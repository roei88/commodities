import { randomUUID } from "node:crypto";
import { runPipeline } from "./engine/pipeline.ts";
import type { LogLine, RunResult } from "../shared/types.ts";

type Status = "running" | "done" | "error";
type Subscriber = (line: LogLine, id: number) => void;

interface Run {
  id: string;
  status: Status;
  log: LogLine[]; // append-only; index+1 is the SSE event id
  result: RunResult | null;
  error: string | null;
  subscribers: Set<Subscriber>;
  createdAt: number;
}

const runs = new Map<string, Run>();

// Evict runs older than 2h to bound memory (single-process, local-first).
function gc() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, r] of runs) if (r.createdAt < cutoff) runs.delete(id);
}

export function startRun(commodityId: string, span: { from: string; to: string }): string {
  gc();
  const id = randomUUID();
  const run: Run = {
    id,
    status: "running",
    log: [],
    result: null,
    error: null,
    subscribers: new Set(),
    createdAt: Date.now(),
  };
  runs.set(id, run);

  const emit = (level: LogLine["level"], msg: string) => {
    const line: LogLine = { ts: new Date().toISOString(), level, msg };
    run.log.push(line);
    const eventId = run.log.length;
    for (const sub of run.subscribers) {
      try {
        sub(line, eventId);
      } catch {
        /* ignore broken subscriber */
      }
    }
  };

  // Fire-and-forget; the SSE stream tails run.log by id.
  (async () => {
    try {
      const result = await runPipeline(commodityId, span, emit);
      result.runId = id;
      run.result = result;
      run.status = "done";
      emit("done", "__COMPLETE__");
    } catch (err: any) {
      run.error = err?.message ?? String(err);
      run.status = "error";
      emit("error", `Pipeline failed: ${run.error}`);
      emit("done", "__COMPLETE__");
    }
  })();

  return id;
}

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

// Subscribe an SSE client; replays everything after `lastEventId` first, then
// streams live lines. Returns an unsubscribe fn.
export function subscribe(id: string, lastEventId: number, sub: Subscriber): (() => void) | null {
  const run = runs.get(id);
  if (!run) return null;
  // replay backlog
  for (let i = lastEventId; i < run.log.length; i++) sub(run.log[i], i + 1);
  if (run.status === "running") {
    run.subscribers.add(sub);
    return () => run.subscribers.delete(sub);
  }
  return () => {};
}
