# @hookwars/realtime — authoritative game server

Colyseus-based **server-authoritative** Arena Deathmatch room (Phase 2 vertical slice).

## Trust model (CLAUDE.md §4)
Clients send **input intent only** (`{ seq, dx, dz, angle, dt }`). The server:
- validates every input (finite, magnitude-bounded) before queuing,
- rate-limits the input queue (`MAX_INPUTS_PER_TICK`),
- clamps the client-reported `dt` (`MAX_DT`) to kill speed-hacks,
- normalizes direction so diagonals aren't faster,
- simulates at a fixed **30 Hz** tick and enforces arena bounds,
- is the **sole writer** of position/hp/score, and reports `lastProcessedInput`
  back to each client for **prediction reconciliation**.

There is no client-asserted state — the cheating surface is contained in `ArenaRoom.update`.

## Run
```bash
pnpm --filter @hookwars/realtime install
pnpm --filter @hookwars/realtime dev      # ws://localhost:2567, room "arena"
```
Health probe: `GET http://localhost:2567/health` → `{"status":"ok"}`.

## Files
- `src/rooms/schema/ArenaState.ts` — synced state (`Player` map + tick).
- `src/rooms/ArenaRoom.ts` — authoritative simulation + anti-cheat validation.
- `src/index.ts` — HTTP server (health) + Colyseus WS transport.

## Next
- Add combat (server-side hit resolution + lag compensation with a clamped rewind window).
- Wire the Babylon client (`apps/game-client`) via `colyseus.js` with client prediction + entity interpolation.
- Front with Nakama matchmaking; allocate rooms onto an Agones fleet (Phase 3-4).
