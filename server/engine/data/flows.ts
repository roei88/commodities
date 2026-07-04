import { yahooOHLC } from "./yahoo.ts";

export interface ETFFlow {
  ticker: string;
  latestPrice: number;
  latestDate: string;
  changePct5d: number | null;
  changePct20d: number | null;
  source: string;
}

// Class-relevant ETFs whose price trend is a proxy for demand-side flow.
// Not tonnes-of-holdings (which needs paid feeds), but the daily discovered flow.
export const CLASS_ETF: Record<string, string> = {
  "precious-metals": "GLD",
  "industrial-metals": "DBB", // Invesco Base Metals
  energy: "USO",              // US Oil Fund
  grains: "DBA",              // Invesco Agriculture (broad)
  softs: "NIB",               // iPath Bloomberg Cocoa (softs proxy)
  livestock: "COW",
};

// Special-case a few commodities to a more specific ETF.
export const ID_ETF: Record<string, string> = {
  gold: "GLD",
  silver: "SLV",
  platinum: "PPLT",
  palladium: "PALL",
  copper: "CPER",
  "wti-oil": "USO",
  "brent-oil": "BNO",
  "natural-gas": "UNG",
  gasoline: "UGA",
  wheat: "WEAT",
  corn: "CORN",
  soybeans: "SOYB",
  sugar: "CANE",
};

function pctChange(from: number, to: number): number {
  return ((to - from) / from) * 100;
}

export async function etfFlow(commodityId: string, klass: string): Promise<ETFFlow | null> {
  const ticker = ID_ETF[commodityId] ?? CLASS_ETF[klass];
  if (!ticker) return null;
  try {
    const bars = await yahooOHLC(ticker, 40);
    if (bars.length < 20) return null;
    const last = bars[bars.length - 1];
    const b5 = bars[bars.length - 6];
    const b20 = bars[bars.length - 21];
    return {
      ticker,
      latestPrice: Number(last.close.toFixed(2)),
      latestDate: last.date,
      changePct5d: b5 ? Number(pctChange(b5.close, last.close).toFixed(2)) : null,
      changePct20d: b20 ? Number(pctChange(b20.close, last.close).toFixed(2)) : null,
      source: `Yahoo ${ticker}`,
    };
  } catch {
    return null;
  }
}
