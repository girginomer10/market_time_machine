# Scenario Authoring Guide

This guide is for contributors who want to add a historical scenario package to Market Time Machine. It complements [Data and Scenario Standard](data-and-scenarios.md), which is the canonical schema reference.

## Quick Start

A scenario lives under `src/data/scenarios/<id>/index.ts` and exports a single `ScenarioPackage` produced by `assembleScenario`. The package is registered in `src/data/scenarios/index.ts`.

Minimum required parts:

- `meta`: a `ScenarioMeta` block with id, title, range, symbols, license, and data sources
- `instruments`: at least one `Instrument` matching `meta.symbols`
- `candles`: ISO-timestamped OHLCV candles, sorted by `closeTime`
- `events`: market events with both `happenedAt` and `publishedAt`
- `benchmarks`: optional, but recommended for post-game comparison
- `broker`: a `BrokerConfig` describing fills, spread, fees, slippage, leverage

`assembleScenario` will normalize sort order. It does not validate — call `validateScenarioPackage` from `src/domain/validation/scenario.ts` to check correctness.

## Validation Checklist

Before opening a pull request, confirm:

- All timestamps are ISO 8601 strings with a timezone (`...Z` or `...+HH:MM`)
- Candles are sorted by `closeTime` and do not overlap
- Every event carries both `happenedAt` and `publishedAt`
- `publishedAt` is the time the market could first know about the event, not the time the underlying thing happened
- Every curated event should carry a concise `source` label and a traceable `sourceUrl`; missing attribution is treated as a validator warning
- Event summaries are written in present-tense, knowable language — no hindsight
- `affectedSymbols` and candle symbols all appear in `instruments`
- Broker assumptions are realistic for the asset class (crypto vs. equities differ on fractional, leverage, hours)
- License and data sources are declared
- Local/professional scenarios should also declare `dataVersion`, `sourceManifest`, `generatedAt`, `priceAdjustment`, and `marketCalendarId` when those are known

The validator returns errors and warnings:

```ts
import { validateScenarioPackage } from "src/domain/validation/scenario";
const result = validateScenarioPackage(pkg);
if (!result.valid) console.error(result.errors);
```

## Avoiding Hindsight

The single most important authoring rule: an event summary must describe only what was knowable at `publishedAt`. The validator runs a conservative pattern check that flags obvious cases as warnings:

- "triggered a rally / crash / sell-off"
- "kicked off the bull run"
- "in hindsight" / "in retrospect"
- "before the crash" / "ahead of the rally"
- "would later" / "went on to"

The check is deliberately small. It catches the common mistakes; it does not replace careful editing.

| Avoid | Prefer |
| --- | --- |
| "The Fed cut rates, triggering a powerful rally." | "The Federal Reserve announced an emergency rate cut of 50 basis points." |
| "Days before the crash, sentiment was high." | "On March 11, the WHO declared COVID-19 a pandemic." |
| "This kicked off the 2021 bull run." | "MicroStrategy disclosed an initial $250M Bitcoin treasury purchase." |

## happenedAt vs. publishedAt

Use both fields whenever there is a meaningful gap.

| Event type | happenedAt | publishedAt |
| --- | --- | --- |
| Press conference | Time of conference | Time of conference |
| Law passed → law in force | Effective date | Date the law was signed/announced |
| Earnings period | End of fiscal period | Time of earnings release |
| Macro data window | Period covered | Time of release |
| On-chain event (block, halving) | Block timestamp | Block timestamp |

If the dates match, set them equal. The point is not to invent deltas; the point is to never let a future-only timestamp leak.

## Pre/Post-Range Events

Events outside the scenario range get a warning, not an error. Use this intentionally: a bit of pre-context (the year before) or post-context (the resolution after) can make a scenario more educational, but mark `outside_scenario_range` as expected in the package README.

## Sample Data

If your scenario uses synthetic, smoothed, or otherwise non-source-true prices (for example, the demo BTC scenario), set `meta.isSampleData = true` and explain the construction in `dataSources`. The product surface uses this flag to add a clear sample-data badge.

## Local FRED S&P 500 Import

The repo includes a local importer for users who want to replay the 2020 COVID scenario with FRED's `SP500` close series without committing upstream-restricted data:

```sh
npm run import:fred-sp500
```

This writes a generated scenario to `src/data/scenarios/sp500-covid-2020-fred/`, which is intentionally gitignored. Restart the dev server and the scenario switcher will include **S&P 500 COVID Crash & Recovery (FRED Local)** automatically.

Important licensing notes:

- FRED can provide access to `SP500`, but the series is marked as S&P Dow Jones Indices content with reproduction restrictions.
- Generated files should stay local unless you have separate redistribution permission from the data owner.
- A production bundle built while the generated scenario exists will include the generated data, so do not publish that bundle unless your use complies with the upstream terms.
- The importer uses source close values only. Open/high/low are derived from adjacent closes and volume is set to `0`, so the generated scenario is useful for broad timing practice, not intraday execution realism.

Optional date range:

```sh
npm run import:fred-sp500 -- --start=2020-01-02 --end=2020-12-31
```

## Local Licensed OHLCV Import

If you already have local-use or redistribution-safe OHLCV data, generate a gitignored local scenario:

```sh
npm run import:ohlcv -- --input=local-data/spy.csv --symbol=SPY --title="SPY Local Replay" --license="Licensed local use only"
```

Input may be CSV or JSON. Rows should include `date` or `openTime`/`closeTime`, plus `open`, `high`, `low`, `close`, and optional `volume`. The generated package includes source manifest metadata, an always-open local market calendar, professional broker assumptions, and an empty `corporateActions` array that can be filled later for splits or dividends.

Generated `src/data/scenarios/local-*/` folders are ignored by git. Keep them local unless the data owner grants explicit redistribution rights.

## Running the Validator Locally

```sh
npm run test -- scenario
```

Tests live under `src/domain/validation/scenario.test.ts` and `src/data/scenarios/scenarios.test.ts`. The second suite asserts that every registered scenario in the project passes validation with zero errors.
