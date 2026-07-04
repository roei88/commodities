import { cached } from "./cache.ts";
import type { Bar } from "./yahoo.ts";

const OHLC_TTL_MS = 6 * 60 * 60 * 1000;

// Keyless CSV daily history from Stooq. Covers a subset of commodities (metals,
// energy core, some ags). Symbol codes look like "gc.f", "cl.f".
export async function stooqOHLC(code: string, minDays: number): Promise<Bar[]> {
  if (!code) throw new Error("stooq: no code");
  const key = `stooq:${code}`;
  const { value } = await cached<Bar[]>(key, OHLC_TTL_MS, async () => {
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(code)}&i=d`;
    const res = await fetch(url, { headers: { "User-Agent": "commodity-research/0.1" } });
    if (!res.ok) throw new Error(`stooq HTTP ${res.status}`);
    const text = await res.text();
    // Header: Date,Open,High,Low,Close,Volume
    const lines = text.trim().split("\n");
    if (lines.length < 2 || !/^Date/i.test(lines[0])) throw new Error("stooq: bad CSV");
    const bars: Bar[] = [];
    for (let i = 1; i < lines.length; i++) {
      const [d, o, h, l, c, v] = lines[i].split(",");
      const close = parseFloat(c);
      if (!d || Number.isNaN(close)) continue;
      bars.push({
        date: new Date(d + "T00:00:00Z").toISOString(),
        open: parseFloat(o) || close,
        high: parseFloat(h) || close,
        low: parseFloat(l) || close,
        close,
        volume: parseFloat(v) || 0,
      });
    }
    if (bars.length === 0) throw new Error("stooq: no bars");
    return bars.slice(-Math.max(minDays + 40, 120));
  });
  return value;
}
