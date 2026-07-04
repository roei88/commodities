import { yahooOHLC } from "./yahoo.ts";

export interface ImpliedVolResult {
  index: string;      // e.g. "^GVZ"
  value: number;      // annualized %, e.g. 22.4
  asOf: string;
  source: string;
}

// CBOE vol indices for commodities, mapped per asset id/class.
// - ^GVZ: gold vol index
// - ^OVX: crude oil vol index
// - ^VXSLV: silver (SLV) vol index
// Others fall back to null; the engine then uses realized vol.
const IV_INDEX: Record<string, string> = {
  gold: "^GVZ",
  silver: "^VXSLV",
  "wti-oil": "^OVX",
};

// Fetches the latest close of the appropriate vol index. Keyless (Yahoo).
export async function impliedVolFor(commodityId: string): Promise<ImpliedVolResult | null> {
  const idx = IV_INDEX[commodityId];
  if (!idx) return null;
  try {
    const bars = await yahooOHLC(idx, 40);
    if (!bars.length) return null;
    const last = bars[bars.length - 1];
    return { index: idx, value: Number(last.close.toFixed(2)), asOf: last.date, source: `Yahoo ${idx}` };
  } catch {
    return null;
  }
}
