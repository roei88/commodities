import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { FanPoint } from "../../shared/types.ts";

// Read the CSS variable at draw time so the fan chart matches the commodity theme.
function currentAccentHex(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--accent-hex").trim();
  return v || "#4c8dff";
}

// Renders the Monte-Carlo percentile fan as filled bands (p5-p95, p25-p75) plus
// the median line. uPlot is canvas-based so thousands of points stay smooth.
export default function FanChart({ fan, spot, unit }: { fan: FanPoint[]; spot: number; unit: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!ref.current || fan.length === 0) return;

    const xs = [0, ...fan.map((_, i) => i + 1)];
    const p5 = [spot, ...fan.map((f) => f.p5)];
    const p25 = [spot, ...fan.map((f) => f.p25)];
    const p50 = [spot, ...fan.map((f) => f.p50)];
    const p75 = [spot, ...fan.map((f) => f.p75)];
    const p95 = [spot, ...fan.map((f) => f.p95)];

    const data: uPlot.AlignedData = [xs, p95, p5, p75, p25, p50];

    const width = ref.current.clientWidth || 600;
    const opts: uPlot.Options = {
      width,
      height: 320,
      cursor: { drag: { x: false, y: false } },
      legend: { show: true },
      scales: { x: { time: false } },
      // Series-level fill on edge series would extend the paint down to y=0; keep
      // strokes only on the edge series and let the `bands` array own all fill.
      series: [
        {},
        { label: "p95", stroke: "transparent", value: (_u: uPlot, v: number | null) => fmt(v, unit) },
        { label: "p5", stroke: "transparent", value: (_u: uPlot, v: number | null) => fmt(v, unit) },
        { label: "p75", stroke: "transparent", value: (_u: uPlot, v: number | null) => fmt(v, unit) },
        { label: "p25", stroke: "transparent", value: (_u: uPlot, v: number | null) => fmt(v, unit) },
        { label: "median", stroke: currentAccentHex(), width: 2, value: (_u: uPlot, v: number | null) => fmt(v, unit) },
      ],
      bands: [
        { series: [1, 2], fill: "rgba(76,141,255,0.10)" },
        { series: [3, 4], fill: "rgba(76,141,255,0.22)" },
      ],
      axes: [
        {
          stroke: "#9aa4b2",
          grid: { stroke: "#232a33" },
          values: (_u, splits) => splits.map((s) => (Number.isInteger(s) ? (s === 0 ? "now" : `D${s}`) : "")),
        },
        { stroke: "#9aa4b2", grid: { stroke: "#232a33" } },
      ],
    };

    plotRef.current?.destroy();
    plotRef.current = new uPlot(opts, data, ref.current);

    const onResize = () => plotRef.current?.setSize({ width: ref.current!.clientWidth, height: 320 });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [fan, spot, unit]);

  return <div className="uplot-wrap" ref={ref} />;
}

function fmt(v: number | null, _unit: string): string {
  if (v == null) return "";
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
