import { useEffect, useRef } from "react";
import { createWorld } from "./game/world";
import { Hud } from "./ui/Hud";
import "./ui/tokens.css";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    return createWorld(canvasRef.current);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "var(--void)" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />
      {/* gameplay vignette, matching design §8 */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(10,13,19,.55) 100%)" }} />
      <Hud />
    </div>
  );
}
