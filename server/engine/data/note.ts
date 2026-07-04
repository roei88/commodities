import YahooFinance from "yahoo-finance2";
import { yahooOHLC } from "./yahoo.ts";
import { cached } from "./cache.ts";
import type { CommodityMeta } from "../../../shared/types.ts";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface NewsItem { title: string; publisher: string; date: string | null; link: string }

export interface MarketNote {
  symbol: string;
  asOf: string;
  price: number;
  unit: string;
  changePct1d: number | null;
  changePct1w: number | null;
  changePct1m: number | null;
  note: string;        // composed, data-driven paragraph (no fabricated news)
  news: NewsItem[];    // real, attributable headlines
  source: string;
}

function mean(a: number[]): number { return a.reduce((s, x) => s + x, 0) / a.length; }
function pct(from: number, to: number): number { return ((to - from) / from) * 100; }
function fmt(v: number): string {
  const abs = Math.abs(v);
  const dp = abs >= 1000 ? 0 : abs >= 10 ? 2 : 4;
  return v.toLocaleString("en-US", { minimumFractionDigits: dp === 0 ? 0 : 2, maximumFractionDigits: dp });
}
function signedPct(v: number | null): string {
  if (v == null) return "n/a";
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}
function rsi14(closes: number[]): number | null {
  const p = 14;
  if (closes.length < p + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = closes[i] - closes[i - 1]; d >= 0 ? (g += d) : (l -= d); }
  let ag = g / p, al = l / p;
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}
function realizedVolPct(closes: number[], w = 20): number | null {
  if (closes.length < w + 1) return null;
  const r: number[] = [];
  for (let i = closes.length - w; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  const m = mean(r);
  const v = r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v) * Math.sqrt(252) * 100;
}

// Normalise Yahoo's publish timestamp (seconds or ms depending on feed).
function normTs(t: number | undefined): string | null {
  if (!t) return null;
  const ms = t > 1e12 ? t : t * 1000;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function fetchNews(symbol: string): Promise<NewsItem[]> {
  try {
    const r: any = await yf.search(symbol, { newsCount: 4, quotesCount: 1 });
    return (r.news ?? []).slice(0, 3).map((n: any) => ({
      title: String(n.title ?? "").trim(),
      publisher: String(n.publisher ?? "").trim(),
      date: normTs(n.providerPublishTime),
      link: String(n.link ?? ""),
    })).filter((n: NewsItem) => n.title && n.link);
  } catch {
    return [];
  }
}

// Compose a fluent, data-driven market note from real price statistics. This
// is NOT news narrative (that requires editorial judgement / an LLM) — it is an
// honest description of where the contract is trading and what the mechanical
// indicators say, phrased in prose. Works for every commodity.
export async function getMarketNote(commodity: CommodityMeta): Promise<MarketNote> {
  const key = `note:${commodity.symbol}`;
  const TTL = 3 * 60 * 60 * 1000;
  const { value } = await cached<MarketNote>(key, TTL, async () => {
    const bars = await yahooOHLC(commodity.symbol, 400);
    if (bars.length < 30) throw new Error("insufficient history for note");
    const closes = bars.map((b) => b.close);
    const last = closes[closes.length - 1];
    const asOf = bars[bars.length - 1].date;
    const d1 = closes.length > 1 ? pct(closes[closes.length - 2], last) : null;
    const w1 = closes.length > 6 ? pct(closes[closes.length - 6], last) : null;
    const m1 = closes.length > 22 ? pct(closes[closes.length - 22], last) : null;

    const yr = closes.slice(-252);
    const hi52 = Math.max(...yr), lo52 = Math.min(...yr);
    const fromHi = pct(hi52, last); // negative = below high
    const ma50 = closes.length >= 50 ? mean(closes.slice(-50)) : null;
    const ma200 = closes.length >= 200 ? mean(closes.slice(-200)) : null;
    const rsi = rsi14(closes);
    const vol = realizedVolPct(closes);

    // trend posture
    const above50 = ma50 != null && last > ma50;
    const above200 = ma200 != null && last > ma200;
    const trend =
      above50 && above200 ? "a constructive technical posture" :
      !above50 && !above200 ? "a weak technical posture" :
      "a mixed technical posture";
    const maSentence =
      ma50 != null && ma200 != null
        ? `Price is ${above50 ? "above" : "below"} its 50-day and ${above200 ? "above" : "below"} its 200-day moving average — ${trend}`
        : "";
    const momo =
      rsi == null ? "" :
      rsi > 70 ? `momentum is overbought (RSI ${rsi.toFixed(0)})` :
      rsi > 55 ? `momentum is firm (RSI ${rsi.toFixed(0)})` :
      rsi > 45 ? `momentum is neutral (RSI ${rsi.toFixed(0)})` :
      rsi > 30 ? `momentum is soft (RSI ${rsi.toFixed(0)})` :
      `momentum is oversold (RSI ${rsi.toFixed(0)})`;
    const volSentence =
      vol == null ? "" :
      `Realized volatility is ${vol > 35 ? "elevated" : vol > 18 ? "moderate" : "subdued"} at ${vol.toFixed(0)}% annualized.`;

    const dirWord = (v: number | null) => (v == null ? "flat" : v >= 0 ? "up" : "down");
    const s1 = `${commodity.label} (${commodity.venue} ${commodity.symbol}) last traded at ${fmt(last)} ${commodity.unit}, ` +
      `${dirWord(d1)} ${signedPct(d1 == null ? null : Math.abs(d1))} on the day` +
      (w1 != null ? ` and ${dirWord(w1)} ${signedPct(Math.abs(w1))} over the past week` : "") + ".";
    const s2 = `It sits ${Math.abs(fromHi).toFixed(1)}% ${fromHi < 0 ? "below" : "above"} its 52-week high of ${fmt(hi52)} ` +
      `(range ${fmt(lo52)}–${fmt(hi52)}).`;
    const s3 = [maSentence, momo].filter(Boolean).join(", while ") + (maSentence || momo ? "." : "");
    const note = [s1, s2, s3, volSentence].filter(Boolean).join(" ");

    const news = await fetchNews(commodity.symbol);

    return {
      symbol: commodity.symbol,
      asOf,
      price: last,
      unit: commodity.unit,
      changePct1d: d1,
      changePct1w: w1,
      changePct1m: m1,
      note,
      news,
      source: `Yahoo Finance (${commodity.symbol})`,
    };
  });
  return value;
}
