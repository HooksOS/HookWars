/**
 * HW hexagon emblem — the app icon / favicon / brand mark.
 * Hexagon per the brand spec: points at top- and bottom-center, flat sides.
 * Outer hex amber, inner hex void, "HW" in Saira Condensed 800.
 */
export function Emblem({ size = 40 }: { size?: number }) {
  const pts = "50,1 99,25 99,75 50,99 1,75 1,25";
  const inset = "50,9 91,29 91,71 50,91 9,71 9,29";
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="HookWars">
      <polygon points={pts} fill="#FFB22E" />
      <polygon points={inset} fill="#0B0E14" />
      <text
        x="50"
        y="50"
        dominantBaseline="central"
        textAnchor="middle"
        fontFamily="'Saira Condensed', sans-serif"
        fontWeight={800}
        fontSize="34"
        letterSpacing="-1"
        fill="#FFB22E"
      >
        HW
      </text>
    </svg>
  );
}

/** HOOK + WARS two-tone wordmark, Saira Condensed 800. */
export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: 800,
        fontSize: size,
        letterSpacing: "0.01em",
        lineHeight: 1,
      }}
    >
      <span style={{ color: "var(--text-hi)" }}>HOOK</span>
      <span style={{ color: "var(--amber)" }}>WARS</span>
    </span>
  );
}
