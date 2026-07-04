import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

type Range = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "ALL";

interface Candle { t: number; o: number; h: number; l: number; c: number; v?: number }
interface ChartData {
  symbol: string;
  range: Range;
  interval: string;
  candles: Candle[];
  lastPrice: number | null;
  previousClose: number | null;
  changePct: number | null;
  source: string;
}

const RANGES: Range[] = ["1D", "5D", "1M", "3M", "6M", "1Y", "5Y", "ALL"];

// Interactive TradingView-style price chart: range switcher, current price
// readout, hover crosshair with date + price tooltip, area-under-line fill
// tinted by the commodity's theme accent.
export default function AssetChart({
  commodityId,
  unit,
  onDataLoaded,
  onError,
}: {
  commodityId: string;
  unit: string;
  onDataLoaded?: (d: ChartData) => void;
  onError?: (msg: string | null) => void;
}) {
  const [range, setRange] = useState<Range>("1M");
  const [data, setData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ t: number; c: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch data whenever commodity or range changes.
  useEffect(() => {
    if (!commodityId) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    // Reset stale state immediately so the previous commodity's chart doesn't
    // linger while the new one loads (or errors).
    setData(null);
    setHover(null);
    setError(null);
    // Destroy the previous uPlot instance so its canvas doesn't stay on screen
    // showing the old commodity's line during the fetch.
    plotRef.current?.destroy();
    plotRef.current = null;
    setLoading(true);
    fetch(`/api/chart/${commodityId}?range=${range}`, { signal: ac.signal })
      .then((r) => r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j.error ?? `HTTP ${r.status}`))))
      .then((d: ChartData) => {
        setData(d);
        onError?.(null);
        onDataLoaded?.(d);
      })
      .catch((e: any) => {
        if (e?.name !== "AbortError") {
          const msg = e?.message ?? "chart fetch failed";
          setError(msg);
          onError?.(msg);
        }
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [commodityId, range]);

  // Read the current accent hex from CSS variables so the chart line + fill
  // match the commodity's theme.
  const accent = useMemo(
    () => (typeof window !== "undefined"
      ? getComputedStyle(document.documentElement).getPropertyValue("--accent-hex").trim() || "#4c8dff"
      : "#4c8dff"),
    [commodityId]
  );

  // Build / rebuild the uPlot when data arrives or the container is resized.
  useEffect(() => {
    if (!data || !containerRef.current || data.candles.length === 0) return;
    const el = containerRef.current;
    const xs = data.candles.map((c) => c.t / 1000);
    const ys = data.candles.map((c) => c.c);
    const first = data.candles[0].c;
    const positive = (data.changePct ?? 0) >= 0;
    const lineColor = positive ? accent : "#ef6b6b";
    const fillTop = withAlpha(lineColor, 0.32);
    const fillBottom = withAlpha(lineColor, 0.02);

    const width = el.clientWidth || 480;
    const height = 220;

    plotRef.current?.destroy();
    plotRef.current = new uPlot(
      {
        width,
        height,
        cursor: {
          x: true,
          y: true,
          drag: { x: false, y: false },
          points: { size: 6, stroke: lineColor, fill: "#ffffff", width: 2 },
        },
        legend: { show: false },
        scales: { x: { time: true }, y: { auto: true } },
        axes: [
          {
            stroke: "#8a94a3",
            grid: { stroke: "rgba(140,145,160,0.10)" },
            ticks: { stroke: "rgba(140,145,160,0.20)", width: 1 },
            size: 22,
            font: '10px ui-monospace, SFMono-Regular, Menlo, monospace',
          },
          {
            stroke: "#8a94a3",
            grid: { stroke: "rgba(140,145,160,0.10)" },
            ticks: { stroke: "rgba(140,145,160,0.20)", width: 1 },
            size: 62,
            font: '10px ui-monospace, SFMono-Regular, Menlo, monospace',
            values: (_u, splits) => splits.map((v) => fmtY(v)),
          },
        ],
        series: [
          {},
          {
            label: "price",
            stroke: lineColor,
            width: 1.8,
            fill: (u) => makeGradient(u, fillTop, fillBottom),
            points: { show: false },
            value: (_u, v) => (v == null ? "" : fmtY(v)),
          },
        ],
        hooks: {
          setCursor: [
            (u) => {
              const idx = u.cursor.idx;
              if (idx == null || idx < 0) { setHover(null); return; }
              const t = u.data[0][idx] as number;
              const c = u.data[1][idx] as number;
              if (t != null && c != null) setHover({ t: t * 1000, c });
              else setHover(null);
            },
          ],
        },
      },
      [xs, ys] as uPlot.AlignedData,
      el
    );

    const onResize = () => plotRef.current?.setSize({ width: el.clientWidth, height });
    void first;
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [data, accent]);

  const lastPrice = data?.lastPrice ?? null;
  const changePct = data?.changePct ?? null;
  const positive = (changePct ?? 0) >= 0;
  const hoverStr = hover ? `${fmtDate(hover.t, range)} · ${fmtY(hover.c)}` : null;

  return (
    <div className="asset-chart">
      <div className="asset-chart-head">
        <div className="asset-chart-price">
          <span className="ap-value">{lastPrice != null ? fmtY(lastPrice) : "—"}</span>
          <span className="ap-unit">{unit}</span>
          {changePct != null && (
            <span className={`ap-change ${positive ? "up" : "down"}`}>
              {positive ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%
              <span className="ap-change-range">{range}</span>
            </span>
          )}
          {hoverStr && <span className="ap-hover">{hoverStr}</span>}
        </div>
        <div className="asset-chart-ranges" role="tablist" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={r === range}
              className={r === range ? "r-btn active" : "r-btn"}
              onClick={() => setRange(r)}
            >{r}</button>
          ))}
        </div>
      </div>
      <div className="asset-chart-body" ref={containerRef}>
        {loading && !data && <div className="asset-chart-msg">Loading…</div>}
        {error && !loading && <div className="asset-chart-msg error">Chart unavailable · {error}</div>}
      </div>
      {data && <div className="asset-chart-foot">{data.source}</div>}
    </div>
  );
}

// ---- helpers ----
function fmtY(v: number): string {
  const abs = Math.abs(v);
  const dp = abs >= 1000 ? 1 : abs >= 10 ? 2 : 4;
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtDate(ms: number, range: Range): string {
  const d = new Date(ms);
  if (range === "1D" || range === "5D") {
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (range === "5Y" || range === "ALL") {
    return d.toLocaleString("en-US", { month: "short", year: "numeric" });
  }
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const bigint = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${a})`;
}
function makeGradient(u: uPlot, top: string, bottom: string): CanvasGradient {
  const ctx = u.ctx;
  const g = ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}
