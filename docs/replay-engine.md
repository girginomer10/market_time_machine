# Replay Engine

## Purpose

The replay engine is the heart of Market Time Machine.

Its job is to advance historical time and return a snapshot of only the information that was available at the current replay time.

## Core Concepts

### Replay Time

`currentTime` is the simulated historical time.

The user experiences the market from this point of view.

### Visibility

Data is visible only if its availability timestamp is less than or equal to `currentTime`.

### Snapshot

A replay snapshot is the full state the UI needs at a specific replay time.

```ts
type ReplaySnapshot = {
  sessionId: string;
  scenarioId: string;
  currentTime: string;
  visibleCandles: Candle[];
  visibleEvents: MarketEvent[];
  visibleIndicators: IndicatorSnapshot[];
  tradablePrices: TradablePrice[];
  portfolio: PortfolioSnapshot;
  replayStatus: "idle" | "playing" | "paused" | "finished";
};
```

## Visibility Rules

```text
candle.closeTime <= currentTime
event.publishedAt <= currentTime
indicator.availableAt <= currentTime
benchmarkPoint.time <= currentTime
corporateAction.announcedAt <= currentTime
```

The engine should avoid using fields such as `happenedAt` for visibility unless the event was genuinely knowable at that time.

## Clock Model

The engine should support:

- play
- pause
- step forward
- speed change
- seek within allowed replay rules
- finish

Replay can advance by candle index or wall-clock time.

For most scenarios, candle-index advancement is safer and easier:

```text
currentIndex += speedAdjustedStep
currentTime = candles[currentIndex].closeTime
```

For mixed-frequency scenarios, the engine may use a unified timeline of candles, events, and indicator availability points.

## Speed Model

Speed should be abstracted from real seconds.

Example:

```ts
type ReplaySpeed = {
  label: "1x" | "5x" | "20x" | "step";
  candlesPerTick: number;
  tickMs: number;
};
```

## No Future Data Contract

The frontend should not directly calculate visibility from full datasets in professional or challenge mode.

Recommended API contract:

```text
GET /replay-sessions/:id/snapshot
  -> returns visible snapshot only

POST /replay-sessions/:id/advance
  -> advances replay according to rules
  -> returns visible snapshot only
```

For local open source mode, the same interface can be implemented in memory.

## Pseudocode

```ts
function getReplaySnapshot(state: ReplayState, scenario: ScenarioData): ReplaySnapshot {
  const currentTime = state.currentTime;

  const visibleCandles = scenario.candles.filter(
    candle => candle.closeTime <= currentTime
  );

  const visibleEvents = scenario.events.filter(
    event => event.publishedAt <= currentTime
  );

  const visibleIndicators = scenario.indicators.filter(
    indicator => indicator.availableAt <= currentTime
  );

  const tradablePrices = getTradablePrices(visibleCandles, scenario.broker);
  const portfolio = markPortfolioToMarket(state.portfolio, tradablePrices);

  return {
    sessionId: state.sessionId,
    scenarioId: scenario.id,
    currentTime,
    visibleCandles,
    visibleEvents,
    visibleIndicators,
    tradablePrices,
    portfolio,
    replayStatus: state.status
  };
}
```

Production code should avoid repeated full-array filtering for large datasets. Use sorted indexes, cursors, or database queries.

## Event Timing Gotcha

An earnings result for Q1 2020 may describe the period ending March 31, 2020, but it might not have been announced until April 23, 2020.

The replay engine must use announcement or publication time.

```text
periodEnd: 2020-03-31
announcedAt: 2020-04-23T20:05:00Z
visibleAt: 2020-04-23T20:05:00Z
```

## Testing Requirements

Replay engine tests should cover:

- Future candles are hidden
- Future events are hidden
- Events appear at `publishedAt`, not `happenedAt`
- Indicators appear at `availableAt`
- Portfolio value uses last visible tradable price
- Report data is inaccessible before scenario finish
- Seeking rules cannot reveal future data in challenge mode

## Anti-Cheat Requirements

Local mode cannot fully prevent cheating because data lives on the user's machine.

Challenge and professional modes require:

- Server-side replay state
- Server-side order execution
- Server-side scoring
- Snapshot-only client responses
- Immutable session logs
- Locked scenario configuration
- No client access to full future datasets

