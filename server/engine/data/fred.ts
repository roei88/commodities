import { cached } from "./cache.ts";

export interface FredSeries {
  id: string;
  latest: number;
  latestDate: string;
  prev: number | null;
  source: string;
}

// FRED observations for one series. Requires a free API key; without it we throw
// so the caller can RED-FLAG the macro overlay rather than fabricate.
export async function fredSeries(seriesId: string): Promise<FredSeries> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error("fred: no API key");
  const key = `fred:${seriesId}`;
  const TTL = 12 * 60 * 60 * 1000;
  const { value } = await cached<FredSeries>(key, TTL, async () => {
    const url =
      `https://api.stlouisfed.org/fred/series/observations` +
      `?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=10`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fred HTTP ${res.status}`);
    const json: any = await res.json();
    const obs: any[] = (json.observations ?? []).filter((o: any) => o.value !== ".");
    if (obs.length === 0) throw new Error(`fred: no observations for ${seriesId}`);
    return {
      id: seriesId,
      latest: parseFloat(obs[0].value),
      latestDate: obs[0].date,
      prev: obs[1] ? parseFloat(obs[1].value) : null,
      source: `FRED ${seriesId}`,
    };
  });
  return value;
}

// Real yield proxy = 10y nominal (DGS10) - 10y breakeven (T10YIE).
export async function fredRealYield(): Promise<{ value: number; asOf: string } | null> {
  try {
    const [nominal, breakeven] = await Promise.all([fredSeries("DGS10"), fredSeries("T10YIE")]);
    return { value: nominal.latest - breakeven.latest, asOf: nominal.latestDate };
  } catch {
    return null;
  }
}

export interface FredHistoryPoint { date: string; value: number }

// Fetch a full daily history for one FRED series (used for rolling correlation).
export async function fredHistory(seriesId: string, days = 400): Promise<FredHistoryPoint[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error("fred: no API key");
  const key = `fred-hist:${seriesId}:${days}`;
  const TTL = 12 * 60 * 60 * 1000;
  const { value } = await cached<FredHistoryPoint[]>(key, TTL, async () => {
    const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const url =
      `https://api.stlouisfed.org/fred/series/observations` +
      `?series_id=${seriesId}&api_key=${apiKey}&file_type=json&observation_start=${start}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`fred HTTP ${res.status}`);
    const json: any = await res.json();
    const obs: any[] = (json.observations ?? []).filter((o: any) => o.value !== ".");
    if (obs.length === 0) throw new Error(`fred: no observations for ${seriesId}`);
    return obs.map((o: any) => ({ date: o.date, value: parseFloat(o.value) }));
  });
  return value;
}

// Real-yield history = DGS10 - T10YIE aligned by date. Returns [] on failure.
export async function fredRealYieldHistory(days = 400): Promise<FredHistoryPoint[]> {
  try {
    const [nom, be] = await Promise.all([fredHistory("DGS10", days), fredHistory("T10YIE", days)]);
    const byDate = new Map(be.map((p) => [p.date, p.value]));
    const out: FredHistoryPoint[] = [];
    for (const p of nom) {
      const b = byDate.get(p.date);
      if (b != null) out.push({ date: p.date, value: p.value - b });
    }
    return out;
  } catch {
    return [];
  }
}
