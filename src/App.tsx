import { useEffect, useMemo, useRef, useState } from "react";
import type { CommodityMeta, LogLine, RunResult } from "../shared/types.ts";
import { streamRun } from "./lib/sse.ts";
import { renderMarkdown, downloadFile } from "./lib/markdown.ts";
import FanChart from "./components/FanChart.tsx";
import IntervalLadder from "./components/IntervalLadder.tsx";

type CommodityWithPlan = CommodityMeta & { planResolution: string };
type Status = "idle" | "running" | "done" | "error";

export default function App() {
  const [commodities, setCommodities] = useState<CommodityWithPlan[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [log, setLog] = useState<LogLine[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [tab, setTab] = useState<"activity" | "report">("activity");
  const closeRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef<string | null>(null);
  const runCommodityRef = useRef<string | null>(null);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const [commoditiesError, setCommoditiesError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/commodities")
      .then((r) => r.json())
      .then((d) => setCommodities(d.commodities ?? []))
      .catch((e) => { setCommodities([]); setCommoditiesError(String(e)); });
  }, []);

  // Default span: today -> +10 days, once a commodity is picked.
  useEffect(() => {
    if (selected && !from) {
      const now = new Date();
      const end = new Date(now.getTime() + 10 * 864e5);
      setFrom(now.toISOString().slice(0, 10));
      setTo(end.toISOString().slice(0, 10));
    }
  }, [selected]);

  // Sticky-bottom log scroll: auto-scroll only when the user is already at the
  // bottom (or within 40px). Container-scoped so the page doesn't yank.
  useEffect(() => {
    const el = logBoxRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [log]);

  // Cleanup: close any open SSE stream on unmount.
  useEffect(() => () => { closeRef.current?.(); closeRef.current = null; }, []);

  const commodity = commodities.find((c) => c.id === selected);
  const spanValid = useMemo(() => !!from && !!to && new Date(to) > new Date(from), [from, to]);
  const spanInPast = useMemo(() => !!to && new Date(to) <= new Date(), [to]);
  const canRun = !!selected && spanValid && status !== "running" && !commodity?.dataUnavailable;

  function onSelectCommodity(id: string) {
    // Mid-run guard: abort any in-flight stream and clear state.
    if (status === "running") {
      closeRef.current?.();
      closeRef.current = null;
      runIdRef.current = null;
      runCommodityRef.current = null;
      setLog([]);
    }
    setSelected(id);
    setStatus("idle");
    setResult(null);
    setLog([]);
  }

  function run() {
    if (!canRun) return;
    setStatus("running");
    setLog([]);
    setResult(null);
    setTab("activity");
    closeRef.current?.();
    const commodityAtStart = selected;
    runCommodityRef.current = commodityAtStart;

    fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commodityId: selected, from, to }),
    })
      .then((r) => r.json())
      .then(({ runId, error }) => {
        if (error || !runId) {
          setLog((l) => [...l, mkLine("error", error ?? "failed to start run")]);
          setStatus("error");
          return;
        }
        runIdRef.current = runId;
        closeRef.current = streamRun(
          runId,
          (line) => {
            // Ignore lines from an orphaned prior run.
            if (runCommodityRef.current !== commodityAtStart) return;
            setLog((l) => [...l, line]);
          },
          () => {
            if (runCommodityRef.current !== commodityAtStart) return;
            finish(runId);
          }
        );
      })
      .catch((e) => {
        setLog((l) => [...l, mkLine("error", String(e))]);
        setStatus("error");
      });
  }

  function finish(runId: string) {
    fetch(`/api/report/${runId}`)
      .then((r) => r.ok ? r.json() : { status: "error", error: `HTTP ${r.status}` })
      .then((d) => {
        if (d.status === "done") {
          setResult(d.result);
          setStatus("done");
          setTab("report");
        } else if (d.status === "error") {
          setLog((l) => [...l, mkLine("error", d.error ?? "run failed")]);
          setStatus("error");
        } else {
          // "running" status returned after 'complete' event -> server likely evicted the run
          setLog((l) => [...l, mkLine("error", "Run finished but report is unavailable (server may have restarted).")]);
          setStatus("error");
        }
      })
      .catch((e) => {
        setLog((l) => [...l, mkLine("error", `Report fetch failed: ${e?.message ?? e}`)]);
        setStatus("error");
      });
  }

  const reportHtml = useMemo(() => (result ? renderMarkdown(result.markdown) : ""), [result]);

  function exportMd() {
    if (!result) return;
    downloadFile(`${result.commodity.id}-${result.finishedAt.slice(0, 10)}.md`, result.markdown, "text/markdown");
  }
  function exportHtml() {
    if (!result) return;
    const doc = `<!doctype html><meta charset="utf-8"><title>${result.commodity.label} report</title><body style="max-width:820px;margin:40px auto;font-family:system-ui;padding:0 20px">${reportHtml}</body>`;
    downloadFile(`${result.commodity.id}-${result.finishedAt.slice(0, 10)}.html`, doc, "text/html");
  }

  return (
    <div className="app">
      <div className="topbar">
        <h1>Commodity Research</h1>
        <span className="sub">deterministic price-target engine · local-first</span>
        <div className="spacer" />
        <StatusPill status={status} flags={result?.redFlags.length ?? 0} />
      </div>

      <div className="container">
        {/* Controls */}
        <div className="controls">
          <div className="field">
            <label>Commodity</label>
            <select value={selected} onChange={(e) => onSelectCommodity(e.target.value)}>
              <option value="">Select a commodity…</option>
              {commodities.map((c) => (
                <option key={c.id} value={c.id} disabled={(c as any).dataUnavailable}>
                  {c.label} · {c.venue}{(c as any).dataUnavailable ? " (no live data)" : ""}
                </option>
              ))}
            </select>
            {commoditiesError && <div className="seed-quote" style={{ color: "var(--red)" }}>Failed to load commodities: {commoditiesError}</div>}
            {commodity && (
              <>
                <div className="plan-chip">plan: {commodity.planResolution}</div>
                {(commodity as any).dataUnavailable && (
                  <div className="seed-quote" style={{ color: "var(--amber)" }}>
                    ⚠ No live data source for this commodity: {(commodity as any).dataUnavailableReason}
                  </div>
                )}
                {commodity.seed && (
                  <div className="seed-quote">
                    last known {commodity.seed.sell} / {commodity.seed.buy}{" "}
                    <span className={commodity.seed.changePct >= 0 ? "up" : "down"}>
                      {commodity.seed.changePct >= 0 ? "+" : ""}{commodity.seed.changePct}%
                    </span>{" "}· snapshot (live price fetched on run)
                  </div>
                )}
              </>
            )}
          </div>

          <div className="field">
            <label>Analysis span</label>
            <div className="dates">
              <div className="field">
                <input type="date" value={from} disabled={!selected} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="field">
                <input type="date" value={to} disabled={!selected} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            {selected && !spanValid && <div className="seed-quote">Pick an end date after the start date.</div>}
            {selected && spanValid && spanInPast && (
              <div className="seed-quote" style={{ color: "var(--amber)" }}>
                ⚠ Span end is in the past — projection horizon defaults to ~5 trading days.
              </div>
            )}
          </div>

          <button className="run-btn" disabled={!canRun} onClick={run}>
            {status === "running" ? "Running…" : "Run research"}
          </button>
        </div>

        {/* Tabs */}
        <div className="tabs">
          <button className={`tab ${tab === "activity" ? "active" : ""}`} onClick={() => setTab("activity")}>
            Activity log
          </button>
          <button
            className={`tab ${tab === "report" ? "active" : ""}`}
            disabled={!result}
            onClick={() => setTab("report")}
          >
            Report {result ? "✓" : ""}
          </button>
        </div>

        {tab === "activity" && (
          <div className="logbox" ref={logBoxRef}>
            {log.length === 0 && <div className="empty">Select a commodity and span, then Run research. Activity streams here live.</div>}
            {log.map((l, i) => (
              <div key={i} className={`logline lv-${l.level}`}>
                <span className="t">{new Date(l.ts).toLocaleTimeString("en-GB", { hour12: false })}</span>
                <span className="m">{l.msg}</span>
              </div>
            ))}
          </div>
        )}

        {tab === "report" && result && (
          <div className="report-grid">
            <div className="card">
              <div className="export-row">
                <button className="btn-sm" onClick={exportMd}>Export .md</button>
                <button className="btn-sm" onClick={exportHtml}>Export .html</button>
              </div>
              <div className="markdown" dangerouslySetInnerHTML={{ __html: reportHtml }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {result.montecarlo && (
                <div className="card">
                  <h3>Monte-Carlo fan</h3>
                  <FanChart fan={result.montecarlo.fan} spot={result.montecarlo.spot} unit={result.commodity.unit} />
                </div>
              )}
              {result.montecarlo && (
                <div className="card">
                  <h3>Interval ladder ({result.commodity.unit})</h3>
                  <IntervalLadder rows={result.montecarlo.ladder} unit={result.commodity.unit} />
                </div>
              )}
            </div>
          </div>
        )}

        <div className="disclaimer">
          Mechanical, backward-looking model — no live news/weather/narrative awareness. Scenario analysis, not investment advice.
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status, flags }: { status: Status; flags: number }) {
  if (status === "idle") return null;
  const label =
    status === "running" ? "running" : status === "done" ? `done${flags ? ` · ${flags} flag${flags === 1 ? "" : "s"}` : ""}` : "error";
  return (
    <span className={`status-pill ${status}`}>
      <span className={`dot ${status === "running" ? "pulse" : ""}`} />
      {label}
    </span>
  );
}

function mkLine(level: LogLine["level"], msg: string): LogLine {
  return { ts: new Date().toISOString(), level, msg };
}
