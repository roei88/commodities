import { cached } from "./cache.ts";

export interface CotResult {
  asOf: string; // report date (Tuesday)
  managedMoneyNet: number;
  managedMoneyLong: number;
  managedMoneyShort: number;
  percentile3y: number | null;
  source: string;
}

// CFTC Disaggregated Futures-only report via Socrata (keyless). We pull ~3y of
// weekly rows for one contract code, take the latest net managed-money position,
// and percentile-rank it over the window.
export async function cotDisaggregated(contractCode: string): Promise<CotResult> {
  if (!contractCode) throw new Error("cot: no contract code");
  const key = `cot:${contractCode}`;
  const TTL = 12 * 60 * 60 * 1000; // 12h; COT only updates weekly (Fri)
  const { value } = await cached<CotResult>(key, TTL, async () => {
    const base = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json";
    const q =
      `?$where=cftc_contract_market_code='${contractCode}'` +
      `&$order=report_date_as_yyyy_mm_dd DESC&$limit=160`;
    const res = await fetch(base + q, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`cot HTTP ${res.status}`);
    const rows: any[] = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("cot: no rows");

    const nets = rows.map((r) => {
      const long = Number(r.m_money_positions_long_all ?? r.mmoney_positions_long_all ?? 0);
      const short = Number(r.m_money_positions_short_all ?? r.mmoney_positions_short_all ?? 0);
      return { date: r.report_date_as_yyyy_mm_dd, long, short, net: long - short };
    });
    const latest = nets[0];
    const netSeries = nets.map((n) => n.net).filter((n) => Number.isFinite(n));
    let percentile: number | null = null;
    if (netSeries.length > 5) {
      const below = netSeries.filter((n) => n <= latest.net).length;
      percentile = below / netSeries.length;
    }
    return {
      asOf: latest.date,
      managedMoneyNet: latest.net,
      managedMoneyLong: latest.long,
      managedMoneyShort: latest.short,
      percentile3y: percentile,
      source: "CFTC Disaggregated COT (publicreporting.cftc.gov)",
    };
  });
  return value;
}
