import { useEffect, useState } from "react";

interface NewsItem { title: string; publisher: string; date: string | null; link: string }
interface Note {
  price: number;
  unit: string;
  changePct1d: number | null;
  changePct1w: number | null;
  changePct1m: number | null;
  note: string;
  news: NewsItem[];
  source: string;
}

// Data-driven market note shown under the chart. The paragraph is composed
// server-side from real price statistics; headlines are real, attributable
// Yahoo Finance items with source links.
export default function MarketNote({ commodityId }: { commodityId: string }) {
  const [data, setData] = useState<Note | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!commodityId) return;
    const ac = new AbortController();
    setData(null);
    setErr(null);
    fetch(`/api/note/${commodityId}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j.error ?? `HTTP ${r.status}`)))))
      .then((d: Note) => setData(d))
      .catch((e: any) => { if (e?.name !== "AbortError") setErr(e?.message ?? "unavailable"); });
    return () => ac.abort();
  }, [commodityId]);

  if (err) return null; // silently omit when unavailable (chart already shows an error row)
  if (!data) return <div className="market-note market-note-loading">Loading market note…</div>;

  const chips: { label: string; v: number | null }[] = [
    { label: "1D", v: data.changePct1d },
    { label: "1W", v: data.changePct1w },
    { label: "1M", v: data.changePct1m },
  ];

  return (
    <div className="market-note">
      <div className="mn-head">
        <span className="mn-title">Market note</span>
        <span className="mn-chips">
          {chips.map((c) => c.v != null && (
            <span key={c.label} className={`mn-chip ${c.v >= 0 ? "up" : "down"}`}>
              {c.label} {c.v >= 0 ? "+" : ""}{c.v.toFixed(2)}%
            </span>
          ))}
        </span>
      </div>
      <p className="mn-body">{data.note}</p>
      {data.news.length > 0 && (
        <div className="mn-news">
          <div className="mn-news-label">Recent headlines</div>
          {data.news.map((n, i) => (
            <a key={i} className="mn-news-item" href={n.link} target="_blank" rel="noopener noreferrer">
              <span className="mn-news-title">{n.title}</span>
              <span className="mn-news-meta">{n.publisher}{n.date ? ` · ${n.date}` : ""}</span>
            </a>
          ))}
        </div>
      )}
      <div className="mn-source">Note composed from price data · headlines via {data.source}</div>
    </div>
  );
}
