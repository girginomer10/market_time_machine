# Market Time Machine

[![CI](https://github.com/girginomer10/market_time_machine/actions/workflows/ci.yml/badge.svg)](https://github.com/girginomer10/market_time_machine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-Local%20Lab%20v1-2E8B57.svg)](#project-status)

Market Time Machine is an open source financial history lab for replaying past markets without seeing the future.

The app lets you choose and brief a historical market period, see only the
prices and events that were knowable at that replay time, make simulated trades
with a structured thesis and risk plan, and review planned-versus-actual
decisions afterward. Completed reports and repeat-run comparisons stay on the
device and can be exported, printed, or shared by the user.

> Can you trade a famous market regime before knowing how history turns out?

## Project Status

Market Time Machine Local Lab v1 is the complete local-first product scope: an
installable historical replay lab with offline use, local progress, session
backup/restore, user scenario-package import, and no required account or cloud
service. It is not a broker, investment product, or production trading system.

Good fits today:

- Replay curated historical regimes locally
- Practice timing, sizing, and journaling
- Review chronological decisions and compare repeat attempts
- Import validated scenario packages and keep progress locally
- Inspect the information-firewall architecture
- Contribute new scenario packages
- Extend broker simulation, analytics, and reporting

Hosted-platform boundaries:

- Real-money trading
- Hosted anti-cheat challenge mode
- Institutional-grade market data
- Server-side accounts, leaderboards, or cohorts

## Quick Start

Prerequisites:

- Node.js 22.12 or newer
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
npm run check            # Run the complete release verification gate
npm run check:pwa        # Validate service-worker syntax, manifest, and icons
npm run import:ecb-eurgbp # Rebuild the shipped ECB EUR/GBP source snapshot
npm run import:fred-sp500 # Generate a local FRED SP500 scenario
npm run import:ohlcv     # Generate a local scenario from licensed OHLCV CSV/JSON
```

## Install And Offline Use

Production builds are installable PWAs on supporting browsers when served over
HTTPS (or `localhost`). After one successful online load, the static app shell
and shipped scenario bundles can reopen offline. Development mode deliberately
does not register the service worker.

The GitHub Pages deployment workflow is manual-only and does not change
repository settings automatically. See [Release And Deployment](docs/release-and-deployment.md)
for local production checks, install behavior, and the maintainer-run deployment
process. Local Lab v1 includes a rights-reviewed, source-observed EUR/GBP
onboarding scenario. Hosted accounts, server-enforced competition, and managed
data services remain outside this release scope.

## Included Scenarios

The repo ships one source-observed onboarding scenario plus synthetic sample
scenarios that demonstrate the broader product loop and schema. Data fidelity
and provenance are shown in-app for each lab.

| Scenario | Symbol | Theme | Data note |
| --- | --- | --- | --- |
| Brexit Referendum: EUR/GBP 2016 | `EURGBP` | Referendum, sterling uncertainty, Bank of England response | ECB daily reference-rate observations; OHLC repeat each daily point and volume is zero |
| Bitcoin 2020-2021 | `BTCUSD` | COVID crash, halving, bull cycle | Synthetic sample prices |
| S&P 500 COVID Crash & Recovery | `SPY` | Pandemic crash, policy response, vaccine news | Synthetic sample prices |
| Nasdaq 2022 Rate Shock | `QQQ` | Inflation, Fed tightening, growth-stock repricing | Synthetic sample prices |
| Regional Banking Crisis 2023 | `KRE` | SVB, Signature, First Republic, deposit confidence | Synthetic sample prices |

The EUR/GBP source snapshot is reproducible from the official ECB Data API:

```sh
npm run import:ecb-eurgbp -- --force=true --retrieved-at=2026-07-13T00:00:00.000Z
```

Review the diff and current source terms before committing a refreshed
snapshot; the script deliberately refuses to overwrite by default.

### Optional FRED SP500 Local Import

Users can generate a local S&P 500 scenario from FRED closes:

```sh
npm run import:fred-sp500
```

This writes to `src/data/scenarios/sp500-covid-2020-fred/`, which is intentionally gitignored. FRED's `SP500` series is S&P Dow Jones Indices content, so generated files should remain local unless you have redistribution rights. See [Scenario Authoring](docs/scenario-authoring.md#local-fred-sp-500-import).

Local licensed scenarios are available in the development server but are excluded from normal production bundles, even when their ignored source files exist in the workspace.

FRED closes are source observations, but the importer derives open/high/low and
sets volume to zero. Generated packages are therefore labeled **Sample data**
so the UI does not present the derived OHLC candles as fully source-observed.

The importer will not overwrite an existing generated scenario unless you pass
`--force=true`. Custom date ranges receive a generic date-range identity and
only retain events inside that range.

### Optional Licensed OHLCV Local Import

Users with their own redistribution-safe or local-use licensed OHLCV data can generate a local scenario:

```sh
npm run import:ohlcv -- --input=local-data/spy.csv --symbol=SPY --title="SPY Local Replay" --license="Licensed local use only"
```

This writes to `src/data/scenarios/local-spy/`, which is gitignored by default. CSV/JSON rows should include `date` or `openTime`/`closeTime`, plus `open`, `high`, `low`, `close`, and optional `volume`.
The importer validates prices, duplicates, timestamps, and output paths before
an atomic write. It does not invent an exchange calendar; generated scenarios
leave market-hours enforcement off until you add a verified calendar.

The browser exposes separate controls for restoring a session export and
importing a complete Market Time Machine scenario package. Neither accepts raw
OHLCV. User-owned JSON OHLCV is imported through the CLI above as an array of
row objects. See [Privacy And Local Data](docs/privacy-and-local-data.md#three-different-json-paths)
for an exact JSON example, storage boundaries, and deletion instructions.

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
- [Release and Deployment](docs/release-and-deployment.md)
- [Privacy and Local Data](docs/privacy-and-local-data.md)
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

The EUR/GBP onboarding package attributes the ECB reference-rate series and
states which OHLCV fields are derived. The ECB's [website reuse conditions](https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html)
require accurate reproduction, ECB attribution, and disclosure of
modifications; they also add notice requirements if ECB information is sold.
Review the current source terms for every release and do not treat this summary
as legal advice.

## Disclaimer

Market Time Machine is for education, research, and historical simulation. It is not investment advice, a broker, an exchange, a recommendation engine, or a guarantee of trading performance. Sample or derived prices are not executable market quotes. Sessions, completed-run history, imported scenarios, and journal notes are stored locally in the browser; review [Privacy and Local Data](docs/privacy-and-local-data.md) before using a shared device or exporting a session.
