# Market Time Machine

[![CI](https://github.com/girginomer10/market_time_machine/actions/workflows/ci.yml/badge.svg)](https://github.com/girginomer10/market_time_machine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-V2%20Shipped-2E8B57.svg)](#v2-personal-decision-gym)

Market Time Machine is an open source financial history lab for replaying past markets without seeing the future.

The app lets you choose and brief a historical market period, see only the
prices and events that were knowable at that replay time, make simulated trades
with a structured thesis and risk plan, and review planned-versus-actual
decisions afterward. Completed reports and repeat-run comparisons stay on the
device and can be exported, printed, or shared by the user.

> Can you trade a famous market regime before knowing how history turns out?

## Project Status

Market Time Machine V2 is the shipped local-first product: an installable
historical replay lab plus a deliberate-practice layer, with offline use, local
progress, versioned practice evidence, session and practice-archive
portability, user scenario-package import, and no required account or cloud
service. Local Lab v1 remains its replay, simulation, and reporting foundation.
It is not a broker, investment product, or production trading system.

Good fits today:

- Replay curated historical regimes locally
- Practice timing, sizing, and journaling
- Complete versioned Event Discipline drills at visible market-event checkpoints
- Review chronological decisions and compare repeat attempts
- Inspect competency-scoped evidence confidence, comparable-run trends, and tracks
- Import validated scenario packages and keep progress locally
- Inspect the information-firewall architecture
- Contribute new scenario packages
- Extend broker simulation, analytics, and reporting

Hosted-platform boundaries:

- Real-money trading
- Hosted anti-cheat challenge mode
- Institutional-grade market data
- Server-side accounts, leaderboards, or cohorts

## V2: Personal Decision Gym

V2 turns one-off replays into a local deliberate-practice loop. The Practice
Coach prepares one assessment-backed next exercise—completion retry, measured
component focus, cross-regime transfer, or comparable rerun. Broader unmeasured
recommendations remain in the report. Event Discipline drills require a
complete initial plan and explicit Hold, Reduce,
Exit, or Wait responses when high-importance events become visible. The drill
also asks which visible events actually influenced each response; checkpoint
membership is never automatic linkage credit. The rubric scores observable plan coverage, checkpoint coverage, visible-event
linkage, and rule adherence; missing evidence remains unassessed and profit is
not treated as a durable skill rating.

The shipped evidence layer includes:

- a compact local ledger of up to 250 factual or drill-assessed attempts, without
  raw journal, plan, checkpoint-response, or reflection text;
- versioned competency evidence claims with evidence breadth, exact
  source-scenario coverage, confidence, and same-context trend comparisons that
  also require the same rubric content, mode, and full broker configuration;
- open Decision Foundations and Event Pressure Transfer tracks backed by the two
  ECB reference-rate scenarios. Every credit-bearing unit pins the canonical
  replay-contract version, practice mode, broker mode, and full broker
  configuration fingerprint;
- a Volatility Discipline preview using synthetic QQQ and KRE paths. These units
  can rehearse the drill but cannot award unit or track credit;
- a V2 practice archive containing up to 12 recent full reports plus the compact
  ledger, with strict import, non-overwriting conflict handling, and migration
  from V1 run-history exports. Full reports can contain private journal, plan,
  checkpoint-decision, and reflection text; compact ledger entries cannot.
- a surprise Blind/Local Challenge self-test that chooses an eligible lab only
  after start. It masks identity locally but is explicitly not secure anti-cheat.

Scenario packages may also carry validated, data-only drill definitions. A valid
authored drill becomes runnable only with its containing scenario and cannot
replace a reserved built-in definition. Credit-bearing track references remain
separately curated; importing a runnable drill does not grant track credit.
Browser imports receive an app-derived SHA-256 identity over the complete replay
contract, including authored drills, so a reused author version label cannot
silently make changed content compatible with an older saved session.

See [V2 Product Definition](docs/v2-personal-decision-gym.md) for the exact
shipped scope, evidence boundaries, and non-goals.

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
npm run import:ecb-eurusd # Rebuild the shipped ECB EUR/USD source snapshot
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
process. V2 includes two rights-reviewed ECB reference-rate scenarios with
source-observed daily values and explicit derived-field disclosure. Hosted
accounts, server-enforced competition, and managed data services remain outside
this release scope.

## Included Scenarios

The repo ships two source-observed ECB scenarios, including the EUR/GBP
onboarding lab, plus synthetic sample scenarios that demonstrate the broader
product loop and schema. Data fidelity and provenance are shown in-app for each
lab.

| Scenario | Symbol | Theme | Data note |
| --- | --- | --- | --- |
| Brexit Referendum: EUR/GBP 2016 | `EURGBP` | Referendum, sterling uncertainty, Bank of England response | ECB daily reference-rate observations; OHLC repeat each daily point, volume is zero, and date-only observations use a derived 00:00Z-15:00Z replay window |
| COVID Liquidity Shock: EUR/USD 2020 | `EURUSD` | Pandemic news, dollar funding, Federal Reserve and ECB liquidity response | ECB daily reference-rate observations; OHLC repeat each daily point, volume is zero, and date-only observations use a derived 00:00Z-15:00Z replay window |
| Bitcoin 2020-2021 | `BTCUSD` | COVID crash, halving, bull cycle | Synthetic sample prices |
| S&P 500 COVID Crash & Recovery | `SPY` | Pandemic crash, policy response, vaccine news | Synthetic sample prices |
| Nasdaq 2022 Rate Shock | `QQQ` | Inflation, Fed tightening, growth-stock repricing | Synthetic sample prices |
| Regional Banking Crisis 2023 | `KRE` | SVB, Signature, First Republic, deposit confidence | Synthetic sample prices |

The EUR/GBP source snapshot is reproducible from the official ECB Data API:

```sh
npm run import:ecb-eurgbp -- --force=true --retrieved-at=2026-07-13T00:00:00.000Z
```

Review the diff and current source terms before committing a refreshed
snapshot; the script deliberately refuses to overwrite by default. The
snapshot stores a canonical observation SHA-256 as a source sub-identity. The
shipped scenario's authoritative `dataVersion` is a separate SHA-256 of its
complete replay contract: replay-relevant metadata, instruments, derived
candles, events, indicators, benchmarks, default broker, market calendar, and
corporate actions. `dataVersion` itself and `generatedAt` are excluded, so
changing only `retrievedAt` does not change replay identity. Any other refreshed
or authored replay change must be reviewed with the full-contract version test
and its pinned constant updated.

The ECB source supplies one date and one reference value, not an intraday bar.
Both ECB labs therefore derive candle open/close times as `00:00Z` and `15:00Z`
and place the matching benchmark point at `15:00Z`. These timestamps are a
deterministic replay convention, not observed publication or execution times.

The former observation-only and retrieval-stamped ECB identities remain
accepted only as explicitly reviewed migration aliases for these built-in
scenarios. They are not wildcard matches: an unreviewed value compares only by
exact equality and cannot bridge a session, coach, evidence-comparison, or
track-credit mismatch.

The second observed ECB snapshot is reproduced with:

```sh
npm run import:ecb-eurusd -- --force=true --retrieved-at=2026-07-14T00:00:00.000Z
```

Its source manifest and field-level derivation disclosure are documented in
[`src/data/scenarios/eurusd-covid-liquidity-2020/README.md`](src/data/scenarios/eurusd-covid-liquidity-2020/README.md).

### Optional FRED SP500 Local Import

Users can generate a local S&P 500 scenario from FRED closes:

```sh
npm run import:fred-sp500
```

This writes to `src/data/scenarios/sp500-covid-2020-fred/`, which is intentionally gitignored. FRED's `SP500` series is S&P Dow Jones Indices content, so generated files should remain local unless you have redistribution rights. See [Scenario Authoring](docs/scenario-authoring.md#local-fred-sp-500-import).

Local licensed scenarios are available in the development server but are excluded from normal production bundles, even when their ignored source files exist in the workspace.

FRED closes are source observations, but the importer derives open/high/low and
sets volume to zero. Generated packages therefore disclose **Observed values
with derived fields** and list the boundary explicitly. Their version combines
the imported-content SHA-256 with the bundled event-layer version. Candle times
also use derived regular 09:30-16:00 America/New_York sessions; exchange
early-close exceptions are not modeled, so the package is not intraday-timing
evidence.

The importer will not overwrite an existing generated scenario unless you pass
`--force=true`. Custom date ranges receive a generic date-range identity and
only retain events inside that range. Its `index.ts` and `README.md` are staged
and replaced as one recoverable pair, with rollback if installation fails.

### Optional Licensed OHLCV Local Import

Users with their own redistribution-safe or local-use licensed OHLCV data can generate a local scenario:

```sh
npm run import:ohlcv -- --input=local-data/spy.csv --symbol=SPY --title="SPY Local Replay" --license="Licensed local use only"
```

This writes to `src/data/scenarios/local-spy/`, which is gitignored by default. CSV/JSON rows should include `date` or `openTime`/`closeTime`, plus `open`, `high`, `low`, `close`, and optional `volume`. Use `--tickSize=<positive number>` when the instrument needs a custom price increment; FX defaults to `0.0001` and other asset classes default to `0.01`.
The importer validates prices, duplicates, timestamps, tick size, and output
paths before staging and recoverably replacing the generated source/README pair.
It refuses output inside production-copied or bundled source roots. It does not
invent an exchange calendar; generated scenarios leave market-hours enforcement
off until you add a verified calendar.

The browser exposes separate controls for restoring a session export and
importing a complete Market Time Machine scenario package. Neither accepts raw
OHLCV. User-owned JSON OHLCV is imported through the CLI above as an array of
row objects. Current session backups pin the canonical scenario identity and
full active broker configuration; practice backups also pin the exact drill
definition. They do not embed an imported scenario package, so that package
must be imported first in another browser. See [Privacy And Local Data](docs/privacy-and-local-data.md#four-different-json-paths)
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
  -> practice engine assesses versioned drill process evidence
  -> local ledger, evidence profile, and tracks guide the next practice
```

Important source areas:

- `src/data/scenarios/` - scenario packages
- `src/domain/replay/` - information firewall and replay visibility
- `src/domain/broker/` - execution, order validation, margin
- `src/domain/portfolio/` - positions and P/L
- `src/domain/analytics/` - metrics and behavioral flags
- `src/domain/report/` - post-game report assembly
- `src/domain/practice/` - drill rules, assessments, evidence, and track credit
- `src/domain/history/` - bounded reports, compact ledger, and practice archive
- `src/data/practice/` - curated drill and track definitions
- `src/components/` - chart, controls, timeline, journal, and report UI

## Documentation

- [Product Design](docs/product-design.md)
- [V2 Product Definition](docs/v2-personal-decision-gym.md)
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

Market Time Machine is for education, research, and historical simulation. It is not investment advice, a broker, an exchange, a recommendation engine, or a guarantee of trading performance. Sample or derived prices are not executable market quotes. Local scores, evidence, and tracks are self-assessment aids, not tamper-proof certification. Sessions, completed-run history, compact practice evidence, imported scenarios, and journal notes are stored locally in the browser; review [Privacy and Local Data](docs/privacy-and-local-data.md) before using a shared device or exporting a session or practice archive.
