# Changelog

All notable changes to Market Time Machine will be tracked here.

The project follows a lightweight changelog for the local-first product.

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
