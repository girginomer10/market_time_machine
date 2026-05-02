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

Frontend
  -> chart
  -> timeline
  -> trade ticket
  -> portfolio monitor
  -> journal
  -> report
```

## Open Source Local Architecture

The initial open source version can run mostly in the browser.

```text
Static scenario package
  -> scenario loader
  -> local replay engine
  -> local broker simulation
  -> local report engine
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
  domain/
    replay/
    simulation/
    portfolio/
    analytics/
    data/
  store/
    replayStore.ts
    portfolioStore.ts
    scenarioStore.ts
  types/
    market.ts
    scenario.ts
    trading.ts
    reporting.ts
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

