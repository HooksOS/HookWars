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

const TICK_HZ = 30;
const TICK_MS = 1000 / TICK_HZ;
const MAX_SPEED = 6; // world units / second — the authoritative speed cap
const ARENA_RADIUS = 14; // keep players inside the ring (matches client scene)
const MAX_DT = 0.1; // never trust a client dt larger than this (anti-speedhack)
const MAX_INPUTS_PER_TICK = 4; // drop floods (rate-limit / anti-cheat)

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
  }

  onJoin(client: Client): void {
    const count = this.state.players.size;
    const player = new Player();
    player.id = client.sessionId;
    player.faction = count % 4;
    // spawn evenly around the ring
    const a = (count / this.maxClients) * Math.PI * 2;
    player.x = Math.cos(a) * (ARENA_RADIUS - 4);
    player.z = Math.sin(a) * (ARENA_RADIUS - 4);
    player.angle = a + Math.PI;
    this.state.players.set(client.sessionId, player);
    this.queues.set(client.sessionId, []);
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.queues.delete(client.sessionId);
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

    this.state.players.forEach((player, sessionId) => {
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
