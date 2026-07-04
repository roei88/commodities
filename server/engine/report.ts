import type {
  CommodityMeta, PlanAsset, Quote, Technicals, Bands, RegimeRead,
  MonteCarloResult, RedFlag, OptionsImpliedTargets, TermStructureRead, BacktestResult, RunResult,
} from "../../shared/types.ts";

export interface ReportInput {
  commodity: CommodityMeta;
  plan: PlanAsset;
  planResolution: string;
  planHash: string;
  span: { from: string; to: string };
  quote: Quote | null;
  dataSource: string;
  technicals: Technicals | null;
  bands: Bands[];
  volSource: "implied" | "realized" | "unavailable";
  volUsedPct: number | null;
  impliedVolPct: number | null;
  realizedVolPct: number | null;
  regime: RegimeRead | null;
  cot: RunResult["cot"];
  macro: RunResult["macro"];
  termStructure: TermStructureRead | null;
  etfFlow: RunResult["etfFlow"];
  montecarlo: MonteCarloResult | null;
  optionsImplied: OptionsImpliedTargets | null;
  backtest: BacktestResult[] | null;
  catalystsInSpan: RunResult["catalystsInSpan"];
  invalidations: RunResult["invalidations"];
  confidence: RunResult["confidence"];
  tldr: string;
  redFlags: RedFlag[];
  generatedAt: string;
}

function n(v: number | null | undefined, dp = 2): string {
  if (v == null || Number.isNaN(v)) return "n/a";
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function signed(v: number | null | undefined, dp = 2): string {
  if (v == null || Number.isNaN(v)) return "n/a";
  const s = v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return v > 0 ? "+" + s : s;
}

export function assembleReport(inp: ReportInput): string {
  const { commodity: c, plan, quote } = inp;
  const L: string[] = [];

  // ============================================================
  // TL;DR — plain-English summary card
  // ============================================================
  L.push(`# ${c.label} — price-target research`);
  L.push("");
  L.push(`> ${inp.tldr}`);
  L.push("");
  if (inp.regime && inp.montecarlo) {
    const last = inp.montecarlo.fan[inp.montecarlo.fan.length - 1];
    L.push(`**Where it goes from here:**`);
    L.push(`- **Most likely close by span end:** ${n(last.p50)} ${c.unit}`);
    L.push(`- **Comfortable range (50%):** ${n(last.p25)} – ${n(last.p75)}`);
    L.push(`- **Full range (90%):** ${n(last.p5)} – ${n(last.p95)}`);
    L.push(`- **Direction:** ${leanText(inp.regime.lean)}`);
    L.push("");
  }
  if (inp.invalidations.length) {
    L.push(`**What would break the read?**`);
    for (const iv of inp.invalidations) {
      L.push(`- ${cap(iv.horizon)}: bearish thesis fails on a close above **${n(iv.upsideBreak)}**; bullish thesis fails on a close below **${n(iv.downsideBreak)}**.`);
    }
    L.push("");
  }
  L.push("---");
  L.push("");

  // ============================================================
  // Detail — full quant section
  // ============================================================
  L.push(`## Setup`);
  L.push(
    `**Benchmark:** ${c.venue} ${c.symbol} · **Unit:** ${c.unit} · ` +
      `**Plan:** ${plan.label ?? plan.id} (\`${inp.planResolution}\`, hash \`${inp.planHash}\`)`
  );
  L.push(`**Analysis span:** ${inp.span.from.slice(0, 10)} → ${inp.span.to.slice(0, 10)}`);
  if (quote) {
    L.push(
      `**Spot:** ${n(quote.price)} ${c.unit} · as of ${quote.asOf.slice(0, 16).replace("T", " ")}Z · ` +
        (quote.changePct != null ? (quote.changePct >= 0 ? "+" : "") + n(quote.changePct) + "% d/d · " : "") +
        `source: ${quote.source} · market **${quote.marketOpen ? "open" : "closed"}**` +
        (quote.stale ? " · **RED FLAG: data may be stale**" : "")
    );
  }
  L.push("");

  // Regime
  if (inp.regime) {
    L.push(`## Regime + signal stack`);
    L.push(`**Regime:** ${inp.regime.regime}`);
    L.push(`**Evidence:** ${inp.regime.evidence}`);
    L.push("");
    L.push(`| Signal | Score | Weight | Note |`);
    L.push(`|---|---|---|---|`);
    for (const s of inp.regime.signals) {
      L.push(`| ${s.name} | ${s.score > 0 ? "+1" : s.score < 0 ? "−1" : "0"} | ${s.weight} | ${s.note} |`);
    }
    const p = inp.regime.probabilities;
    L.push("");
    L.push(`**Scenario probabilities:** Bull ${(p.bull * 100).toFixed(0)}% · Base ${(p.base * 100).toFixed(0)}% · Bear ${(p.bear * 100).toFixed(0)}%`);
    L.push(`**Directional lean:** ${leanText(inp.regime.lean)}`);
    L.push("");
  }

  // Bands
  if (inp.bands.length) {
    L.push(`## Expected-move bands`);
    L.push(
      `Vol source used: **${inp.volSource}** (${n(inp.volUsedPct, 1)}%). ` +
        (inp.impliedVolPct != null && inp.realizedVolPct != null
          ? `Implied ${n(inp.impliedVolPct, 1)}% vs realized ${n(inp.realizedVolPct, 1)}% → ${inp.impliedVolPct > inp.realizedVolPct * 1.1 ? "**event premium priced**" : inp.impliedVolPct < inp.realizedVolPct * 0.9 ? "**complacency**" : "roughly aligned"}.`
          : "")
    );
    L.push("");
    L.push(`| Horizon | ±1σ (~68%) | ±1.65σ (~90%) |`);
    L.push(`|---|---|---|`);
    for (const b of inp.bands) L.push(`| ${b.horizon} (${b.days}d) | ${n(b.sigma1[0])} – ${n(b.sigma1[1])} | ${n(b.sigma90[0])} – ${n(b.sigma90[1])} |`);
    L.push("");
  }

  // Monte Carlo
  if (inp.montecarlo) {
    const mc = inp.montecarlo;
    const last = mc.fan[mc.fan.length - 1];
    L.push(`## Monte-Carlo simulation`);
    L.push(`${plan.monteCarlo.paths.toLocaleString()} seeded paths (\`${mc.seed}\`), ${mc.fan.length} trading days, ${plan.monteCarlo.process} process.`);
    L.push("");
    L.push(`**End-of-span distribution:** median ${n(last.p50)}, 50% ${n(last.p25)}–${n(last.p75)}, 90% ${n(last.p5)}–${n(last.p95)}`);
    if (mc.appliedCatalysts.length) {
      L.push(`**Event days applied:** ${mc.appliedCatalysts.map((c) => `${c.date} ${c.label} (×${c.volMultiplier})`).join("; ")}`);
    }
    L.push("");
    L.push(`**Touch probabilities over span:**`);
    for (const t of mc.touchProbs) {
      if (t.probUp != null) L.push(`- reach ${n(t.level)} (up): ${(t.probUp * 100).toFixed(0)}%`);
      else L.push(`- reach ${n(t.level)} (down): ${((t.probDown ?? 0) * 100).toFixed(0)}%`);
    }
    L.push("");
  }

  // Options-implied
  if (inp.optionsImplied) {
    const oi = inp.optionsImplied;
    L.push(`## Options-implied targets (${oi.underlying}, T=${oi.daysToExpiry}d)`);
    L.push(`Risk-neutral density derived from ${oi.underlying} option chain expiring ${oi.expiry}.`);
    L.push("");
    L.push(`| p5 | p25 | p50 | p75 | p95 |`);
    L.push(`|---|---|---|---|---|`);
    L.push(`| ${n(oi.p5)} | ${n(oi.p25)} | ${n(oi.p50)} | ${n(oi.p75)} | ${n(oi.p95)} |`);
    L.push("");
    if (inp.montecarlo) {
      const mcLast = inp.montecarlo.fan[inp.montecarlo.fan.length - 1];
      const mcMedianPct = ((mcLast.p50 - inp.montecarlo.spot) / inp.montecarlo.spot) * 100;
      const rndMedianPct = ((oi.p50 - oi.spot) / oi.spot) * 100;
      L.push(`_Note: options implied for ${oi.underlying} — a proxy ETF, not the front future. Median implies ${signed(rndMedianPct)}% vs MC ${signed(mcMedianPct)}% on the future._`);
      L.push("");
    }
  }

  // Term structure
  if (inp.termStructure) {
    const t = inp.termStructure;
    L.push(`## Term structure & roll`);
    if (t.shape === "insufficient") {
      L.push(`_${t.note}_`);
    } else {
      L.push(`**Shape:** ${t.shape} · **Roll yield (ann.):** ${signed(t.rollYieldAnnualizedPct)}% · **Front-next spread:** ${signed(t.spread)}`);
      L.push("");
      L.push(`| Contract | Month | Price | Expiry |`);
      L.push(`|---|---|---|---|`);
      for (const cx of t.contracts) L.push(`| ${cx.symbol} | ${cx.monthCode} | ${n(cx.price)} | ${cx.expiry ?? "—"} |`);
    }
    L.push("");
  }

  // Positioning
  L.push(`## Positioning (CFTC COT)`);
  if (inp.cot) {
    L.push(
      `Managed-money net: **${inp.cot.managedMoneyNet.toLocaleString()}** contracts · ` +
        `3y percentile: ${inp.cot.percentile3y != null ? (inp.cot.percentile3y * 100).toFixed(0) + "%" : "n/a"} · ` +
        `as of ${inp.cot.asOf} (lagged ≤1 week) · ${inp.cot.source}` +
        (inp.cot.venueNote ? ` · _${inp.cot.venueNote}_` : "")
    );
  } else {
    L.push(`_COT unavailable for this contract._`);
  }
  L.push("");

  // Macro
  if (inp.macro && (inp.macro.realYield || inp.macro.dxy || inp.macro.realYieldCorrelation != null)) {
    L.push(`## Macro overlay`);
    if (inp.macro.realYield) L.push(`- 10y real yield (DGS10 − T10YIE): ${n(inp.macro.realYield.value, 2)}% as of ${inp.macro.realYield.asOf}`);
    if (inp.macro.realYieldCorrelation != null) L.push(`- Rolling correlation (returns vs Δ real-yield): ${inp.macro.realYieldCorrelation.toFixed(2)}${inp.macro.realYieldCorrelation < -0.2 ? " → **inverse intact**" : inp.macro.realYieldCorrelation > 0.2 ? " → regime broken" : " → weak"}`);
    if (inp.macro.dxy) L.push(`- Dollar index (${inp.macro.dxy.source}): ${n(inp.macro.dxy.value, 2)} · 1d ${signed(inp.macro.dxy.changePct1d)}% · 20d ${signed(inp.macro.dxy.changePct20d)}%`);
    L.push("");
  }

  // ETF flow
  if (inp.etfFlow) {
    L.push(`## ETF flow proxy`);
    L.push(`${inp.etfFlow.ticker}: 5d ${signed(inp.etfFlow.changePct5d)}% · 20d ${signed(inp.etfFlow.changePct20d)}% · ${inp.etfFlow.source}`);
    L.push("");
  }

  // Catalysts
  if (inp.catalystsInSpan.length) {
    L.push(`## Scheduled catalysts in span`);
    L.push(`| Date | Event | Vol × | Source |`);
    L.push(`|---|---|---|---|`);
    for (const c of inp.catalystsInSpan) L.push(`| ${c.date} | ${c.label} | ${c.volMultiplier} | ${c.source} |`);
    L.push("");
  }

  // Backtest
  if (inp.backtest && inp.backtest.length) {
    L.push(`## Backtest — has the model been honest?`);
    L.push(`For each horizon, re-ran the same band construction on 60 rolling anchor dates and checked whether the realized close fell inside.`);
    L.push("");
    L.push(`| Horizon | n | ±1σ hit rate | 90% hit rate | Median error |`);
    L.push(`|---|---|---|---|---|`);
    for (const b of inp.backtest) L.push(`| ${b.horizon} | ${b.n} | ${(b.hitRate1Sigma * 100).toFixed(0)}% | ${(b.hitRate90 * 100).toFixed(0)}% | ${n(b.medianError, 2)} |`);
    L.push("");
    L.push(`_Reference: a well-calibrated ±1σ band should hit ~68%, a 90% band ~90%. Deviation ≥5pt means the vol source under- or over-states risk._`);
    L.push("");
  }

  // Qualitative protocols out of scope (declared but not executed by engine)
  if (plan.qualitativeProtocols && plan.qualitativeProtocols.length) {
    L.push(`## Qualitative protocols — declared, NOT executed`);
    L.push(`_The following are part of the methodology but require external judgement the deterministic engine does not perform:_`);
    for (const q of plan.qualitativeProtocols) L.push(`- ${q}`);
    L.push("");
  }

  // Red flags
  if (inp.redFlags.length) {
    L.push(`## RED FLAGS`);
    for (const f of inp.redFlags) L.push(`- **${f.where}:** ${f.message}`);
    L.push("");
  }

  // Confidence
  L.push(`## Confidence`);
  L.push(`**${inp.confidence.label.toUpperCase()}** (${inp.confidence.score}/10). Drivers: ${inp.confidence.drivers.join(", ")}.`);
  L.push("");

  // Accuracy ceilings
  if (plan.accuracyCeilings) {
    L.push(`## Accuracy ceilings`);
    for (const [k, v] of Object.entries(plan.accuracyCeilings)) L.push(`- **${k}:** ${v}`);
    L.push("");
  }

  // Sources
  L.push(`## Accessed / inferred`);
  const accessed = [inp.dataSource];
  if (inp.cot) accessed.push(inp.cot.source);
  if (inp.macro?.realYield) accessed.push("FRED (DGS10, T10YIE)");
  if (inp.macro?.dxy) accessed.push(inp.macro.dxy.source);
  if (inp.termStructure && inp.termStructure.shape !== "insufficient") accessed.push(`Yahoo term structure (${inp.termStructure.root})`);
  if (inp.etfFlow) accessed.push(inp.etfFlow.source);
  if (inp.optionsImplied) accessed.push(inp.optionsImplied.source);
  L.push(`**Accessed:** ${accessed.join(" · ")}`);
  L.push(`**Inferred:** regime read, signal-stack scoring, scenario probabilities, expected-move bands, Monte-Carlo distribution, options risk-neutral density, backtest hit rates.`);
  L.push("");

  // Disclaimer
  L.push(`---`);
  L.push(
    `_Mechanical, backward-looking quantitative model with no live news or narrative awareness. ` +
      `Outputs are scenario analysis, not investment advice, and carry no guarantee. Generated ${inp.generatedAt}._`
  );

  return L.join("\n");
}

function leanText(l: RegimeRead["lean"] | undefined): string {
  if (l === "bull") return "**bullish lean**";
  if (l === "bear") return "**bearish lean**";
  return "**no lean** (net signal below threshold — band + trigger only)";
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
