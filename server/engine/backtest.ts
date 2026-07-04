import type { Bar } from "./data/yahoo.ts";
import type { PlanAsset, BacktestResult } from "../../shared/types.ts";
import { realizedVol } from "./technicals.ts";

// Rolling-anchor backtest: for each historical anchor date, use the vol as of
// that date to build a per-horizon ±1σ and ±1.65σ band around the anchor close,
// then see whether the realized close H trading-days later fell inside.
// This is a fair proxy for "how honest is the reported band?".
export function backtestBands(bars: Bar[], plan: PlanAsset, anchorsPerHorizon = 60): BacktestResult[] {
  const closes = bars.map((b) => b.close);
  const w = plan.technicals.realizedVolWindow;
  const s1 = plan.bands.sigmaLevels[0] ?? 1.0;
  const s90 = plan.bands.sigmaLevels[1] ?? 1.65;
  const out: BacktestResult[] = [];
  for (const [horizon, days] of Object.entries(plan.bands.horizons)) {
    let n = 0, inside1 = 0, inside90 = 0;
    const errors: number[] = [];
    // Sample the last `anchorsPerHorizon` valid anchor points where a horizon
    // outcome is still within the bar range.
    const maxAnchor = bars.length - 1 - days;
    const minAnchor = Math.max(w + 5, maxAnchor - anchorsPerHorizon);
    for (let i = maxAnchor; i >= minAnchor && i >= 0; i--) {
      const window = closes.slice(0, i + 1);
      const vol = realizedVol(window, w);
      if (vol == null) continue;
      const anchor = closes[i];
      const realized = closes[i + days];
      if (anchor == null || realized == null) continue;
      const move = anchor * (vol / 100) * Math.sqrt(days / 252);
      n++;
      if (Math.abs(realized - anchor) <= s1 * move) inside1++;
      if (Math.abs(realized - anchor) <= s90 * move) inside90++;
      errors.push(Math.abs(realized - anchor));
    }
    errors.sort((a, b) => a - b);
    const median = errors.length ? errors[Math.floor(errors.length / 2)] : 0;
    out.push({
      horizon,
      n,
      hitRate1Sigma: n ? Number((inside1 / n).toFixed(3)) : 0,
      hitRate90: n ? Number((inside90 / n).toFixed(3)) : 0,
      brier: null,
      medianError: Number(median.toFixed(4)),
    });
  }
  return out;
}
