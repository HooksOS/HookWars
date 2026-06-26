import { Room, Client } from "colyseus";
import { ArenaState, Player } from "./schema/ArenaState";

/** One input frame sent by a client. The client sends INTENT only. */
interface InputMessage {
  seq: number; // monotonic sequence for server reconciliation
  dx: number; // desired move direction x in [-1, 1]
  dz: number; // desired move direction z in [-1, 1]
  angle: number; // facing
  dt: number; // client frame delta (seconds) — clamped server-side
}

/** A fire intent. The client asks to shoot in a direction; the server decides hits. */
interface FireMessage {
  angle: number; // aim direction (radians), same convention as movement: dir = (sin, cos)
}

const TICK_HZ = 30;
const TICK_MS = 1000 / TICK_HZ;
const MAX_SPEED = 6; // world units / second — the authoritative speed cap
const ARENA_RADIUS = 14; // keep players inside the ring (matches client scene)
const MAX_DT = 0.1; // never trust a client dt larger than this (anti-speedhack)
const MAX_INPUTS_PER_TICK = 4; // drop floods (rate-limit / anti-cheat)

// --- combat tuning (all server-authoritative) ---
// Timing uses wall-clock (Date.now) not tick counts, so cooldown/respawn/round
// length stay accurate even if the sim loop runs below its nominal rate.
const FIRE_COOLDOWN_MS = 250; // min interval between shots (rate-limit)
const FIRE_RANGE = 22; // hitscan max distance (world units)
const FIRE_DAMAGE = 34; // 3 shots to down a 100 HP player
const PLAYER_RADIUS = 0.7; // hit cylinder radius (matches character footprint)
const MAX_HP = 100;
const RESPAWN_MS = 3000; // 3 s respawn delay

// --- match flow (server-authoritative; tunable via env for tests/ops) ---
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS ?? 180); // round length
const SCORE_TO_WIN = Number(process.env.SCORE_TO_WIN ?? 10); // first to N kills ends early
const POSTROUND_MS = Number(process.env.POSTROUND_SECONDS ?? 6) * 1000; // scoreboard hold
const PHASE_ACTIVE = 1;
const PHASE_ENDED = 2;

/**
 * Server-authoritative Arena Deathmatch room.
 *
 * Trust model (CLAUDE.md §4 "Never trust the client"): clients submit only input
 * intent; the server validates it, clamps speed/bounds, simulates at a fixed 30 Hz
 * tick, and is the sole writer of position/hp/score. Cheating surface is contained
 * here — there is no client-asserted state.
 */
export class ArenaRoom extends Room<ArenaState> {
  maxClients = 8;

  /** queued inputs per client session id, drained each simulation tick */
  private queues = new Map<string, InputMessage[]>();
  /** wall-clock ms of each player's last shot — enforces the fire cooldown */
  private lastFireMs = new Map<string, number>();
  /** wall-clock ms at which a downed player respawns */
  private respawnAtMs = new Map<string, number>();
  /** wall-clock ms the current round started (for the countdown) */
  private roundStartMs = 0;
  /** wall-clock ms the post-round scoreboard hold ends and the next round begins */
  private postRoundEndMs = 0;

  onCreate(): void {
    this.setState(new ArenaState());
    this.state.scoreToWin = SCORE_TO_WIN;
    this.startRound();
    this.setSimulationInterval((deltaMs) => this.update(deltaMs), TICK_MS);

    this.onMessage("input", (client, message: InputMessage) => {
      if (!this.isValidInput(message)) return; // reject malformed/hostile input
      const q = this.queues.get(client.sessionId);
      if (!q) return;
      if (q.length >= MAX_INPUTS_PER_TICK) q.shift(); // bound the queue
      q.push(message);
    });

    this.onMessage("fire", (client, message: FireMessage) => {
      this.handleFire(client.sessionId, message);
    });
  }

  onJoin(client: Client): void {
    const count = this.state.players.size;
    const player = new Player();
    player.id = client.sessionId;
    player.faction = count % 4;
    this.placeAtSpawn(player, this.freeSpawnSlot());
    this.state.players.set(client.sessionId, player);
    this.queues.set(client.sessionId, []);
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.queues.delete(client.sessionId);
    this.lastFireMs.delete(client.sessionId);
    this.respawnAtMs.delete(client.sessionId);
  }

  /** Spawn / respawn a player at an evenly-distributed ring position with full HP. */
  private placeAtSpawn(player: Player, slot: number): void {
    const a = (slot / this.maxClients) * Math.PI * 2;
    player.x = Math.cos(a) * (ARENA_RADIUS - 4);
    player.z = Math.sin(a) * (ARENA_RADIUS - 4);
    player.angle = a + Math.PI;
    player.hp = MAX_HP;
  }

  /** Ring slot farthest from all live players — prevents spawning on top of someone. */
  private freeSpawnSlot(exclude?: string): number {
    let bestSlot = 0;
    let bestMinDist = -1;
    for (let s = 0; s < this.maxClients; s++) {
      const a = (s / this.maxClients) * Math.PI * 2;
      const x = Math.cos(a) * (ARENA_RADIUS - 4);
      const z = Math.sin(a) * (ARENA_RADIUS - 4);
      let minD = Infinity;
      this.state.players.forEach((p, id) => {
        if (id === exclude || p.hp <= 0) return;
        minD = Math.min(minD, Math.hypot(p.x - x, p.z - z));
      });
      if (minD > bestMinDist) {
        bestMinDist = minD;
        bestSlot = s;
      }
    }
    return bestSlot;
  }

  /**
   * Authoritative hitscan. The client only asks to fire in a direction; the
   * SERVER validates the cooldown, ray-casts against current authoritative
   * positions, applies damage, and awards score. Clients cannot claim a hit.
   */
  private handleFire(sid: string, msg: FireMessage): void {
    if (!msg || !Number.isFinite(msg.angle)) return;
    const shooter = this.state.players.get(sid);
    if (!shooter || shooter.hp <= 0) return; // dead players can't shoot
    if (this.state.phase !== PHASE_ACTIVE) return; // no fighting between rounds

    const nowMs = Date.now();
    const last = this.lastFireMs.get(sid) ?? -FIRE_COOLDOWN_MS;
    if (nowMs - last < FIRE_COOLDOWN_MS) return; // rate-limited
    this.lastFireMs.set(sid, nowMs);

    // aim direction matches the movement convention: dir = (sin(angle), cos(angle))
    const dirX = Math.sin(msg.angle);
    const dirZ = Math.cos(msg.angle);

    let hitId: string | null = null;
    let hitDist = FIRE_RANGE;
    this.state.players.forEach((target, tid) => {
      if (tid === sid || target.hp <= 0) return;
      // project target onto the ray; reject if behind or beyond range
      const ox = target.x - shooter.x;
      const oz = target.z - shooter.z;
      const proj = ox * dirX + oz * dirZ;
      if (proj <= 0 || proj > FIRE_RANGE) return;
      // perpendicular distance from ray to target centre
      const perp = Math.hypot(ox - dirX * proj, oz - dirZ * proj);
      if (perp <= PLAYER_RADIUS && proj < hitDist) {
        hitDist = proj;
        hitId = tid;
      }
    });

    if (hitId) {
      const target = this.state.players.get(hitId)!;
      target.hp = Math.max(0, target.hp - FIRE_DAMAGE);
      if (target.hp === 0) {
        shooter.score++;
        this.respawnAtMs.set(hitId, nowMs + RESPAWN_MS);
        this.broadcast("kill", { killer: sid, victim: hitId });
        if (this.state.phase === PHASE_ACTIVE && shooter.score >= this.state.scoreToWin) {
          this.endRound(sid);
        }
      }
    }

    // tracer/feedback event — purely cosmetic; authority already applied above
    this.broadcast("shot", {
      from: sid,
      x: shooter.x,
      z: shooter.z,
      angle: msg.angle,
      hit: hitId,
      dist: hitId ? hitDist : FIRE_RANGE,
    });
  }

  /** Structural validation before an input is ever queued. */
  private isValidInput(m: InputMessage): boolean {
    return (
      m != null &&
      Number.isFinite(m.seq) &&
      Number.isFinite(m.dx) &&
      Number.isFinite(m.dz) &&
      Number.isFinite(m.angle) &&
      Number.isFinite(m.dt) &&
      Math.abs(m.dx) <= 1.001 &&
      Math.abs(m.dz) <= 1.001
    );
  }

  /** Begin a fresh round: reset scores, respawn everyone, restart the clock. */
  private startRound(): void {
    this.state.phase = PHASE_ACTIVE;
    this.state.winner = "";
    this.state.timeLeft = ROUND_SECONDS;
    this.roundStartMs = Date.now();
    this.respawnAtMs.clear();
    this.lastFireMs.clear();
    let slot = 0;
    this.state.players.forEach((player) => {
      player.score = 0;
      this.placeAtSpawn(player, slot++);
    });
    this.broadcast("roundStart", {});
  }

  /** End the round, freeze the result, and hold the scoreboard briefly. */
  private endRound(winnerId: string): void {
    this.state.phase = PHASE_ENDED;
    this.state.winner = winnerId;
    this.state.timeLeft = 0;
    this.postRoundEndMs = Date.now() + POSTROUND_MS;
    this.broadcast("roundEnd", { winner: winnerId });
  }

  /** Session id of the current highest scorer (empty string if nobody scored). */
  private leader(): string {
    let bestId = "";
    let best = 0;
    this.state.players.forEach((player, sid) => {
      if (player.score > best) {
        best = player.score;
        bestId = sid;
      }
    });
    return bestId;
  }

  /** Advance match timing: countdown while active, auto-restart after a result. */
  private updateMatch(): void {
    const nowMs = Date.now();
    if (this.state.phase === PHASE_ACTIVE) {
      const elapsed = Math.floor((nowMs - this.roundStartMs) / 1000);
      const left = Math.max(0, ROUND_SECONDS - elapsed);
      if (left !== this.state.timeLeft) this.state.timeLeft = left;
      if (left === 0) this.endRound(this.leader()); // time-limit win goes to the leader
    } else if (this.state.phase === PHASE_ENDED && nowMs >= this.postRoundEndMs) {
      this.startRound();
    }
  }

  /** Fixed-timestep authoritative simulation. */
  private update(deltaMs: number): void {
    const dt = deltaMs / 1000;
    this.state.tick++;

    this.updateMatch();

    // respawn any downed players whose timer has elapsed
    if (this.respawnAtMs.size > 0) {
      const nowMs = Date.now();
      this.respawnAtMs.forEach((whenMs, sid) => {
        if (nowMs < whenMs) return;
        const player = this.state.players.get(sid);
        if (player) this.placeAtSpawn(player, this.freeSpawnSlot(sid));
        this.respawnAtMs.delete(sid);
      });
    }

    this.state.players.forEach((player, sessionId) => {
      if (player.hp <= 0) return; // downed players don't move until they respawn
      const q = this.queues.get(sessionId);
      if (!q || q.length === 0) return;

      for (const input of q) {
        // clamp the client-reported dt — the server decides how far you can move
        const stepDt = Math.min(Math.max(input.dt, 0), MAX_DT, dt);

        // normalize direction so diagonal isn't faster (anti-cheat on magnitude)
        let { dx, dz } = input;
        const len = Math.hypot(dx, dz);
        if (len > 1) {
          dx /= len;
          dz /= len;
        }

        let nx = player.x + dx * MAX_SPEED * stepDt;
        let nz = player.z + dz * MAX_SPEED * stepDt;

        // hard arena bounds (server-enforced — clients cannot leave the ring)
        const r = Math.hypot(nx, nz);
        if (r > ARENA_RADIUS) {
          nx = (nx / r) * ARENA_RADIUS;
          nz = (nz / r) * ARENA_RADIUS;
        }

        player.x = nx;
        player.z = nz;
        player.angle = input.angle;
        player.lastProcessedInput = input.seq;
      }
      q.length = 0; // drained
    });
  }
}
