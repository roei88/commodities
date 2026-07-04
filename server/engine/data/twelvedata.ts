import { cached } from "./cache.ts";
import type { Bar } from "./yahoo.ts";

const OHLC_TTL_MS = 6 * 60 * 60 * 1000;

// Keyed free-tier fallback (800 req/day, 8/min). Only used when a key is present
// and the keyless sources failed.
export async function twelvedataOHLC(symbol: string, minDays: number): Promise<Bar[]> {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) throw new Error("twelvedata: no API key");
  if (!symbol) throw new Error("twelvedata: no symbol");
  const outputsize = Math.min(Math.max(minDays + 40, 120), 5000);
  const key = `twelvedata:${symbol}:${outputsize}`;
  const { value } = await cached<Bar[]>(key, OHLC_TTL_MS, async () => {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
      symbol
    )}&interval=1day&outputsize=${outputsize}&apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`twelvedata HTTP ${res.status}`);
    const json: any = await res.json();
    if (json.status === "error" || !Array.isArray(json.values))
      throw new Error(`twelvedata: ${json.message ?? "no values"}`);
    const bars: Bar[] = json.values
      .map((v: any) => {
        const close = parseFloat(v.close);
        return {
          date: new Date(v.datetime + "T00:00:00Z").toISOString(),
          open: parseFloat(v.open) || close,
          high: parseFloat(v.high) || close,
          low: parseFloat(v.low) || close,
          close,
          volume: parseFloat(v.volume) || 0,
        };
      })
      .filter((b: Bar) => !Number.isNaN(b.close))
      .reverse(); // Twelve Data returns newest-first
    if (bars.length === 0) throw new Error("twelvedata: no bars");
    return bars;
  });
  return value;
}
