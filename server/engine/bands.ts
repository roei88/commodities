import type { Bands, PlanAsset, Technicals } from "../../shared/types.ts";

export interface BandsInput {
  realizedVolPct: number | null;
  impliedVolPct: number | null;
}

// Expected-move bands via the vol-scaled random-walk: move = spot * vol * sqrt(t/252).
// Vol source honors plan.bands.volSource ("implied" -> use IV, else realized).
// Returns per-horizon bands plus which vol source was used and its value.
export interface ComputedBands {
  bands: Bands[];
  volUsedPct: number | null;
  volSourceUsed: "implied" | "realized" | "unavailable";
  impliedVolPct: number | null;
  realizedVolPct: number | null;
}

export function computeBands(spot: number, tech: Technicals, plan: PlanAsset, iv?: BandsInput): ComputedBands {
  const realized = tech.realizedVolAnnualPct ?? iv?.realizedVolPct ?? null;
  const implied = iv?.impliedVolPct ?? null;
  const preferImplied = plan.bands.volSource === "implied";
  const volPct = preferImplied && implied != null ? implied : realized;
  const volSourceUsed: ComputedBands["volSourceUsed"] =
    volPct == null ? "unavailable" : preferImplied && implied != null ? "implied" : "realized";

  if (volPct == null || spot <= 0) {
    return { bands: [], volUsedPct: null, volSourceUsed, impliedVolPct: implied, realizedVolPct: realized };
  }
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
  return { bands: out, volUsedPct: volPct, volSourceUsed, impliedVolPct: implied, realizedVolPct: realized };
}

function round(n: number): number {
  const abs = Math.abs(n);
  const dp = abs >= 1000 ? 1 : abs >= 10 ? 2 : 4;
  return Number(n.toFixed(dp));
}
