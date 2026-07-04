import type { Bar } from "./data/index.ts";
import type { Technicals, PlanAsset } from "../../shared/types.ts";

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

// Wilder-smoothed RSI (RMA), the industry-standard variant.
function rsi(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  // Seed avg with simple mean over first `period` diffs.
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  // Wilder smoothing for the remaining diffs: RMA_t = (prev*(p-1) + cur) / p
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(closes: number[]): { value: number; signal: number; hist: number } | null {
  if (closes.length < 35) return null;
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine, 9);
  const value = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { value, signal, hist: value - signal };
}

function atr(bars: Bar[], period: number): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return trs.reduce((a, b) => a + b, 0) / period;
}

// Annualized realized volatility (%) from daily log returns over `window`.
export function realizedVol(closes: number[], window: number): number | null {
  if (closes.length < window + 1) return null;
  const rets: number[] = [];
  for (let i = closes.length - window; i < closes.length; i++) {
    rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varr) * Math.sqrt(252) * 100;
}

// Pearson correlation between two aligned series of daily log returns.
// Returns null if aligned length < 20.
export function correlationOfReturns(seriesA: number[], seriesB: number[]): number | null {
  const n = Math.min(seriesA.length, seriesB.length);
  if (n < 21) return null;
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 1; i < n; i++) {
    a.push(Math.log(seriesA[i] / seriesA[i - 1]));
    b.push(Math.log(seriesB[i] / seriesB[i - 1]));
  }
  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  if (den === 0) return null;
  return num / den;
}

// Align two dated series by date, keeping only common dates. Returns close arrays.
export function alignByDate(
  a: { date: string; value: number }[],
  b: { date: string; value: number }[]
): { aVals: number[]; bVals: number[] } {
  const bByDate = new Map(b.map((x) => [x.date.slice(0, 10), x.value]));
  const aVals: number[] = [];
  const bVals: number[] = [];
  for (const p of a) {
    const k = p.date.slice(0, 10);
    if (bByDate.has(k)) {
      aVals.push(p.value);
      bVals.push(bByDate.get(k)!);
    }
  }
  return { aVals, bVals };
}

// Percentile rank of the latest ATR% within its own history (regime signal).
export function atrPctRank(bars: Bar[], period: number): number | null {
  if (bars.length < period + 60) return null;
  const series: number[] = [];
  for (let end = period + 1; end <= bars.length; end++) {
    const a = atr(bars.slice(0, end), period);
    if (a != null) series.push((a / bars[end - 1].close) * 100);
  }
  if (series.length < 30) return null;
  const latest = series[series.length - 1];
  const below = series.filter((v) => v <= latest).length;
  return below / series.length;
}

export function computeTechnicals(bars: Bar[], plan: PlanAsset): Technicals {
  const closes = bars.map((b) => b.close);
  const maOut: Technicals["ma"] = {};
  for (const p of plan.technicals.maPeriods) {
    const val = sma(closes, p);
    const prevVal = sma(closes.slice(0, -5), p);
    maOut[`ma${p}`] =
      val == null
        ? null
        : { value: val, slope: prevVal == null ? 0 : val - prevVal, priceAbove: closes[closes.length - 1] > val };
  }
  return {
    rsi14: rsi(closes, plan.technicals.rsiPeriod),
    macd: macd(closes),
    ma: maOut,
    atr14: atr(bars, plan.technicals.atrPeriod),
    realizedVolAnnualPct: realizedVol(closes, plan.technicals.realizedVolWindow),
  };
}
