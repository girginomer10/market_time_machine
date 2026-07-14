# Architecture

## Architecture Goal

The architecture must protect the core product promise:

**During replay, the client receives only information that was available at the current replay time.**

Everything else follows from that rule.

## Product Layers

```text
Scenario Data
  -> historical prices
  -> events
  -> indicators
  -> benchmark series
  -> broker assumptions

Replay Engine
  -> current replay time
  -> visible candles
  -> visible events
  -> visible indicators
  -> tradable prices

Broker Simulation Engine
  -> orders
  -> fills
  -> fees
  -> slippage
  -> margin
  -> positions

Portfolio Engine
  -> cash
  -> exposure
  -> realized P/L
  -> unrealized P/L
  -> portfolio value

Journal Engine
  -> trade notes
  -> decision context
  -> intent and risk plan

Report Engine
  -> performance metrics
  -> risk metrics
  -> attribution
  -> behavioral flags
  -> benchmark comparison

Practice Coach
  -> versioned drill assessment or factual baseline gap
  -> deterministic repeat, component focus, transfer, or comparable rerun
  -> local Practice orientation milestones
  -> versioned rubric

Practice Engine
  -> versioned drill definitions
  -> published-event checkpoint schedule
  -> initial-plan and checkpoint rules
  -> process-only assessment

Evidence And History
  -> 12 bounded full reports
  -> 250 compact factual/assessment entries
  -> competency-and-rubric evidence claims plus exact-context trends
  -> exact-version practice-track credit
  -> V2 archive and V1 history migration

Frontend
  -> chart
  -> timeline
  -> trade ticket
  -> portfolio monitor
  -> journal
  -> report
  -> practice coach
  -> drill checkpoints and debrief
  -> evidence profile and tracks
```

## Open Source Local Architecture

The shipped open source product runs in the browser without an application
server.

```text
Static scenario package
  -> scenario loader
  -> local replay engine
  -> local broker simulation
  -> local report engine
  -> local practice assessment and evidence ledger
  -> React app
```

This is ideal for easy installation, GitHub demos, offline use, and community contribution.

Limitation:

The browser will technically download the scenario package, so a technical user can inspect future data. This is acceptable for education and local exploration, but not for competitive challenges.

## Hosted Challenge Architecture

For serious challenges, cohorts, and professional training, future data must stay server-side.

```text
Client
  -> requests replay snapshot
  -> submits orders and journal entries
  -> receives visible state only

Replay API
  -> validates session clock
  -> filters candles, events, and indicators
  -> returns no future data

Simulation API
  -> accepts orders
  -> creates fills
  -> applies broker model
  -> stores portfolio snapshots

Report API
  -> unlocks after scenario completion
  -> uses full historical data
  -> generates metrics and behavioral analysis

Data Store
  -> scenario packages
  -> normalized price data
  -> event data
  -> user sessions
  -> trades and reports
```

## Core Services

### Scenario Service

Responsibilities:

- List scenarios
- Load scenario metadata
- Validate scenario packages
- Resolve instruments
- Expose allowed scenario configuration

### Replay Service

Responsibilities:

- Maintain current replay time
- Generate visible snapshots
- Enforce information firewall
- Handle replay speed, pause, step, and seek rules
- Prevent replay jumps that violate challenge configuration

### Simulation Service

Responsibilities:

- Accept order intents
- Validate buying power and position constraints
- Fill orders based on execution model
- Apply fees, spread, slippage, margin, and liquidation rules
- Produce position and cash updates

### Portfolio Service

Responsibilities:

- Track cash
- Track positions
- Mark positions to visible market prices
- Calculate exposure
- Calculate realized and unrealized P/L
- Store portfolio snapshots

### Event Service

Responsibilities:

- Load event timeline
- Filter by published time
- Normalize event importance and sentiment
- Prevent hindsight phrasing
- Link events to instruments

### Report Service

Responsibilities:

- Generate scenario-end report
- Compare with benchmarks
- Calculate metrics
- Detect behavioral flags
- Analyze journal consistency
- Produce shareable summaries

### Practice Service

Responsibilities:

- Validate versioned drill definitions against the selected scenario
- Map eligible events by `publishedAt` to the next primary-symbol candle close
- Enforce required initial-plan fields and unresolved checkpoint stops
- Capture Hold, Reduce, Exit, or Wait responses and local rule violations
- Produce process-only drill assessments without using return as skill evidence

The shipped UI combines curated built-ins with valid scenario-authored
definitions discovered from the currently available scenario packages. Authored
definitions are scenario-scoped, cannot replace reserved built-in ids, and do
not mutate the separately curated practice-track catalog.

### Evidence And History Service

Responsibilities:

- Keep stable run-instance identity across save/restore
- Pin practice sessions to scenario data plus competency/definition/rubric
  identity and reject restore-time drift
- Retain at most 12 recent full reports and 250 compact ledger entries
- Strip raw journal, plan, checkpoint-response, and reflection text from compact
  evidence
- Group compatible evidence by stable competency id and rubric while retaining
  every represented drill id and definition version
- Compare trends only across matching scenario/data version, drill/definition,
  rubric, mode, and broker context
- Award track credit only to exact curated unit references in one qualifying
  attempt
- Deep-validate and deterministically merge V2 practice archives, persist both
  history layers with rollback, and migrate V1 exports as factual unassessed data

## Suggested Frontend Structure

```text
src/
  app/
    App.tsx
    router.tsx
  components/
    chart/
    replay/
    trade/
    timeline/
    journal/
    report/
    scenario/
    practice/
  data/
    practice/
    scenarios/
  domain/
    replay/
    broker/
    portfolio/
    analytics/
    report/
    practice/
    history/
  store/
    sessionStore.ts
  types/
    market.ts
    scenario.ts
    trading.ts
    reporting.ts
    practice.ts
```

## Suggested Backend Structure

```text
services/
  api/
    scenarios/
    replay/
    simulation/
    reports/
    challenges/
  workers/
    ingest/
    normalize/
    validate-scenarios/
    generate-reports/
  packages/
    domain/
    scenario-schema/
    analytics/
    execution-models/
```

## Data Stores

The shipped local product does not require a database. It uses browser
`localStorage` for the active session, imported scenarios, bounded completed-run
history, and the compact practice ledger. Static application and shipped
scenario assets use browser Cache Storage. User-controlled JSON files provide
session and practice-archive portability.

The ledger is intentionally not a second full report store. It contains compact
facts and optional validated assessments, while sensitive free text remains in
the active session or recent full report where applicable.

### Future Hosted Stores

Recommended long-term stores:

- PostgreSQL for users, sessions, scenarios, orders, fills, reports
- TimescaleDB for historical candles and portfolio snapshots
- DuckDB for local analytics and batch scenario validation
- Redis for active replay sessions and challenge locks
- Object storage for raw and packaged scenario files

## Information Firewall

Visibility must be based on availability time, not descriptive period.

Rules:

```text
candle.closeTime <= currentTime
event.publishedAt <= currentTime
indicator.availableAt <= currentTime
earnings.announcedAt <= currentTime
corporateAction.announcedAt <= currentTime
benchmarkPoint.time <= currentTime
```

The report engine may access the full scenario only after the replay is complete.

## Deployment Modes

### Local Lab

Best for:

- Open source use
- Personal learning
- Scenario creation
- Offline demos

Tradeoff:

- No strong anti-cheat guarantee

### Hosted Public Challenges

Best for:

- Leaderboards
- Shared scenarios
- Community events

Requires:

- Server-side replay
- Server-side execution
- Server-side scoring

### Educator or Team Workspace

Best for:

- Cohorts
- Courses
- Prop training
- Internal assessments

Requires:

- User roles
- Assignment flows
- Exportable reports
- Scenario locking
- Audit trail
