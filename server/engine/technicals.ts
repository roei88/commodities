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

function rsi(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
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
