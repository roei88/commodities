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

// Small icon/emoji-free glyph for the section header stripe.
const ROLE_LABEL: Record<SectionRole, string> = {
  tldr: "SUMMARY", setup: "SETUP", regime: "REGIME",
  bands: "BANDS", montecarlo: "SIMULATION", options: "OPTIONS",
  termstructure: "CURVE", positioning: "POSITIONING",
  macro: "MACRO", flow: "FLOW", catalysts: "CATALYSTS",
  backtest: "BACKTEST", invalidation: "INVALIDATION",
  confidence: "CONFIDENCE", qualitative: "PROTOCOLS",
  redflags: "FLAGS", ceilings: "CEILINGS", sources: "SOURCES",
};

// Color intent per section — most use the primary accent, but red-flags and
// invalidation lean toward the secondary/warning tone.
const ROLE_TONE: Record<SectionRole, "primary" | "secondary" | "warn"> = {
  tldr: "primary", setup: "primary", regime: "primary",
  bands: "primary", montecarlo: "primary", options: "secondary",
  termstructure: "secondary", positioning: "secondary",
  macro: "secondary", flow: "secondary", catalysts: "primary",
  backtest: "primary", invalidation: "warn",
  confidence: "primary", qualitative: "secondary",
  redflags: "warn", ceilings: "secondary", sources: "secondary",
};

export default function ReportView({ sections }: { sections: ReportSection[] }) {
  return (
    <div className="report-sections">
      {sections.map((s, i) => {
        const motif = ROLE_MOTIF[s.role];
        const tone = ROLE_TONE[s.role];
        const label = ROLE_LABEL[s.role];
        const html = renderMarkdown(s.markdown);
        return (
          <section
            key={i}
            className={`section-frame section-${s.role} tone-${tone}`}
            aria-label={s.title}
          >
            <div className="section-motif" aria-hidden>
              <Motif kind={motif} size={140} />
            </div>
            <div className="section-header">
              <span className="section-role-label">{label}</span>
              <h2>{s.title}</h2>
            </div>
            <div className="section-body markdown" dangerouslySetInnerHTML={{ __html: html }} />
          </section>
        );
      })}
    </div>
  );
}
