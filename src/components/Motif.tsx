import type { MotifKind } from "../lib/theme.ts";

// A pluggable, purely-decorative SVG placed in a card's top-right as a
// watermark. Uses currentColor + var(--accent2) so it always harmonises with
// the active commodity theme. Kept single-file so all motifs can be tuned
// together (viewBox 120x120, ~0.55 opacity, no interactivity).

interface Props {
  kind: MotifKind;
  className?: string;
  size?: number;
}

export default function Motif({ kind, className, size = 128 }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 120 120",
    xmlns: "http://www.w3.org/2000/svg",
    className: "motif " + (className ?? ""),
    "aria-hidden": true,
  } as const;

  const strokePrimary = { stroke: "currentColor", fill: "none", strokeWidth: 1.2 };
  const strokeSecondary = { stroke: "var(--accent2, currentColor)", fill: "none", strokeWidth: 1.0 };

  switch (kind) {
    // ---- Role motifs ----

    case "gears":
      return (
        <svg {...common}>
          <g {...strokePrimary} strokeLinecap="round">
            {/* big gear */}
            {gearTeeth(60, 60, 40, 30, 12)}
            <circle cx="60" cy="60" r="30" />
            <circle cx="60" cy="60" r="16" />
            <circle cx="60" cy="60" r="4" fill="currentColor" />
          </g>
          <g {...strokeSecondary} strokeLinecap="round">
            {gearTeeth(100, 25, 20, 14, 10)}
            <circle cx="100" cy="25" r="14" />
            <circle cx="100" cy="25" r="6" />
          </g>
        </svg>
      );

    case "sparkline":
      return (
        <svg {...common}>
          <g {...strokePrimary}>
            <path d="M8,88 L22,74 L34,80 L46,58 L60,64 L72,44 L86,50 L98,32 L112,38"
              strokeWidth="1.6" />
            <circle cx="112" cy="38" r="2.5" fill="currentColor" />
          </g>
          <g {...strokeSecondary} strokeDasharray="2 3">
            <path d="M8,100 L22,88 L34,92 L46,74 L60,80 L72,62 L86,66 L98,52 L112,58" />
          </g>
          <g stroke="currentColor" strokeWidth="0.4" opacity="0.35">
            {[10, 30, 50, 70, 90, 110].map((x) => <line key={x} x1={x} y1="8" x2={x} y2="112" />)}
          </g>
        </svg>
      );

    case "bars":
      return (
        <svg {...common}>
          <g stroke="currentColor" strokeWidth="0.4" opacity="0.35">
            <line x1="8" y1="100" x2="112" y2="100" />
          </g>
          {[
            { x: 14, h: 30, c: "currentColor" },
            { x: 30, h: 48, c: "currentColor" },
            { x: 46, h: 62, c: "var(--accent2, currentColor)" },
            { x: 62, h: 40, c: "currentColor" },
            { x: 78, h: 72, c: "var(--accent2, currentColor)" },
            { x: 94, h: 56, c: "currentColor" },
          ].map((b, i) => (
            <rect key={i} x={b.x} y={100 - b.h} width="10" height={b.h} fill={b.c} opacity="0.75" rx="1" />
          ))}
        </svg>
      );

    case "radar":
      return (
        <svg {...common}>
          <g {...strokePrimary} strokeWidth="0.5" opacity="0.6">
            {/* rings */}
            {[14, 26, 38, 50].map((r) => <circle key={r} cx="60" cy="60" r={r} />)}
            {/* axes */}
            {Array.from({ length: 6 }).map((_, i) => {
              const a = (i * Math.PI) / 3 - Math.PI / 2;
              return <line key={i} x1="60" y1="60" x2={60 + 50 * Math.cos(a)} y2={60 + 50 * Math.sin(a)} />;
            })}
          </g>
          {/* signal polygon */}
          <path
            d={radarPath([0.9, 0.5, 0.7, 0.35, 0.55, 0.8])}
            fill="currentColor" fillOpacity="0.28" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"
          />
        </svg>
      );

    case "calendar":
      return (
        <svg {...common}>
          <g {...strokePrimary}>
            <rect x="18" y="26" width="88" height="72" rx="4" />
            <line x1="18" y1="42" x2="106" y2="42" strokeWidth="1.5" />
            <line x1="32" y1="20" x2="32" y2="32" strokeWidth="2" strokeLinecap="round" />
            <line x1="92" y1="20" x2="92" y2="32" strokeWidth="2" strokeLinecap="round" />
          </g>
          {/* days grid */}
          <g fill="currentColor" opacity="0.55">
            {Array.from({ length: 24 }).map((_, i) => {
              const c = i % 6;
              const r = Math.floor(i / 6);
              return <rect key={i} x={26 + c * 13} y={50 + r * 10} width="8" height="6" rx="1" />;
            })}
          </g>
          {/* highlights */}
          <rect x="52" y="60" width="8" height="6" rx="1" fill="var(--accent2, currentColor)" />
          <rect x="78" y="70" width="8" height="6" rx="1" fill="var(--accent2, currentColor)" />
        </svg>
      );

    case "grid":
      return (
        <svg {...common}>
          <g stroke="currentColor" strokeWidth="0.5" opacity="0.6">
            {Array.from({ length: 12 }).map((_, i) => (
              <line key={"h" + i} x1="8" y1={12 + i * 8} x2="112" y2={12 + i * 8} />
            ))}
            {Array.from({ length: 13 }).map((_, i) => (
              <line key={"v" + i} x1={8 + i * 8} y1="12" x2={8 + i * 8} y2="108" />
            ))}
          </g>
          <g fill="var(--accent2, currentColor)" opacity="0.6">
            <rect x="40" y="44" width="24" height="24" rx="2" />
            <rect x="72" y="52" width="16" height="16" rx="2" />
          </g>
        </svg>
      );

    case "gauge":
      return (
        <svg {...common}>
          <g {...strokePrimary} strokeLinecap="round">
            <path d="M20,80 A40,40 0 0 1 100,80" strokeWidth="1.5" />
            {[0.15, 0.35, 0.55, 0.75, 0.95].map((f, i) => {
              const a = Math.PI * (1 - f);
              const x1 = 60 + 40 * Math.cos(a), y1 = 80 - 40 * Math.sin(a);
              const x2 = 60 + 30 * Math.cos(a), y2 = 80 - 30 * Math.sin(a);
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="1.2" />;
            })}
          </g>
          <g>
            <line x1="60" y1="80" x2="86" y2="52" stroke="var(--accent2, currentColor)" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="60" cy="80" r="4" fill="currentColor" />
          </g>
        </svg>
      );

    // ---- Commodity-family motifs ----

    case "flame":
      return (
        <svg {...common}>
          <g {...strokePrimary}>
            <path d="M60,20 C68,32 78,42 78,58 C78,74 66,86 60,96 C54,86 42,74 42,58 C42,42 52,32 60,20 Z" strokeWidth="1.5" />
            <path d="M60,40 C64,48 70,54 70,64 C70,74 64,82 60,88 C56,82 50,74 50,64 C50,54 56,48 60,40 Z"
              stroke="var(--accent2, currentColor)" fill="var(--accent2, currentColor)" fillOpacity="0.35" />
          </g>
        </svg>
      );

    case "sheaf":
      return (
        <svg {...common}>
          <g {...strokePrimary} strokeLinecap="round">
            {/* stalks */}
            {[-12, -4, 4, 12].map((x) => (
              <line key={x} x1={60 + x * 0.4} y1="100" x2={60 + x * 1.8} y2="16" strokeWidth="1.2" />
            ))}
            {/* seeds */}
            {[-8, 0, 8].map((x) =>
              [26, 34, 42, 50, 58].map((y) => (
                <ellipse key={`${x}-${y}`} cx={60 + x} cy={y - x * 0.1} rx="3" ry="5" transform={`rotate(${x * 2} ${60 + x} ${y})`}
                  fill="var(--accent2, currentColor)" opacity="0.7" stroke="none" />
              ))
            )}
            {/* tie */}
            <path d="M46,86 Q60,80 74,86 Q60,92 46,86 Z" fill="currentColor" opacity="0.6" stroke="none" />
          </g>
        </svg>
      );

    case "leaf":
      return (
        <svg {...common}>
          <g {...strokePrimary}>
            <path d="M60,18 C86,30 92,60 72,90 C56,74 44,60 40,42 C42,32 50,22 60,18 Z" strokeWidth="1.5" />
            <path d="M60,18 L64,90" strokeWidth="0.8" />
            {[
              [40, 42, 60, 38],
              [46, 55, 64, 50],
              [52, 68, 68, 62],
              [58, 80, 70, 74],
            ].map(([x1, y1, x2, y2], i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="0.6" opacity="0.6" />
            ))}
          </g>
        </svg>
      );

    case "ingot":
      return (
        <svg {...common}>
          <g {...strokePrimary}>
            <path d="M18,72 L34,52 L86,52 L102,72 L86,88 L34,88 Z" strokeWidth="1.5" fill="currentColor" fillOpacity="0.12" />
            <path d="M34,52 L102,72" strokeWidth="0.8" />
            <path d="M34,52 L18,72" strokeWidth="0.8" />
            <path d="M34,52 L86,52 L102,72 L86,88 L34,88 L18,72 Z" strokeWidth="1.5" />
            <text x="60" y="76" fontFamily="ui-monospace,monospace" fontSize="10" fill="var(--accent2, currentColor)"
              textAnchor="middle" opacity="0.85">.999</text>
          </g>
        </svg>
      );

    case "hoof":
      return (
        <svg {...common}>
          <g fill="currentColor" opacity="0.7">
            <ellipse cx="42" cy="48" rx="14" ry="18" />
            <ellipse cx="78" cy="48" rx="14" ry="18" />
          </g>
          <g fill="var(--accent2, currentColor)" opacity="0.7">
            <ellipse cx="42" cy="86" rx="16" ry="12" />
            <ellipse cx="78" cy="86" rx="16" ry="12" />
          </g>
        </svg>
      );

    default:
      return null;
  }
}

// ---- helpers ----
function gearTeeth(cx: number, cy: number, r: number, inner: number, n: number): JSX.Element[] {
  const teeth: JSX.Element[] = [];
  const tw = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x1 = cx + inner * Math.cos(a);
    const y1 = cy + inner * Math.sin(a);
    const x2 = cx + r * Math.cos(a);
    const y2 = cy + r * Math.sin(a);
    teeth.push(
      <line key={"t" + i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={tw} strokeLinecap="round" />
    );
  }
  return teeth;
}
function radarPath(values: number[]): string {
  const cx = 60, cy = 60, R = 46;
  return values
    .map((v, i) => {
      const a = (i * Math.PI * 2) / values.length - Math.PI / 2;
      const x = cx + R * v * Math.cos(a);
      const y = cy + R * v * Math.sin(a);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ") + " Z";
}
