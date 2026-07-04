import yahooLib from "yahoo-finance2";
import { cached } from "./cache.ts";

const yf = new (yahooLib as any)({ suppressNotices: ["yahooSurvey"] });

export interface TermStructure {
  contracts: { symbol: string; monthCode: string; price: number; expiry: string | null }[];
  shape: "backwardation" | "contango" | "flat" | "insufficient";
  rollYieldAnnualizedPct: number | null; // (front - next) / front * 12
  spread: number | null; // front - next
  note: string;
}

// Yahoo month codes for futures (in delivery calendar order).
const MONTHS = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"];

// Compose a Yahoo futures chain by building forward month codes from today.
// Root example: "GC" for gold -> tries GCQ26.CMX, GCV26.CMX, etc.
// We keep it simple: try suffixes like "=F" (continuous) already covered elsewhere;
// here we probe deliveries via the "MYYY" convention (e.g. "GCQ26" or "GCQ2026").
function yearCodes(y: number): string[] {
  const yy = String(y).slice(-2);
  return [yy, String(y)];
}

function nextMonths(from: Date, n: number): { code: string; year: number; monthIdx: number }[] {
  const out: { code: string; year: number; monthIdx: number }[] = [];
  const cur = new Date(from);
  cur.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    cur.setUTCMonth(cur.getUTCMonth() + 1);
    out.push({ code: MONTHS[cur.getUTCMonth()], year: cur.getUTCFullYear(), monthIdx: cur.getUTCMonth() });
  }
  return out;
}

// Try to fetch a single dated future close via yahoo quote. Returns null on miss.
async function tryQuote(symbol: string): Promise<{ price: number; expiry: string | null } | null> {
  try {
    const q: any = await yf.quote(symbol);
    if (q && (q.regularMarketPrice ?? q.price) != null) {
      return {
        price: Number(q.regularMarketPrice ?? q.price),
        expiry: q.expireDate ? new Date(q.expireDate).toISOString().slice(0, 10) : null,
      };
    }
  } catch {}
  return null;
}

// Build the term structure for a futures root (e.g. "GC", "CL", "NG") over the
// next `depth` delivery months. Very tolerant: we skip months Yahoo can't quote
// and treat two valid neighbors as sufficient for shape.
export async function termStructure(root: string, depth = 4): Promise<TermStructure> {
  const cacheKey = `termstructure:${root}:${depth}`;
  const TTL = 3 * 60 * 60 * 1000;
  const { value } = await cached<TermStructure>(cacheKey, TTL, async () => {
    const months = nextMonths(new Date(), depth + 2);
    const contracts: TermStructure["contracts"] = [];
    for (const m of months) {
      if (contracts.length >= depth) break;
      let hit: { price: number; expiry: string | null } | null = null;
      for (const yr of yearCodes(m.year)) {
        const sym = `${root}${m.code}${yr}.CMX`;
        hit = await tryQuote(sym);
        if (!hit) hit = await tryQuote(`${root}${m.code}${yr}.NYM`);
        if (!hit) hit = await tryQuote(`${root}${m.code}${yr}`);
        if (hit) {
          contracts.push({ symbol: `${root}${m.code}${yr}`, monthCode: m.code, price: hit.price, expiry: hit.expiry });
          break;
        }
      }
    }
    if (contracts.length < 2) {
      return { contracts, shape: "insufficient", rollYieldAnnualizedPct: null, spread: null, note: "Fewer than 2 deliveries quoted." };
    }
    const front = contracts[0].price;
    const next = contracts[1].price;
    const spread = front - next;
    // Approx: monthly roll % * 12 for annualization; direction preserved.
    const monthlyRoll = (front - next) / front;
    const rollYieldAnnualizedPct = Number((monthlyRoll * 12 * 100).toFixed(2));
    let shape: TermStructure["shape"];
    if (Math.abs(spread) < front * 0.001) shape = "flat";
    else if (front > next) shape = "backwardation";
    else shape = "contango";
    return {
      contracts,
      shape,
      rollYieldAnnualizedPct,
      spread: Number(spread.toFixed(4)),
      note: `${shape} across ${contracts.length} deliveries; front-next spread ${spread.toFixed(2)}`,
    };
  });
  return value;
}

// Map a commodity id to the Yahoo futures root Yahoo uses for dated contracts.
export const FUTURES_ROOT: Record<string, string> = {
  gold: "GC",
  silver: "SI",
  platinum: "PL",
  palladium: "PA",
  copper: "HG",
  "wti-oil": "CL",
  "brent-oil": "BZ",
  "natural-gas": "NG",
  "heating-oil": "HO",
  gasoline: "RB",
  wheat: "ZW",
  corn: "ZC",
  soybeans: "ZS",
  sugar: "SB",
  cotton: "CT",
  "arabica-coffee": "KC",
  cocoa: "CC",
  "live-cattle": "LE",
  aluminum: "ALI",
};
