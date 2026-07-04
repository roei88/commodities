import type { LogLine } from "../../shared/types.ts";

// Subscribe to a run's SSE log. Calls onLine per log line and onComplete once
// the pipeline signals done. Returns a close fn. EventSource auto-reconnects and
// the server replays via Last-Event-ID, so a dropped connection self-heals.
export function streamRun(
  runId: string,
  onLine: (line: LogLine) => void,
  onComplete: () => void
): () => void {
  const es = new EventSource(`/api/stream/${runId}`);

  es.onmessage = (ev) => {
    try {
      const line = JSON.parse(ev.data) as LogLine;
      if (line.msg === "__COMPLETE__") return; // handled by 'complete' event
      onLine(line);
    } catch {
      /* ignore malformed */
    }
  };

  es.addEventListener("complete", () => {
    es.close();
    onComplete();
  });

  es.onerror = () => {
    // EventSource retries automatically; only give up if the server closed it.
    if (es.readyState === EventSource.CLOSED) onComplete();
  };

  return () => es.close();
}
