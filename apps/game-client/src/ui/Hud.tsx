import { useHud } from "../store";
import { Emblem } from "./Emblem";
import { ARENA_RADIUS } from "../net/protocol";

/**
 * COMMAND in-match HUD — pixel-faithful recreation of design screen 08.
 * Tokens, fonts, sizes, and colors match design_handoff_hookwars §8 exactly.
 * Wired to authoritative state: HP, score, timer, team kills, killfeed, radar.
 * Cosmetic (client-side) placeholders, matching the mock: abilities, armor, weapon.
 */

const FACTION_COLORS = ["#FF4D43", "#2E8BFF", "#2BD66A", "#6E7A8F"];
const FACTION_NAMES = ["DOMINION", "VANGUARD", "SYNDICATE", "WRAITH"];
const mono = "var(--font-mono)";
const disp = "var(--font-display)";

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function Hud() {
  return (
    <>
      <BrandTag />
      <Crosshair />
      <Minimap />
      <ScoreBar />
      <Killfeed />
      <BottomLeft />
      <Ammo />
      <BottomRight />
      <Connection />
      <EndBanner />
    </>
  );
}

const overlay: React.CSSProperties = { position: "absolute", pointerEvents: "none" };

function BrandTag() {
  return (
    <div style={{ ...overlay, top: 18, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 8, opacity: 0.0 }}>
      <Emblem size={28} />
    </div>
  );
}

function Crosshair() {
  const c = "#FFB22E";
  return (
    <div style={{ ...overlay, left: "50%", top: "50%", width: 54, height: 54, transform: "translate(-50%,-50%)" }}>
      <div style={{ position: "absolute", inset: 0, border: "1.5px solid rgba(255,178,46,.85)", borderRadius: "50%" }} />
      <div style={{ position: "absolute", left: "50%", top: -10, width: 2, height: 12, background: c, transform: "translateX(-50%)" }} />
      <div style={{ position: "absolute", left: "50%", bottom: -10, width: 2, height: 12, background: c, transform: "translateX(-50%)" }} />
      <div style={{ position: "absolute", top: "50%", left: -10, height: 2, width: 12, background: c, transform: "translateY(-50%)" }} />
      <div style={{ position: "absolute", top: "50%", right: -10, height: 2, width: 12, background: c, transform: "translateY(-50%)" }} />
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 3, height: 3, background: "#FF4D43", borderRadius: "50%", transform: "translate(-50%,-50%)" }} />
    </div>
  );
}

function Minimap() {
  const blips = useHud((s) => s.blips);
  const arena = useHud((s) => s.arena);
  const R = ARENA_RADIUS;
  const toPx = (v: number) => (v / R) * 0.5 * 0.86 * 208 + 104; // fit ring inside 208 box
  return (
    <div style={{ ...overlay, top: 22, left: 22, width: 208 }}>
      <div style={{ position: "relative", width: 208, height: 208, border: "1px solid rgba(255,178,46,.4)", borderRadius: 4, background: "rgba(10,13,19,.66)", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.06) 1px,transparent 1px)", backgroundSize: "26px 26px" }} />
        <div style={{ position: "absolute", top: 6, left: 8, fontFamily: mono, fontSize: 10, letterSpacing: ".14em", color: "#FFB22E" }}>{arena}</div>
        {blips.map((b, i) =>
          b.local ? (
            <div key={i} style={{ position: "absolute", left: toPx(b.x), top: toPx(b.z), width: 8, height: 8, background: "#FFB22E", transform: "translate(-50%,-50%) rotate(45deg)", opacity: b.alive ? 1 : 0.3 }} />
          ) : (
            <div key={i} style={{ position: "absolute", left: toPx(b.x), top: toPx(b.z), width: 6, height: 6, borderRadius: "50%", background: FACTION_COLORS[b.faction % 4], transform: "translate(-50%,-50%)", opacity: b.alive ? 1 : 0.3 }} />
          ),
        )}
      </div>
    </div>
  );
}

function ScoreBar() {
  const teams = useHud((s) => s.teams);
  const timeLeft = useHud((s) => s.timeLeft);
  const total = Math.max(1, teams[0] + teams[1] + teams[2] + teams[3]);
  const seg = (i: number) => Math.max(i < 2 ? 18 : 0, (teams[i] / total) * 140);
  const segColors = ["#FF4D43", "#2E8BFF", "#2BD66A", "#6E7A8F"];
  return (
    <div style={{ ...overlay, top: 22, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(10,13,19,.7)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 6, padding: "8px 18px" }}>
        <span style={{ fontFamily: disp, fontWeight: 800, fontSize: 24, color: "#FF4D43" }}>{teams[0]}</span>
        <span style={{ fontFamily: mono, fontSize: 13, color: "#F4F6FA", letterSpacing: ".1em" }}>{mmss(timeLeft)}</span>
        <span style={{ fontFamily: disp, fontWeight: 800, fontSize: 24, color: "#2E8BFF" }}>{teams[1]}</span>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{ width: seg(i), height: 4, background: segColors[i] }} />
        ))}
      </div>
      <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".16em", color: "#FFB22E" }}>◈ ARENA DEATHMATCH · FIRST TO 10</span>
    </div>
  );
}

function Killfeed() {
  const killfeed = useHud((s) => s.killfeed);
  return (
    <div style={{ ...overlay, top: 22, right: 22, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      {killfeed.map((k) =>
        k.you ? (
          <div key={k.id} style={{ background: "rgba(255,178,46,.16)", border: "1px solid rgba(255,178,46,.4)", borderRadius: 4, padding: "6px 12px", fontFamily: mono, fontSize: 12, color: "#FFB22E" }}>
            YOU ▸ {k.victim} · ELIM
          </div>
        ) : (
          <div key={k.id} style={{ background: "rgba(10,13,19,.66)", borderRadius: 4, padding: "6px 12px", fontFamily: mono, fontSize: 12 }}>
            <span style={{ color: "#98A4B8" }}>{k.killer}</span> <span style={{ color: "#98A4B8" }}>▸</span> <span style={{ color: "#FF4D43" }}>{k.victim}</span>
          </div>
        ),
      )}
    </div>
  );
}

function BottomLeft() {
  const hp = useHud((s) => s.hp);
  const faction = 0; // local faction surfaced via store.teams index in a fuller build
  const hpFrac = Math.max(0, Math.min(1, hp / 100));
  return (
    <div style={{ ...overlay, bottom: 24, left: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 12 }}>
        <Ability label="DASH" k="Q" />
        <Ability label="BREACH" k="E" color="#FF4D43" />
        <div style={{ width: 72, height: 72, border: "2px solid #FFB22E", borderRadius: 8, background: "linear-gradient(0deg,rgba(255,178,46,.25),rgba(10,13,19,.7))", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontFamily: disp, fontWeight: 800, fontSize: 13, color: "#FFB22E", textAlign: "center", lineHeight: 0.9 }}>ULT<br />READY</span>
          <span style={{ position: "absolute", bottom: -2, right: 4, fontFamily: mono, fontSize: 10, color: "#FFB22E" }}>X</span>
        </div>
      </div>
      <div style={{ fontFamily: disp, fontWeight: 800, fontSize: 18, color: "#F4F6FA", marginBottom: 4 }}>
        BREACHER <span style={{ fontFamily: mono, fontSize: 11, color: FACTION_COLORS[faction] }}>· {FACTION_NAMES[faction]}</span>
      </div>
      <div style={{ width: 300, height: 14, background: "rgba(10,13,19,.7)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 3, overflow: "hidden", display: "flex" }}>
        <div style={{ width: `${hpFrac * 100}%`, height: "100%", background: "#2BD66A", transition: "width 120ms var(--ease)" }} />
        <div style={{ flex: 1, background: "rgba(43,214,106,.12)" }} />
      </div>
      <div style={{ width: 300, height: 7, background: "rgba(10,13,19,.7)", border: "1px solid rgba(46,139,255,.4)", borderRadius: 3, overflow: "hidden", marginTop: 4 }}>
        <div style={{ width: "58%", height: "100%", background: "#2E8BFF" }} />
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 5, fontFamily: mono, fontSize: 11, color: "#C9D3E2" }}>
        <span>HP <span style={{ color: "#2BD66A" }}>{Math.ceil(hp)}</span></span>
        <span>ARM <span style={{ color: "#2E8BFF" }}>41</span></span>
      </div>
    </div>
  );
}

function Ability({ label, k, color = "#F4F6FA" }: { label: string; k: string; color?: string }) {
  const tinted = color !== "#F4F6FA";
  return (
    <div style={{ width: 60, height: 60, border: `1px solid ${tinted ? "rgba(255,77,67,.5)" : "rgba(255,255,255,.2)"}`, borderRadius: 6, background: tinted ? "rgba(255,77,67,.12)" : "rgba(10,13,19,.7)", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontFamily: disp, fontWeight: 800, fontSize: 13, color, textAlign: "center", lineHeight: 0.9 }}>{label}</span>
      <span style={{ position: "absolute", bottom: -2, right: 3, fontFamily: mono, fontSize: 10, color: "#98A4B8" }}>{k}</span>
    </div>
  );
}

function Ammo() {
  const ammo = useHud((s) => s.ammo);
  const ammoMax = useHud((s) => s.ammoMax);
  const reserve = useHud((s) => s.reserve);
  return (
    <div style={{ ...overlay, bottom: 24, left: "50%", transform: "translateX(-50%)", textAlign: "center" }}>
      <div style={{ fontFamily: disp, fontWeight: 800, fontSize: 54, lineHeight: 0.8, color: "#F4F6FA" }}>
        {ammo}
        <span style={{ fontSize: 24, color: "#98A4B8" }}>/{ammoMax}</span>
      </div>
      <div style={{ fontFamily: mono, fontSize: 12, letterSpacing: ".14em", color: "#FFB22E" }}>WARLORD AR · ◈{reserve} RSV</div>
    </div>
  );
}

function BottomRight() {
  const score = useHud((s) => s.score);
  const players = useHud((s) => s.playerCount);
  return (
    <div style={{ ...overlay, bottom: 24, right: 24, textAlign: "right" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12, alignItems: "flex-end" }}>
        <div style={{ background: "rgba(10,13,19,.66)", borderRadius: 4, padding: "6px 12px", fontFamily: mono, fontSize: 12, color: "#C9D3E2" }}>
          <span style={{ color: "#2E8BFF" }}>●</span> {players} OPERATORS ONLINE
        </div>
      </div>
      <div style={{ background: "rgba(255,178,46,.14)", border: "1px solid rgba(255,178,46,.4)", borderRadius: 5, padding: "9px 14px", display: "inline-block" }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: "#98A4B8", letterSpacing: ".1em" }}>THIS MATCH</div>
        <div style={{ fontFamily: disp, fontWeight: 800, fontSize: 26, color: "#FFB22E", lineHeight: 0.9 }}>
          ◈ {score * 20} <span style={{ fontSize: 13, color: "#C9D3E2" }}>$BULLET</span>
        </div>
      </div>
      <div style={{ fontFamily: mono, fontSize: 12, color: "#C9D3E2", marginTop: 8 }}>
        ELIM <span style={{ color: "#F4F6FA" }}>{score}</span> · K/D <span style={{ color: "#2BD66A" }}>—</span>
      </div>
    </div>
  );
}

function Connection() {
  const status = useHud((s) => s.status);
  const fps = useHud((s) => s.fps);
  return (
    <div style={{ ...overlay, bottom: 6, left: 24, fontFamily: mono, fontSize: 10, letterSpacing: ".1em", color: "#5B6678" }}>
      {status.toUpperCase()} · {fps} FPS · WASD MOVE · MOUSE AIM · CLICK FIRE
    </div>
  );
}

function EndBanner() {
  const ended = useHud((s) => s.ended);
  const won = useHud((s) => s.winnerIsLocal);
  if (!ended) return null;
  return (
    <div style={{ ...overlay, inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(60% 50% at 50% 50%, rgba(10,13,19,.55), transparent)" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: disp, fontWeight: 800, fontSize: 96, lineHeight: 0.85, color: won ? "#FFB22E" : "#FF4D43", textShadow: won ? "0 0 40px rgba(255,178,46,.5)" : "0 0 40px rgba(255,77,67,.4)" }}>
          {won ? "VICTORY" : "ROUND OVER"}
        </div>
        <div style={{ fontFamily: mono, fontSize: 13, letterSpacing: ".2em", color: "#98A4B8", marginTop: 8 }}>NEXT ROUND STARTING…</div>
      </div>
    </div>
  );
}
