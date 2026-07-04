import YahooFinance from "yahoo-finance2";
import { cached } from "./cache.ts";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export type ChartRange = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "ALL";

export interface Candle {
  t: number;   // ms since epoch
  o: number; h: number; l: number; c: number;
  v?: number;
}

export interface ChartData {
  symbol: string;
  range: ChartRange;
  interval: string;
  candles: Candle[];
  lastPrice: number | null;
  previousClose: number | null;
  changePct: number | null;
  source: string;
}

// Standard mapping from a range button to (interval, days-back) for Yahoo.
// Yahoo intraday intervals are only available for the last few days.
function rangeToParams(range: ChartRange): { interval: "1m" | "5m" | "15m" | "1h" | "1d" | "1wk" | "1mo"; days: number } {
  switch (range) {
    case "1D":  return { interval: "5m",  days: 2   };
    case "5D":  return { interval: "15m", days: 6   };
    case "1M":  return { interval: "1d",  days: 40  };
    case "3M":  return { interval: "1d",  days: 100 };
    case "6M":  return { interval: "1d",  days: 200 };
    case "1Y":  return { interval: "1d",  days: 380 };
    case "5Y":  return { interval: "1wk", days: 1900 };
    case "ALL": return { interval: "1mo", days: 10950 };
  }
}

// Fetch OHLC via yahoo-finance2.chart() and normalise to compact Candle[].
export async function getChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const { interval, days } = rangeToParams(range);
  const key = `chart:${symbol}:${range}`;
  const TTL = intraday(interval) ? 5 * 60 * 1000 : 60 * 60 * 1000;
  const { value } = await cached<ChartData>(key, TTL, async () => {
    const period1 = new Date(Date.now() - days * 864e5);
    const res: any = await yf.chart(symbol, { period1, interval });
    const quotes: any[] = (res?.quotes ?? []).filter((q: any) => q && q.close != null);
    if (quotes.length === 0) throw new Error(`no data for ${symbol} ${range}`);
    const candles: Candle[] = quotes.map((q: any) => ({
      t: new Date(q.date).getTime(),
      o: num(q.open, q.close),
      h: num(q.high, q.close),
      l: num(q.low, q.close),
      c: num(q.close, 0),
      v: q.volume ?? undefined,
    }));
    const last = candles[candles.length - 1];
    // "Previous" reference for the % change depends on range:
    //  - 1D: previous close
    //  - anything else: first candle in the range (typical fintech convention)
    const ref = range === "1D" ? candles[Math.max(0, candles.length - 2)]?.c ?? null : candles[0].c;
    const changePct = ref != null && ref !== 0 ? ((last.c - ref) / ref) * 100 : null;
    return {
      symbol,
      range,
      interval,
      candles,
      lastPrice: last.c,
      previousClose: ref,
      changePct,
      source: `Yahoo Finance (${symbol}, ${interval})`,
    };
  });
  return value;
}

function num(a: number | null | undefined, fallback: number): number {
  return a == null || Number.isNaN(a) ? fallback : Number(a);
}
function intraday(iv: string): boolean {
  return iv.endsWith("m") || iv === "1h";
}
