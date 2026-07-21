# Changelog

All notable changes to Market Time Machine will be tracked here.

The project follows a lightweight changelog for the local-first product.

## 0.3.0 - Personal Decision Gym v2 - 2026-07-16

- Defined V2 as a local deliberate-practice product that connects replay
  evidence to one focused next exercise without accounts, telemetry, or AI
  grading.
- Shipped the Local Practice Coach with a versioned drill baseline, deterministic
  incomplete-attempt/weakest-component/transfer/comparable-repeat assignments,
  supported current/target measures, rubric version, and three evidence-based
  Practice orientation milestones kept separate from track credit.
- Kept generic outcome/report recommendations in the report so the coach never
  relabels an unmeasured behavior as Event Discipline evidence.
- Connected finished reports back to the next-practice loop and made coach CTAs
  prepare the existing scenario briefing rather than silently starting or
  replacing a replay.
- Shipped versioned Event Discipline drills for the EUR/GBP and EUR/USD ECB
  scenarios and synthetic QQQ/KRE rehearsal scenarios. Drills require an initial
  plan plus at least one executed position for completion, stop at mapped
  high-importance event checkpoints, capture Hold/Reduce/Exit/Wait decisions,
  and use a process-only rubric.
- Added the reproducible ECB EUR/USD COVID Liquidity scenario and importer as the
  second source-observed daily reference-rate lab, with explicit mixed-fidelity
  disclosure for derived OHLC fields and zero volume.
- Added a compact local practice ledger with stable replay identities, factual
  legacy entries, versioned drill assessments, a 250-entry cap, and no copied raw
  journal, plan, checkpoint-response, or reflection text.
- Added a versioned evidence profile that groups compatible drill definitions by
  stable competency and rubric identity while retaining their exact definition
  identities, evidence counts, source-scenario coverage, and confidence labels.
  Trends compare only runs sharing the same scenario version, mode, broker mode
  and full configuration, drill, definition, and rubric content.
- Added curated Decision Foundations and Event Pressure Transfer tracks. Track
  credit requires every criterion in one attempt with the exact replay, drill,
  rubric, mode, and full broker identity; synthetic QQQ and KRE Volatility
  Discipline units remain explicitly preview-only and cannot award credit.
- Replaced run-history-only export with the V2 practice archive: up to 12 recent
  full reports plus 250 compact entries, deep render-safe validation, one
  canonical atomic storage envelope with rollback, deterministic non-overwriting
  conflict handling, and migration from V1 history exports as factual unassessed
  evidence.
- Added scenario-package drill-definition authoring, validation, and
  scenario-scoped runtime discovery. Valid imported definitions are runnable
  with their containing scenario, cannot replace reserved built-ins, and do not
  enter the separately curated credit-bearing track catalog.
- Pinned active practice-session backups to the exact scenario data version,
  competency, definition, rubric, normalized drill snapshot, and full broker
  configuration; restore rejects drift and requires imported scenario packages
  to be installed separately.
- Added keyboard radiogroup navigation and improved muted-text contrast in the
  scenario library.
- Hardened the V2 release contract with explicit learner-selected checkpoint
  event links, legacy automatic-link non-credit, complete rubric-content
  fingerprints, authored-drill primary-symbol enforcement, version-safe legacy
  session restore, and a truthful surprise Blind/Local Challenge self-test.
- Consolidated completed reports and compact evidence into one verified
  canonical browser envelope with fail-closed migration, atomic per-run
  add/remove/clear/import behavior, and honest quota/readback rollback.
- Content-addressed ECB, FRED, and local-import replay versions; added staged
  two-file importer replacement/rollback, EUR/GBP parser parity, and explicit
  observed-versus-derived FRED disclosure.
- Hardened importer provenance and release packaging with exact ECB series-key
  validation, documented camelCase CSV timestamps, version-bound configurable
  tick sizes, protected output roots, and extension-independent text-asset scans.
- Added authoritative checkpoint-schedule fingerprints across assessments,
  evidence, coaching, tracks, archives, and exact archived-drill replay; partial
  or self-declared schedules cannot earn completion credit or appear as a
  measured history/report/coach score. Competency claims still combine
  compatible cross-regime drills by competency and rubric identity; schedules
  remain an admission and exact-trend boundary rather than fragmenting claims.
- Made report-save failure recovery non-lossy, destructive archive operations
  non-cancelable after commit, session restore explicitly replace active work,
  browser-save deletion report its verified result, and history actions wait for
  pending archive writes.
- Required versioned, non-replacing user scenario packages, then normalized
  browser imports to an app-derived full-contract SHA-256 that includes authored
  drills; duplicate stored ids fail closed without bricking startup.
- Made initial plans/checkpoint responses/violations replacement-protected,
  rechecked progress after asynchronous restore reads, added explicit fresh
  unassessed fallback for drifted archived drills, and surfaced browser-save
  read/write/delete/recovery health globally.
- Hardened local imports against host-timezone drift, stale-lock takeover races,
  arbitrary transaction-directory deletion, impossible/non-ISO timestamps, and
  interrupted or power-loss-exposed paired writes with guarded recovery and
  flushed files/manifests/directories.
- Clarified that deep validation of user-editable local archives establishes
  bounded internal consistency, not cryptographic authorship, anti-cheat, or
  real-world skill certification.
- Corrected the March 15, 2020 Fed event visibility to `21:00Z`, versioned that
  replay change fail-closed, and disclosed the ECB date-only `00:00Z`-`15:00Z`
  replay-window derivation in metadata and source documentation.

## 0.2.0 - Local Lab v1 - 2026-07-13

- Completed the first-run product journey with a scenario library, product
  boundaries, scenario briefing, explicit mode selection, safe continue/start,
  and local session tools.
- Added the ECB-sourced EUR/GBP Brexit onboarding lab with reproducible import,
  official-event sources, reuse attribution, and observed/derived field labels.
- Added structured trade decisions (thesis, invalidation, exit plan, accepted
  risk, and visible-event links) plus chronological planned-versus-actual review.
- Added bounded completed-run history, same-scenario comparisons, report replay,
  history export/removal, and user-scenario import/removal.
- Added native-share/clipboard summaries, JSON report export, Print / Save PDF,
  major-event auto-pause, and tick-size-aware FX pricing.
- Added installable/offline PWA packaging, manual GitHub Pages deployment,
  privacy/safety documentation, and a Node 22 CI release gate.
- Upgraded the Vite/Vitest build and test toolchain and refreshed transitive
  dependencies so the complete dependency audit is clean.

- Reworked replay advancement around a single multi-symbol timeline so every instrument, event, financing charge, corporate action, order trigger, and report snapshot is processed at the correct market instant.
- Completed broker and portfolio lifecycle handling for partial fills, zero-liquidity deferral, gap-aware stops and targets, DAY/GTC expiry, bracket/OCO orders, margin calls, forced liquidation, borrow costs, dividends, and splits.
- Added validated session persistence plus JSON import/export, canonical restore-time recomputation, Explorer/Realistic Practice/Blind Replay/Local Challenge modes, challenge information masking, and safe reset/scenario-change confirmation flows.
- Expanded post-game analytics with exact trade reconstruction, attribution, execution diagnostics, behavioral checks, evidence-aware decision scoring, journal quality, decision consistency, recommendations, and data provenance.
- Hardened scenario validation and both local-data importers against non-finite or overflowing values, incomplete output, and mislabeled data; production builds now include only the explicit redistributable scenario allowlist and verify that local licensed data cannot leak into bundles.
- Added responsive and accessible report, journal, audit, replay, and trade controls together with focused regression coverage across the application, store, replay engine, broker, analytics, validation, and import pipeline.
- Added working limit-order edit and cancellation controls, with cancelled/rejected/expired order status badges in trade history.
- Added stop-loss and take-profit pending orders with replay-time trigger processing.
- Extended working-order edits to stop-loss and take-profit trigger prices.
- Added All/Working/Closed filters to the trade history table.
- Added bracket/OCO exits so paired stop-loss and take-profit orders cancel the sibling leg after one fills.
- Surfaced OCO group labels in trade history so bracket legs and source fills stay easy to match.
- Added the first professional-emulation pass: volume-limited partial fills, gap-aware stop/target execution, time-in-force expiry, replay audit events, margin snapshots, borrow costs, forced liquidation fills, chart/order markers, risk panel, and execution-quality reporting.
- Added a local licensed OHLCV importer that generates gitignored `local-*` scenario packages with source-manifest metadata.
- Added a visible replay audit panel so order, fill, risk, and system events can be reviewed during a session.
- Completed BTC 2020-2021 event source attribution and surfaced scenario event-source coverage plus source links in the event timeline.

## 0.1.0 - Open Source Alpha

- Built the local-first React/Vite replay app.
- Added replay controls, event timeline, trade ticket, portfolio view, decision journal, trade history, and post-game report.
- Added broker presets, market orders, limit orders, spread/fee/slippage modeling, short-position support, and margin helpers.
- Added analytics for returns, drawdown, volatility, Sharpe/Sortino, trade outcomes, exposure, and behavioral flags.
- Added scenario validation for timestamps, symbol consistency, candle structure, event publication times, and obvious hindsight phrasing.
- Added sample scenarios for BTC 2020-2021, S&P 500 COVID crash, Nasdaq 2022 rate shock, and the 2023 regional banking crisis.
- Added a local FRED SP500 importer that keeps generated restricted data out of git.
- Added open source project documentation, contribution guidelines, CI, and GitHub issue/PR templates.
