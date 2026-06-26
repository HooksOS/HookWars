import { useEffect, useRef } from "react";
import { createWorld } from "./game/world";
import { useHud } from "./store";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { setFps, setPlayers, setStatus, setVitals } = useHud.getState();

  useEffect(() => {
    if (!canvasRef.current) return;
    const dispose = createWorld(canvasRef.current, {
      onFps: setFps,
      onPlayers: setPlayers,
      onStatus: setStatus,
      onVitals: setVitals,
    });
    return dispose;
  }, [setFps, setPlayers, setStatus, setVitals]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />
      <Hud />
    </div>
  );
}

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

function Hud() {
  const fps = useHud((s) => s.fps);
  const players = useHud((s) => s.players);
  const arena = useHud((s) => s.arena);
  const status = useHud((s) => s.status);
  const hp = useHud((s) => s.hp);
  const score = useHud((s) => s.score);
  const downed = useHud((s) => s.downed);

  const hpFrac = Math.max(0, Math.min(1, hp / 100));
  const hpColor = hpFrac > 0.5 ? "#46d0ff" : hpFrac > 0.25 ? "#f5c451" : "#ff5b5b";

  return (
    <>
      <div style={{ ...panel, top: 16, left: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2, color: "#46d0ff" }}>HOOKWARS</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>{arena} · Base · $BULLET</div>
      </div>

      <div style={{ ...panel, top: 16, right: 16, textAlign: "right" }}>
        <div>FPS {fps}</div>
        <div>PLAYERS {players}</div>
        <div>SCORE {score}</div>
      </div>

      {/* health bar */}
      <div style={{ ...panel, bottom: 64, left: "50%", transform: "translateX(-50%)", padding: "8px 12px", width: 260 }}>
        <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 4 }}>HP {Math.ceil(hp)}</div>
        <div style={{ height: 10, background: "rgba(255,255,255,0.1)", borderRadius: 5, overflow: "hidden" }}>
          <div style={{ width: `${hpFrac * 100}%`, height: "100%", background: hpColor, transition: "width 120ms, background 120ms" }} />
        </div>
      </div>

      <div style={{ ...panel, bottom: 16, left: 16, fontSize: 12, opacity: 0.85 }}>
        <div>WASD move · mouse aim · click to fire · {status}</div>
        <div style={{ opacity: 0.7 }}>server-authoritative · client predicts &amp; interpolates only</div>
      </div>

      {downed && (
        <div
          style={{
            ...panel,
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            textAlign: "center",
            borderColor: "rgba(255,91,91,0.6)",
            fontSize: 20,
            fontWeight: 700,
            color: "#ff8a8a",
          }}
        >
          DOWNED
          <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.85, marginTop: 4 }}>respawning…</div>
        </div>
      )}
    </>
  );
}
