import { create } from "zustand";

/**
 * UI-facing game state. The Babylon render loop + netcode write here at a
 * throttled cadence; the React HUD subscribes with selectors. Display only —
 * the client is NEVER authoritative (CLAUDE.md §4). HP/score shown here are the
 * SERVER's values, mirrored for the HUD.
 */
interface HudState {
  fps: number;
  players: number;
  arena: string;
  status: string;
  hp: number;
  score: number;
  downed: boolean;
  setFps: (fps: number) => void;
  setPlayers: (n: number) => void;
  setStatus: (s: string) => void;
  setVitals: (hp: number, score: number) => void;
}

export const useHud = create<HudState>((set) => ({
  fps: 0,
  players: 0,
  arena: "Industrial Arena",
  status: "connecting…",
  hp: 100,
  score: 0,
  downed: false,
  setFps: (fps) => set({ fps }),
  setPlayers: (players) => set({ players }),
  setStatus: (status) => set({ status }),
  setVitals: (hp, score) => set({ hp, score, downed: hp <= 0 }),
}));
