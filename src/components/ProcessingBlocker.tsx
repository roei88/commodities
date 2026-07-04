// Full-panel processing blocker shown in the Report tab while a run is in
// flight. Two meshing cog-wheels counter-rotate; the latest pipeline step is
// surfaced underneath so the wait feels informative rather than opaque.

function Gear({ cx, cy, r, teeth, className }: { cx: number; cy: number; r: number; teeth: number; className: string }) {
  const toothH = r * 0.34;
  const toothW = r * 0.26;
  const items = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * 360;
    items.push(
      <rect
        key={i}
        x={cx - toothW / 2}
        y={cy - r - toothH * 0.55}
        width={toothW}
        height={toothH}
        rx={toothW * 0.25}
        transform={`rotate(${a} ${cx} ${cy})`}
      />
    );
  }
  return (
    <g className={className} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
      {items}
      <circle cx={cx} cy={cy} r={r} />
      <circle cx={cx} cy={cy} r={r * 0.42} className="cog-hole" />
    </g>
  );
}

export default function ProcessingBlocker({ step }: { step?: string }) {
  return (
    <div className="processing-blocker" role="status" aria-live="polite">
      <div className="pb-cogs" aria-hidden>
        <svg viewBox="0 0 160 120" xmlns="http://www.w3.org/2000/svg">
          <Gear cx={58} cy={58} r={34} teeth={12} className="cog cog-a" />
          <Gear cx={112} cy={72} r={24} teeth={10} className="cog cog-b" />
        </svg>
      </div>
      <div className="pb-title">Generating report…</div>
      <div className="pb-step">{step || "Running the deterministic research pipeline"}</div>
      <div className="pb-bar" aria-hidden><span /></div>
    </div>
  );
}
