import { Client, Room } from "colyseus.js";
import type { InputFrame } from "./protocol";

export interface NetPlayer {
  id: string;
  faction: number;
  x: number;
  z: number;
  angle: number;
  hp: number;
  score: number;
  lastProcessedInput: number;
}

/** Cosmetic shot event broadcast by the server after it resolves the hitscan. */
export interface ShotEvent {
  from: string;
  x: number;
  z: number;
  angle: number;
  hit: string | null;
  dist: number;
}

/** Authoritative match state, mirrored to the HUD. */
export interface MatchState {
  phase: number;
  timeLeft: number;
  scoreToWin: number;
  winner: string;
  teams: [number, number, number, number]; // kills aggregated by faction R/B/G/K
  players: number;
}

export interface NetCallbacks {
  onAdd: (p: NetPlayer) => void;
  onRemove: (id: string) => void;
  onChange: (p: NetPlayer) => void;
  onShot?: (s: ShotEvent) => void;
  onMatch?: (m: MatchState) => void;
  onKill?: (killer: string, victim: string) => void;
}

const ENDPOINT = import.meta.env.VITE_REALTIME_URL ?? "ws://localhost:2567";

/**
 * Thin Colyseus connection wrapper. Joins the authoritative "arena" room,
 * forwards per-player state deltas + shot events to the renderer, and sends
 * input / fire intent. Authority stays entirely server-side.
 */
export class NetClient {
  private room: Room | null = null;
  sessionId = "";

  async connect(cb: NetCallbacks): Promise<void> {
    const client = new Client(ENDPOINT);
    const room = await client.joinOrCreate("arena");
    this.room = room;
    this.sessionId = room.sessionId;

    if (cb.onShot) room.onMessage("shot", cb.onShot);
    room.onMessage("roundStart", () => {});
    room.onMessage("roundEnd", () => {});
    if (cb.onKill) room.onMessage("kill", (m: { killer: string; victim: string }) => cb.onKill!(m.killer, m.victim));
    else room.onMessage("kill", () => {});

    const state = room.state as {
      phase: number;
      timeLeft: number;
      scoreToWin: number;
      winner: string;
      players: {
        size: number;
        onAdd: (cb: (p: NetPlayer, key: string) => void) => void;
        onRemove: (cb: (p: NetPlayer, key: string) => void) => void;
        forEach: (cb: (p: NetPlayer, key: string) => void) => void;
      };
    };

    state.players.onAdd((player, key) => {
      cb.onAdd(snapshot(player, key));
      // @ts-expect-error colyseus schema callback attached at runtime
      player.onChange(() => cb.onChange(snapshot(player, key)));
    });
    state.players.onRemove((_p, key) => cb.onRemove(key));

    if (cb.onMatch) {
      room.onStateChange(() => {
        const teams: [number, number, number, number] = [0, 0, 0, 0];
        state.players.forEach((p) => {
          teams[p.faction % 4] += p.score;
        });
        cb.onMatch!({
          phase: state.phase,
          timeLeft: state.timeLeft,
          scoreToWin: state.scoreToWin,
          winner: state.winner,
          teams,
          players: state.players.size,
        });
      });
    }
  }

  sendInput(input: InputFrame): void {
    this.room?.send("input", input);
  }

  sendFire(angle: number): void {
    this.room?.send("fire", { angle });
  }

  dispose(): void {
    this.room?.leave();
    this.room = null;
  }
}

function snapshot(p: NetPlayer, key: string): NetPlayer {
  return {
    id: key,
    faction: p.faction,
    x: p.x,
    z: p.z,
    angle: p.angle,
    hp: p.hp,
    score: p.score,
    lastProcessedInput: p.lastProcessedInput,
  };
}
