import { getOHLC, quoteFromBars, cotDisaggregated, fredRealYield, fredSeries } from "./data/index.ts";
import { computeTechnicals, realizedVol } from "./technicals.ts";
import { computeBands } from "./bands.ts";
import { computeRegime, type RegimeContext } from "./regime.ts";
import { runMonteCarlo } from "./montecarlo.ts";
import { assembleReport } from "./report.ts";
import { resolvePlanFor, getCommodity } from "../plans/resolver.ts";
import type { RunResult, RedFlag, LogLine, Quote, Technicals, Bands, RegimeRead, MonteCarloResult } from "../../shared/types.ts";

export type Emit = (level: LogLine["level"], msg: string) => void;

// Count business days (Mon-Fri) between two dates, min 1, capped at 40.
function tradingDaysBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  if (to <= from) return 5;
  let days = 0;
  const cur = new Date(from);
  while (cur < to && days < 60) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const d = cur.getUTCDay();
    if (d !== 0 && d !== 6) days++;
  }
  return Math.max(1, Math.min(days, 40));
}

export async function runPipeline(
  commodityId: string,
  span: { from: string; to: string },
  emit: Emit
): Promise<RunResult> {
  const generatedAt = new Date().toISOString();
  const redFlags: RedFlag[] = [];

  emit("step", `Resolving commodity "${commodityId}"...`);
  const commodity = getCommodity(commodityId);
  if (!commodity) throw new Error(`Unknown commodity: ${commodityId}`);
  emit("ok", `${commodity.label} — ${commodity.venue} ${commodity.symbol} (${commodity.unit})`);

  emit("step", `Resolving plan asset (dedicated > class > universal)...`);
  const { plan, resolution, planHash } = resolvePlanFor(commodity);
  emit("ok", `Plan: ${plan.label ?? plan.id} [${resolution}] hash ${planHash}`);

  // ---- Data: OHLC via fallback ladder ----
  emit("step", `Fetching price history (${commodity.symbol})...`);
  let bars;
  let dataSource = "unavailable";
  let quote: Quote | null = null;
  try {
    const ohlc = await getOHLC(commodity, plan.dataInputs.minHistoryDays ?? 400);
    bars = ohlc.bars;
    dataSource = ohlc.source;
    for (const a of ohlc.attempts) emit(a.ok ? "ok" : "warn", `  ${a.source}: ${a.ok ? "ok" : "failed"} — ${a.note}`);
    quote = quoteFromBars(bars, ohlc.source, commodity.seed?.changePct);
    emit("ok", `Spot ${quote.price} as of ${quote.asOf.slice(0, 10)} · market ${quote.marketOpen ? "open" : "closed"}`);
    if (quote.stale) {
      redFlags.push({ where: "price", message: `Latest bar is stale (weekend/closed market) — bands built off a stale spot.` });
      emit("flag", `RED FLAG: latest bar appears stale.`);
    }
  } catch (e: any) {
    redFlags.push({ where: "price", message: `All OHLC sources failed: ${e?.message ?? e}` });
    emit("error", `RED FLAG: could not fetch any price data — ${e?.message ?? e}`);
  }

  // ---- Technicals ----
  let technicals: Technicals | null = null;
  let bands: Bands[] = [];
  if (bars && bars.length > 30) {
    emit("step", `Computing technicals (RSI/MACD/MA/ATR/realized vol)...`);
    technicals = computeTechnicals(bars, plan);
    emit(
      "ok",
      `RSI ${fmt(technicals.rsi14)} · realized vol ${fmt(technicals.realizedVolAnnualPct)}% · ` +
        `MA50 ${fmt(technicals.ma["ma50"]?.value)} MA200 ${fmt(technicals.ma["ma200"]?.value)}`
    );
    if (quote) {
      bands = computeBands(quote.price, technicals, plan);
      emit("ok", `Expected-move bands computed for ${bands.map((b) => b.horizon).join(", ")}.`);
    }
  } else {
    redFlags.push({ where: "technicals", message: "Insufficient price history for technicals." });
    emit("flag", `RED FLAG: not enough history for technicals.`);
  }

  // ---- COT positioning ----
  let cot: RunResult["cot"] = null;
  if (plan.dataInputs.cotContractCode) {
    emit("step", `Fetching CFTC COT positioning...`);
    try {
      const c = await cotDisaggregated(plan.dataInputs.cotContractCode);
      cot = { asOf: c.asOf, managedMoneyNet: c.managedMoneyNet, percentile3y: c.percentile3y, source: c.source };
      emit("ok", `Managed-money net ${c.managedMoneyNet.toLocaleString()} · 3y pct ${c.percentile3y != null ? (c.percentile3y * 100).toFixed(0) + "%" : "n/a"} · as of ${c.asOf}`);
    } catch (e: any) {
      redFlags.push({ where: "positioning", message: `COT fetch failed: ${e?.message ?? e}` });
      emit("warn", `COT unavailable — ${e?.message ?? e}`);
    }
  } else {
    emit("warn", `No COT contract code for ${commodity.id} — positioning skipped.`);
  }

  // ---- Macro overlay (real yield / DXY) for classes that declare it ----
  let macro: RunResult extends never ? never : { realYield?: { value: number; asOf: string } | null; dxy?: number | null } | null = null;
  let realYieldCorrelation: number | null = null;
  if ((plan.dataInputs.macroSeries ?? []).length) {
    emit("step", `Fetching macro overlay (FRED)...`);
    const ry = await fredRealYield();
    if (ry) {
      macro = { realYield: ry };
      emit("ok", `10y real yield ${ry.value.toFixed(2)}% as of ${ry.asOf}`);
    } else {
      redFlags.push({ where: "macro", message: "FRED unavailable (no key or fetch failed) — real-yield overlay skipped." });
      emit("warn", `FRED macro unavailable (set FRED_API_KEY to enable).`);
    }
  }

  // ---- Regime + signal stack ----
  let regime: RegimeRead | null = null;
  if (bars && technicals) {
    emit("step", `Running regime gate + signal stack...`);
    const ctx: RegimeContext = { cotPercentile: cot?.percentile3y ?? null, realYieldCorrelation };
    regime = computeRegime(bars, technicals, plan, ctx);
    emit(
      "ok",
      `Regime: ${regime.regime} · lean ${regime.lean} · ` +
        `Bull ${(regime.probabilities.bull * 100).toFixed(0)}/Base ${(regime.probabilities.base * 100).toFixed(0)}/Bear ${(regime.probabilities.bear * 100).toFixed(0)}`
    );
  }

  // ---- Monte Carlo ----
  let montecarlo: MonteCarloResult | null = null;
  if (quote && technicals?.realizedVolAnnualPct && regime) {
    const horizon = tradingDaysBetween(quote.asOf, span.to);
    emit("step", `Running Monte-Carlo (${plan.monteCarlo.paths.toLocaleString()} paths, ${horizon} trading days)...`);
    const dailyVolPct = technicals.realizedVolAnnualPct / Math.sqrt(252);
    const monthMoveFrac = (technicals.realizedVolAnnualPct / 100) * Math.sqrt(21 / 252);
    const seed = `${commodity.symbol}|${quote.asOf.slice(0, 10)}|${planHash}`;
    montecarlo = runMonteCarlo(plan, {
      spot: quote.price,
      dailyVolPct,
      horizonTradingDays: horizon,
      probabilities: regime.probabilities,
      monthMoveFrac,
      seed,
      eventDayMultipliers: {},
    });
    const last = montecarlo.fan[montecarlo.fan.length - 1];
    emit("ok", `MC median ${last.p50} · 90% band ${last.p5}–${last.p95} · seed ${seed}`);
  } else {
    emit("warn", `Monte-Carlo skipped (needs spot + vol + regime).`);
  }

  // ---- Assemble report ----
  emit("step", `Assembling Markdown report...`);
  const markdown = assembleReport({
    commodity,
    plan,
    planResolution: resolution,
    planHash,
    span,
    quote,
    dataSource,
    technicals,
    bands,
    regime,
    cot,
    macro: macro as any,
    montecarlo,
    redFlags,
    generatedAt,
  });
  emit("done", `Report ready (${markdown.length} chars, ${redFlags.length} RED FLAG${redFlags.length === 1 ? "" : "s"}).`);

  return {
    runId: "", // set by caller
    commodity,
    planId: plan.id,
    planResolution: resolution,
    span,
    quote,
    technicals,
    bands,
    regime,
    cot,
    montecarlo,
    redFlags,
    markdown,
    finishedAt: new Date().toISOString(),
  };
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "n/a";
  const abs = Math.abs(n);
  return n.toFixed(abs >= 1000 ? 0 : abs >= 10 ? 1 : 2);
}
