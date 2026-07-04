import type { CommodityMeta } from "../../../shared/types.ts";

export interface Catalyst {
  label: string;
  date: string;   // ISO date
  applies: string[]; // commodity ids / classes
  volMultiplier: number;
  source: string;
}

// A deterministic, class-based catalyst calendar. Kept intentionally small,
// dated, and structured. No free-text scraping.
// Dates are computed by rule ("Fridays at 3:30 pm ET" for COT, monthly WASDE
// second Tuesday, etc). For sources with non-deterministic schedules we ship
// a small static list that the operator can maintain in this file.

function nthDayOfMonth(year: number, monthIdx0: number, weekday: number, nth: number): Date {
  const d = new Date(Date.UTC(year, monthIdx0, 1));
  const first = d.getUTCDay();
  const offset = (7 + weekday - first) % 7;
  d.setUTCDate(1 + offset + (nth - 1) * 7);
  return d;
}

// Every scheduled catalyst inside [from, to] that could touch any of our
// commodities. Returns a flat list already filtered by relevance.
export function catalystsFor(commodity: CommodityMeta, from: Date, to: Date): Catalyst[] {
  const out: Catalyst[] = [];
  const c = commodity;
  const cur = new Date(from);
  cur.setUTCHours(0, 0, 0, 0);

  while (cur <= to) {
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth();
    const d = cur.getUTCDate();
    const dow = cur.getUTCDay();
    const iso = cur.toISOString().slice(0, 10);

    // CFTC COT — every Friday (report is released ~3:30pm ET Fridays).
    if (dow === 5) {
      out.push({ label: "CFTC COT release", date: iso, applies: ["*"], volMultiplier: 1.15, source: "CFTC weekly release schedule" });
    }

    // EIA Weekly Petroleum Status — every Wednesday. Affects crude/RBOB/HO.
    if (dow === 3 && ["wti-oil", "brent-oil", "gasoline", "heating-oil"].includes(c.id)) {
      out.push({ label: "EIA Weekly Petroleum Status", date: iso, applies: [c.id], volMultiplier: 1.3, source: "EIA weekly release schedule" });
    }

    // EIA Natural Gas Storage — every Thursday.
    if (dow === 4 && c.id === "natural-gas") {
      out.push({ label: "EIA Natural Gas Storage", date: iso, applies: [c.id], volMultiplier: 1.4, source: "EIA weekly release schedule" });
    }

    // USDA WASDE — 2nd Tuesday of each month (approx; actual can shift 8-12th).
    if (c.class === "grains" || c.class === "softs" || c.class === "livestock") {
      const wasde = nthDayOfMonth(y, m, 2 /*Tue*/, 2).toISOString().slice(0, 10);
      if (wasde === iso) {
        out.push({ label: "USDA WASDE report", date: iso, applies: [c.class], volMultiplier: 1.5, source: "USDA WASDE monthly schedule" });
      }
    }

    // USDA Crop Progress — every Monday during growing season (Apr-Nov, U.S.).
    if (dow === 1 && (c.class === "grains") && m >= 3 && m <= 10) {
      out.push({ label: "USDA Crop Progress", date: iso, applies: [c.class], volMultiplier: 1.15, source: "USDA weekly release schedule" });
    }

    // FOMC — hard-coded 2026 meeting dates (macro overlay for gold/silver/DXY-sensitive).
    const fomc2026 = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-16"];
    if (fomc2026.includes(iso) && (c.class === "precious-metals" || c.class === "industrial-metals" || c.class === "energy")) {
      out.push({ label: "FOMC rate decision", date: iso, applies: [c.class], volMultiplier: 1.8, source: "Federal Reserve 2026 meeting calendar" });
    }

    // US CPI release — hard-coded 2026 dates.
    const cpi2026 = ["2026-01-14", "2026-02-11", "2026-03-11", "2026-04-14", "2026-05-13", "2026-06-11", "2026-07-14", "2026-08-12", "2026-09-10", "2026-10-15", "2026-11-13", "2026-12-10"];
    if (cpi2026.includes(iso) && (c.class === "precious-metals" || c.class === "energy")) {
      out.push({ label: "US CPI release", date: iso, applies: [c.class], volMultiplier: 1.5, source: "BLS 2026 release schedule" });
    }

    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return out;
}
