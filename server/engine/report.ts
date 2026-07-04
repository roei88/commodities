import type {
  CommodityMeta,
  PlanAsset,
  Quote,
  Technicals,
  Bands,
  RegimeRead,
  MonteCarloResult,
  RedFlag,
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
  regime: RegimeRead | null;
  cot: { asOf: string; managedMoneyNet: number; percentile3y: number | null; source: string } | null;
  macro: { realYield?: { value: number; asOf: string } | null; dxy?: number | null } | null;
  montecarlo: MonteCarloResult | null;
  redFlags: RedFlag[];
  generatedAt: string;
}

function n(v: number | null | undefined, dp = 2): string {
  if (v == null || Number.isNaN(v)) return "n/a";
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function assembleReport(inp: ReportInput): string {
  const { commodity: c, plan, quote } = inp;
  const L: string[] = [];

  // Header
  L.push(`# ${c.label} price-target research — ${inp.generatedAt.slice(0, 10)}`);
  L.push("");
  L.push(
    `**Benchmark:** ${c.venue} ${c.symbol} · **Unit:** ${c.unit} · ` +
      `**Plan:** ${plan.label ?? plan.id} (\`${inp.planResolution}\`, hash \`${inp.planHash}\`)`
  );
  L.push(`**Analysis span:** ${inp.span.from.slice(0, 10)} → ${inp.span.to.slice(0, 10)}`);
  if (quote) {
    L.push(
      `**Spot:** ${n(quote.price)} ${c.unit} · as of ${quote.asOf.slice(0, 16).replace("T", " ")}Z · ` +
        `${quote.changePct != null ? (quote.changePct >= 0 ? "+" : "") + n(quote.changePct) + "% d/d" : ""} · ` +
        `source: ${quote.source} · market **${quote.marketOpen ? "open" : "closed"}**` +
        (quote.stale ? " · **RED FLAG: data may be stale**" : "")
    );
  } else {
    L.push(`**Spot:** RED FLAG — no live quote available (all data sources failed).`);
  }
  L.push("");

  // Regime
  if (inp.regime) {
    L.push(`## Regime read`);
    L.push(`**Dominant regime:** ${inp.regime.regime}`);
    L.push(`**Evidence:** ${inp.regime.evidence}`);
    L.push("");
    L.push(`**Signal stack** (each scored -1/0/+1 × weight):`);
    for (const s of inp.regime.signals) {
      const sign = s.score > 0 ? "+1" : s.score < 0 ? "-1" : " 0";
      L.push(`- ${s.name} (w ${s.weight}): \`${sign}\` — ${s.note}`);
    }
    const p = inp.regime.probabilities;
    L.push("");
    L.push(
      `**Scenario probabilities:** Bull ${(p.bull * 100).toFixed(0)}% · ` +
        `Base ${(p.base * 100).toFixed(0)}% · Bear ${(p.bear * 100).toFixed(0)}%`
    );
    L.push(
      `**Directional lean:** ${inp.regime.lean === "no-lean" ? "**no lean** (net signal below catalyst threshold — band + trigger only)" : inp.regime.lean.toUpperCase()}`
    );
    L.push("");
  }

  // Bands
  if (inp.bands.length) {
    L.push(`## Expected-move bands (vol-scaled)`);
    L.push(`Derived from ${plan.bands.volSource} vol ${n(inp.technicals?.realizedVolAnnualPct, 1)}% annualized. ±1σ ≈ 68%, ±1.65σ ≈ 90%.`);
    L.push("");
    L.push(`| Horizon | ±1σ band | 90% bound |`);
    L.push(`|---|---|---|`);
    for (const b of inp.bands) {
      L.push(`| ${b.horizon} (${b.days}d) | ${n(b.sigma1[0])} – ${n(b.sigma1[1])} | ${n(b.sigma90[0])} – ${n(b.sigma90[1])} |`);
    }
    L.push("");
  }

  // Monte Carlo
  if (inp.montecarlo) {
    const mc = inp.montecarlo;
    const last = mc.fan[mc.fan.length - 1];
    L.push(`## Monte-Carlo price targets`);
    L.push(
      `${plan.monteCarlo.paths.toLocaleString()} seeded paths (\`${mc.seed}\`), ${mc.fan.length} trading days, ` +
        `${plan.monteCarlo.process} process.`
    );
    L.push("");
    L.push(`**End-of-span (Day ${mc.fan.length}) distribution:**`);
    L.push(`- Median: ${n(last.p50)}`);
    L.push(`- 50% band (p25–p75): ${n(last.p25)} – ${n(last.p75)}`);
    L.push(`- 90% band (p5–p95): ${n(last.p5)} – ${n(last.p95)}`);
    L.push("");
    L.push(`**Touch probabilities over the span:**`);
    for (const t of mc.touchProbs) {
      if (t.probUp != null) L.push(`- reach ${n(t.level)} (up): ${(t.probUp * 100).toFixed(0)}%`);
      else L.push(`- reach ${n(t.level)} (down): ${((t.probDown ?? 0) * 100).toFixed(0)}%`);
    }
    L.push("");
    L.push(`_Interactive fan chart + full interval ladder are rendered alongside this report._`);
    L.push("");
  }

  // Positioning
  L.push(`## Positioning (COT)`);
  if (inp.cot) {
    L.push(
      `Managed-money net: **${inp.cot.managedMoneyNet.toLocaleString()}** contracts · ` +
        `3y percentile: ${inp.cot.percentile3y != null ? (inp.cot.percentile3y * 100).toFixed(0) + "%" : "n/a"} · ` +
        `as of ${inp.cot.asOf} (RED FLAG: lagged ≤1 week) · ${inp.cot.source}`
    );
  } else {
    L.push(`RED FLAG — COT unavailable for this contract (no code or fetch failed).`);
  }
  L.push("");

  // Macro (precious metals / where declared)
  if (inp.macro && (inp.macro.realYield || inp.macro.dxy != null)) {
    L.push(`## Macro overlay`);
    if (inp.macro.realYield)
      L.push(`- 10y real yield (DGS10−T10YIE): ${n(inp.macro.realYield.value, 2)}% as of ${inp.macro.realYield.asOf}`);
    if (inp.macro.dxy != null) L.push(`- Dollar index (DX-Y.NYB): ${n(inp.macro.dxy, 2)}`);
    L.push("");
  }

  // Catalysts (declared)
  if (plan.catalystCalendar && plan.catalystCalendar.length) {
    L.push(`## Declared catalysts`);
    for (const cat of plan.catalystCalendar) {
      L.push(`- ${cat.label}${cat.date ? ` (${cat.date})` : ""} — vol ×${cat.volMultiplier}`);
    }
    L.push("");
  }

  // Qualitative protocols out of deterministic scope
  if (plan.qualitativeProtocols && plan.qualitativeProtocols.length) {
    L.push(`## Qualitative protocols (declared — NOT executed by the deterministic engine)`);
    for (const q of plan.qualitativeProtocols) L.push(`- ${q}`);
    L.push("");
  }

  // Red flags
  if (inp.redFlags.length) {
    L.push(`## RED FLAGS`);
    for (const f of inp.redFlags) L.push(`- **${f.where}:** ${f.message}`);
    L.push("");
  }

  // Accuracy ceilings
  if (plan.accuracyCeilings) {
    L.push(`## Accuracy ceilings`);
    for (const [k, v] of Object.entries(plan.accuracyCeilings)) L.push(`- **${k}:** ${v}`);
    L.push("");
  }

  // Sources
  L.push(`## Sources`);
  L.push(`- Price/technicals: ${inp.dataSource}`);
  if (inp.cot) L.push(`- Positioning: ${inp.cot.source}`);
  if (inp.macro?.realYield) L.push(`- Macro: FRED (DGS10, T10YIE)`);
  L.push("");

  // Disclaimer
  L.push(`---`);
  L.push(
    `_This is a mechanical, backward-looking quantitative model with no live news, weather, or narrative awareness. ` +
      `Outputs are scenario analysis, not investment advice, and carry no guarantee. Generated ${inp.generatedAt}._`
  );

  return L.join("\n");
}
