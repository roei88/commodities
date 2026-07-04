import type { Bands, PlanAsset, Technicals } from "../../shared/types.ts";

// Expected-move bands via the vol-scaled random-walk: move = spot * vol * sqrt(t/252).
// Reported at each sigma level in the plan (1.0 = ~68%, 1.65 = ~90%).
export function computeBands(spot: number, tech: Technicals, plan: PlanAsset): Bands[] {
  const volPct = tech.realizedVolAnnualPct; // annualized %
  if (volPct == null || spot <= 0) return [];
  const vol = volPct / 100;
  const out: Bands[] = [];
  for (const [horizon, days] of Object.entries(plan.bands.horizons)) {
    const sigmaMove = spot * vol * Math.sqrt(days / 252);
    const s1 = plan.bands.sigmaLevels[0] ?? 1.0;
    const s90 = plan.bands.sigmaLevels[1] ?? 1.65;
    out.push({
      horizon,
      days,
      sigma1: [round(spot - s1 * sigmaMove), round(spot + s1 * sigmaMove)],
      sigma90: [round(spot - s90 * sigmaMove), round(spot + s90 * sigmaMove)],
    });
  }
  return out;
}

function round(n: number): number {
  const abs = Math.abs(n);
  const dp = abs >= 1000 ? 1 : abs >= 10 ? 2 : 4;
  return Number(n.toFixed(dp));
}
