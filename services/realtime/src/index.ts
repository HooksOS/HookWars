import { createServer } from "node:http";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ArenaRoom } from "./rooms/ArenaRoom";

const PORT = Number(process.env.PORT ?? 2567);

const httpServer = createServer((req, res) => {
  // lightweight health endpoint for k8s liveness/readiness probes
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "realtime" }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("arena", ArenaRoom);

gameServer
  .listen(PORT)
  .then(() => console.log(`[realtime] HookWars authoritative server on ws://localhost:${PORT} (room: "arena")`))
  .catch((err) => {
    console.error("[realtime] failed to start:", err);
    process.exit(1);
  });
