import type { Bar } from "./data/index.ts";
import type { PlanAsset, Technicals, RegimeRead, SignalScore } from "../../shared/types.ts";
import { atrPctRank } from "./technicals.ts";

export interface RegimeContext {
  cotPercentile?: number | null; // managed-money net percentile (0..1)
  realYieldCorrelation?: number | null; // rolling corr of returns vs real yield
  gldTrend?: number | null; // flow proxy: sign of recent close change
}

// Evaluate the declared regimeRules against computed features. Rules use a tiny
// whitelist of tokens (no eval) so plan assets stay safe/declarative.
function evalRule(rule: string, feat: Record<string, number | boolean>): boolean {
  // supports "&&" of simple comparisons like "price>ma200", "ma50Slope>0",
  // "atrPctRank>0.8", "realYieldCorrelationIntact==false"
  return rule.split("&&").every((clauseRaw) => {
    const clause = clauseRaw.trim();
    const m = clause.match(/^([a-zA-Z0-9_]+)\s*(>=|<=|>|<|==)\s*(-?[0-9.]+|true|false)$/);
    if (!m) return false;
    const [, lhs, op, rhsRaw] = m;
    const lv = feat[lhs];
    if (lv === undefined) return false;
    const rhs = rhsRaw === "true" ? true : rhsRaw === "false" ? false : parseFloat(rhsRaw);
    switch (op) {
      case ">": return Number(lv) > Number(rhs);
      case "<": return Number(lv) < Number(rhs);
      case ">=": return Number(lv) >= Number(rhs);
      case "<=": return Number(lv) <= Number(rhs);
      case "==": return lv === rhs;
      default: return false;
    }
  });
}

export function computeRegime(
  bars: Bar[],
  tech: Technicals,
  plan: PlanAsset,
  ctx: RegimeContext
): RegimeRead {
  const price = bars[bars.length - 1].close;
  const ma50 = tech.ma["ma50"];
  const ma200 = tech.ma["ma200"];
  const ma20 = tech.ma["ma20"];
  const rank = atrPctRank(bars, plan.technicals.atrPeriod);

  const feat: Record<string, number | boolean> = {
    price,
    ma20: ma20?.value ?? price,
    ma50: ma50?.value ?? price,
    ma200: ma200?.value ?? price,
    ma50Slope: ma50?.slope ?? 0,
    atrPctRank: rank ?? 0,
    realYieldCorrelationIntact: ctx.realYieldCorrelation != null ? ctx.realYieldCorrelation < -0.2 : true,
  };

  const regimes: string[] = [];
  for (const r of plan.regimeRules ?? []) {
    if (evalRule(r.if, feat)) regimes.push(r.regime);
  }
  const regime = regimes[0] ?? "neutral / range";
  const evidence =
    `price ${fmt(price)} vs ma50 ${fmt(ma50?.value)} / ma200 ${fmt(ma200?.value)}; ` +
    `ATR%-rank ${rank != null ? (rank * 100).toFixed(0) + "%" : "n/a"}`;

  // ---- Signal stack: each factor scored -1/0/+1 with its plan weight ----
  const signals: SignalScore[] = [];
  const stack = plan.signalStack;

  if (stack.trend) {
    const above = (ma50?.priceAbove ? 1 : 0) + (ma200?.priceAbove ? 1 : 0);
    const slope = (ma50?.slope ?? 0) > 0 ? 1 : (ma50?.slope ?? 0) < 0 ? -1 : 0;
    const s = clampScore(above === 2 ? 1 : above === 0 ? -1 : 0, slope);
    signals.push({ name: "trend", score: s, weight: stack.trend.weight, note: `price vs 50/200 MA + slope` });
  }
  if (stack.momentum) {
    let s: -1 | 0 | 1 = 0;
    const rsi = tech.rsi14;
    const hist = tech.macd?.hist ?? 0;
    if (rsi != null) {
      if (rsi > 55 && hist > 0) s = 1;
      else if (rsi < 45 && hist < 0) s = -1;
    }
    signals.push({ name: "momentum", score: s, weight: stack.momentum.weight, note: `RSI ${fmt(rsi)}, MACD hist ${fmt(hist)}` });
  }
  if (stack.positioning) {
    // Contrarian at extremes: crowded long (high percentile) = fade risk (-1).
    let s: -1 | 0 | 1 = 0;
    const p = ctx.cotPercentile;
    if (p != null) {
      if (p > 0.85) s = -1;
      else if (p < 0.15) s = 1;
    }
    signals.push({
      name: "positioning",
      score: s,
      weight: stack.positioning.weight,
      note: p != null ? `COT net 3y pct ${(p * 100).toFixed(0)}%` : "COT unavailable",
    });
  }
  if (stack.flow) {
    let s: -1 | 0 | 1 = 0;
    if (ctx.gldTrend != null) s = ctx.gldTrend > 0 ? 1 : ctx.gldTrend < 0 ? -1 : 0;
    else {
      // fallback flow proxy: 5-day price rate of change sign
      const roc = bars.length > 5 ? price - bars[bars.length - 6].close : 0;
      s = roc > 0 ? 1 : roc < 0 ? -1 : 0;
    }
    signals.push({ name: "flow", score: s, weight: stack.flow.weight, note: "flow / 5d ROC proxy" });
  }
  if (stack.realYield) {
    let s: -1 | 0 | 1 = 0;
    if (ctx.realYieldCorrelation != null && ctx.realYieldCorrelation < -0.2) {
      // inverse intact: rising real yields would be a headwind; we score the
      // recent real-yield direction is unknown here, so keep neutral unless corr strong
      s = 0;
    }
    signals.push({
      name: "realYield",
      score: s,
      weight: stack.realYield.weight,
      note: ctx.realYieldCorrelation != null ? `gold/real-yield corr ${ctx.realYieldCorrelation.toFixed(2)}` : "real-yield data unavailable",
    });
  }

  const net = signals.reduce((a, s) => a + s.score * s.weight, 0); // ~ -1..+1
  // Map net score to Bull/Base/Bear probabilities (softmax-ish, bounded).
  const bull = clamp01(0.34 + net * 0.4);
  const bear = clamp01(0.34 - net * 0.4);
  const base = clamp01(1 - bull - bear);
  const total = bull + base + bear;
  const probabilities = { bull: bull / total, base: base / total, bear: bear / total };

  // Honesty rule from the transcripts: no lean below catalyst granularity. We only
  // emit a directional lean when the net signal is meaningful.
  let lean: RegimeRead["lean"] = "no-lean";
  if (net > 0.15) lean = "bull";
  else if (net < -0.15) lean = "bear";

  return { regime, evidence, signals, probabilities, lean };
}

function clampScore(a: number, b: number): -1 | 0 | 1 {
  const s = a + b;
  return s > 0 ? 1 : s < 0 ? -1 : 0;
}
function clamp01(n: number): number {
  return Math.max(0.02, Math.min(0.96, n));
}
function fmt(n: number | null | undefined): string {
  if (n == null) return "n/a";
  const abs = Math.abs(n);
  return n.toFixed(abs >= 1000 ? 0 : abs >= 10 ? 1 : 2);
}
