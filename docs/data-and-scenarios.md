# Data and Scenario Standard

## Goal

Market Time Machine should grow through high-quality, open source historical scenarios.

A scenario is not only a price file. It is a complete, time-aware market environment with prices, events, benchmark data, broker assumptions, and metadata.

## Scenario Package Structure

Recommended package layout:

```text
scenarios/
  btc-2020-2021/
    scenario.json
    instruments.json
    candles.jsonl
    events.jsonl
    benchmarks.jsonl
    indicators.jsonl
    broker.json
    README.md
    LICENSE.md
    sources.md
```

Large datasets may use CSV or Parquet instead of JSONL.

## Scenario Metadata

```ts
type Scenario = {
  id: string;
  title: string;
  subtitle?: string;
  assetClass: "crypto" | "equity" | "index" | "fx" | "commodity" | "rates" | "etf";
  symbols: string[];
  startTime: string;
  endTime: string;
  baseCurrency: string;
  initialCash: number;
  defaultGranularity: "1m" | "5m" | "15m" | "1h" | "1d";
  difficulty: "beginner" | "intermediate" | "advanced" | "expert";
  tags: string[];
  supportedModes: Array<"explorer" | "professional" | "blind" | "challenge">;
  benchmarkSymbol?: string;
  license: string;
  dataSources: string[];
};
```

## Instrument Schema

```ts
type Instrument = {
  symbol: string;
  name: string;
  assetClass: Scenario["assetClass"];
  exchange?: string;
  currency: string;
  timezone: string;
  tradingHours?: TradingHours;
  tickSize?: number;
  lotSize?: number;
  allowFractional?: boolean;
};
```

## Candle Schema

```ts
type Candle = {
  symbol: string;
  openTime: string;
  closeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjustedClose?: number;
  source?: string;
};
```

Use `closeTime` for replay visibility. A candle should not be visible before it has completed unless the product explicitly supports live-forming candles.

## Event Schema

Events must separate what happened from when the market could know it.

```ts
type MarketEvent = {
  id: string;
  happenedAt: string;
  publishedAt: string;
  title: string;
  type:
    | "news"
    | "earnings"
    | "macro"
    | "central_bank"
    | "regulation"
    | "geopolitical"
    | "analyst_rating"
    | "price_event"
    | "social_sentiment"
    | "onchain"
    | "corporate_action";
  summary: string;
  affectedSymbols: string[];
  importance: 1 | 2 | 3 | 4 | 5;
  sentiment?: "positive" | "negative" | "mixed" | "neutral";
  source?: string;
  sourceUrl?: string;
};
```

Important:

Do not write event summaries with hindsight. For example:

Bad:

```text
The Fed cut rates, triggering a powerful market rally.
```

Good:

```text
The Federal Reserve announced an emergency rate cut of 50 basis points.
```

The first version leaks future price action. The second version describes only what was knowable at publication time.

## Indicator Schema

Indicators also need availability times.

```ts
type IndicatorSnapshot = {
  symbol: string;
  name: string;
  time: string;
  availableAt: string;
  value: number | Record<string, number>;
  parameters?: Record<string, string | number | boolean>;
};
```

Examples:

- moving averages
- RSI
- realized volatility
- macro releases
- inflation data
- unemployment data
- on-chain metrics

For revised macro data, store vintage data when possible. A user replaying March 2020 should see the value that was available in March 2020, not a later revision.

## Benchmark Schema

```ts
type BenchmarkPoint = {
  symbol: string;
  time: string;
  value: number;
};
```

Benchmarks are used for post-game comparison and optional in-game context, depending on scenario rules.

## Broker Assumption File

```ts
type BrokerConfig = {
  baseCurrency: string;
  commissionRateBps: number;
  fixedFee: number;
  spreadBps: number;
  slippageModel: "none" | "fixed_bps" | "volume_based" | "volatility_based";
  allowFractional: boolean;
  allowShort: boolean;
  maxLeverage: number;
  marginCallPolicy?: "disabled" | "liquidate_on_threshold" | "reject_new_orders";
  borrowRateBps?: number;
};
```

## Data Quality Requirements

Scenario contributions should include:

- Clear source attribution
- License compatibility
- Timezone information
- Candle granularity
- Adjusted price notes
- Known data gaps
- Event source links where possible
- No hindsight phrasing in events
- Reproducible transformation notes

## Validation Rules

Scenario validation should check:

- All timestamps are parseable ISO 8601 strings
- Candles are sorted
- Candles do not overlap
- Required fields exist
- Events have `publishedAt`
- Events do not fall outside scenario range unless intentionally included as pre-context
- Symbols match known instruments
- Broker assumptions are present
- Scenario license is declared

## Open Source Scenario Philosophy

The project should accept imperfect but transparent scenarios before rejecting everything for not being institutional-grade.

Good open source scenario data should be:

- Reproducible
- Clearly sourced
- Clearly licensed
- Explicit about limitations
- Free of future leakage

