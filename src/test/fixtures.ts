import type {
  BenchmarkPoint,
  BrokerConfig,
  Candle,
  Instrument,
  MarketEvent,
  ScenarioPackage,
} from "../types";
import { assembleScenario } from "../domain/scenario/loader";

const SYMBOL = "TEST";

export function makeCandles(): Candle[] {
  const closes = [100, 102, 105, 110, 108, 115];
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const time = Date.UTC(2024, 0, 1 + i);
    const next = Date.UTC(2024, 0, 2 + i);
    return {
      symbol: SYMBOL,
      openTime: new Date(time).toISOString(),
      closeTime: new Date(next - 1).toISOString(),
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1000 + i * 100,
    } satisfies Candle;
  });
}

export function makeEvents(): MarketEvent[] {
  return [
    {
      id: "evt-1",
      happenedAt: "2024-01-01T12:00:00.000Z",
      publishedAt: "2024-01-03T08:00:00.000Z",
      title: "Past event",
      type: "news",
      summary: "Already published before scenario midpoint.",
      affectedSymbols: [SYMBOL],
      importance: 3,
      sentiment: "neutral",
    },
    {
      id: "evt-2",
      happenedAt: "2024-01-04T12:00:00.000Z",
      publishedAt: "2024-01-05T16:00:00.000Z",
      title: "Future event",
      type: "news",
      summary: "Should not be visible until 2024-01-05T16:00Z.",
      affectedSymbols: [SYMBOL],
      importance: 4,
      sentiment: "negative",
    },
  ];
}

export function makeBenchmark(): BenchmarkPoint[] {
  return makeCandles().map((c) => ({
    symbol: SYMBOL,
    time: c.closeTime,
    value: c.close,
  }));
}

export function makeBroker(overrides: Partial<BrokerConfig> = {}): BrokerConfig {
  return {
    baseCurrency: "USD",
    commissionRateBps: 10,
    fixedFee: 0,
    spreadBps: 0,
    slippageModel: "none",
    slippageBps: 0,
    allowFractional: true,
    allowShort: false,
    maxLeverage: 1,
    ...overrides,
  };
}

export function makeInstruments(): Instrument[] {
  return [
    {
      symbol: SYMBOL,
      name: "Test instrument",
      assetClass: "crypto",
      currency: "USD",
      timezone: "UTC",
      allowFractional: true,
    },
  ];
}

export function makeScenario(broker?: BrokerConfig): ScenarioPackage {
  return assembleScenario({
    scenario: {
      id: "test",
      title: "Test scenario",
      assetClass: "crypto",
      symbols: [SYMBOL],
      startTime: "2024-01-01T00:00:00.000Z",
      endTime: "2024-01-07T00:00:00.000Z",
      baseCurrency: "USD",
      initialCash: 1000,
      defaultGranularity: "1d",
      difficulty: "beginner",
      tags: ["test"],
      supportedModes: ["explorer"],
      benchmarkSymbol: SYMBOL,
      license: "MIT",
      dataSources: ["test"],
      isSampleData: true,
    },
    instruments: makeInstruments(),
    candles: makeCandles(),
    events: makeEvents(),
    indicators: [],
    benchmarks: makeBenchmark(),
    broker: broker ?? makeBroker(),
  });
}
