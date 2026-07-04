import type { Bar } from "./data/index.ts";
import type { PlanAsset, Technicals, RegimeRead, SignalScore } from "../../shared/types.ts";
import { atrPctRank } from "./technicals.ts";

export interface RegimeContext {
  cotPercentile?: number | null;      // managed-money net percentile (0..1)
  realYieldCorrelation?: number | null; // rolling corr of returns vs real-yield
  realYieldDirection?: number | null;   // recent real-yield change (%pts, signed)
  dxyChangePct?: number | null;         // recent DXY move (%, signed)
  etfFlow5dPct?: number | null;         // 5d % change in the flow-proxy ETF
  rollShape?: "backwardation" | "contango" | "flat" | null;
  gldTrend?: number | null;             // legacy alias, kept for compat
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
    // Prefer real ETF flow when available; fall back to 5d ROC of price.
    let s: -1 | 0 | 1 = 0;
    let note: string;
    if (ctx.etfFlow5dPct != null) {
      s = ctx.etfFlow5dPct > 0.5 ? 1 : ctx.etfFlow5dPct < -0.5 ? -1 : 0;
      note = `ETF 5d ${ctx.etfFlow5dPct > 0 ? "+" : ""}${ctx.etfFlow5dPct.toFixed(1)}%`;
    } else if (ctx.gldTrend != null) {
      s = ctx.gldTrend > 0 ? 1 : ctx.gldTrend < 0 ? -1 : 0;
      note = "ETF flow (legacy)";
    } else {
      const roc = bars.length > 5 ? price - bars[bars.length - 6].close : 0;
      s = roc > 0 ? 1 : roc < 0 ? -1 : 0;
      note = "5d price ROC (fallback — no ETF flow)";
    }
    signals.push({ name: "flow", score: s, weight: stack.flow.weight, note });
  }
  if (stack.realYield) {
    // Only score real-yield if the correlation is meaningful; else neutral+note.
    let s: -1 | 0 | 1 = 0;
    let note = "real-yield correlation unavailable";
    const corr = ctx.realYieldCorrelation;
    const dir = ctx.realYieldDirection;
    if (corr != null && dir != null && Math.abs(corr) > 0.2) {
      // Inverse regime: rising real yields => headwind for gold (score -1).
      // Corr>0 (regime broken) reverses the sign.
      const yieldsRising = dir > 0;
      const inverseIntact = corr < 0;
      s = inverseIntact ? (yieldsRising ? -1 : 1) : (yieldsRising ? 1 : -1);
      note = `corr ${corr.toFixed(2)} (${inverseIntact ? "inverse intact" : "REGIME BROKEN"}), Δ real-yield ${dir > 0 ? "+" : ""}${dir.toFixed(2)}%pt`;
    } else if (corr != null) {
      note = `corr ${corr.toFixed(2)} (weak — no signal)`;
    }
    signals.push({ name: "realYield", score: s, weight: stack.realYield.weight, note });
  }
  // Optional DXY factor (added dynamically when present in stack; treated inverse to commodities).
  if (stack.dxy) {
    let s: -1 | 0 | 1 = 0;
    if (ctx.dxyChangePct != null) s = ctx.dxyChangePct > 0.5 ? -1 : ctx.dxyChangePct < -0.5 ? 1 : 0;
    signals.push({
      name: "dxy",
      score: s,
      weight: stack.dxy.weight,
      note: ctx.dxyChangePct != null ? `DXY 20d ${ctx.dxyChangePct > 0 ? "+" : ""}${ctx.dxyChangePct.toFixed(1)}%` : "DXY unavailable",
    });
  }
  // Optional term-structure factor (backwardation = bullish tightness).
  if (stack.termStructure) {
    let s: -1 | 0 | 1 = 0;
    if (ctx.rollShape === "backwardation") s = 1;
    else if (ctx.rollShape === "contango") s = -1;
    signals.push({
      name: "termStructure",
      score: s,
      weight: stack.termStructure.weight,
      note: ctx.rollShape ? `curve: ${ctx.rollShape}` : "curve unavailable",
    });
  }

  const totalW = signals.reduce((s, x) => s + x.weight, 0) || 1;
  const net = signals.reduce((a, s) => a + s.score * s.weight, 0) / totalW; // ~ -1..+1
  // Softmax over (bull, base, bear) with logits (+net*T, 0, -net*T). Temperature T controls
  // how sharply an extreme net collapses onto one scenario. T=2 keeps Base as the modal
  // outcome for |net|<0.35, matching how the transcripts talk about "range holds".
  const T = 2;
  const logits = [net * T, 0, -net * T];
  const maxL = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - maxL));
  const sumExp = exps[0] + exps[1] + exps[2];
  const probabilities = { bull: exps[0] / sumExp, base: exps[1] / sumExp, bear: exps[2] / sumExp };

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
