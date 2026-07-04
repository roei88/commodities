import { useMemo } from "react";
import type { LadderRow } from "../../shared/types.ts";

// Group ladder rows by day (extracted from "Mon Jul 6 · session" labels) and
// render as a compact date-first ladder with real day headers.
export default function IntervalLadder({ rows, unit }: { rows: LadderRow[]; unit: string }) {
  const groups = useMemo(() => {
    const g: { day: string; rows: { session: string; target: number; lo: number; hi: number }[] }[] = [];
    for (const r of rows) {
      const [day, session] = r.label.split(" · ");
      const last = g[g.length - 1];
      if (last && last.day === day) last.rows.push({ session: session ?? "", target: r.target, lo: r.lo, hi: r.hi });
      else g.push({ day, rows: [{ session: session ?? "", target: r.target, lo: r.lo, hi: r.hi }] });
    }
    return g;
  }, [rows]);

  return (
    <div className="ladder-v2">
      <div className="ladder-v2-head">
        <span className="lh-day">Date</span>
        <span className="lh-session">Session</span>
        <span className="lh-num">Low</span>
        <span className="lh-num">Target</span>
        <span className="lh-num">High</span>
      </div>
      {groups.map((g, gi) => (
        <div key={gi} className="ladder-v2-group">
          <div className="ladder-v2-day">{g.day}</div>
          <div className="ladder-v2-rows">
            {g.rows.map((r, ri) => (
              <div key={ri} className="ladder-v2-row">
                <span className="lc-session">{r.session}</span>
                <span className="lc-num lo">{fmt(r.lo)}</span>
                <span className="lc-num tgt">{fmt(r.target)}</span>
                <span className="lc-num hi">{fmt(r.hi)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="ladder-v2-foot">{unit} · low / target / high are the p25 / p50 / p75 of the Monte-Carlo end-of-day distribution.</div>
    </div>
  );
}

function fmt(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
