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
const FIRE_COOLDOWN_TICKS = 8; // ~250 ms between shots at 30 Hz (rate-limit)
const FIRE_RANGE = 22; // hitscan max distance (world units)
const FIRE_DAMAGE = 34; // 3 shots to down a 100 HP player
const PLAYER_RADIUS = 0.7; // hit cylinder radius (matches character footprint)
const MAX_HP = 100;
const RESPAWN_TICKS = TICK_HZ * 3; // 3 s respawn delay

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
  /** tick of each player's last shot — enforces the server-side fire cooldown */
  private lastFireTick = new Map<string, number>();
  /** tick at which a downed player respawns */
  private respawnAt = new Map<string, number>();

  onCreate(): void {
    this.setState(new ArenaState());
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
    this.placeAtSpawn(player, count);
    this.state.players.set(client.sessionId, player);
    this.queues.set(client.sessionId, []);
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.queues.delete(client.sessionId);
    this.lastFireTick.delete(client.sessionId);
    this.respawnAt.delete(client.sessionId);
  }

  /** Spawn / respawn a player at an evenly-distributed ring position with full HP. */
  private placeAtSpawn(player: Player, slot: number): void {
    const a = (slot / this.maxClients) * Math.PI * 2;
    player.x = Math.cos(a) * (ARENA_RADIUS - 4);
    player.z = Math.sin(a) * (ARENA_RADIUS - 4);
    player.angle = a + Math.PI;
    player.hp = MAX_HP;
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

    const last = this.lastFireTick.get(sid) ?? -FIRE_COOLDOWN_TICKS;
    if (this.state.tick - last < FIRE_COOLDOWN_TICKS) return; // rate-limited
    this.lastFireTick.set(sid, this.state.tick);

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
        this.respawnAt.set(hitId, this.state.tick + RESPAWN_TICKS);
        this.broadcast("kill", { killer: sid, victim: hitId });
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

  /** Fixed-timestep authoritative simulation. */
  private update(deltaMs: number): void {
    const dt = deltaMs / 1000;
    this.state.tick++;

    // respawn any downed players whose timer has elapsed
    if (this.respawnAt.size > 0) {
      let slot = 0;
      this.respawnAt.forEach((tick, sid) => {
        if (this.state.tick < tick) {
          slot++;
          return;
        }
        const player = this.state.players.get(sid);
        if (player) this.placeAtSpawn(player, slot);
        this.respawnAt.delete(sid);
        slot++;
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
