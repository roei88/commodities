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
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/commodities")
      .then((r) => r.json())
      .then((d) => setCommodities(d.commodities ?? []))
      .catch(() => setCommodities([]));
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

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const commodity = commodities.find((c) => c.id === selected);
  const spanValid = useMemo(() => !!from && !!to && new Date(to) > new Date(from), [from, to]);
  const canRun = !!selected && spanValid && status !== "running";

  function run() {
    if (!canRun) return;
    setStatus("running");
    setLog([]);
    setResult(null);
    setTab("activity");
    closeRef.current?.();

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
        closeRef.current = streamRun(
          runId,
          (line) => setLog((l) => [...l, line]),
          () => finish(runId)
        );
      })
      .catch((e) => {
        setLog((l) => [...l, mkLine("error", String(e))]);
        setStatus("error");
      });
  }

  function finish(runId: string) {
    fetch(`/api/report/${runId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "done") {
          setResult(d.result);
          setStatus("done");
          setTab("report");
        } else if (d.status === "error") {
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
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
            <select value={selected} onChange={(e) => { setSelected(e.target.value); setStatus("idle"); }}>
              <option value="">Select a commodity…</option>
              {commodities.map((c) => (
                <option key={c.id} value={c.id}>{c.label} · {c.venue}</option>
              ))}
            </select>
            {commodity && (
              <>
                <div className="plan-chip">plan: {commodity.planResolution}</div>
                {commodity.seed && (
                  <div className="seed-quote">
                    last known {commodity.seed.sell} / {commodity.seed.buy}{" "}
                    <span className={commodity.seed.changePct >= 0 ? "up" : "down"}>
                      {commodity.seed.changePct >= 0 ? "+" : ""}{commodity.seed.changePct}%
                    </span>{" "}· market closed (live price fetched on run)
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
          <div className="logbox">
            {log.length === 0 && <div className="empty">Select a commodity and span, then Run research. Activity streams here live.</div>}
            {log.map((l, i) => (
              <div key={i} className={`logline lv-${l.level}`}>
                <span className="t">{l.ts.slice(11, 19)}</span>
                <span className="m">{l.msg}</span>
              </div>
            ))}
            <div ref={logEndRef} />
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
