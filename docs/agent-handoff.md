# Agent Handoff

## 2026-05-03 15:18 - Codex

- Task: Cleaned up GitHub repository hygiene after Dependabot opened too many early alpha update branches.
- Changed: Removed `.github/dependabot.yml` so the public branch/PR list stays focused for the initial open source launch. Planned follow-up in this session: close/delete existing Dependabot PR branches and create/push `v0.1.0` tag.
- Verified: `git ls-remote --heads origin` showed only `main` plus Dependabot branches; `gh pr list` showed 7 open Dependabot PRs. Full code checks were not rerun before this config-only cleanup because the previous `npm run check` passed minutes earlier and no app code changed.
- Memory: none; no repo semantic memory directory is installed.
- Next: Re-enable dependency automation later with grouped updates once the repo has settled.

## 2026-05-03 15:14 - Codex

- Task: Polished the repository for a professional GitHub open source launch.
- Changed: Rebuilt `README.md` into a setup/use/contribution entrypoint; added `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `CHANGELOG.md`, CI workflow, Dependabot config, CODEOWNERS, issue templates, and PR template. Updated `package.json`/`package-lock.json` with MIT license, repository metadata, Node engine, keywords, and `npm run check`.
- Verified: `npm run check` passed (`npm run lint`, 199/199 tests, and production build all succeeded).
- Memory: none; no repo semantic memory directory is installed. Durable note: root license is MIT for code/docs, while scenario data/source terms remain declared per scenario metadata and restricted generated data remains gitignored/local-only.
- Next: After GitHub Actions runs on remote, confirm the README CI badge resolves green.

## 2026-05-03 15:04 - Codex

- Task: Added another sample scenario, `kre-banking-crisis-2023`, covering the U.S. regional-bank stress window around SVB, Signature, and First Republic.
- Changed: Added `src/data/scenarios/kre-banking-crisis-2023/index.ts` with deterministic synthetic KRE-proxy candles, FDIC/Fed/OCC/DFPI-sourced event timeline, indicators, benchmarks, and stressed regional-bank broker assumptions. Extended `src/data/scenarios/scenarios.test.ts` with scenario-specific checks.
- Verified: `npm run test -- scenarios` passed 20/20; `npm run test` passed 199/199 across 18 suites; `npm run lint` clean; `npm run build` succeeded.
- Memory: none; no repo semantic memory directory is installed. Durable note: this scenario keeps ETF prices synthetic while event timing/source URLs are anchored to official bank-regulator and central-bank releases.
- Next: Good next additions are `gme-2021-meme-mania` for FOMO/short-squeeze behavior or `gold-2020-2022-inflation` for cross-asset inflation practice.

## 2026-05-03 14:58 - Codex

- Task: Added another sample scenario, `qqq-rate-hike-2022`, covering the Nasdaq/QQQ 2022 inflation and Fed tightening regime.
- Changed: Added `src/data/scenarios/qqq-rate-hike-2022/index.ts` with deterministic synthetic QQQ-proxy candles, official-source Fed/BLS event timeline, indicators, benchmarks, and broker assumptions. Extended `src/data/scenarios/scenarios.test.ts` with scenario-specific checks.
- Verified: `npm run test` passed 195/195 across 18 suites; `npm run lint` clean; `npm run build` succeeded.
- Memory: none; no repo semantic memory directory is installed. Durable note: this scenario intentionally uses synthetic sample ETF prices while event timestamps and summaries are anchored to official Fed/BLS publication times.
- Next: Good next additions are `gme-2021-meme-mania` for FOMO/short-squeeze behavior or `gold-2020-2022-inflation` for cross-asset inflation practice.

## 2026-05-03 14:08 - Codex

- Task: Added a repo-safe FRED SP500 local import path for the COVID scenario.
- Changed: `scripts/import-fred-sp500.mjs` fetches FRED `SP500` closes and generates a gitignored local scenario at `src/data/scenarios/sp500-covid-2020-fred/`. `src/data/scenarios/index.ts` now auto-discovers scenario modules via `import.meta.glob`, so generated local scenarios appear in the switcher without editing registry code. Added `npm run import:fred-sp500`, Vite import-meta typing, gitignore rules, and scenario-authoring docs for the FRED workflow.
- Verified: `npm run import:fred-sp500` generated 253 observations; `npm run test -- scenarios` passed 12/12 before and after generation; `npm run test` passed 191/191 across 18 suites; `npm run lint` clean; `npm run build` succeeded with generated scenario included; `curl -I http://127.0.0.1:5173/` returned HTTP 200.
- Memory: none; no repo semantic memory directory is installed. Durable note: FRED `SP500` output must remain local/gitignored because FRED exposes S&P DJI copyrighted data; the generated scenario uses source closes only, derives OHLC from adjacent closes, and sets volume to 0.
- Next: If a licensed OHLCV source is added later, replace this close-only local importer with a source-true package or keep both as distinct scenario variants.

## 2026-05-03 13:22 - Codex

- Task: Researched and added a second sample scenario, `sp500-covid-2020`, for the S&P 500/SPY COVID crash and recovery training flow.
- Changed: Added `src/data/scenarios/sp500-covid-2020/index.ts` with deterministic synthetic SPY-proxy candles, official-source event timeline, indicators, benchmarks, and broker assumptions. Registered it in `src/data/scenarios/index.ts` and added scenario coverage in `src/data/scenarios/scenarios.test.ts`.
- Verified: `npm run test -- scenarios` passed 12/12; `npm run test` passed 191/191 across 18 suites; `npm run lint` clean; `npm run build` succeeded; `curl -I http://127.0.0.1:5173/` returned HTTP 200.
- Memory: none; no repo semantic memory directory is installed. Durable note: raw S&P DJI/ETF price data was intentionally not redistributed; this scenario uses clearly labeled synthetic sample prices plus official event source URLs.
- Next: Replace sample prices with a properly licensed market-data pipeline when available, and consider adding scenario README/source notes once external package layout exists.

## 2026-05-03 12:57 - Codex

- Task: Fixed four review findings from the UI/UX port.
- Changed: `src/store/sessionStore.ts` now processes pending limit orders before `finish` builds the final report. `TradeHistory` maps fills back to their source orders so filled limits render as limit fills. `ReplayChart` now uses a shared event-overlay helper that only renders chart markers inside the same last-90-candle window as the visible chart. `TradePanel` uses the broker's one-way half-spread estimate. Added regression tests in `src/store/sessionStore.test.ts`, `src/components/chart/ReplayChart.test.ts`, `src/components/trade/TradePanel.test.ts`, and strengthened `TradeHistory.test.tsx`.
- Verified: `npm run test` passed 187/187 tests across 18 suites, `npm run lint` clean, `npm run build` succeeded, `git diff --check` clean, `curl -I http://127.0.0.1:5173/` returned HTTP 200, and in-app browser QA confirmed pending limit + skip-to-end fills and history shows the filled limit order.
- Memory: none; no repo semantic memory directory is installed. Durable fix details are in this handoff entry.
- Next: Add cancel/modify pending orders and a visual screenshot QA pass when the browser screenshot path is healthy.

## 2026-05-03 12:40 - Codex

- Task: Implemented the `finance time machine-2` UI/UX port plan on the existing React/Vite app without replacing replay, broker, portfolio, order, journal, or report domain logic.
- Changed: `src/app/App.tsx` rebuilt the three-zone header, scenario switcher, replay/firewall metadata, derived portfolio/date/day display, and shared chart/timeline event hover state. `src/styles/global.css` now defines the obsidian/amber IBM Plex visual system, responsive dashboard layout, chart overlays, trade ticket, timeline, history, journal, and report styling. `ReplayChart`, `EventTimeline`, `TradePanel`, `TradeHistory`, and `PostGameReport` were redesigned around visible-only data, broker-model clarity, pending/fill state, and the newer narrative report structure. Added focused UI tests for visible event rendering, pending order history, and neutral zero report values.
- Verified: `npm run test` passed 184/184 tests across 15 suites, `npm run lint` clean, `npm run build` succeeded, `git diff --check` clean, `curl -I http://127.0.0.1:5173/` returned HTTP 200. Browser smoke via the in-app browser covered play/pause/step, market buy, pending limit order, limit fill, finish report, and reset to clean start; screenshot capture timed out in the browser tool, so verification used DOM and interaction state.
- Memory: none; no repo semantic memory directory is installed. Durable implementation note is in this handoff entry.
- Next: Add true visual screenshot QA when the browser screenshot path is healthy, then polish mobile breakpoint screenshots, cancel/modify pending orders, and richer scenario packs.

## 2026-05-02 23:38 - Codex

- Task: Continued quality/product pass by adding broker model selection and first pending order workflow.
- Changed: `src/store/sessionStore.ts` now owns active broker config/mode, locks broker selection after first fill, uses selected broker for quotes/execution, and processes triggered pending limit orders during replay advancement. `src/components/trade/TradePanel.tsx` adds Scenario/Ideal/Realistic/Harsh broker controls plus Market/Limit order entry. `src/components/journal/TradeHistory.tsx` shows pending limit orders. `src/domain/broker/simulator.ts` adds limit order placement, trigger detection, and limit fills. `src/domain/replay/engine.ts` accepts active broker spread for tradable prices. Added focused simulator/replay tests and supporting CSS.
- Verified: `npm run test` passed 181/181 tests, `npm run lint` completed cleanly, `npm run build` succeeded, and `curl -I http://127.0.0.1:5173/` returned HTTP 200.
- Memory: active broker config must live in session state, not only in scenario data, so quote spread and execution assumptions remain consistent after preset changes.
- Next: Add cancel/modify pending order controls, stop-loss/take-profit/bracket orders, margin liquidation on replay ticks, and manual browser smoke test.

## 2026-05-02 23:33 - Codex

- Task: Quality pass after alpha vertical slice; integrated previously isolated broker/report modules and tightened first-run polish.
- Changed: `src/domain/broker/simulator.ts` now delegates fill pricing/commission/order validation to broker support modules; `src/domain/broker/orderValidation.ts` validates execution-price buying power and short-opening margin; `src/domain/portfolio/portfolio.ts` now handles short positions and covers; `src/types/reporting.ts`, `src/domain/analytics/behavior.ts`, `src/domain/report/report.ts`, and `src/components/report/PostGameReport.tsx` now expose/render behavioral flags; `src/styles/global.css` removes decorative radial background and adds behavioral signal styling. Added simulator/portfolio tests.
- Verified: `npm run test` passed 177/177 tests, `npm run lint` completed cleanly, and `npm run build` succeeded.
- Memory: resolved prior handoff TODOs for broker helper integration, `BehavioralFlag` report typing, and behavioral flag report rendering.
- Next: Wire actual broker preset selection into UI, add limit/stop orders, add real licensed data/loader, and run a manual browser click-through.

## 2026-05-02 23:24 - Codex

- Task: Final integration verification after one main Claude build agent plus three parallel Claude side agents.
- Changed: No code changes in this entry; verified the integrated app and started the local dev server.
- Verified: `npm run test` passed 174/174 tests, `npm run build` succeeded, `npm run lint` completed cleanly, and `curl -I http://127.0.0.1:5173/` returned HTTP 200.
- Memory: none; no new durable implementation lesson beyond the entries below.
- Next: Click through the browser flow manually, then wire broker presets/behavioral flags into the UI and replace synthetic BTC data with licensed historical data.

## 2026-05-02 23:23 - Claude (vertical-slice integration)

- Task: Stand up the first working vertical slice of Market Time Machine on top of the existing product docs (Vite + React + TS app, lightweight-charts, Zustand, scenario loading, replay engine, broker, portfolio, report, full UI).
- Stack: Vite 5 + React 18 + TypeScript 5, Zustand for session state, lightweight-charts for the candle/volume view, Vitest + Testing Library for tests, ESLint flat config for lint.
- Files touched (created in this slice; some were extended in parallel by other agents):
  - Project scaffolding: `package.json`, `tsconfig*.json`, `vite.config.ts`, `eslint.config.js`, `index.html`, `.gitignore`.
  - Types: `src/types/{market,scenario,replay,trading,reporting,index}.ts`.
  - Domain: `src/domain/replay/engine.ts`, `src/domain/broker/simulator.ts`, `src/domain/portfolio/portfolio.ts`, `src/domain/report/report.ts`, `src/domain/scenario/loader.ts`. Parallel agents added `src/domain/{validation,analytics}/*` and the broker support modules; the report module now delegates metric math to `analytics/*`.
  - Data: `src/data/scenarios/btc-2020-2021/index.ts`, `src/data/scenarios/index.ts`.
  - State + UI: `src/store/sessionStore.ts`, `src/app/App.tsx`, `src/main.tsx`, `src/styles/global.css`, `src/utils/format.ts`, `src/components/{chart,replay,timeline,trade,journal,report}/*`.
  - Tests + setup: `src/test/{setup,fixtures}.ts`, plus colocated `*.test.ts` for replay, broker, portfolio, report.
- Information firewall in code: `src/domain/replay/engine.ts` filters candles, events, indicators, and benchmark points by the visibility rules from `docs/replay-engine.md` (`closeTime`, `publishedAt`, `availableAt`, benchmark `time` all `<= currentTime`). The Zustand store's `selectSnapshot` only ever exposes the visible slice; full-scenario access is reachable only through `buildReport` after `status === "finished"`.
- Demo scenario: `btc-2020-2021` is a deterministic synthetic dataset (mulberry32 RNG, 15 anchor prices shaped to the public BTC 2020-2021 macro path). Clearly tagged `isSampleData: true` and surfaced as a "Sample data" pill in the UI header so contributors do not mistake it for real licensed data. License: `CC-BY-4.0 (sample data)`.
- UI vertical slice: scenario header (title/subtitle, granularity, difficulty, sample-data badge, status pill, replay clock), candlestick chart with volume histogram, Play / Pause / Step / 1x–60x speed control, "Skip to end" + Reset, event timeline that respects `publishedAt`, trade panel with cash / position / total value / total return / realized + unrealized P/L / live spread quote / quantity input / decision-note textarea / Buy / Sell, trade history with attached notes, decision journal, and a post-game report modal with total return, benchmark return, excess return, drawdown, vol, Sharpe/Sortino, fees+spread, slippage, exposure time, best/worst closed trade.
- Verification commands run from repo root:
  - `npm install --no-fund --no-audit` — clean install.
  - `npx tsc -b` — clean type-check, no errors.
  - `npx vitest run` — **174/174 tests across 12 suites passing** (replay visibility, broker spread/commission/rejection, FIFO portfolio, equity-curve + drawdown, behavioral detectors, scenario validation, analytics, BTC scenario sanity).
  - `npx vite build` — production bundle 351 KB JS / 8.4 KB CSS, gzip 111 KB.
  - `npx eslint .` — clean, no warnings.
  - `npx vite --port 5173 --host 127.0.0.1` then `curl http://127.0.0.1:5173/` returned HTTP 200; Vite served `main.tsx`, `App.tsx`, and the store via on-the-fly transform without errors.
- Open risks / next steps:
  1. Ship a real licensed BTC dataset and a JSONL/CSV scenario loader so the lab is not dependent on the synthetic anchor data.
  2. Add a scenario picker UI — the registry already supports multiple scenarios but the shell currently locks to the default.
  3. Surface the analytics module's `behavioralFlags` and an equity-curve mini-chart inside the report modal — both are already computed.
  4. Layer in limit/stop orders and the `ideal` / `realistic` / `harsh` broker presets — execution models, margin, and order-validation modules are already in `src/domain/broker/`.
  5. Wire `assertScenarioValid` from `src/domain/validation/scenario.ts` into a CI step so contributed packages cannot ship with hindsight phrasing or missing `publishedAt` fields.
  6. Browser smoke test — the dev server compiles and serves modules cleanly, but a human should still click through play/pause/buy/sell/finish on a real browser before tagging this slice as "demo-able".

## 2026-05-02 23:22 - Claude (scenario package foundation)

- Task: Strong open-source scenario package foundation per `docs/data-and-scenarios.md` — schema-driven validation utilities, deterministic BTC 2020-2021 demo package, focused tests, contributor docs.
- Changed:
  - `src/domain/validation/scenario.ts` — `ValidationIssue`, `ValidationResult`, and a `validateScenarioPackage` that returns structured errors/warnings (`code` + `path` + `message`). Sub-validators: `validateScenarioMeta`, `validateInstruments`, `validateCandles`, `validateEvents`, `validateBenchmarks`, `validateIndicators`, `validateBroker`. Helpers: `isIsoTimestamp` (regex + `Date.parse`) and `findHindsightPatterns` (8 conservative regex patterns, deliberately precision-biased per advisor guidance).
  - Validation rules cover: ISO 8601 timestamps everywhere; sorted/non-overlapping candles; OHLC bracketing (`high >= max(open,close,low)`); non-negative volume; granularity-gap warnings; candle/event symbol consistency with declared `instruments`; every event has `publishedAt`; `publishedAt` precedes `happenedAt` warning; hindsight phrasing warning on title+summary; events outside scenario range warning; broker license/leverage/spread/commission sanity; slippage-model parameter check; scenario range/license/data-source presence.
  - `src/domain/scenario/loader.ts` — sort is now stable per-symbol; the existing `validateScenario` delegates to the validation module so there is one source of truth. Added `validateScenarioStrict` (full result) and `assertScenarioValid` (throws on errors) for downstream wiring.
  - `src/data/scenarios/btc-2020-2021/index.ts` — split El Salvador into the law-passage event (`evt-2021-06-09-elsalvador-law`, signed) and the in-force event (`evt-2021-09-07-elsalvador`, takes effect) so the schema's `happenedAt`-vs-`publishedAt` distinction is demonstrated with an honest knowable delay rather than fabricated deltas.
  - `src/domain/validation/scenario.test.ts` — 29 unit tests covering ISO parsing, hindsight detection precision/recall, and every error/warning code surfaced by `validateScenarioPackage`.
  - `src/data/scenarios/scenarios.test.ts` — 8 tests asserting every shipped scenario in the registry passes validation with zero errors and the BTC demo has the expected metadata, candle count, event types, benchmarks, broker.
  - `docs/scenario-authoring.md` — contributor guide with quick start, validation checklist, hindsight examples, `happenedAt`-vs-`publishedAt` table, `meta.isSampleData` guidance.
- Verified: `npx vitest run` → 173/173 passing across all 12 suites; `npx tsc --noEmit -p tsconfig.app.json` clean.
- Outside ownership left untouched: `simulator.ts`, app shell, chart UI, report UI, `package.json`, `package-lock.json`. `src/test/setup.ts` and `src/test/fixtures.ts` arrived from another agent mid-session — reused them rather than overwriting.
- Next: register more open-source scenarios (March 2020 SPY crash, 2008 GFC, May 2010 flash crash); wire `assertScenarioValid` into a CI step so a malformed contribution fails fast; consider a structured "post-game reflection" field separate from `summary` so legitimate after-the-fact context never lives where the hindsight detector runs.

## 2026-05-02 23:18 - Claude (broker support modules)

- Task: Implemented professional broker simulation support modules (presets, fill pricing, order validation, margin) per `docs/broker-simulation.md`.
- Changed:
  - `src/domain/broker/executionModels.ts` — `IDEAL_BROKER_CONFIG`, `REALISTIC_BROKER_CONFIG`, `HARSH_BROKER_CONFIG`, `BROKER_PRESETS`, `getBrokerPreset`, `isBrokerPresetName`, `marketFillPrice` (supports `none`/`fixed_bps`/`volume_based`/`volatility_based` slippage models with optional `quantity`/`candleVolumeNotional`/`volatility` context), `slippageBpsFor`, `commissionFor`. Half-spread per side matches `simulator.ts` convention.
  - `src/domain/broker/orderValidation.ts` — `REJECTION_REASONS` constant map + `RejectionReasonCode` union, structured `ValidationResult`, building blocks (`checkQuantity`, `normalizeQuantity`, `checkLotSize`, `buyingPower`, `checkBuyingPower`, `checkLongShortConstraint`, `checkLiquidity`, `checkTradability`) plus a top-level `validateMarketOrder` that short-circuits on the first failure.
  - `src/domain/broker/margin.ts` — `MarginPolicy` type, `IDEAL/REALISTIC/HARSH_MARGIN_POLICY` presets, `MARGIN_POLICY_PRESETS`, `marginPolicyFromBroker` (derives policy from `BrokerConfig`), `initialMarginRequired`, `maintenanceMarginRequired`, `accountEquity`, `marginUtilization`, `marginSnapshot` (single-call view including `isMarginCall`/`requiresLiquidation`/`excessEquity`), `borrowCostFor`, `canOpenAdditionalNotional`.
  - Tests: `executionModels.test.ts` (14), `orderValidation.test.ts` (27), `margin.test.ts` (20). All 61 new tests pass; 7 pre-existing `simulator.test.ts` tests still pass.
- Verified: `npx vitest run src/domain/broker` → 68/68 passing. `npx tsc -p tsconfig.app.json --noEmit` clean for broker modules (unrelated pre-existing errors in `report.test.ts` and `sessionStore.ts`).
- Integration notes (intentionally NOT done — `simulator.ts` is owned by another agent):
  - `simulator.ts` currently inlines a `priceWithSpreadAndSlippage` that mirrors `marketFillPrice` minus the slippage-model branches. It can be replaced by `marketFillPrice(referencePrice, side, broker, ctx)` to gain volume/volatility-aware slippage.
  - `simulator.ts` currently inlines its rejection prose. The `REJECTION_REASONS` map exposes the same strings; the simulator can switch to `rejection("...").message` for consistency without breaking callers.
  - `validateMarketOrder` can replace the procedural validation block in `simulator.executeMarketOrder` once we want a single-source-of-truth for the rejection ladder.
  - Margin is not yet wired into `executeMarketOrder` or the portfolio loop; `marginSnapshot` is ready to be called per replay tick or pre-trade for `marginCallPolicy === "reject_new_orders"` and `"liquidate_on_threshold"`.
- Outside ownership left untouched: `simulator.ts`, scenario files, app shell, chart UI, `package.json`, `package-lock.json`.
- Next: wire the new helpers into `simulator.ts` (pre-trade margin gate, slippage models, structured rejection codes); add limit/stop order types; introduce instrument tradability and market-hours wiring (`checkTradability` accepts `marketOpen` already).

## 2026-05-02 23:20 - Claude (analytics & report foundation)

- Task: Implemented the analytics/reporting foundation per `docs/analytics-and-reporting.md`. Pulled metric calculations out of the inline `report.ts` and added a behavioral-flag detector layer.
- Changed:
  - `src/domain/analytics/metrics.ts` — pure functions: `totalReturn`, `benchmarkReturn`, `excessReturn`, `simpleReturns`, `mean`, `stdDev`, `volatility`, `annualizedVolatility`, `maxDrawdown`, `sharpeRatio`, `sortinoRatio`, `calmarRatio`, `periodsPerYearForGranularity`. Annualization is parametric (no hardcoded `sqrt(365)`); `periodsPerYearForGranularity` maps the scenario's granularity.
  - `src/domain/analytics/trades.ts` — pure functions: `realizeTrades` (FIFO matching with per-unit commission proration; replaces the buggy proration in the old inline `computeTradeOutcomes`), `tradeOutcomes`, `bestTrade`/`worstTrade` (sign-aware), `winRate`, `profitFactor`, `averageWin`/`averageLoss`, `feesTotal`, `slippageTotal`, `turnover`, `exposureTime` (counts a candle as exposed if held entering OR exiting it).
  - `src/domain/analytics/behavior.ts` — `BehavioralFlag` type + `BehavioralFlagType` union; detectors `detectPanicSell`, `detectFomoBuy`, `detectEarlyProfitTake`, `detectOvertrading`, and an aggregator `detectAllBehavioralFlags`. Each detector takes explicit candle slices and parameters — no global session access — so future-data exposure is a caller decision (only the finished-session report passes the full-session candles in). Tunable thresholds via `defaultDetectorParams`; severity mapped from magnitude.
  - `src/domain/analytics/index.ts` — barrel export.
  - `src/domain/report/report.ts` — refactored `buildReport` to delegate every metric to `analytics/*`, derive `periodsPerYear` from `scenario.meta.defaultGranularity`, and emit a `behavioralFlags: BehavioralFlag[]` field on the returned payload. Public surface (`buildReport({ scenario, fills, initialCash })`, `buildEquityCurve`) is preserved for `sessionStore.ts`. Return type is now `FinishedSessionReport = ReportPayload & { behavioralFlags }`. The previous inline `maxDrawdown`/`stdDev`/`computeReturns`/`computeTradeOutcomes`/`computeExposureTime` functions are removed.
  - Tests: `src/domain/analytics/metrics.test.ts` (24), `trades.test.ts` (14), `behavior.test.ts` (14). 52/52 pass.
- Verified: `npx vitest run src/domain/analytics` → 52/52. `npx vitest run` → 171/173 (the two failing tests are in `src/domain/validation/scenario.test.ts`, owned by another agent and unrelated to this work). `npx tsc -b` clean. The pre-existing `src/domain/report/report.test.ts` (4 tests) imports `maxDrawdown` from `analytics/metrics` and uses `buildReport` — both still pass against the refactored module.
- Decisions worth flagging:
  - I did not extend `src/types/reporting.ts` to add `BehavioralFlag`. That file is shared and a parallel agent may still be editing it. The type lives in `analytics/behavior.ts` and is re-exported via `analytics/index.ts`. If/when stable, lift it into `types/reporting.ts` and add the `behavioralFlags` field to `ReportPayload` itself.
  - `exposureTime` semantics: a candle counts as "exposed" if the position is held *entering or exiting* it. The previous implementation under-counted candles where the user opened and closed within the same period.
  - `realizeTrades` uses per-unit commission proration (not the old proration formula, which compounded a partially-mutated `lot.commission` against the post-mutation quantity — buggy). Realized P/L now subtracts `commissionPerUnit * used` cleanly.
- Outside ownership left untouched: `package.json`, `package-lock.json`, app shell, chart UI, scenario package files, broker simulator, shared `src/types/*`, `src/test/*`.
- Next: lift `BehavioralFlag` into `types/reporting.ts`; add lesson-generation that summarizes the flag set in plain English; surface behavioral flags in the post-session UI; wire scoring (35/25/20/10/10 weighting from the docs) on top of these metrics.
