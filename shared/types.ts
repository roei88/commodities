// Shared types used by both the server engine and the React client.

export type AssetClass =
  | "precious-metals"
  | "energy"
  | "industrial-metals"
  | "grains"
  | "softs"
  | "livestock";

export interface CommodityMeta {
  id: string; // e.g. "gold"
  label: string; // e.g. "Gold"
  symbol: string; // Yahoo symbol, e.g. "GC=F"
  stooq?: string; // Stooq code fallback, e.g. "gc.f"
  twelvedata?: string; // Twelve Data symbol fallback, e.g. "XAU/USD"
  class: AssetClass;
  unit: string; // "USD/oz", "USD/bbl", "USD/tonne", "USd/lb"...
  venue: string; // "COMEX", "NYMEX", "ICE US", "CBOT"...
  cotContractCode?: string; // CFTC market code (disaggregated report)
  // Seed reference quote from the user's snapshot (last known; "market closed").
  seed?: { sell: number; buy: number; changePct: number };
}

// ---- Plan asset (declarative research recipe) ----
export interface PlanAsset {
  id: string;
  extends?: string; // class id or another asset id
  label?: string;
  dataInputs: {
    primarySymbol?: string;
    fallbackSymbols?: string[];
    cotContractCode?: string;
    macroSeries?: string[];
    minHistoryDays?: number;
  };
  technicals: {
    rsiPeriod: number;
    atrPeriod: number;
    realizedVolWindow: number;
    maPeriods: number[];
  };
  bands: {
    volSource: "realized" | "implied";
    horizons: Record<string, number>; // { day:1, week:5, month:21 }
    sigmaLevels: number[]; // [1.0, 1.65]
  };
  signalStack: Record<string, { weight: number }>; // trend/momentum/positioning/flow
  regimeRules?: { if: string; regime: string }[];
  catalystCalendar?: { label: string; date?: string; recurrence?: string; volMultiplier: number }[];
  monteCarlo: {
    paths: number;
    seedStrategy: string;
    process: string; // "ou-jump"
    ouMeanReversionHalflifeDays?: number;
    jumpDailyHazardPct?: number;
    jumpMeanPct?: number;
    jumpSdPct?: number;
    ladderIntervalHours: number;
  };
  reportSections?: string[];
  accuracyCeilings?: Record<string, string>;
  // Commodity-specific qualitative protocols that a deterministic engine cannot
  // execute without external judgement/feeds; declared here so the report can
  // RED-FLAG them explicitly rather than silently skip.
  qualitativeProtocols?: string[];
}

// ---- Engine outputs ----
export interface Quote {
  price: number;
  asOf: string; // ISO
  source: string;
  marketOpen: boolean;
  stale: boolean;
  changePct?: number;
}

export interface Technicals {
  rsi14: number | null;
  macd: { value: number; signal: number; hist: number } | null;
  ma: Record<string, { value: number; slope: number; priceAbove: boolean } | null>;
  atr14: number | null;
  realizedVolAnnualPct: number | null;
}

export interface Bands {
  horizon: string;
  days: number;
  sigma1: [number, number];
  sigma90: [number, number]; // 1.65 sigma
}

export interface SignalScore {
  name: string;
  score: -1 | 0 | 1;
  weight: number;
  note: string;
}

export interface RegimeRead {
  regime: string;
  evidence: string;
  signals: SignalScore[];
  probabilities: { bull: number; base: number; bear: number };
  lean: "bull" | "bear" | "no-lean";
}

export interface FanPoint {
  label: string; // "Day 1" or an ISO date
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface LadderRow {
  label: string; // "Day 2 · 06:00"
  target: number; // median
  lo: number; // p25
  hi: number; // p75
}

export interface MonteCarloResult {
  spot: number;
  seed: string;
  fan: FanPoint[];
  ladder: LadderRow[];
  touchProbs: { level: number; probUp?: number; probDown?: number }[];
}

export interface RedFlag {
  where: string;
  message: string;
}

export interface RunResult {
  runId: string;
  commodity: CommodityMeta;
  planId: string;
  planResolution: string; // "dedicated:gold" | "class:energy" | "universal"
  span: { from: string; to: string };
  quote: Quote | null;
  technicals: Technicals | null;
  bands: Bands[];
  regime: RegimeRead | null;
  cot: { asOf: string; managedMoneyNet: number; percentile3y: number | null; source: string } | null;
  montecarlo: MonteCarloResult | null;
  redFlags: RedFlag[];
  markdown: string;
  finishedAt: string;
}

// ---- SSE log line ----
export interface LogLine {
  ts: string;
  level: "info" | "step" | "ok" | "warn" | "flag" | "error" | "done";
  msg: string;
}
