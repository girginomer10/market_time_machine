# Scenario Authoring Guide

This guide is for contributors who want to add a historical scenario package to Market Time Machine. It complements [Data and Scenario Standard](data-and-scenarios.md), which is the canonical schema reference.

## Quick Start

A scenario lives under `src/data/scenarios/<id>/index.ts` and exports a single `ScenarioPackage` produced by `assembleScenario`. Shipped, redistribution-safe packages must also be added to the explicit production allowlist in `src/data/scenarios/index.ts`; local importer output is discovered separately in development only.

Minimum required parts:

- `meta`: a `ScenarioMeta` block with id, title, range, symbols, license, and data sources
- `instruments`: at least one `Instrument` matching `meta.symbols`
- `candles`: ISO-timestamped OHLCV candles, sorted by `closeTime`
- `events`: market events with both `happenedAt` and `publishedAt`
- `drills`: optional data-only practice definitions scoped to this scenario
- `benchmarks`: optional, but recommended for post-game comparison
- `broker`: a `BrokerConfig` describing fills, spread, fees, slippage, leverage

`assembleScenario` will normalize sort order. It validates and defensively copies optional authored drills because malformed drill rules must never enter a replay. Call `validateScenarioPackage` from `src/domain/validation/scenario.ts` to check the complete package.

## Replay-Contract Identity

Treat `meta.dataVersion` as the immutable identity of the scenario contract, not
as a label for the price file alone. The shipped ECB packages pin a SHA-256 of a
canonical payload containing replay-relevant metadata, instruments, candles,
events, indicators, benchmarks, the scenario broker, market calendar, and
corporate actions. `dataVersion` itself is excluded to avoid recursion, and
`generatedAt` is excluded because retrieval time alone does not change replay.
Array order remains significant. When a browser-imported package contains
scenario-authored drills, those definitions are also included in the canonical
scenario identity in addition to carrying their own definition, competency,
rubric, and rubric-content identities.

Browser imports must still declare a non-empty author `dataVersion`, but the app
does not trust that label as proof of sameness. It derives and persists an
app-owned `sha256:<digest>` from the complete canonical replay contract. Removing
and re-importing changed content under the same id and author label therefore
produces a different restore identity.

A source snapshot's `contentSha256` can be useful provenance, but it is only one
sub-identity. If an included observation, derivation rule, event, instrument,
broker default, calendar, corporate action, or report-relevant metadata changes,
assign a new scenario version. The built-in `dataVersions` regression recomputes
the ECB full contracts and checks their pinned constants.

Do not reuse an old value to make a changed package restore or earn evidence.
The runtime recognizes only a small set of centrally reviewed, scenario-specific
built-in aliases; there is no general fallback or prefix match. Unknown versions
receive no migration and compare only by exact equality. Current session exports
also fingerprint the active broker configuration separately, because a
selectable preset can differ from the scenario's versioned default broker.

## Optional Data-Only Practice Drills

A scenario package may include `drills?: DrillDefinition[]`. These are JSON-compatible definitions, not executable extensions. See the compact [event-discipline example](examples/event-discipline-drill.json).

Each definition requires:

- a non-empty `meta.dataVersion` on the containing scenario, so session restore
  and comparable evidence can reject changed market/event data
- a scenario-local unique `id` and a positive integer `definitionVersion`
- a non-empty stable `competencyId`, `rubricVersion`, title, and description
- `scenarioId` exactly matching the containing package
- a `primarySymbol` declared by the scenario and a `mode` supported by it
- an initial-plan rule using only `thesis`, `invalidation`, `exitPlan`, and `acceptedRisk`
- checkpoint mapping `next_primary_candle_close`, with `groupSameReplayIndex: true`
- checkpoint actions containing `hold`, `reduce`, `exit`, and `wait` exactly once
- a process rubric with `plan_coverage`, `checkpoint_coverage`, `event_linkage`, and `rule_adherence` weights summing to `1`
- a finite `violationPenalty` from `0` through `100`

Eligible events are selected by `minimumImportance` and `affectedSymbols`, then mapped from `publishedAt` to the next real close of `primarySymbol`. A definition is invalid if it produces no checkpoint or if an eligible event has no later primary-symbol close. Events mapped to the same replay index become one grouped checkpoint.

Valid scenario-authored drills appear as runnable library options only with their containing scenario. A definition using a reserved built-in id cannot replace the built-in definition. Imported definitions do not enter the curated practice-track allowlist or earn track credit merely by copying a track drill id.

`competencyId` groups compatible definitions in the evidence profile; use the
same value only when they assess the same process under the same rubric. It does
not grant track credit or make two runs trend-comparable. Trends still require
the same canonical scenario identity, drill/definition and rubric content, mode,
broker mode, and full broker fingerprint. A reviewed built-in version alias can
match its canonical successor; an unreviewed mismatch cannot.

Authoring is intentionally data-only. Custom functions, scripts, arbitrary scoring code, and a no-code drill editor are not supported; a no-code editor is a product non-goal for this schema version.

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
- Every imported scenario must declare a non-empty `dataVersion`; packages with
  authored drills are subject to the same rule. The browser normalizes it to a
  full-contract SHA-256 rather than trusting a reused author label. Also declare `sourceManifest`,
  `generatedAt`, `priceAdjustment`, and `marketCalendarId` when those are known
- A changed replay-contract layer has a new `dataVersion`; a source-file digest
  alone is not enough when authored events, broker assumptions, or other layers
  can also change
- Optional drills pass structural parsing, domain validation, scenario matching, and unique-id/version checks

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

Synthetic price paths may still use carefully sourced historical events, but
that event provenance does not make the market series source-observed. The
shipped practice-track catalog keeps synthetic QQQ and KRE Event Discipline
units preview-only and non-creditable.

## Local FRED S&P 500 Import

The repo includes a local importer for users who want to replay the 2020 COVID scenario with FRED's `SP500` close series without committing upstream-restricted data:

```sh
npm run import:fred-sp500
```

This writes a generated scenario to `src/data/scenarios/sp500-covid-2020-fred/`, which is intentionally gitignored. Restart the dev server and the scenario switcher will include **S&P 500 COVID Crash & Recovery (FRED Local)** automatically.

Important licensing notes:

- FRED can provide access to `SP500`, but the series is marked as S&P Dow Jones Indices content with reproduction restrictions.
- Generated files should stay local unless you have separate redistribution permission from the data owner.
- Local licensed scenarios are discovered by the development server only. The normal production build aliases local discovery to an empty registry, and its release check verifies that `FRED:SP500` licensing markers are absent from `dist`.
- The importer uses source close values only. Open/high/low are derived from adjacent closes and volume is set to `0`, so the generated scenario is useful for broad timing practice, not intraday execution realism.
- Candle open/close timestamps are derived from regular 09:30-16:00
  America/New_York sessions. Exchange early-close exceptions are not modeled,
  so those timestamps are not source observations or intraday event-time evidence.
- Because open/high/low are derived rather than source observations, the generated package sets `meta.isSampleData = true`, `meta.dataFidelity = "mixed"`, and explicit observed/derived field lists. The briefing says that the closes are observed and the remaining replay fields are derived; it does not call the FRED close observations synthetic.
- `meta.dataVersion` combines a SHA-256 identity of normalized imported market content with the bundled S&P 500 event-layer version. A changed close, requested range, derivation contract, or authored event layer therefore creates a different replay identity; `generatedAt` alone does not.
- The generator schema fixes the remaining emitted instrument, broker, calendar,
  and derivation defaults. If you hand-edit any generated replay layer afterward,
  assign a new version instead of retaining the importer-produced identity.

Optional date range:

```sh
npm run import:fred-sp500 -- --start=2020-01-02 --end=2020-12-31
```

Custom ranges use a generic `S&P 500 FRED Replay` identity and keep only events
inside the requested interval. Existing output is protected; use
`--force=true` only when you intentionally want to replace it. Custom output
paths may be git-visible, so always inspect `git status` before publishing. The
new `index.ts` and `README.md` are staged together; if either install step
fails, the importer restores the prior pair. Output under `public/`, `dist/`,
bundled `src/` roots, or a shipped scenario directory is refused so a local
licensed snapshot cannot be placed directly on a production path.

## Local Licensed OHLCV Import

If you already have local-use or redistribution-safe OHLCV data, generate a gitignored local scenario:

```sh
npm run import:ohlcv -- --input=local-data/spy.csv --symbol=SPY --title="SPY Local Replay" --license="Licensed local use only"
```

Input may be CSV or JSON. Rows should include `date` or `openTime`/`closeTime`, plus `open`, `high`, `low`, `close`, and optional `volume`. Both camelCase and snake_case timestamp headers are accepted in CSV. Date-only values are normalized as UTC dates; every date-time value must carry an explicit `Z` or numeric UTC offset so imports are identical across host timezones. The importer validates timestamps, positive OHLC values, OHLC relationships, duplicates, metadata, IDs, tick size, and output paths before staging both generated files and replacing them as a recoverable pair. Publication uses an owner-identified lock and a recoverable transaction manifest, so a later run can reclaim a dead writer and either roll back an interrupted pair or finalize a completely installed pair. FX defaults to a `0.0001` tick; other asset classes default to `0.01`, and `--tickSize=<positive number>` overrides either default. Tick size is included in the SHA-256 `dataVersion`, which covers the normalized generator inputs and schema and is independent of generation time. The generated package includes source-manifest metadata, configurable asset class/granularity/currency/timezone/initial cash, professional broker assumptions, and an empty `corporateActions` array. If you later fill that array or hand-edit events, broker settings, or another replay layer, assign a new version.

Lock takeover is serialized and rechecks the observed owner's file identity before
reclaiming it, so two recovery contenders cannot move a newly acquired live lock.
Staged files, manifests, installed outputs, commit markers, locks, and their
critical directories are flushed before publication advances. Recovery deletes
only a valid importer-owned transaction described by its manifest; a missing,
corrupt, or unexpected transaction directory is preserved and reported for
manual inspection. A hard power loss can leave an abandoned `.preparing-*` or
takeover-guard artifact, but those fail closed and do not overwrite user files.

The importer deliberately does not invent a market calendar from a timezone.
Generated scenarios set `marketHoursEnforced: false`; add a verified exchange
calendar and enable enforcement only when the actual sessions and holidays are
known. Pass `--force=true` to intentionally replace an existing generated
scenario.

Generated `src/data/scenarios/local-*/` folders are ignored by git. The importer
rejects output under `public/`, `dist/`, bundled `src/` roots, or a shipped
scenario directory; custom repository paths outside those roots can still be
git-visible. Keep generated data local unless the data owner grants explicit
redistribution rights.

## Running the Validator Locally

```sh
npm run test -- scenario
```

Tests live under `src/domain/validation/scenario.test.ts` and `src/data/scenarios/scenarios.test.ts`. The second suite asserts that every registered scenario in the project passes validation with zero errors.
