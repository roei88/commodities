import YahooFinance from "yahoo-finance2";
import { cached } from "./cache.ts";

export interface Bar {
  date: string; // ISO
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// yahoo-finance2 v3 exports a class; instantiate once.
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const OHLC_TTL_MS = 6 * 60 * 60 * 1000; // 6h

// Fetch daily OHLC history via yahoo-finance2 chart(). Keyless but unofficial.
export async function yahooOHLC(symbol: string, minDays: number): Promise<Bar[]> {
  const lookbackDays = Math.max(minDays + 40, 120);
  const period1 = new Date(Date.now() - lookbackDays * 864e5);
  const key = `yahoo:${symbol}:${lookbackDays}`;
  const { value } = await cached<Bar[]>(key, OHLC_TTL_MS, async () => {
    const res: any = await yahooFinance.chart(symbol, {
      period1,
      interval: "1d",
    });
    const quotes = (res?.quotes ?? []) as any[];
    const bars: Bar[] = quotes
      .filter((q) => q && q.close != null && q.date)
      .map((q) => ({
        date: new Date(q.date).toISOString(),
        open: q.open ?? q.close,
        high: q.high ?? q.close,
        low: q.low ?? q.close,
        close: q.close,
        volume: q.volume ?? 0,
      }));
    if (bars.length === 0) throw new Error(`yahoo: no bars for ${symbol}`);
    return bars;
  });
  return value;
}
