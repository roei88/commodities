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
