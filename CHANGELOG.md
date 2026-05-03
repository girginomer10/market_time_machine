# Changelog

All notable changes to Market Time Machine will be tracked here.

The project currently follows a lightweight changelog while it is in open source alpha.

## Unreleased

- Added working limit-order edit and cancellation controls, with cancelled/rejected/expired order status badges in trade history.
- Added stop-loss and take-profit pending orders with replay-time trigger processing.
- Extended working-order edits to stop-loss and take-profit trigger prices.
- Added All/Working/Closed filters to the trade history table.

## 0.1.0 - Open Source Alpha

- Built the local-first React/Vite replay app.
- Added replay controls, event timeline, trade ticket, portfolio view, decision journal, trade history, and post-game report.
- Added broker presets, market orders, limit orders, spread/fee/slippage modeling, short-position support, and margin helpers.
- Added analytics for returns, drawdown, volatility, Sharpe/Sortino, trade outcomes, exposure, and behavioral flags.
- Added scenario validation for timestamps, symbol consistency, candle structure, event publication times, and obvious hindsight phrasing.
- Added sample scenarios for BTC 2020-2021, S&P 500 COVID crash, Nasdaq 2022 rate shock, and the 2023 regional banking crisis.
- Added a local FRED SP500 importer that keeps generated restricted data out of git.
- Added open source project documentation, contribution guidelines, CI, and GitHub issue/PR templates.
