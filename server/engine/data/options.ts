import yahooLib from "yahoo-finance2";
import { cached } from "./cache.ts";

const yf = new (yahooLib as any)({ suppressNotices: ["yahooSurvey"] });

export interface OptionChain {
  underlying: string;
  spot: number;
  expiry: string; // ISO
  daysToExpiry: number;
  calls: OptionQuote[];
  puts: OptionQuote[];
  source: string;
}
export interface OptionQuote {
  strike: number;
  lastPrice: number;
  bid?: number;
  ask?: number;
  impliedVolatility?: number;
  openInterest?: number;
  volume?: number;
}

// Fetch the nearest-expiry option chain from Yahoo. Works for tickers like GLD, USO, SLV, GDX;
// some futures roots may return sparse results — caller must handle nulls.
export async function optionChain(underlying: string): Promise<OptionChain | null> {
  const key = `options:${underlying}`;
  const TTL = 60 * 60 * 1000;
  try {
    const { value } = await cached<OptionChain>(key, TTL, async () => {
      const q: any = await yf.options(underlying);
      const spot = Number(q?.quote?.regularMarketPrice ?? q?.quote?.postMarketPrice ?? NaN);
      const chain = q?.options?.[0];
      if (!chain || !Number.isFinite(spot)) throw new Error("options: no chain / spot");
      const expiry = new Date(chain.expirationDate ?? Date.now()).toISOString();
      const daysToExpiry = Math.max(
        0,
        Math.round((new Date(expiry).getTime() - Date.now()) / 864e5)
      );
      const map = (o: any): OptionQuote => ({
        strike: Number(o.strike),
        lastPrice: Number(o.lastPrice ?? 0),
        bid: o.bid != null ? Number(o.bid) : undefined,
        ask: o.ask != null ? Number(o.ask) : undefined,
        impliedVolatility: o.impliedVolatility != null ? Number(o.impliedVolatility) : undefined,
        openInterest: o.openInterest != null ? Number(o.openInterest) : undefined,
        volume: o.volume != null ? Number(o.volume) : undefined,
      });
      return {
        underlying,
        spot,
        expiry,
        daysToExpiry,
        calls: (chain.calls ?? []).map(map),
        puts: (chain.puts ?? []).map(map),
        source: `Yahoo options ${underlying}`,
      };
    });
    return value;
  } catch {
    return null;
  }
}

// Approximate the risk-neutral density from call prices via Breeden-Litzenberger:
// f(K) ~ ∂²C/∂K² * exp(rT). Use a finite-difference with the observed strike grid.
// Since we do not have a clean discount curve here, we ignore the discount factor
// (equivalent to r ~ 0 over short horizons); result is normalized to sum to 1.
export interface RndPoint { strike: number; density: number; cdf: number }

export function riskNeutralDensity(chain: OptionChain): RndPoint[] | null {
  const calls = chain.calls
    .filter((c) => Number.isFinite(c.strike) && Number.isFinite(c.lastPrice) && c.lastPrice > 0)
    .sort((a, b) => a.strike - b.strike);
  if (calls.length < 5) return null;
  const raw: { strike: number; density: number }[] = [];
  for (let i = 1; i < calls.length - 1; i++) {
    const kM1 = calls[i - 1].strike;
    const k0 = calls[i].strike;
    const kP1 = calls[i + 1].strike;
    const cM1 = calls[i - 1].lastPrice;
    const c0 = calls[i].lastPrice;
    const cP1 = calls[i + 1].lastPrice;
    // central second difference (unequal spacing)
    const h1 = k0 - kM1;
    const h2 = kP1 - k0;
    const d2 = (2 * (cM1 / (h1 * (h1 + h2)) - c0 / (h1 * h2) + cP1 / (h2 * (h1 + h2))));
    if (Number.isFinite(d2) && d2 > 0) raw.push({ strike: k0, density: d2 });
  }
  if (raw.length < 3) return null;
  const total = raw.reduce((s, p) => s + p.density, 0);
  if (total <= 0) return null;
  let cum = 0;
  return raw.map((p) => {
    const dens = p.density / total;
    cum += dens;
    return { strike: p.strike, density: Number(dens.toFixed(6)), cdf: Number(cum.toFixed(6)) };
  });
}

// Compute strike percentiles (returns strikes at the p5/p25/p50/p75/p95 CDF marks).
export function percentileFromRnd(rnd: RndPoint[], q: number): number | null {
  if (!rnd.length) return null;
  const target = q / 100;
  for (let i = 0; i < rnd.length; i++) {
    if (rnd[i].cdf >= target) {
      if (i === 0) return rnd[0].strike;
      const a = rnd[i - 1];
      const b = rnd[i];
      const f = (target - a.cdf) / (b.cdf - a.cdf || 1);
      return a.strike + f * (b.strike - a.strike);
    }
  }
  return rnd[rnd.length - 1].strike;
}
