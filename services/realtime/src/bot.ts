import { Client, Room } from "colyseus.js";

/**
 * Scripted bot player(s) — a dev tool to exercise the client's REMOTE-player
 * entity-interpolation path. Each bot joins the authoritative "arena" room and
 * streams input intent (exactly like a human client) in a patrol pattern; the
 * server simulates it and broadcasts state, which a watching browser renders by
 * interpolating ~100 ms in the past.
 *
 *   pnpm --filter @hookwars/realtime bot         # 1 bot
 *   BOTS=3 pnpm --filter @hookwars/realtime bot   # 3 bots
 *
 * The bot sends only inputs; it asserts no authority (CLAUDE.md §4).
 */
const ENDPOINT = process.env.REALTIME_URL ?? "ws://localhost:2567";
const COUNT = Math.max(1, Number(process.env.BOTS ?? 1));
const HZ = 20;
const DT = 1 / HZ;

async function spawnBot(i: number): Promise<Room> {
  const client = new Client(ENDPOINT);
  const room = await client.joinOrCreate("arena");
  console.log(`[bot ${i}] joined arena as ${room.sessionId}`);

  let seq = 0;
  // phase-offset each bot so they trace different arcs and don't overlap
  let t = (i / COUNT) * Math.PI * 2;

  const timer = setInterval(() => {
    t += DT * 0.8;
    const dx = Math.cos(t);
    const dz = Math.sin(t);
    const angle = Math.atan2(dx, dz);
    room.send("input", { seq: ++seq, dx, dz, angle, dt: DT });
  }, 1000 / HZ);

  room.onLeave(() => clearInterval(timer));
  return room;
}

async function main(): Promise<void> {
  const rooms: Room[] = [];
  for (let i = 0; i < COUNT; i++) rooms.push(await spawnBot(i));
  console.log(`[bot] ${COUNT} bot(s) patrolling "arena". Open http://localhost:5173 to watch interpolation. Ctrl+C to stop.`);
  process.on("SIGINT", () => {
    rooms.forEach((r) => r.leave());
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[bot] failed:", err);
  process.exit(1);
});
