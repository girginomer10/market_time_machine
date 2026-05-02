# Analytics and Reporting

## Purpose

The post-game report turns a replay session into learning.

The report should answer:

- Did the user make money?
- Did the user beat the market?
- How much risk did the user take?
- Which decisions mattered most?
- Which behaviors appeared?
- Which events influenced the user?
- What should the user practice next?

## Report Sections

### 1. Scorecard

High-level result:

- Total return
- Benchmark return
- Outperformance
- Max drawdown
- Volatility
- Sharpe ratio
- Sortino ratio
- Win rate
- Profit factor
- Fees paid
- Exposure time
- Turnover

### 2. Equity Curve

Show:

- Portfolio value over time
- Benchmark value over time
- Drawdown chart
- Major trades
- Major events

### 3. Decision Replay

For each important trade:

- User action
- User note
- Price context at the time
- Visible events at the time
- What happened afterward
- Contribution to total P/L

### 4. Attribution

Break performance into drivers:

- Market exposure
- Timing
- Position sizing
- Fees and slippage
- Holding period
- Cash drag
- Leverage
- Short exposure

### 5. Behavioral Profile

Detect patterns:

- Panic selling
- FOMO buying
- Dip catching
- Early profit taking
- Holding losers
- Overtrading
- News overreaction
- Underreaction to regime change
- Excessive leverage

### 6. Lessons

Generate short, evidence-based lessons.

Examples:

- "Your best decision was staying invested during the March 2020 volatility spike."
- "Your largest performance drag came from buying after a sharp rally and exiting two candles later."
- "You reacted strongly to negative news, but the price had already absorbed much of the information."

## Core Metrics

```ts
type ReportMetrics = {
  totalReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
  maxDrawdown: number;
  volatility: number;
  sharpe?: number;
  sortino?: number;
  calmar?: number;
  winRate: number;
  profitFactor?: number;
  averageWin?: number;
  averageLoss?: number;
  exposureTime: number;
  turnover: number;
  feesPaid: number;
  slippagePaid: number;
};
```

## Behavioral Flags

```ts
type BehavioralFlag = {
  id: string;
  type:
    | "panic_sell"
    | "fomo_buy"
    | "dip_catching"
    | "early_profit_take"
    | "holding_loser"
    | "overtrading"
    | "news_overreaction"
    | "excessive_leverage";
  severity: 1 | 2 | 3 | 4 | 5;
  tradeIds: string[];
  evidence: string;
  estimatedImpact?: number;
};
```

## Behavioral Definitions

### Panic Sell

Possible detection:

```text
user sells after a large recent drawdown
and price recovers meaningfully within a lookahead window
and the sale materially reduced performance
```

### FOMO Buy

Possible detection:

```text
user buys after a sharp recent rally
and near-term forward return is poor
or the trade has negative expectancy after fees
```

### Early Profit Taking

Possible detection:

```text
user closes a profitable position
and the instrument continues favorably afterward
and the missed gain is significant
```

### Overtrading

Possible detection:

```text
high turnover
plus high fee/slippage drag
plus no meaningful benchmark outperformance
```

## Scoring

Avoid scoring only by absolute return. That rewards reckless leverage and lucky outcomes.

Recommended score:

```text
35% risk-adjusted return
25% benchmark outperformance
20% drawdown control
10% decision consistency
10% journal quality
```

Professional mode may use stricter scoring:

```text
30% excess return
25% risk control
20% execution discipline
15% decision quality
10% journal clarity
```

## Journal Quality

Journal quality should be measured lightly, not as a language contest.

Signals:

- Trade has a note
- Note contains a reason
- Note mentions risk or invalidation
- Exit behavior matches original plan
- User does not repeatedly contradict stated rules

## Benchmarking

Every scenario should define a benchmark.

Examples:

- BTC scenario: buy and hold BTC
- US equity scenario: SPY or asset buy and hold
- FX scenario: hold base currency or relevant FX pair
- Multi-asset scenario: equal-weight basket

Reports should compare:

- User return vs benchmark
- User drawdown vs benchmark
- User volatility vs benchmark
- User time in market vs benchmark

## Report Tone

The report should be direct but not humiliating.

Good:

```text
You avoided the largest drawdown, but your late re-entry caused most of the underperformance.
```

Bad:

```text
You made a terrible trade.
```

The product should teach decision quality while preserving user trust.

