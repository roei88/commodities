import { yahooOHLC } from "./yahoo.ts";
import type { Bar } from "./yahoo.ts";

export interface DxyRead {
  value: number;
  asOf: string;
  changePct1d: number | null;
  changePct20d: number | null;
  source: string;
}

// Tradeable dollar index — keyless via Yahoo (DX-Y.NYB).
export async function dollarIndex(): Promise<DxyRead | null> {
  try {
    const bars = await yahooOHLC("DX-Y.NYB", 40);
    if (bars.length < 2) return null;
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const b20 = bars[bars.length - 21] ?? bars[0];
    return {
      value: Number(last.close.toFixed(2)),
      asOf: last.date,
      changePct1d: Number((((last.close - prev.close) / prev.close) * 100).toFixed(2)),
      changePct20d: b20 ? Number((((last.close - b20.close) / b20.close) * 100).toFixed(2)) : null,
      source: "Yahoo DX-Y.NYB",
    };
  } catch {
    return null;
  }
}

// Also expose the raw DXY bars for correlation math.
export async function dxyBars(days = 200): Promise<Bar[]> {
  return yahooOHLC("DX-Y.NYB", days);
}
