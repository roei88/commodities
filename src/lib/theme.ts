// Per-commodity visual theme — palettes, not accents. Each entry shifts the
// whole page surface stack (not just one accent color) so gold reads warm and
// molten, natural-gas reads cool and industrial, cocoa reads deep and earthy.
//
// Fields:
//  - primary/secondary: two accent colors that pair well; the median line + Run
//    button + section headers use primary; the "under-glow" and secondary chart
//    accents use secondary.
//  - bg0/bg1/bg2: three surface tones from darkest (page background) to
//    lightest (cards/inputs); tuned per commodity, not derived by opacity math.
//  - glow: two RGB triplets for the two radial-gradient blooms in the body.
//  - hero/data: fill for the hero and data card surfaces (kept dark so text
//    stays readable but tinted enough to feel commodity-native).
//  - motif: one of a small set of SVG frame backdrops (see components/Motif).
//  - glyph: emoji-free geometric mark (used in commodity badge).
//  - name: category name used in the report top strip.

export type MotifKind =
  | "gears"       // methodology / setup / regime
  | "sparkline"   // bands / price / MC
  | "bars"        // positioning / backtest
  | "radar"       // signal stack
  | "calendar"    // catalysts
  | "grid"        // macro / term structure
  | "gauge"       // confidence
  | "flame"       // energy-specific decoration
  | "sheaf"       // grain-specific decoration
  | "leaf"        // soft-specific decoration
  | "ingot"       // metal-specific decoration
  | "hoof";       // livestock decoration

export interface CommodityTheme {
  name: string;
  primary: string;     // hex
  primaryRgb: string;  // "r,g,b"
  secondary: string;   // hex — a paired accent for chart bands, motif strokes
  secondaryRgb: string;
  bg0: string;         // page background base
  bg1: string;         // surface (topbar, buttons)
  bg2: string;         // surface-2 (inputs, chips)
  glow1: string;       // "r,g,b" — top-left blooms
  glow2: string;       // "r,g,b" — bottom-right blooms
  hero: string;        // hero card fill
  data: string;        // data card fill
  motif: MotifKind;    // signature decoration for this commodity
  glyph: string;       // small geometric symbol
}

const DEFAULT: CommodityTheme = {
  name: "Commodity",
  primary: "#4c8dff",
  primaryRgb: "76,141,255",
  secondary: "#22d3ee",
  secondaryRgb: "34,211,238",
  bg0: "#0f1216",
  bg1: "#171b21",
  bg2: "#1e242c",
  glow1: "76,141,255",
  glow2: "34,211,238",
  hero: "#12161b",
  data: "#161a20",
  motif: "gears",
  glyph: "◆",
};

const T: Record<string, CommodityTheme> = {
  // ---- PRECIOUS METALS — warm amber / silver / platinum tones ----
  gold: {
    name: "Precious metal · Gold",
    primary: "#ffbf3b", primaryRgb: "255,191,59",
    secondary: "#e08a2e", secondaryRgb: "224,138,46",
    bg0: "#14100a", bg1: "#1c1710", bg2: "#251e14",
    glow1: "255,191,59", glow2: "224,138,46",
    hero: "#1c1710", data: "#181310",
    motif: "ingot", glyph: "◈",
  },
  silver: {
    name: "Precious metal · Silver",
    primary: "#e8ecf3", primaryRgb: "232,236,243",
    secondary: "#8ea8c8", secondaryRgb: "142,168,200",
    bg0: "#0b0e13", bg1: "#141922", bg2: "#1c222d",
    glow1: "232,236,243", glow2: "142,168,200",
    hero: "#141922", data: "#12161e",
    motif: "ingot", glyph: "◇",
  },
  platinum: {
    name: "Precious metal · Platinum",
    primary: "#c9e0ec", primaryRgb: "201,224,236",
    secondary: "#5a8ba7", secondaryRgb: "90,139,167",
    bg0: "#0a0f14", bg1: "#131a22", bg2: "#1a232d",
    glow1: "201,224,236", glow2: "90,139,167",
    hero: "#131a22", data: "#111820",
    motif: "ingot", glyph: "◈",
  },
  palladium: {
    name: "Precious metal · Palladium",
    primary: "#a3d4e0", primaryRgb: "163,212,224",
    secondary: "#3d7f96", secondaryRgb: "61,127,150",
    bg0: "#0a1215", bg1: "#131e23", bg2: "#1a2830",
    glow1: "163,212,224", glow2: "61,127,150",
    hero: "#131e23", data: "#111a20",
    motif: "ingot", glyph: "◈",
  },

  // ---- INDUSTRIAL METALS — burnt copper, cool aluminum ----
  copper: {
    name: "Industrial metal · Copper",
    primary: "#f28b47", primaryRgb: "242,139,71",
    secondary: "#b8552a", secondaryRgb: "184,85,42",
    bg0: "#14100c", bg1: "#1e1712", bg2: "#291d17",
    glow1: "242,139,71", glow2: "184,85,42",
    hero: "#1e1712", data: "#1a1510",
    motif: "ingot", glyph: "●",
  },
  aluminum: {
    name: "Industrial metal · Aluminum",
    primary: "#cfd6e0", primaryRgb: "207,214,224",
    secondary: "#6b7a90", secondaryRgb: "107,122,144",
    bg0: "#0d1015", bg1: "#171b22", bg2: "#20242d",
    glow1: "207,214,224", glow2: "107,122,144",
    hero: "#171b22", data: "#141820",
    motif: "ingot", glyph: "▲",
  },

  // ---- ENERGY — dark oily blacks, gas blues, flame reds ----
  "wti-oil": {
    name: "Energy · WTI Crude",
    primary: "#5c9de8", primaryRgb: "92,157,232",
    secondary: "#e05a3e", secondaryRgb: "224,90,62",
    bg0: "#0a0e12", bg1: "#12171d", bg2: "#1a2028",
    glow1: "92,157,232", glow2: "224,90,62",
    hero: "#12171d", data: "#0f141a",
    motif: "flame", glyph: "▮",
  },
  "brent-oil": {
    name: "Energy · Brent Crude",
    primary: "#7ba7d9", primaryRgb: "123,167,217",
    secondary: "#c76b4a", secondaryRgb: "199,107,74",
    bg0: "#0a0e13", bg1: "#131820", bg2: "#1b222b",
    glow1: "123,167,217", glow2: "199,107,74",
    hero: "#131820", data: "#10151c",
    motif: "flame", glyph: "▮",
  },
  "natural-gas": {
    name: "Energy · Natural Gas",
    primary: "#4fa8dc", primaryRgb: "79,168,220",
    secondary: "#8be3ff", secondaryRgb: "139,227,255",
    bg0: "#08111a", bg1: "#0e1b26", bg2: "#152534",
    glow1: "79,168,220", glow2: "139,227,255",
    hero: "#0e1b26", data: "#0b1620",
    motif: "flame", glyph: "◉",
  },
  "heating-oil": {
    name: "Energy · Heating Oil",
    primary: "#e28158", primaryRgb: "226,129,88",
    secondary: "#a94e28", secondaryRgb: "169,78,40",
    bg0: "#14100c", bg1: "#1d1613", bg2: "#291d17",
    glow1: "226,129,88", glow2: "169,78,40",
    hero: "#1d1613", data: "#191410",
    motif: "flame", glyph: "▮",
  },
  gasoline: {
    name: "Energy · Gasoline",
    primary: "#f39750", primaryRgb: "243,151,80",
    secondary: "#c96a2f", secondaryRgb: "201,106,47",
    bg0: "#14110c", bg1: "#1e1712", bg2: "#2a1e17",
    glow1: "243,151,80", glow2: "201,106,47",
    hero: "#1e1712", data: "#1a1510",
    motif: "flame", glyph: "▮",
  },

  // ---- GRAINS — sunflower yellows, wheat golds, corn ambers ----
  wheat: {
    name: "Grain · Wheat",
    primary: "#e8c765", primaryRgb: "232,199,101",
    secondary: "#a68240", secondaryRgb: "166,130,64",
    bg0: "#12100a", bg1: "#1c1810", bg2: "#251f14",
    glow1: "232,199,101", glow2: "166,130,64",
    hero: "#1c1810", data: "#181410",
    motif: "sheaf", glyph: "❋",
  },
  corn: {
    name: "Grain · Corn",
    primary: "#f4cc41", primaryRgb: "244,204,65",
    secondary: "#b58a1c", secondaryRgb: "181,138,28",
    bg0: "#12100a", bg1: "#1c1810", bg2: "#251f14",
    glow1: "244,204,65", glow2: "181,138,28",
    hero: "#1c1810", data: "#181410",
    motif: "sheaf", glyph: "❋",
  },
  soybeans: {
    name: "Grain · Soybeans",
    primary: "#c1de5a", primaryRgb: "193,222,90",
    secondary: "#5f8a2b", secondaryRgb: "95,138,43",
    bg0: "#0e120a", bg1: "#161c12", bg2: "#1e2617",
    glow1: "193,222,90", glow2: "95,138,43",
    hero: "#161c12", data: "#131810",
    motif: "sheaf", glyph: "❋",
  },

  // ---- SOFTS — warm browns, tropical greens, tans ----
  sugar: {
    name: "Soft · Sugar",
    primary: "#f0ead6", primaryRgb: "240,234,214",
    secondary: "#b8ac82", secondaryRgb: "184,172,130",
    bg0: "#11100c", bg1: "#1a1813", bg2: "#231f17",
    glow1: "240,234,214", glow2: "184,172,130",
    hero: "#1a1813", data: "#171410",
    motif: "leaf", glyph: "❋",
  },
  cotton: {
    name: "Soft · Cotton",
    primary: "#ffffff", primaryRgb: "255,255,255",
    secondary: "#c9c0b0", secondaryRgb: "201,192,176",
    bg0: "#0f0e0c", bg1: "#181613", bg2: "#211d17",
    glow1: "255,255,255", glow2: "201,192,176",
    hero: "#181613", data: "#141210",
    motif: "leaf", glyph: "❋",
  },
  "arabica-coffee": {
    name: "Soft · Arabica Coffee",
    primary: "#b57339", primaryRgb: "181,115,57",
    secondary: "#7a3f1a", secondaryRgb: "122,63,26",
    bg0: "#120c08", bg1: "#1b130d", bg2: "#251b12",
    glow1: "181,115,57", glow2: "122,63,26",
    hero: "#1b130d", data: "#17110b",
    motif: "leaf", glyph: "☕",
  },
  "robusta-coffee": {
    name: "Soft · Robusta Coffee",
    primary: "#8f5c33", primaryRgb: "143,92,51",
    secondary: "#5c3618", secondaryRgb: "92,54,24",
    bg0: "#110b07", bg1: "#19110b", bg2: "#231810",
    glow1: "143,92,51", glow2: "92,54,24",
    hero: "#19110b", data: "#150e09",
    motif: "leaf", glyph: "☕",
  },
  cocoa: {
    name: "Soft · Cocoa",
    primary: "#a06238", primaryRgb: "160,98,56",
    secondary: "#5a2e12", secondaryRgb: "90,46,18",
    bg0: "#100a06", bg1: "#19110b", bg2: "#231810",
    glow1: "160,98,56", glow2: "90,46,18",
    hero: "#19110b", data: "#150e09",
    motif: "leaf", glyph: "◆",
  },

  // ---- LIVESTOCK — earthy reds, prairie tans ----
  "live-cattle": {
    name: "Livestock · Live Cattle",
    primary: "#c17e56", primaryRgb: "193,126,86",
    secondary: "#7d4527", secondaryRgb: "125,69,39",
    bg0: "#120d08", bg1: "#1b140e", bg2: "#251d14",
    glow1: "193,126,86", glow2: "125,69,39",
    hero: "#1b140e", data: "#17110b",
    motif: "hoof", glyph: "▤",
  },
};

export function themeFor(id: string | undefined): CommodityTheme {
  if (!id) return DEFAULT;
  return T[id] ?? DEFAULT;
}

// Apply the theme to :root via CSS custom properties so the whole page shifts.
export function applyTheme(id: string | undefined) {
  const t = themeFor(id);
  const r = document.documentElement.style;
  r.setProperty("--bg", t.bg0);
  r.setProperty("--surface", t.bg1);
  r.setProperty("--surface-2", t.bg2);
  r.setProperty("--accent", t.primary);
  r.setProperty("--accent-hex", t.primary);
  r.setProperty("--accent-rgb", t.primaryRgb);
  r.setProperty("--accent-dim", `rgba(${t.primaryRgb}, 0.22)`);
  r.setProperty("--accent2", t.secondary);
  r.setProperty("--accent2-hex", t.secondary);
  r.setProperty("--accent2-rgb", t.secondaryRgb);
  r.setProperty("--glow1", `rgba(${t.glow1}, 0.16)`);
  r.setProperty("--glow2", `rgba(${t.glow2}, 0.13)`);
  r.setProperty("--hero-fill", t.hero);
  r.setProperty("--data-fill", t.data);
}
