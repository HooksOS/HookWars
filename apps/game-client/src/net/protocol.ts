/**
 * Shared netcode constants + types. These MUST match the authoritative server
 * (services/realtime/src/rooms/ArenaRoom.ts). The client mirrors the movement
 * model ONLY to predict the local player; the server remains the source of truth.
 */
export const TICK_HZ = 30;
export const MAX_SPEED = 6; // world units / second (server-enforced cap)
export const ARENA_RADIUS = 14; // keep players inside the ring
export const INTERP_DELAY_MS = 100; // render remote players this far in the past

/** One input frame the client sends. Intent only — never state. */
export interface InputFrame {
  seq: number;
  dx: number;
  dz: number;
  angle: number;
  dt: number;
}

/** Apply one movement step using the SAME rules as the server (for prediction). */
export function stepMovement(
  pos: { x: number; z: number },
  dx: number,
  dz: number,
  dt: number,
): { x: number; z: number } {
  let ndx = dx;
  let ndz = dz;
  const len = Math.hypot(ndx, ndz);
  if (len > 1) {
    ndx /= len;
    ndz /= len;
  }
  let x = pos.x + ndx * MAX_SPEED * dt;
  let z = pos.z + ndz * MAX_SPEED * dt;
  const r = Math.hypot(x, z);
  if (r > ARENA_RADIUS) {
    x = (x / r) * ARENA_RADIUS;
    z = (z / r) * ARENA_RADIUS;
  }
  return { x, z };
}
