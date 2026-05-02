# Market Time Machine

Market Time Machine is an open source financial history lab for replaying past markets without seeing the future.

The core promise is simple: a user can travel back to a historical market period, but the product only reveals prices, events, indicators, and context that were knowable at that point in time. The user trades, journals decisions, and later compares those decisions against the real outcome.

> Can you trade the 2020 crash without knowing what happens next?

## Product Positioning

Market Time Machine is not just a chart replay tool. It is a decision simulator built around information isolation, realistic execution, and post-game behavioral analysis.

The product should support two primary experiences:

1. **Explorer Mode**
   A gamified, individual learning experience for investors who want to test themselves inside famous historical market regimes.

2. **Professional Training Mode**
   A serious trader training and assessment environment with realistic broker assumptions, strict anti-lookahead controls, scenario scoring, reports, cohorts, and leaderboards.

The long-term identity is:

**Financial History Lab**

## Core Experience Loop

```text
Choose a historical scenario
  -> enter the market at a past date
  -> see only information available up to current replay time
  -> trade with realistic broker constraints
  -> write decision notes
  -> finish the scenario
  -> receive performance, risk, and behavior analysis
  -> replay, compare, or share the result
```

## Core Principles

- **No future leakage:** future candles, future events, future indicators, and future outcomes must never be visible during replay.
- **Published-time realism:** an event is visible only after its real publication or announcement time, not merely the period it describes.
- **Broker realism:** fills, spread, fees, slippage, leverage, margin, partial fills, and liquidity should be modeled explicitly.
- **Decision quality over raw profit:** reports should measure risk, timing, discipline, behavior, and benchmark performance.
- **Open scenario ecosystem:** contributors should be able to add historical market scenarios with clear schemas, licensing, and quality checks.
- **Global by default:** scenarios should support crypto, equities, indices, FX, commodities, rates, and country-specific markets.

## Key Product Surfaces

- Replay chart
- Event timeline
- Trade ticket and order book simulation
- Portfolio and exposure monitor
- Decision journal
- Scenario library
- Post-game report
- Behavioral analytics
- Challenge leaderboard
- Scenario creator and validation tools

## Suggested Technology Direction

Initial open source app:

- Frontend: React, TypeScript, Vite
- Charting: lightweight-charts
- State: Zustand or TanStack Store
- Local data: JSON, CSV, or Parquet
- Analytics: TypeScript domain modules first

Hosted or professional version:

- API: FastAPI, NestJS, or similar
- Database: PostgreSQL plus TimescaleDB or DuckDB for analytics workloads
- Cache/session state: Redis
- Object storage: scenario packages and raw datasets
- Worker jobs: ingestion, normalization, scoring, report generation

## Documentation Map

- [Product Design](docs/product-design.md)
- [Architecture](docs/architecture.md)
- [Data and Scenario Standard](docs/data-and-scenarios.md)
- [Replay Engine](docs/replay-engine.md)
- [Broker Simulation](docs/broker-simulation.md)
- [Analytics and Reporting](docs/analytics-and-reporting.md)
- [Roadmap](docs/roadmap.md)
- [Open Source Contribution Guide](docs/open-source-contribution-guide.md)

## Disclaimer

Market Time Machine is an educational and research product. It is not investment advice, a broker, an exchange, or a recommendation engine.

