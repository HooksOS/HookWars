import { create } from "zustand";

export interface Blip {
  x: number;
  z: number;
  faction: number;
  local: boolean;
  alive: boolean;
}
export interface KillEntry {
  id: number;
  killer: string;
  victim: string;
  you: boolean;
}

/**
 * UI-facing game state for the COMMAND HUD. Written by the Babylon render loop +
 * netcode; read by the React overlay. Everything here mirrors the SERVER's
 * authoritative values (HP, scores, timer, kills) — the client is never the
 * source of truth (CLAUDE.md §4). Ammo is the only cosmetic, client-side value.
 */
interface HudState {
  fps: number;
  status: string;
  arena: string;

  // local player (server-authoritative)
  hp: number;
  score: number;
  downed: boolean;

  // match (server-authoritative)
  phase: number; // 1 active, 2 ended
  timeLeft: number; // seconds
  winnerIsLocal: boolean;
  ended: boolean;
  teams: [number, number, number, number]; // R/B/G/K aggregated kills
  playerCount: number;

  // radar
  blips: Blip[];

  // killfeed
  killfeed: KillEntry[];

  // cosmetic weapon (client-side)
  ammo: number;
  ammoMax: number;
  reserve: number;

  setFps: (n: number) => void;
  setStatus: (s: string) => void;
  setLocal: (hp: number, score: number) => void;
  setMatch: (m: { phase: number; timeLeft: number; winnerIsLocal: boolean; teams: [number, number, number, number]; players: number }) => void;
  setBlips: (b: Blip[]) => void;
  pushKill: (e: { killer: string; victim: string; you: boolean }) => void;
  setAmmo: (ammo: number) => void;
}

let killSeq = 0;

export const useHud = create<HudState>((set) => ({
  fps: 0,
  status: "connecting…",
  arena: "SECTOR 7",
  hp: 100,
  score: 0,
  downed: false,
  phase: 1,
  timeLeft: 0,
  winnerIsLocal: false,
  ended: false,
  teams: [0, 0, 0, 0],
  playerCount: 0,
  blips: [],
  killfeed: [],
  ammo: 30,
  ammoMax: 30,
  reserve: 120,
  setFps: (fps) => set({ fps }),
  setStatus: (status) => set({ status }),
  setLocal: (hp, score) => set({ hp, score, downed: hp <= 0 }),
  setMatch: (m) =>
    set({ phase: m.phase, timeLeft: m.timeLeft, winnerIsLocal: m.winnerIsLocal, ended: m.phase === 2, teams: m.teams, playerCount: m.players }),
  setBlips: (blips) => set({ blips }),
  pushKill: (e) => set((s) => ({ killfeed: [...s.killfeed, { ...e, id: ++killSeq }].slice(-3) })),
  setAmmo: (ammo) => set({ ammo }),
}));
