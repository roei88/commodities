# Commodity Research

A local-first, **deterministic** commodity price-target research app. Pick a commodity and an analysis span, hit **Run**, and a server-side pipeline fetches live market data and computes a full price-target report — expected-move bands, a regime read + signal stack, a seeded Monte-Carlo fan chart, an interval price-target ladder, and COT positioning — streaming its activity live and rendering an exportable Markdown report.

No LLM, no API key required to start, no per-run cost. The research methodology is encoded as **plan assets** (JSON), executed mechanically.

## What it does (and doesn't)

It executes the *quantitative* half of a rigorous research methodology from live data:

- **Price/technicals** — RSI, MACD, moving averages + slope, ATR, realized volatility.
- **Expected-move bands** — vol-scaled `spot × vol × √(t/252)` at ±1σ and ±1.65σ (90%), for today / week / month.
- **Regime gate + signal stack** — rule-based regime classification and a trend/momentum/positioning/flow stack scored −1/0/+1 × weight → Bull/Base/Bear probabilities.
- **Monte-Carlo** — a seeded (reproducible) OU + jump simulation → percentile fan chart + a 6-hour interval ladder.
- **Positioning** — CFTC COT managed-money net + 3-year percentile (keyless).
- **Macro overlay** (optional) — FRED real yield / dollar index for precious metals.

It does **not** do the free-form, judgement parts of the source methodology — live news synthesis, weather characterization, chatter hygiene. Those require an LLM and are out of scope by design. Where a plan declares such a protocol, the report lists it under *"Qualitative protocols (NOT executed)"* and RED-FLAGs missing inputs rather than faking them. Every report is a mechanical, backward-looking model — scenario analysis, **not investment advice**.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

Open the URL, select a commodity (e.g. Gold), pick a span, and Run.

Production:

```bash
npm run build && npm run start
```

### Optional keys (`.env`, copy from `.env.example`)

Everything degrades gracefully without keys — the report RED-FLAGs any missing source.

- `FRED_API_KEY` — enables the real-yield / dollar-index macro overlay ([free key](https://fred.stlouisfed.org/docs/api/api_key.html)).
- `TWELVEDATA_API_KEY` — a keyed OHLC fallback if Yahoo is unavailable ([free tier](https://twelvedata.com/pricing)).

Primary price data (Yahoo Finance) and CFTC COT need **no key**.

## Data sources

| Data | Source | Key? |
|---|---|---|
| OHLC price history | Yahoo Finance (`yahoo-finance2`) → Twelve Data | keyless / keyed fallback |
| Positioning (COT) | CFTC Socrata disaggregated report | keyless |
| Real yield / dollar index | FRED | free key |

> Yahoo Finance is unofficial and can change without notice; the app falls back and flags source health in every report. (Stooq is wired as a keyless fallback but currently sits behind an anti-bot wall.)

## Plans are assets

The research recipe for each commodity is a JSON **plan asset**, resolved most-specific-first:

```
dedicated (plans/assets/<id>.json)  >  class (plans/classes/<class>.json)  >  universal (plans/universal.json)
```

- `universal.json` — the generic template that runs on everything.
- `classes/*.json` — per-asset-class tuning (precious-metals, energy, industrial-metals, grains, softs, livestock).
- `assets/gold.json`, `assets/cocoa.json` — dedicated, fully-tuned plans.

A plan declares data inputs, technical periods, band config, the signal-stack weights, a catalyst calendar, Monte-Carlo parameters, report sections, and accuracy ceilings. **Add your own** by dropping a validated JSON file in `plans/assets/` (or POST it to `/api/plans`); the resolver and JSON-Schema validation pick it up on the next run. Malformed plans fail loudly.

## Architecture

- **Frontend** — Vite + React + TypeScript SPA (uPlot fan chart, `marked` + `DOMPurify` for the report).
- **Backend** — Express, served with the SPA in one process via `vite-express`. A run streams its activity log over **SSE** (heartbeat + `Last-Event-ID` replay), decoupled from the socket by `runId` so a refresh or reconnect survives.
- **Engine** — `server/engine/`: data adapters + cache, technicals, bands, regime, Monte-Carlo, report assembler, orchestrated by `pipeline.ts`.

```
src/            React SPA (components, lib)
server/         Express + SSE + pipeline + engine + data adapters
plans/          plan assets (universal, classes/, assets/), registry, schema
shared/types.ts types shared by client + server
```

## Deploy

Long-running runs (minutes) need a long-running host — not a serverless function that times out. Included: `render.yaml` for a one-click **Render** Blueprint. Railway / Fly.io work the same way: build with `npm run build`, start with `npm run start`, set `PORT` (and any optional keys). Do **not** deploy to a serverless/edge platform that caps function duration.

## Disclaimer

This is a mechanical quantitative model with no live news, weather, or narrative awareness. Outputs are scenario analysis for research, not financial advice, and carry no guarantee of accuracy.
