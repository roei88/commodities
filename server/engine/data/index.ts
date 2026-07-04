import { yahooOHLC, type Bar } from "./yahoo.ts";
import { stooqOHLC } from "./stooq.ts";
import { twelvedataOHLC } from "./twelvedata.ts";
import { isBarStale } from "./cache.ts";
import type { CommodityMeta, Quote } from "../../../shared/types.ts";

export type { Bar } from "./yahoo.ts";
export { cotDisaggregated } from "./cot.ts";
export { fredSeries, fredRealYield } from "./fred.ts";

export interface OHLCResult {
  bars: Bar[];
  source: string;
  attempts: { source: string; ok: boolean; note: string }[];
}

// Fallback ladder: Yahoo (keyless) -> Stooq (keyless) -> Twelve Data (keyed).
// Each attempt is recorded so the pipeline can stream/log the source used.
export async function getOHLC(commodity: CommodityMeta, minDays: number): Promise<OHLCResult> {
  const attempts: OHLCResult["attempts"] = [];

  // 1. Yahoo
  try {
    const bars = await yahooOHLC(commodity.symbol, minDays);
    attempts.push({ source: "yahoo", ok: true, note: `${bars.length} bars` });
    return { bars, source: `Yahoo Finance (${commodity.symbol})`, attempts };
  } catch (e: any) {
    attempts.push({ source: "yahoo", ok: false, note: e?.message ?? "error" });
  }

  // 2. Stooq
  if (commodity.stooq) {
    try {
      const bars = await stooqOHLC(commodity.stooq, minDays);
      attempts.push({ source: "stooq", ok: true, note: `${bars.length} bars` });
      return { bars, source: `Stooq (${commodity.stooq})`, attempts };
    } catch (e: any) {
      attempts.push({ source: "stooq", ok: false, note: e?.message ?? "error" });
    }
  }

  // 3. Twelve Data (keyed)
  if (commodity.twelvedata) {
    try {
      const bars = await twelvedataOHLC(commodity.twelvedata, minDays);
      attempts.push({ source: "twelvedata", ok: true, note: `${bars.length} bars` });
      return { bars, source: `Twelve Data (${commodity.twelvedata})`, attempts };
    } catch (e: any) {
      attempts.push({ source: "twelvedata", ok: false, note: e?.message ?? "error" });
    }
  }

  const err = new Error(
    `All OHLC sources failed for ${commodity.id}: ` + attempts.map((a) => `${a.source}(${a.note})`).join(", ")
  );
  (err as any).attempts = attempts;
  throw err;
}

// Build a spot Quote from the latest bar, with staleness / market-open flags.
export function quoteFromBars(bars: Bar[], source: string, seedChangePct?: number): Quote {
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const { stale, ageHours } = isBarStale(last.date);
  const changePct = prev ? ((last.close - prev.close) / prev.close) * 100 : seedChangePct;
  return {
    price: last.close,
    asOf: last.date,
    source,
    marketOpen: ageHours < 6, // a bar within the last 6h implies an active session
    stale,
    changePct,
  };
}
