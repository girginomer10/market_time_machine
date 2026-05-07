# Changelog

All notable changes to Market Time Machine will be tracked here.

The project currently follows a lightweight changelog while it is in open source alpha.

## Unreleased

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
