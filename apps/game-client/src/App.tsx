import { useEffect, useRef } from "react";
import { createArena } from "./game/scene";
import { useHud } from "./store";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setFps = useHud((s) => s.setFps);

  useEffect(() => {
    if (!canvasRef.current) return;
    const dispose = createArena(canvasRef.current, setFps);
    return dispose;
  }, [setFps]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />
      <Hud />
    </div>
  );
}

function Hud() {
  const fps = useHud((s) => s.fps);
  const players = useHud((s) => s.players);
  const arena = useHud((s) => s.arena);

  const panel: React.CSSProperties = {
    position: "absolute",
    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
    color: "#dff6ff",
    background: "rgba(5,12,22,0.55)",
    border: "1px solid rgba(60,160,220,0.35)",
    borderRadius: 8,
    padding: "10px 14px",
    backdropFilter: "blur(4px)",
    pointerEvents: "none",
  };

  return (
    <>
      <div style={{ ...panel, top: 16, left: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2, color: "#46d0ff" }}>HOOKWARS</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>{arena} · Base · $BULLET</div>
      </div>
      <div style={{ ...panel, top: 16, right: 16, textAlign: "right" }}>
        <div>FPS {fps}</div>
        <div>PLAYERS {players}/8</div>
      </div>
      <div style={{ ...panel, bottom: 16, left: 16, fontSize: 12, opacity: 0.85 }}>
        web-only · Babylon.js · server-authoritative (client carries no authority)
      </div>
    </>
  );
}
