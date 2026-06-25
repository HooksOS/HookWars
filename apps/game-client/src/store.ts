import { create } from "zustand";

/**
 * UI-facing game state. The Babylon render loop + netcode write here at a
 * throttled cadence; the React HUD subscribes with selectors. Display only —
 * the client is NEVER authoritative (CLAUDE.md §4).
 */
interface HudState {
  fps: number;
  players: number;
  arena: string;
  status: string;
  setFps: (fps: number) => void;
  setPlayers: (n: number) => void;
  setStatus: (s: string) => void;
}

export const useHud = create<HudState>((set) => ({
  fps: 0,
  players: 0,
  arena: "Industrial Arena",
  status: "connecting…",
  setFps: (fps) => set({ fps }),
  setPlayers: (players) => set({ players }),
  setStatus: (status) => set({ status }),
}));
