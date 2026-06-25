import { create } from "zustand";

/**
 * UI-facing game state. The Babylon render loop writes here at a throttled
 * cadence (~10 Hz); React HUD subscribes with selectors. The client is NEVER
 * authoritative — these are display values only (CLAUDE.md §4).
 */
interface HudState {
  fps: number;
  players: number;
  arena: string;
  setFps: (fps: number) => void;
}

export const useHud = create<HudState>((set) => ({
  fps: 0,
  players: 8,
  arena: "Industrial Arena",
  setFps: (fps) => set({ fps }),
}));
