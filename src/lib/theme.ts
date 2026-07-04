// Per-commodity visual theme. Each entry: an accent color, a soft glow color for
// the hero card, and an emoji glyph. The accent tints the page (subtle) and the
// primary buttons/median line; the glow tints only the hero card so the report
// stays readable.

export interface CommodityTheme {
  accent: string;      // rgb triplet as "R,G,B" for opacity control
  hex: string;         // hex short form for chart lines
  glow: string;        // "R,G,B" for the hero glow
  glyph: string;       // emoji, kept tiny
}

const T: Record<string, CommodityTheme> = {
  gold:           { accent: "212,169,64",  hex: "#d4a940", glow: "212,169,64",  glyph: "◈" },
  silver:         { accent: "180,190,205", hex: "#b4becd", glow: "180,190,205", glyph: "◇" },
  platinum:       { accent: "170,200,215", hex: "#aac8d7", glow: "170,200,215", glyph: "◈" },
  palladium:      { accent: "150,200,210", hex: "#96c8d2", glow: "150,200,210", glyph: "◈" },
  copper:         { accent: "204,120,73",  hex: "#cc7849", glow: "204,120,73",  glyph: "●" },
  aluminum:       { accent: "185,185,200", hex: "#b9b9c8", glow: "185,185,200", glyph: "▲" },
  "wti-oil":      { accent: "44,50,58",    hex: "#7d848a", glow: "60,70,82",    glyph: "▮" },
  "brent-oil":    { accent: "40,55,72",    hex: "#7a8998", glow: "50,68,92",    glyph: "▮" },
  "natural-gas":  { accent: "78,148,205",  hex: "#4e94cd", glow: "78,148,205",  glyph: "◉" },
  "heating-oil":  { accent: "185,105,70",  hex: "#b96946", glow: "185,105,70",  glyph: "▮" },
  gasoline:       { accent: "205,120,80",  hex: "#cd7850", glow: "205,120,80",  glyph: "▮" },
  wheat:          { accent: "215,180,90",  hex: "#d7b45a", glow: "215,180,90",  glyph: "❋" },
  corn:           { accent: "230,190,70",  hex: "#e6be46", glow: "230,190,70",  glyph: "❋" },
  soybeans:       { accent: "180,205,90",  hex: "#b4cd5a", glow: "180,205,90",  glyph: "❋" },
  sugar:          { accent: "215,215,220", hex: "#d7d7dc", glow: "215,215,220", glyph: "❋" },
  cotton:         { accent: "220,215,205", hex: "#dcd7cd", glow: "220,215,205", glyph: "❋" },
  "arabica-coffee": { accent: "150,90,60", hex: "#965a3c", glow: "150,90,60",   glyph: "☕" },
  "robusta-coffee": { accent: "120,75,50", hex: "#784b32", glow: "120,75,50",   glyph: "☕" },
  cocoa:          { accent: "128,74,40",   hex: "#804a28", glow: "128,74,40",   glyph: "◆" },
  "live-cattle":  { accent: "165,110,80",  hex: "#a56e50", glow: "165,110,80",  glyph: "▤" },
};

const DEFAULT: CommodityTheme = { accent: "76,141,255", hex: "#4c8dff", glow: "76,141,255", glyph: "◆" };

export function themeFor(id: string | undefined): CommodityTheme {
  if (!id) return DEFAULT;
  return T[id] ?? DEFAULT;
}

// Apply the theme to the root element as CSS custom properties.
export function applyTheme(id: string | undefined) {
  const t = themeFor(id);
  const root = document.documentElement;
  root.style.setProperty("--accent", `rgb(${t.accent})`);
  root.style.setProperty("--accent-rgb", t.accent);
  root.style.setProperty("--accent-dim", `rgba(${t.accent}, 0.25)`);
  root.style.setProperty("--accent-glow", `rgba(${t.glow}, 0.16)`);
  root.style.setProperty("--accent-hex", t.hex);
}
