import { Fragment, type ReactNode } from "react";
import { renderMarkdown } from "../lib/markdown.ts";
import type { ReportSection, SectionRole } from "../../shared/types.ts";
import type { MotifKind } from "../lib/theme.ts";
import Motif from "./Motif.tsx";

// Maps each section role to the SVG motif it wears in its top-right.
const ROLE_MOTIF: Record<SectionRole, MotifKind> = {
  tldr: "sparkline",
  setup: "gears",
  regime: "radar",
  bands: "sparkline",
  montecarlo: "sparkline",
  options: "gauge",
  termstructure: "grid",
  positioning: "bars",
  macro: "grid",
  flow: "sparkline",
  catalysts: "calendar",
  backtest: "bars",
  invalidation: "gauge",
  confidence: "gauge",
  qualitative: "gears",
  redflags: "gauge",
  ceilings: "gears",
  sources: "gears",
};

const ROLE_LABEL: Record<SectionRole, string> = {
  tldr: "SUMMARY", setup: "SETUP", regime: "REGIME",
  bands: "BANDS", montecarlo: "SIMULATION", options: "OPTIONS",
  termstructure: "CURVE", positioning: "POSITIONING",
  macro: "MACRO", flow: "FLOW", catalysts: "CATALYSTS",
  backtest: "BACKTEST", invalidation: "INVALIDATION",
  confidence: "CONFIDENCE", qualitative: "PROTOCOLS",
  redflags: "FLAGS", ceilings: "CEILINGS", sources: "SOURCES",
};

const ROLE_TONE: Record<SectionRole, "primary" | "secondary" | "warn"> = {
  tldr: "primary", setup: "primary", regime: "primary",
  bands: "primary", montecarlo: "primary", options: "secondary",
  termstructure: "secondary", positioning: "secondary",
  macro: "secondary", flow: "secondary", catalysts: "primary",
  backtest: "primary", invalidation: "warn",
  confidence: "primary", qualitative: "secondary",
  redflags: "warn", ceilings: "secondary", sources: "secondary",
};

interface Props {
  sections: ReportSection[];
  // Optional client-rendered "sections" that we inject inline as full-width
  // frames after the TL;DR. This eliminates the empty vertical space that
  // used to sit next to the report sections when the data lived in a fixed
  // right-hand column.
  fanChart?: ReactNode;
  ladder?: ReactNode;
}

function SectionFrame({
  role, title, body, className = "",
}: { role: SectionRole; title: string; body: ReactNode; className?: string }) {
  const motif = ROLE_MOTIF[role];
  const tone = ROLE_TONE[role];
  const label = ROLE_LABEL[role];
  return (
    <section className={`section-frame section-${role} tone-${tone} ${className}`} aria-label={title}>
      <div className="section-motif" aria-hidden><Motif kind={motif} size={140} /></div>
      <div className="section-header">
        <span className="section-role-label">{label}</span>
        <h2>{title}</h2>
      </div>
      <div className="section-body">{body}</div>
    </section>
  );
}

// A "pseudo" section frame for client-rendered data (fan chart, ladder).
function DataFrame({
  motif, label, title, tone, className, children,
}: {
  motif: MotifKind; label: string; title: string;
  tone: "primary" | "secondary" | "warn";
  className?: string; children: ReactNode;
}) {
  return (
    <section className={`section-frame section-data tone-${tone} ${className ?? ""}`} aria-label={title}>
      <div className="section-motif" aria-hidden><Motif kind={motif} size={140} /></div>
      <div className="section-header">
        <span className="section-role-label">{label}</span>
        <h2>{title}</h2>
      </div>
      <div className="section-body data-body">{children}</div>
    </section>
  );
}

export default function ReportView({ sections, fanChart, ladder }: Props) {
  return (
    <div className="report-sections">
      {sections.map((s, i) => {
        const html = renderMarkdown(s.markdown);
        const body = <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
        const node = <SectionFrame key={`s-${i}`} role={s.role} title={s.title} body={body} />;
        // Inject the fan chart + interval ladder as their own frames right
        // after the TL;DR so they read as part of the price story.
        if (s.role === "tldr" && (fanChart || ladder)) {
          return (
            <Fragment key={i}>
              {node}
              {fanChart && (
                <DataFrame
                  motif="sparkline" label="PRICE PATHS" title="Monte-Carlo fan"
                  tone="primary" className="section-fanchart"
                >{fanChart}</DataFrame>
              )}
              {ladder && (
                <DataFrame
                  motif="bars" label="INTRADAY TARGETS" title="Interval price ladder"
                  tone="primary" className="section-ladder"
                >{ladder}</DataFrame>
              )}
            </Fragment>
          );
        }
        return node;
      })}
    </div>
  );
}
