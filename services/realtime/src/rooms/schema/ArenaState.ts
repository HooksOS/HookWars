import { Schema, MapSchema, type } from "@colyseus/schema";

/**
 * Authoritative per-player state. These values are written ONLY by the server
 * simulation (ArenaRoom.update). Clients receive them via Colyseus delta sync
 * and render/interpolate — they never write authoritative fields (CLAUDE.md §4).
 */
export class Player extends Schema {
  @type("string") id = "";
  @type("uint8") faction = 0; // 0=Red 1=Blue 2=Green 3=Black
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") angle = 0; // facing, radians
  @type("uint16") hp = 100;
  @type("uint16") score = 0;
  /** last input sequence the server has processed — drives client reconciliation */
  @type("uint32") lastProcessedInput = 0;
}

export class ArenaState extends Schema {
  @type("string") arena = "Industrial Arena";
  @type("uint8") mode = 0; // 0 = Arena Deathmatch
  @type("number") tick = 0;

  // --- match state (server-authoritative) ---
  @type("uint8") phase = 1; // 0 = warmup, 1 = active, 2 = ended
  @type("uint16") timeLeft = 0; // whole seconds remaining in the round
  @type("uint16") scoreToWin = 0; // first to this many kills wins
  @type("string") winner = ""; // session id of the round winner (when ended)

  @type({ map: Player }) players = new MapSchema<Player>();
}
