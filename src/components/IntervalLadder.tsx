import type { LadderRow } from "../../shared/types.ts";

// The 6-hour (plan-configurable) price-target ladder: median target + p25/p75 band.
export default function IntervalLadder({ rows, unit }: { rows: LadderRow[]; unit: string }) {
  return (
    <div className="ladder">
      <table>
        <thead>
          <tr>
            <td>Interval</td>
            <td className="num">Lo (p25)</td>
            <td className="num">Target</td>
            <td className="num">Hi (p75)</td>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.label}</td>
              <td className="num">{fmt(r.lo)}</td>
              <td className="num tgt">{fmt(r.target)}</td>
              <td className="num">{fmt(r.hi)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmt(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
