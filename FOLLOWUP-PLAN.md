# Follow-up Plan — Post-Build Review (2026-07-04)

A full-session audit of the commodity-research app **as delivered vs the user's inputs** — the original spec message, the four clarifying answers, the approved implementation plan, and the two methodology transcripts (`~/Downloads/part1_precompaction.md`, `part2_current_session.md`). This document is the working backlog for follow-up work.

## How this review was produced (and its honest limits)

Six parallel specialized review agents, one lens each: **spec-compliance**, **engine/math/data correctness**, **frontend/UI/UX**, **methodology fidelity vs transcripts**, **host-system/deploy**, **runtime resilience**. Each was to be adversarially verified by a second agent.

**Limits, stated plainly:**
- The **verification stage and the resilience-runtime reviewer failed mid-run — the Claude monthly spend limit was hit**. So: no dedicated resilience review exists (its intended scope is folded into the backlog below from overlap with other lenses), and findings were *not* machine-verified.
- Compensation: (a) **cross-lens convergence** — every major finding below was independently discovered by 2–4 separate lenses; (b) **direct spot-verification** of the highest-impact and least-certain claims against the actual code and live CFTC API (results below). Findings that failed spot-verification were removed.

**Spot-verification results (run directly against code + live APIs):**
| Claim | Result |
|---|---|
| NG COT code `0233AK` returns no data | ✅ CONFIRMED (Socrata returns `[]`) |
| Aluminum COT `191693` is the wrong instrument | ✅ CONFIRMED (resolves to "ALUMINUM MWP" — Midwest Premium, not outright) |
| `reportSections` is dead config (never read) | ✅ CONFIRMED (zero engine references) |
| `bands.volSource` ignored by computeBands | ✅ CONFIRMED |
| `span.from` unused by the engine | ✅ CONFIRMED (only echoed in report header) |
| Monte-Carlo gets empty `eventDayMultipliers` | ✅ CONFIRMED (`{}` hard-coded, pipeline.ts:144) |
| RC=F invalid on Yahoo (Robusta) | ✅ CONFIRMED live by reviewer (`Not Found`) |
| Build artifacts / cache blobs committed (SC-12) | ❌ **REFUTED** — only `data-cache/.gitkeep` is tracked; dist/ correctly ignored |

## What was done well (convergent across lenses)

- All 20 commodities present with **seed quotes exactly matching the user's pasted list**; select → calendar-enables → valid-span → Run gating works precisely as specified.
- Live SSE activity log (heartbeat, Last-Event-ID replay, runId decoupling) matches the "GitHub-Actions log" ask; report auto-opens in its tab with working .md/.html export.
- The deterministic pipeline verifiably ran on live data (gold dedicated / corn + silver class fallback), with real graceful degradation (RED FLAGs instead of fabricated numbers) and **reproducible seeded Monte-Carlo**.
- Plan-asset system (universal ← class ← dedicated deep-merge, ajv validation, loud failure on malformed assets) is real and tested.
- The honesty layer — "Qualitative protocols (NOT executed)", accuracy ceilings, disclaimers — is a genuine differentiator carried over from the transcripts.
- Deviation from the "boilerplate template" instruction (fresh Vite scaffold) was researched, surfaced in the approved plan, and justified (SC-13 — no action).

---

## Confirmed gaps — the follow-up backlog

### Theme 1 — Broken spec promises (highest priority)

| # | Sev | Finding | Fix |
|---|---|---|---|
| SC-3 / ENG-12 / HOST-1 | **P0** | **`render.yaml` quick-deploy is self-breaking**: `NODE_ENV=production` makes `npm install` omit devDependencies, so `vite` (build), `tsx` (start), `react` are all missing on Render | Remove the NODE_ENV envVar (start script already sets it via cross-env) **or** `npm install --include=dev`; longer-term move `tsx` to dependencies or precompile the server |
| SC-5 / ENG-05 / HOST-2 | **P1** | **`.env` is never loaded** — README instructs creating it, but FRED/Twelve Data keys are silently ignored (no dotenv, no `--env-file`) | Zero-dep fix: `try { process.loadEnvFile(); } catch {}` first line of `server/index.ts` (Node 20.12+) |
| SC-1 / ENG-03 / FE-05 / MF-11 | **P1** | **`span.from` is decorative** — research is unaffected by it; horizon = quote date → `span.to`, capped silently at 40 trading days; all-past spans silently become a 5-day forward forecast | Wire `from` to bound the technicals/vol history window (preferred); flag horizon truncation with a RED FLAG; reject/flag past spans; mirror constraints in the UI (`min` on inputs, helper text) |
| SC-2 / FE-04 | **P1** | **No plan UI** — the verbatim answer required "the option to add additional specified/generic ones"; only a hidden POST /api/plans exists | Make the plan chip expandable (read-only resolved-plan view via existing GET /api/plan/:id) + an "Add plan…" modal (paste/upload JSON → ajv errors surfaced) + optional plan-override select |
| SC-4 / ENG-07 / HOST-3 | **P1** | **Robusta Coffee is unresearchable** — RC=F invalid on Yahoo, all fallback fields empty; a Run burns into an all-RED-FLAG empty report | Find a real source (Twelve Data robusta symbol / proxy) or mark "no live data source" in the dropdown and warn before Run |
| ENG-01 / SC-8 | **P1** | **Natural Gas COT dead** — `0233AK` doesn't exist in the disaggregated dataset | Change to NYMEX Henry Hub `023651`; add a startup/CI check validating every registry COT code returns rows |
| ENG-02 | **P1** | **Aluminum COT is the wrong instrument** (Midwest *Premium* swap `191693`, not outright aluminum) — wrong positioning numbers shown | Change to `191691` (verify), covered by the same registry validation check |
| SC-9 | P2 | "Data-time span" is **date-only** (spec wording implies time-of-day) | `datetime-local` inputs; pass time into the horizon calc |

### Theme 2 — Report claims vs engine reality (honesty debt)

The transcripts' core discipline is "never imply the engine did something it didn't." These items violate that:

| # | Sev | Finding | Fix |
|---|---|---|---|
| MF-1 / ENG-06 / SC-7 | **P0** | Gold's flagship **real-yield regime can never fire**: `realYieldCorrelation` is hardcoded `null`, yet plan rules + report imply a correlation test happens | Fetch FRED daily series (not just latest), compute ~60d rolling correlation of returns vs real-yield changes, feed `RegimeContext`; score the signal from recent real-yield direction when corr < −0.2 |
| ENG-04 / SC-6 / MF-4 | **P1** | **catalystCalendar inert but reported as applied**: report prints "vol ×N" per catalyst while MC always receives `{}` | Map dated catalysts inside the span to trading-day indices → `eventDayMultipliers`; log applied catalysts in the activity stream; render applied vs out-of-span distinctly. Until wired: relabel section "Declared catalysts (NOT applied)" |
| MF-2 | **P1** | **Invalidation levels + confidence rating** — the transcripts' core per-horizon deliverable — never rendered; `reportSections` config is entirely dead | Render both: invalidation from MA/sigma structure per horizon; confidence computed from red-flag count, source health, staleness, COT presence, net-signal magnitude. Honor or remove `reportSections` |
| MF-5 | **P1** | **Implied vol never attempted** — GVZ (the transcripts' named free primary for gold) ignored; `volSource:"implied"` schema-legal but unimplemented | Fetch `^GVZ` via existing Yahoo client where declared; IV-vs-realized comparison in report; realized fallback + RED FLAG on failure |
| MF-3 | **P1** | **No-lean-below-catalyst hard rule not implemented** — "below catalyst threshold" wording implies catalyst awareness that doesn't exist | Give catalysts dates (COT Fridays computable), force `no-lean` + "trigger that resolves it" line when span.to precedes the next catalyst |
| MF-6 | **P1** | **No target logging/scoring** — the falsifiability/calibration loop from every plan version is absent | Persist a compact target log per run; auto-score matured targets on later runs; surface a calibration table |
| MF-7 | P2 | Regime labels overclaim ("supply-math regime reasserting" from a moving average) | Rename to what's measured, or suffix "(technical proxy — channel attribution not executed)" |
| MF-9 | P2 | Cocoa "widen bands" thin-OI promise — nothing widens | Apply a documented multiplier when the high-ATR regime fires, or move to accuracyCeilings |
| MF-10 | P2 | **DXY declared but never fetched** (README claims it too) | Iterate `macroSeries` through fredSeries(), or fetch `DX-Y.NYB` via Yahoo (keyless); RED-FLAG failures |
| MF-8 / ENG-17 | P2 | "Flow" signal is a 5-day ROC (momentum double-count); GLD hook never wired | Fetch class-relevant ETF trend via Yahoo; add divergence flag; or fold into momentum and reweight |
| ENG-09 | P2 | 6h ladder is linear interpolation of **daily** percentiles, undisclosed | One-line disclosure in report + UI ("indicative pacing, not simulated intraday") |
| ENG-10 | P2 | Touch probabilities from daily closes understate true touch probability | Brownian-bridge crossing correction, or disclose "measured on daily closes" |
| ENG-11 | P2 | Brent COT uses the small NYMEX look-alike, undisclosed | Label as proxy or ingest ICE Europe COT |
| MF-13 | P3 | No Accessed/Inferred footer | One-line footer listing accessed sources vs inferred outputs |
| MF-12 | P3 | Structural-vs-tactical firewall survives only as prose | Optional dedicated report section |

### Theme 3 — Frontend/UX defects

| # | Sev | Finding | Fix |
|---|---|---|---|
| FE-01 | **P1** | UI sticks on "Running…" forever if server restarts / run evicted | Handle non-done fallthrough in `finish()` with a visible error line |
| FE-02 | **P1** | Switching commodity mid-run orphans the stream; its completion later hijacks the report tab | Close stream + clear state on switch (or bind run to commodity and guard `finish()`) |
| FE-03 | **P1** | **Fan chart double-paints**: series-level `fill` on p5/p25 paints everything below the fan to y=0 | Remove `fill` from the four edge series; keep paint only in the `bands` array |
| FE-06 | P2 | Log force-scrolls the whole page on every line; fights the user scrolling up | Scroll the container only, with a sticky-bottom heuristic |
| FE-07 | P2 | Log timestamps UTC not local | `toLocaleTimeString` |
| FE-08 / SC-10 | P2 | "market closed" hardcoded; live quote never updates the selector after a run | Post-run, swap seed line for live quote + real marketOpen |
| FE-09 | P2 | Span edge cases silently rewritten (40d cap, past spans) with zero UI feedback | Input `min`/max + helper text mirroring engine truth (pairs with ENG-03) |
| FE-10/12/14 | P2/P3 | A11y: unassociated labels, no tab semantics; `--text-mute` ~4.1:1 contrast; ladder header uses `<td>` | id/htmlFor + aria; lighten to ≈5:1; `<th scope=col>` + sticky header |
| FE-11 | P2 | Failed commodity fetch → silently empty dropdown | Visible error + retry |
| FE-13 | P3 | Fan x-axis can print "D1.5" | Integer-only `incrs` |
| FE-15 | P3 | Exported .html is unstyled, chart-less, title unescaped | Embed CSS; serialize canvas `toDataURL`; escape title |
| FE-16 | P3 | Logbox fixed 420px | `clamp(320px, 55vh, 720px)` |
| FE-17 | P3 | Unmount cleanup, stale report across selection, favicon | Housekeeping pass |

### Theme 4 — Engine math precision

| # | Sev | Finding | Fix |
|---|---|---|---|
| ENG-08 | P2 | RSI is Cutler's (simple avg), labeled rsi14, drives 55/45 thresholds | Wilder smoothing for RSI + ATR, or rename + note variant |
| ENG-13 | P3 | Probability mapping is linear (comment says softmax-ish); Base can never be modal | Base = 0.4 − 0.15·\|net\| style mapping or real softmax; document |
| ENG-14 | P3 | Staleness false-positives Monday mornings / holidays | Business-hours age computation; small holiday list |
| ENG-15 | P3 | Sigma bands vs MC bands can disagree with no note | One reconciliation sentence in report |
| ENG-16 | P3 | COT percentile: labeled "3y" regardless of history; self-inclusive rank | "over N weeks" + midrank |

### Theme 5 — Host / runtime / persistence

| # | Sev | Finding | Fix |
|---|---|---|---|
| SC-11 | P2 | Reports lost on server restart (in-memory store); README wording overpromises | Persist finished RunResult JSON to `runs/` keyed by runId; lazy rehydrate on GET |
| HOST-4 | P2 | Preview launch.json lives in user-global `~/.claude/launch.json` with an `npm --prefix` hack | Commit a repo-local `.claude/launch.json`; neutralize the global entry; open future sessions with the repo as root |
| HOST-5 | P2 | No `engines` field / documented Node requirement | `"engines": {"node": ">=20"}` + README line |
| HOST-6 | P3 | Production runtime depends on devDeps (tsx); react/react-dom miscategorized | Move tsx to dependencies or add a server build step; recategorize |
| — | P2 | *(resilience lens — reviewer lost to spend limit; carried from overlap)* No fetch timeouts (a hung socket can stall a run forever with the SSE heartbeat keeping the connection alive); no rate-limit on POST /api/run; **on public deploy there is zero auth and /api/plans writes files to disk** | AbortController timeouts (~15s) on all fetches; simple in-flight run cap; deploy note: put auth/proxy in front or disable POST /api/plans in production |
| — | P3 | No automated tests at all | Add vitest: unit tests for technicals/bands/MC seed determinism/resolver merge + one API integration test |

### Refuted / no-action

- **SC-12** (build artifacts committed) — REFUTED by direct check; only `data-cache/.gitkeep` tracked.
- **SC-13** (boilerplate deviation) — surfaced in the approved plan; no action.

---

## Proposed follow-up phases

1. **Phase R1 — Truth & plumbing (small diffs, big honesty wins):** load `.env` (HOST-2), fix render.yaml (HOST-1), fix NG/Aluminum COT codes + registry validation script (ENG-01/02), Robusta source-or-disable (SC-4), relabel catalysts section until wired (ENG-04 interim), ladder/touch-prob disclosures (ENG-09/10), Brent proxy label (ENG-11), fan chart double-paint (FE-03), stuck-"Running…" and mid-run-switch fixes (FE-01/02).
2. **Phase R2 — Make the span real:** wire `span.from` into the history window, flag horizon caps, reject past spans, mirror in UI (ENG-03/FE-05/FE-09/SC-9 datetime).
3. **Phase R3 — Methodology completion:** real-yield rolling correlation + DXY fetch (MF-1/MF-10), GVZ implied vol for gold (MF-5), catalystCalendar → MC event days (MF-4), invalidation + confidence sections (MF-2), no-lean-below-catalyst rule (MF-3), flow via ETF trend (MF-8), thin-market band widening (MF-9), Accessed/Inferred footer (MF-13).
4. **Phase R4 — Plans UI:** expandable plan chip (resolved-plan viewer), Add-plan modal with ajv error surfacing, optional plan-override select (SC-2/FE-04).
5. **Phase R5 — Persistence & calibration:** disk-persisted runs (SC-11), target log + auto-scoring calibration table (MF-6).
6. **Phase R6 — Hardening & polish:** fetch timeouts, run cap, deploy auth note, Wilder RSI, probability mapping, staleness business-hours, a11y/contrast/export/logbox polish, engines field, repo-local launch.json, vitest suite.

## Verification checklist for the follow-up work

- `NODE_ENV=production npm install && npm run build && npm run start` succeeds from a clean clone (proves HOST-1/6).
- `.env` with only FRED_API_KEY set → macro overlay appears in a gold report with no shell exports.
- Every registry COT code returns ≥1 Socrata row (scripted check in CI/startup).
- Robusta either runs with real data or is visibly marked unavailable pre-Run.
- Changing `span.from` changes the computed technicals/report; a past span is rejected with a message.
- A plan JSON added through the UI immediately resolves for its commodity; malformed JSON shows ajv errors in the modal.
- Gold report: real-yield correlation number present (or RED FLAG), GVZ IV vs realized line present, catalyst days visibly applied in the MC log line.
- Kill the server mid-run → UI shows an error state, not eternal "Running…"; restart server → previously finished reports still load.
- Fan chart shows no fill below the p5 edge; log doesn't yank the page when scrolled up.

---
*Review provenance: 5/6 review agents completed (spec-compliance, engine-correctness, frontend-ui, methodology-fidelity, host-deploy); resilience-runtime reviewer and all 6 verifier agents were lost to the account's monthly spend limit mid-workflow. All P0/P1 findings above were either spot-verified directly against the code/live APIs in the main session or independently converged on by 2–4 lenses. Full raw findings: session task output `wdnxc7b1o`.*
