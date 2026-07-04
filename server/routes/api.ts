import { Router } from "express";
import { writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startRun, getRun, subscribe } from "../runs.ts";
import { loadRegistry, listDedicatedPlans, resolvePlanFor, getCommodity, validateRawPlan } from "../plans/resolver.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, "..", "..", "plans", "assets");

export const api = Router();

// List commodities (dropdown) with which plan each resolves to.
api.get("/commodities", (_req, res) => {
  const list = loadRegistry().map((c) => {
    let resolution = "universal";
    try {
      resolution = resolvePlanFor(c).resolution;
    } catch {
      /* ignore */
    }
    return { ...c, planResolution: resolution };
  });
  res.json({ commodities: list, dedicatedPlans: listDedicatedPlans() });
});

// Preview the resolved plan for one commodity (shown on selection).
api.get("/plan/:commodityId", (req, res) => {
  const c = getCommodity(req.params.commodityId);
  if (!c) return res.status(404).json({ error: "unknown commodity" });
  try {
    const { plan, resolution, planHash } = resolvePlanFor(c);
    res.json({ resolution, planHash, plan });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "resolve failed" });
  }
});

// Add a new plan asset (validated before save). Body = raw plan JSON.
api.post("/plans", (req, res) => {
  const raw = req.body;
  if (!raw || typeof raw !== "object" || !raw.id) return res.status(400).json({ error: "plan must be an object with an id" });
  const check = validateRawPlan(raw);
  if (!check.ok) return res.status(400).json({ error: "schema validation failed", details: check.errors });
  const path = join(ASSETS_DIR, `${String(raw.id).replace(/[^a-z0-9-]/gi, "")}.json`);
  if (existsSync(path)) return res.status(409).json({ error: "a plan with this id already exists" });
  try {
    writeFileSync(path, JSON.stringify(raw, null, 2));
    res.json({ ok: true, id: raw.id });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "write failed" });
  }
});

// Kick off a run. Body: { commodityId, from, to }.
api.post("/run", (req, res) => {
  const { commodityId, from, to } = req.body ?? {};
  if (!commodityId || !from || !to) return res.status(400).json({ error: "commodityId, from, to required" });
  if (!getCommodity(commodityId)) return res.status(404).json({ error: "unknown commodity" });
  if (new Date(to) <= new Date(from)) return res.status(400).json({ error: "span end must be after start" });
  const runId = startRun(commodityId, { from, to });
  res.json({ runId });
});

// SSE stream of the run's activity log.
api.get("/stream/:runId", (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const lastEventId = Number(req.headers["last-event-id"] ?? 0);
  const send = (line: any, id: number) => {
    res.write(`id: ${id}\n`);
    res.write(`data: ${JSON.stringify(line)}\n\n`);
    if (line.msg === "__COMPLETE__") {
      res.write(`event: complete\ndata: {}\n\n`);
    }
  };

  const unsub = subscribe(req.params.runId, lastEventId, send);
  if (!unsub) return res.status(404).end();

  // heartbeat to keep proxies from killing the idle connection
  const hb = setInterval(() => res.write(`: ping\n\n`), 20000);

  req.on("close", () => {
    clearInterval(hb);
    unsub();
  });
});

// Fetch the finished result (report markdown + chart data). Survives refresh.
api.get("/report/:runId", (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "unknown run" });
  if (run.status === "running") return res.json({ status: "running" });
  if (run.status === "error") return res.status(200).json({ status: "error", error: run.error });
  res.json({ status: "done", result: run.result });
});
