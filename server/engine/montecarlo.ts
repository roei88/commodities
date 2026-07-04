import seedrandom from "seedrandom";
import type { PlanAsset, MonteCarloResult, FanPoint, LadderRow } from "../../shared/types.ts";

interface MCInput {
  spot: number;
  dailyVolPct: number; // base daily vol in %, e.g. 1.15
  horizonTradingDays: number;
  probabilities: { bull: number; base: number; bear: number };
  monthMoveFrac: number; // ~1 sigma monthly move as a fraction (for scenario anchors)
  seed: string;
  eventDayMultipliers: Record<number, number>; // dayIndex -> vol multiplier
  appliedCatalysts?: { label: string; date: string; dayIndex: number; volMultiplier: number }[];
}

function gaussian(rng: seedrandom.PRNG): number {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function pct(sorted: number[], q: number): number {
  const k = (sorted.length - 1) * (q / 100);
  const f = Math.floor(k);
  const c = Math.min(f + 1, sorted.length - 1);
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}

function roundP(n: number): number {
  const abs = Math.abs(n);
  const dp = abs >= 1000 ? 1 : abs >= 10 ? 2 : 4;
  return Number(n.toFixed(dp));
}

export function runMonteCarlo(plan: PlanAsset, input: MCInput): MonteCarloResult {
  const mc = plan.monteCarlo;
  const N = Math.min(Math.max(mc.paths, 1000), 60000);
  const H = Math.max(1, Math.min(input.horizonTradingDays, 40));
  const rng = seedrandom(input.seed);

  const halflife = mc.ouMeanReversionHalflifeDays ?? 10;
  const kappa = Math.log(2) / halflife;
  const baseSig = input.dailyVolPct / 100;
  const hazard = (mc.jumpDailyHazardPct ?? 0) / 100;
  const jMean = (mc.jumpMeanPct ?? 0) / 100;
  const jSd = (mc.jumpSdPct ?? 0) / 100;

  // Scenario anchors from regime probabilities.
  const scenarios = [
    { w: input.probabilities.bull, anchor: input.spot * (1 + input.monthMoveFrac) },
    { w: input.probabilities.base, anchor: input.spot },
    { w: input.probabilities.bear, anchor: input.spot * (1 - input.monthMoveFrac) },
  ];

  // paths[t] holds the value of every path at trading day t (0-indexed day t=day t+1)
  const dayValues: number[][] = Array.from({ length: H }, () => new Array(N));
  const maxTouch = new Array(N).fill(input.spot);
  const minTouch = new Array(N).fill(input.spot);

  for (let i = 0; i < N; i++) {
    // pick scenario anchor
    const u = rng();
    let acc = 0;
    let anchor = input.spot;
    for (const s of scenarios) {
      acc += s.w;
      if (u < acc) {
        anchor = s.anchor;
        break;
      }
    }
    const la = Math.log(anchor);
    let S = input.spot;
    for (let t = 0; t < H; t++) {
      const mult = input.eventDayMultipliers[t] ?? 1;
      const sig = baseSig * mult;
      let r = kappa * (la - Math.log(S)) + sig * gaussian(rng);
      // On event days, elevate jump hazard too (regime awareness).
      const dayHazard = hazard * (mult > 1 ? mult : 1);
      if (dayHazard > 0 && rng() < dayHazard) r += jMean + jSd * gaussian(rng);
      S = S * Math.exp(r);
      dayValues[t][i] = S;
      if (S > maxTouch[i]) maxTouch[i] = S;
      if (S < minTouch[i]) minTouch[i] = S;
    }
  }

  const fan: FanPoint[] = dayValues.map((day, t) => {
    const sorted = [...day].sort((a, b) => a - b);
    return {
      label: `Day ${t + 1}`,
      p5: roundP(pct(sorted, 5)),
      p25: roundP(pct(sorted, 25)),
      p50: roundP(pct(sorted, 50)),
      p75: roundP(pct(sorted, 75)),
      p95: roundP(pct(sorted, 95)),
    };
  });

  // Interval ladder: interpolate median + p25/p75 across intraday steps.
  const stepsPerDay = Math.max(1, Math.round(24 / mc.ladderIntervalHours));
  const ladder: LadderRow[] = [];
  const anchor0 = { p25: input.spot, p50: input.spot, p75: input.spot };
  for (let t = 0; t < H; t++) {
    const from = t === 0 ? anchor0 : { p25: fan[t - 1].p25, p50: fan[t - 1].p50, p75: fan[t - 1].p75 };
    const to = { p25: fan[t].p25, p50: fan[t].p50, p75: fan[t].p75 };
    for (let s = 1; s <= stepsPerDay; s++) {
      const f = s / stepsPerDay;
      const hour = ((s * mc.ladderIntervalHours) % 24).toString().padStart(2, "0");
      ladder.push({
        label: `Day ${t + 1} · ${hour}:00`,
        target: roundP(from.p50 + (to.p50 - from.p50) * f),
        lo: roundP(from.p25 + (to.p25 - from.p25) * f),
        hi: roundP(from.p75 + (to.p75 - from.p75) * f),
      });
    }
  }

  // Touch probabilities at ±1σ / ±1.65σ month levels.
  const levels = [
    input.spot * (1 + input.monthMoveFrac),
    input.spot * (1 + input.monthMoveFrac * 1.65),
    input.spot * (1 - input.monthMoveFrac),
    input.spot * (1 - input.monthMoveFrac * 1.65),
  ];
  const touchProbs = levels.map((level) => {
    if (level >= input.spot) {
      const hits = maxTouch.filter((m) => m >= level).length;
      return { level: roundP(level), probUp: Number((hits / N).toFixed(3)) };
    }
    const hits = minTouch.filter((m) => m <= level).length;
    return { level: roundP(level), probDown: Number((hits / N).toFixed(3)) };
  });

  return {
    spot: input.spot,
    seed: input.seed,
    fan,
    ladder,
    touchProbs,
    appliedCatalysts: input.appliedCatalysts ?? [],
  };
}
