# Market Time Machine

[![CI](https://github.com/girginomer10/market_time_machine/actions/workflows/ci.yml/badge.svg)](https://github.com/girginomer10/market_time_machine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-open--source%20alpha-8A6F2A.svg)](#project-status)

Market Time Machine is an open source financial history lab for replaying past markets without seeing the future.

The app lets you enter a historical market period, see only the prices and events that were knowable at that replay time, place simulated market and limit orders, cancel working orders, write decision notes, and review your performance after the scenario ends.

> Can you trade a famous market regime before knowing how history turns out?

## Project Status

Market Time Machine is a local-first open source alpha. It is usable for demos, learning, and contribution, but it is not a broker, investment product, or production trading simulator.

Good fits today:

- Replay curated historical regimes locally
- Practice timing, sizing, and journaling
- Inspect the information-firewall architecture
- Contribute new scenario packages
- Extend broker simulation, analytics, and reporting

Not promised yet:

- Real-money trading
- Hosted anti-cheat challenge mode
- Institutional-grade market data
- Server-side accounts, leaderboards, or cohorts

## Quick Start

Prerequisites:

- Node.js 18.18 or newer
- npm

Run locally:

```sh
git clone https://github.com/girginomer10/market_time_machine.git
cd market_time_machine
npm install
npm run dev
```

Then open the local URL printed by Vite, usually:

```text
http://127.0.0.1:5173/
```

## Available Scripts

```sh
npm run dev              # Start local development server
npm run build            # Type-check and build production assets
npm run preview          # Preview the production build locally
npm run lint             # Run ESLint
npm run test             # Run Vitest test suite
npm run test:watch       # Run Vitest in watch mode
npm run import:fred-sp500 # Generate a local FRED SP500 scenario
```

## Included Scenarios

The repo ships sample scenarios designed to demonstrate the product loop and the scenario schema. Sample price paths are synthetic and clearly marked in-app.

| Scenario | Symbol | Theme | Data note |
| --- | --- | --- | --- |
| Bitcoin 2020-2021 | `BTCUSD` | COVID crash, halving, bull cycle | Synthetic sample prices |
| S&P 500 COVID Crash & Recovery | `SPY` | Pandemic crash, policy response, vaccine news | Synthetic sample prices |
| Nasdaq 2022 Rate Shock | `QQQ` | Inflation, Fed tightening, growth-stock repricing | Synthetic sample prices |
| Regional Banking Crisis 2023 | `KRE` | SVB, Signature, First Republic, deposit confidence | Synthetic sample prices |

### Optional FRED SP500 Local Import

Users can generate a local S&P 500 scenario from FRED closes:

```sh
npm run import:fred-sp500
```

This writes to `src/data/scenarios/sp500-covid-2020-fred/`, which is intentionally gitignored. FRED's `SP500` series is S&P Dow Jones Indices content, so generated files should remain local unless you have redistribution rights. See [Scenario Authoring](docs/scenario-authoring.md#local-fred-sp-500-import).

## Core Principles

- **No future leakage:** future candles, future events, future indicators, and future outcomes must stay hidden during replay.
- **Published-time realism:** an event becomes visible only after its historical publication or announcement time.
- **Broker realism:** fills, spread, fees, slippage, leverage, and margin rules are explicit.
- **Decision quality over raw profit:** reports should evaluate risk, timing, discipline, behavior, and benchmark performance.
- **Open scenario ecosystem:** contributors should be able to add historical market regimes with clear schemas and licensing.

## Architecture At A Glance

```text
Scenario package
  -> replay engine filters visible candles/events/indicators
  -> broker simulator validates and fills orders
  -> portfolio module marks visible positions to market
  -> journal captures decision notes
  -> report engine unlocks full-session analysis after finish
```

Important source areas:

- `src/data/scenarios/` - scenario packages
- `src/domain/replay/` - information firewall and replay visibility
- `src/domain/broker/` - execution, order validation, margin
- `src/domain/portfolio/` - positions and P/L
- `src/domain/analytics/` - metrics and behavioral flags
- `src/domain/report/` - post-game report assembly
- `src/components/` - chart, controls, timeline, journal, and report UI

## Documentation

- [Product Design](docs/product-design.md)
- [Architecture](docs/architecture.md)
- [Data and Scenario Standard](docs/data-and-scenarios.md)
- [Scenario Authoring](docs/scenario-authoring.md)
- [Replay Engine](docs/replay-engine.md)
- [Broker Simulation](docs/broker-simulation.md)
- [Analytics and Reporting](docs/analytics-and-reporting.md)
- [Roadmap](docs/roadmap.md)
- [Open Source Contribution Guide](docs/open-source-contribution-guide.md)

## Contributing

Contributions are welcome. Good first areas:

- Add or improve scenario packages
- Tighten event publication timestamps
- Improve broker assumptions and order types
- Expand report metrics and behavioral feedback
- Polish accessibility, responsiveness, and tests

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and [Scenario Authoring](docs/scenario-authoring.md).

## Licensing

Code and documentation are released under the [MIT License](LICENSE).

Scenario packages may declare their own data/source terms in `meta.license` and `meta.dataSources`. Do not commit proprietary or restricted market data without explicit redistribution rights.

## Disclaimer

Market Time Machine is for education, research, and historical simulation. It is not investment advice, a broker, an exchange, a recommendation engine, or a guarantee of trading performance.
