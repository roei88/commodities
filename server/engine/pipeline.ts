import { getOHLC, quoteFromBars, cotDisaggregated, fredRealYield, fredRealYieldHistory } from "./data/index.ts";
import { impliedVolFor } from "./data/vol.ts";
import { termStructure, FUTURES_ROOT } from "./data/termstructure.ts";
import { etfFlow } from "./data/flows.ts";
import { dollarIndex } from "./data/macro.ts";
import { optionChain, riskNeutralDensity, percentileFromRnd } from "./data/options.ts";
import { catalystsFor } from "./data/catalysts.ts";
import { ID_ETF } from "./data/flows.ts";
import { computeTechnicals, correlationOfReturns, alignByDate } from "./technicals.ts";
import { computeBands } from "./bands.ts";
import { computeRegime, type RegimeContext } from "./regime.ts";
import { runMonteCarlo } from "./montecarlo.ts";
import { backtestBands } from "./backtest.ts";
import { assembleReport } from "./report.ts";
import { resolvePlanFor, getCommodity } from "../plans/resolver.ts";
import type {
  RunResult, RedFlag, LogLine, Quote, Technicals, Bands, RegimeRead,
  MonteCarloResult, OptionsImpliedTargets, TermStructureRead, BacktestResult,
} from "../../shared/types.ts";

export type Emit = (level: LogLine["level"], msg: string) => void;

// Count business days (Mon-Fri) between two dates. Returns raw count + whether
// it was capped, so the pipeline can emit an honest RED FLAG.
function tradingDaysBetween(fromISO: string, toISO: string): { horizon: number; rawDays: number; capped: boolean } {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  if (to <= from) return { horizon: 5, rawDays: 0, capped: false };
  let days = 0;
  const cur = new Date(from);
  const HARD_CAP = 60;
  while (cur < to && days < HARD_CAP) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const d = cur.getUTCDay();
    if (d !== 0 && d !== 6) days++;
  }
  const MC_MAX = 40;
  return { horizon: Math.max(1, Math.min(days, MC_MAX)), rawDays: days, capped: days > MC_MAX };
}

// Map catalyst dates onto trading-day indices within the horizon.
function mapCatalystsToDays(
  catalysts: { label: string; date: string; volMultiplier: number; source: string }[],
  quoteDate: string,
  horizon: number
) {
  const start = new Date(quoteDate);
  const tradingDates: string[] = [];
  const cur = new Date(start);
  while (tradingDates.length < horizon) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const d = cur.getUTCDay();
    if (d !== 0 && d !== 6) tradingDates.push(cur.toISOString().slice(0, 10));
  }
  const applied: { label: string; date: string; dayIndex: number; volMultiplier: number }[] = [];
  const multipliers: Record<number, number> = {};
  for (const c of catalysts) {
    const idx = tradingDates.indexOf(c.date);
    if (idx >= 0) {
      applied.push({ label: c.label, date: c.date, dayIndex: idx, volMultiplier: c.volMultiplier });
      // If multiple catalysts land on the same day, compound (capped).
      multipliers[idx] = Math.min(2.5, (multipliers[idx] ?? 1) * c.volMultiplier);
    }
  }
  return { multipliers, applied };
}

export async function runPipeline(
  commodityId: string,
  span: { from: string; to: string },
  emit: Emit
): Promise<RunResult> {
  const generatedAt = new Date().toISOString();
  const redFlags: RedFlag[] = [];

  // ---- Resolve commodity and plan ----
  emit("step", `Resolving commodity "${commodityId}"...`);
  const commodity = getCommodity(commodityId);
  if (!commodity) throw new Error(`Unknown commodity: ${commodityId}`);
  emit("ok", `${commodity.label} — ${commodity.venue} ${commodity.symbol} (${commodity.unit})`);

  emit("step", `Resolving plan asset (dedicated > class > universal)...`);
  const { plan, resolution, planHash } = resolvePlanFor(commodity);
  emit("ok", `Plan: ${plan.label ?? plan.id} [${resolution}] hash ${planHash}`);

  // ---- Data-unavailable short-circuit ----
  if (commodity.dataUnavailable) {
    redFlags.push({ where: "data", message: commodity.dataUnavailableReason ?? "No live data source." });
    emit("flag", `RED FLAG: ${commodity.dataUnavailableReason ?? "no live data source"}.`);
  }

  // ---- Span sanity: reject purely-past spans, flag horizon cap ----
  const now = new Date();
  const spanTo = new Date(span.to);
  const spanFrom = new Date(span.from);
  if (spanTo <= now) {
    redFlags.push({ where: "span", message: `Span end (${span.to.slice(0, 10)}) is not in the future — projection horizon defaulted to ~5 trading days.` });
    emit("warn", `Span end is in the past — using default 5-day horizon.`);
  }
  if (spanFrom > now) {
    emit("warn", `Span start (${span.from.slice(0, 10)}) is in the future — using latest available data as anchor.`);
  }

  // ---- OHLC via fallback ladder ----
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
    if (ohlc.source.startsWith("FRED ")) {
      redFlags.push({
        where: "price",
        message: `${commodity.label} has no free daily feed — using ${commodity.fredSeries} (monthly IMF price forward-filled to daily). Realized vol and technicals reflect monthly resolution; treat intraday bands as coarse.`,
      });
      emit("flag", `RED FLAG: source is monthly (FRED ${commodity.fredSeries}) — sub-monthly precision is not real.`);
    }
  } catch (e: any) {
    redFlags.push({ where: "price", message: `All OHLC sources failed: ${e?.message ?? e}` });
    emit("error", `RED FLAG: could not fetch any price data — ${e?.message ?? e}`);
  }

  // ---- Optional: bound history for technicals to span.from (analyst-focus window) ----
  let barsForTech = bars;
  if (bars && bars.length > 30) {
    const anchor = new Date(span.from).getTime();
    // Keep at least `realizedVolWindow` + `maPeriods.max` bars regardless of span,
    // to guarantee technicals can compute.
    const need = Math.max(plan.technicals.realizedVolWindow * 3, Math.max(...plan.technicals.maPeriods) + 30);
    const wantedIdx = bars.findIndex((b) => new Date(b.date).getTime() >= anchor);
    if (wantedIdx > 0 && bars.length - wantedIdx >= need) {
      barsForTech = bars.slice(wantedIdx);
      emit("ok", `Technicals window bounded to span.from (${bars.length - wantedIdx} bars from ${bars[wantedIdx].date.slice(0, 10)}).`);
    } else if (wantedIdx > 0) {
      emit("warn", `Span.from would leave too few bars for technicals — using full history (${bars.length} bars).`);
    }
  }

  // ---- Technicals ----
  let technicals: Technicals | null = null;
  if (barsForTech && barsForTech.length > 30) {
    emit("step", `Computing technicals (RSI/MACD/MA/ATR/realized vol)...`);
    technicals = computeTechnicals(barsForTech, plan);
    emit(
      "ok",
      `RSI ${fmt(technicals.rsi14)} · realized vol ${fmt(technicals.realizedVolAnnualPct)}% · ` +
        `MA50 ${fmt(technicals.ma["ma50"]?.value)} MA200 ${fmt(technicals.ma["ma200"]?.value)}`
    );
  } else if (!bars) {
    // no bars at all
  } else {
    redFlags.push({ where: "technicals", message: "Insufficient price history for technicals." });
    emit("flag", `RED FLAG: not enough history for technicals.`);
  }

  // ---- Implied vol (GVZ/OVX/VXSLV, where mapped) ----
  emit("step", `Fetching implied volatility (vol index)...`);
  const iv = await impliedVolFor(commodity.id);
  if (iv) emit("ok", `${iv.index}: ${iv.value}% (as of ${iv.asOf.slice(0, 10)})`);
  else emit("warn", `No mapped vol index for ${commodity.id} — using realized vol.`);

  // ---- Bands (honoring plan.bands.volSource) ----
  let bandsComputed: { bands: Bands[]; volUsedPct: number | null; volSourceUsed: "implied" | "realized" | "unavailable"; impliedVolPct: number | null; realizedVolPct: number | null } =
    { bands: [], volUsedPct: null, volSourceUsed: "unavailable", impliedVolPct: iv?.value ?? null, realizedVolPct: technicals?.realizedVolAnnualPct ?? null };
  if (quote && technicals) {
    bandsComputed = computeBands(quote.price, technicals, plan, {
      impliedVolPct: iv?.value ?? null,
      realizedVolPct: technicals.realizedVolAnnualPct,
    });
    emit("ok", `Bands using ${bandsComputed.volSourceUsed} vol (${fmt(bandsComputed.volUsedPct)}%) for ${bandsComputed.bands.map((b) => b.horizon).join(", ")}.`);
  }

  // ---- COT positioning ----
  let cot: RunResult["cot"] = null;
  if (plan.dataInputs.cotContractCode) {
    emit("step", `Fetching CFTC COT positioning...`);
    try {
      const c = await cotDisaggregated(plan.dataInputs.cotContractCode);
      cot = { asOf: c.asOf, managedMoneyNet: c.managedMoneyNet, percentile3y: c.percentile3y, source: c.source, venueNote: commodity.cotVenueNote };
      emit("ok", `Managed-money net ${c.managedMoneyNet.toLocaleString()} · 3y pct ${c.percentile3y != null ? (c.percentile3y * 100).toFixed(0) + "%" : "n/a"} · as of ${c.asOf}`);
    } catch (e: any) {
      redFlags.push({ where: "positioning", message: `COT fetch failed: ${e?.message ?? e}` });
      emit("warn", `COT unavailable — ${e?.message ?? e}`);
    }
  } else {
    emit("warn", `No COT contract code for ${commodity.id} — positioning skipped.`);
  }

  // ---- Macro overlay (real yield history + DXY) ----
  emit("step", `Fetching macro overlay (real yield, DXY)...`);
  const macroRealYieldLatest = await fredRealYield();
  const realYieldHistory = macroRealYieldLatest ? await fredRealYieldHistory(300) : [];
  const dxy = await dollarIndex();
  let realYieldCorrelation: number | null = null;
  if (barsForTech && realYieldHistory.length > 20) {
    const priceSeries = barsForTech.map((b) => ({ date: b.date, value: b.close }));
    const { aVals, bVals } = alignByDate(priceSeries, realYieldHistory);
    realYieldCorrelation = correlationOfReturns(aVals, bVals);
    if (realYieldCorrelation != null)
      emit("ok", `Rolling 60d corr (returns vs Δ real-yield): ${realYieldCorrelation.toFixed(2)}`);
  }
  if (macroRealYieldLatest) emit("ok", `10y real yield ${macroRealYieldLatest.value.toFixed(2)}% as of ${macroRealYieldLatest.asOf}`);
  else emit("warn", `FRED unavailable — set FRED_API_KEY to enable real-yield overlay.`);
  if (dxy) emit("ok", `DXY ${dxy.value} (${dxy.changePct20d != null && dxy.changePct20d > 0 ? "+" : ""}${dxy.changePct20d}% 20d)`);
  else emit("warn", `DXY fetch failed.`);

  // ---- Term structure & roll yield ----
  let ts: TermStructureRead | null = null;
  const root = FUTURES_ROOT[commodity.id];
  if (root) {
    emit("step", `Fetching term structure (${root} next 4 deliveries)...`);
    try {
      const t = await termStructure(root, 4);
      ts = { root, ...t };
      if (t.shape === "insufficient") emit("warn", `Term structure: ${t.note}`);
      else emit("ok", `Term structure: ${t.shape}, roll ${t.rollYieldAnnualizedPct}%/yr, spread ${t.spread}`);
    } catch (e: any) {
      emit("warn", `Term structure fetch failed: ${e?.message ?? e}`);
    }
  }

  // ---- ETF flow proxy ----
  emit("step", `Fetching ETF flow proxy...`);
  const flow = await etfFlow(commodity.id, commodity.class);
  if (flow) emit("ok", `${flow.ticker}: 5d ${flow.changePct5d != null && flow.changePct5d > 0 ? "+" : ""}${flow.changePct5d}% · 20d ${flow.changePct20d != null && flow.changePct20d > 0 ? "+" : ""}${flow.changePct20d}%`);
  else emit("warn", `No mapped ETF for ${commodity.id}.`);

  // ---- Regime + signal stack ----
  let regime: RegimeRead | null = null;
  if (barsForTech && technicals) {
    emit("step", `Running regime gate + signal stack...`);
    const ctx: RegimeContext = {
      cotPercentile: cot?.percentile3y ?? null,
      realYieldCorrelation,
      realYieldDirection: realYieldHistory.length > 20
        ? realYieldHistory[realYieldHistory.length - 1].value - realYieldHistory[Math.max(0, realYieldHistory.length - 21)].value
        : null,
      dxyChangePct: dxy?.changePct20d ?? null,
      etfFlow5dPct: flow?.changePct5d ?? null,
      rollShape: ts?.shape === "insufficient" ? null : (ts?.shape ?? null),
    };
    regime = computeRegime(barsForTech, technicals, plan, ctx);
    emit("ok", `Regime: ${regime.regime} · lean ${regime.lean} · Bull ${(regime.probabilities.bull * 100).toFixed(0)}/Base ${(regime.probabilities.base * 100).toFixed(0)}/Bear ${(regime.probabilities.bear * 100).toFixed(0)}`);
  }

  // ---- Catalysts inside span ----
  const catList = commodity ? catalystsFor(commodity, new Date(quote?.asOf ?? span.from), spanTo) : [];
  const catalystsInSpan = catList.map((c) => ({ label: c.label, date: c.date, volMultiplier: c.volMultiplier, source: c.source }));
  if (catalystsInSpan.length) emit("ok", `${catalystsInSpan.length} scheduled catalysts inside span.`);
  else emit("info", `No scheduled catalysts inside span.`);

  // ---- Monte Carlo (event days wired) ----
  let montecarlo: MonteCarloResult | null = null;
  if (quote && bandsComputed.volUsedPct && regime) {
    const { horizon, rawDays, capped } = tradingDaysBetween(quote.asOf, spanTo <= now ? new Date(now.getTime() + 5 * 864e5).toISOString() : span.to);
    if (capped) {
      redFlags.push({ where: "horizon", message: `Span horizon ${rawDays} trading days capped to Monte-Carlo max of 40.` });
      emit("flag", `RED FLAG: horizon capped at 40 trading days (requested ${rawDays}).`);
    }
    emit("step", `Running Monte-Carlo (${plan.monteCarlo.paths.toLocaleString()} paths, ${horizon} trading days)...`);
    const dailyVolPct = bandsComputed.volUsedPct / Math.sqrt(252);
    const monthMoveFrac = (bandsComputed.volUsedPct / 100) * Math.sqrt(21 / 252);
    const seed = `${commodity.symbol}|${quote.asOf.slice(0, 10)}|${planHash}`;
    const { multipliers, applied } = mapCatalystsToDays(catalystsInSpan, quote.asOf, horizon);
    if (applied.length) emit("ok", `${applied.length} catalyst(s) mapped into Monte-Carlo event days.`);
    // Build the trading-date list once so both the fan and the ladder can label with real dates.
    const tradingDates: string[] = [];
    const cur = new Date(quote.asOf);
    while (tradingDates.length < horizon) {
      cur.setUTCDate(cur.getUTCDate() + 1);
      const d = cur.getUTCDay();
      if (d !== 0 && d !== 6) tradingDates.push(cur.toISOString().slice(0, 10));
    }
    montecarlo = runMonteCarlo(plan, {
      spot: quote.price,
      dailyVolPct,
      horizonTradingDays: horizon,
      probabilities: regime.probabilities,
      monthMoveFrac,
      seed,
      eventDayMultipliers: multipliers,
      appliedCatalysts: applied,
      anchorDate: quote.asOf,
      tradingDates,
    });
    const last = montecarlo.fan[montecarlo.fan.length - 1];
    emit("ok", `MC median ${last.p50} · 90% band ${last.p5}–${last.p95} · seed ${seed}`);
  } else {
    emit("warn", `Monte-Carlo skipped (needs spot + vol + regime).`);
  }

  // ---- Options-implied percentile targets (for tickers with a Yahoo option chain) ----
  let optionsImplied: OptionsImpliedTargets | null = null;
  const optionsTicker = ID_ETF[commodity.id];
  if (optionsTicker) {
    emit("step", `Fetching options chain (${optionsTicker})...`);
    try {
      const chain = await optionChain(optionsTicker);
      if (chain) {
        const rnd = riskNeutralDensity(chain);
        if (rnd) {
          const p = (q: number) => percentileFromRnd(rnd, q) ?? chain.spot;
          optionsImplied = {
            underlying: optionsTicker, expiry: chain.expiry.slice(0, 10), daysToExpiry: chain.daysToExpiry,
            spot: chain.spot,
            p5: Number(p(5).toFixed(2)), p25: Number(p(25).toFixed(2)),
            p50: Number(p(50).toFixed(2)), p75: Number(p(75).toFixed(2)), p95: Number(p(95).toFixed(2)),
            source: chain.source,
          };
          emit("ok", `Options RND: p50 ${optionsImplied.p50} · 90% ${optionsImplied.p5}–${optionsImplied.p95} (T=${chain.daysToExpiry}d)`);
        } else emit("warn", `Options RND: too few valid call prices to construct.`);
      } else emit("warn", `Options chain unavailable for ${optionsTicker}.`);
    } catch (e: any) {
      emit("warn", `Options fetch failed: ${e?.message ?? e}`);
    }
  }

  // ---- Backtest bands vs realized outcomes ----
  let backtest: BacktestResult[] | null = null;
  if (barsForTech && barsForTech.length > 120) {
    emit("step", `Backtesting bands vs realized outcomes (rolling anchors)...`);
    backtest = backtestBands(barsForTech, plan, 60);
    for (const b of backtest) emit("ok", `  ${b.horizon}: ±1σ hit ${(b.hitRate1Sigma * 100).toFixed(0)}%, 90% hit ${(b.hitRate90 * 100).toFixed(0)}% (n=${b.n})`);
  }

  // ---- Invalidation levels + confidence ----
  const invalidations = deriveInvalidations(quote, technicals, bandsComputed.bands);
  const confidence = deriveConfidence({
    redFlagCount: redFlags.length,
    hasCot: !!cot,
    hasMacro: !!macroRealYieldLatest,
    hasImpliedVol: bandsComputed.volSourceUsed === "implied",
    hasBacktest: !!backtest,
    marketOpen: quote?.marketOpen ?? false,
    lean: regime?.lean ?? "no-lean",
  });

  // ---- TL;DR ----
  const tldr = buildTldr({ commodity, quote, regime, montecarlo, bandsComputed, catalystsInSpan, dxy, iv, ts, confidence });

  // ---- Assemble report ----
  emit("step", `Assembling report (TL;DR + Detail)...`);
  const markdown = assembleReport({
    commodity, plan, planResolution: resolution, planHash, span,
    quote, dataSource, technicals,
    bands: bandsComputed.bands,
    volSource: bandsComputed.volSourceUsed,
    volUsedPct: bandsComputed.volUsedPct,
    impliedVolPct: bandsComputed.impliedVolPct,
    realizedVolPct: bandsComputed.realizedVolPct,
    regime, cot,
    macro: { realYield: macroRealYieldLatest, realYieldCorrelation, dxy },
    termStructure: ts,
    etfFlow: flow ? { ticker: flow.ticker, changePct5d: flow.changePct5d, changePct20d: flow.changePct20d, source: flow.source } : null,
    montecarlo, optionsImplied, backtest, catalystsInSpan,
    invalidations, confidence, tldr,
    redFlags, generatedAt,
  });
  emit("done", `Report ready (${markdown.length} chars, ${redFlags.length} RED FLAG${redFlags.length === 1 ? "" : "s"}).`);

  return {
    runId: "", commodity, planId: plan.id, planResolution: resolution, span,
    quote, technicals, bands: bandsComputed.bands,
    volSource: bandsComputed.volSourceUsed, volUsedPct: bandsComputed.volUsedPct,
    impliedVolPct: bandsComputed.impliedVolPct, realizedVolPct: bandsComputed.realizedVolPct,
    regime, cot,
    macro: { realYield: macroRealYieldLatest, realYieldCorrelation, dxy },
    termStructure: ts,
    etfFlow: flow ? { ticker: flow.ticker, changePct5d: flow.changePct5d, changePct20d: flow.changePct20d, source: flow.source } : null,
    montecarlo, optionsImplied, backtest, catalystsInSpan,
    invalidations, confidence, tldr,
    redFlags, markdown, finishedAt: new Date().toISOString(),
  };
}

function deriveInvalidations(quote: Quote | null, tech: Technicals | null, bands: Bands[]): RunResult["invalidations"] {
  if (!quote || !tech) return [];
  const ma50 = tech.ma["ma50"]?.value;
  const ma200 = tech.ma["ma200"]?.value;
  const out: RunResult["invalidations"] = [];
  for (const b of bands) {
    // Upside break: max of upper 1σ band and MA200 (for bull lean to survive).
    // Downside break: min of lower 1σ band and MA50 (for bear lean to survive).
    const up = Math.max(b.sigma1[1], ma200 ?? b.sigma1[1]);
    const dn = Math.min(b.sigma1[0], ma50 ?? b.sigma1[0]);
    out.push({ horizon: b.horizon, upsideBreak: Number(up.toFixed(2)), downsideBreak: Number(dn.toFixed(2)) });
  }
  return out;
}

function deriveConfidence(inp: {
  redFlagCount: number; hasCot: boolean; hasMacro: boolean; hasImpliedVol: boolean;
  hasBacktest: boolean; marketOpen: boolean; lean: string;
}): RunResult["confidence"] {
  const drivers: string[] = [];
  let score = 5;
  if (inp.hasCot) { score += 1; drivers.push("live COT"); } else drivers.push("no COT");
  if (inp.hasMacro) { score += 1; drivers.push("macro overlay"); } else drivers.push("no macro");
  if (inp.hasImpliedVol) { score += 1; drivers.push("implied vol"); } else drivers.push("realized vol only");
  if (inp.hasBacktest) { score += 1; drivers.push("backtest data"); }
  if (inp.marketOpen) { score += 1; drivers.push("live market"); } else drivers.push("market closed");
  score -= inp.redFlagCount;
  const label: RunResult["confidence"]["label"] = score >= 7 ? "high" : score >= 4 ? "medium" : "low";
  return { score, label, drivers };
}

function buildTldr(a: any): string {
  const { commodity, quote, regime, montecarlo, bandsComputed, catalystsInSpan, dxy, iv, ts, confidence } = a;
  if (!quote) return `${commodity.label}: no live data available. See RED FLAGS below.`;
  const price = quote.price;
  const unit = commodity.unit;
  const spanEnd = montecarlo?.fan?.length ? montecarlo.fan[montecarlo.fan.length - 1] : null;
  const rangeStr = spanEnd ? `${spanEnd.p25}–${spanEnd.p75}` : (bandsComputed.bands[0] ? `${bandsComputed.bands[0].sigma1[0]}–${bandsComputed.bands[0].sigma1[1]}` : "n/a");
  const median = spanEnd ? spanEnd.p50 : price;
  const leanWord = regime?.lean === "bull" ? "leans up" : regime?.lean === "bear" ? "leans down" : "no directional lean";
  const drivers: string[] = [];
  if (iv) drivers.push(`implied vol ${iv.value}%`);
  if (dxy?.changePct20d != null) drivers.push(`DXY ${dxy.changePct20d > 0 ? "+" : ""}${dxy.changePct20d}% 20d`);
  if (ts && ts.shape !== "insufficient") drivers.push(`${ts.shape} curve`);
  if (catalystsInSpan.length) drivers.push(`${catalystsInSpan.length} catalyst${catalystsInSpan.length === 1 ? "" : "s"} in span`);
  return [
    `**${commodity.label}** is trading at **${price.toLocaleString()} ${unit}**.`,
    `Most likely range by end of span: **${rangeStr}** (median ${median}). Model ${leanWord}.`,
    drivers.length ? `Key drivers: ${drivers.join(", ")}.` : "",
    `Confidence: **${confidence.label}** (${confidence.score}/10 — ${confidence.drivers.join(", ")}).`,
  ].filter(Boolean).join(" ");
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "n/a";
  const abs = Math.abs(n);
  return n.toFixed(abs >= 1000 ? 0 : abs >= 10 ? 1 : 2);
}
