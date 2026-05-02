import type {
  BenchmarkPoint,
  BrokerConfig,
  Candle,
  IndicatorSnapshot,
  MarketEvent,
  ScenarioPackage,
  TradablePrice,
} from "../../types";

export const REPLAY_SPEEDS = [
  { label: "step", candlesPerTick: 1, tickMs: Infinity },
  { label: "1x", candlesPerTick: 1, tickMs: 1500 },
  { label: "5x", candlesPerTick: 1, tickMs: 400 },
  { label: "20x", candlesPerTick: 2, tickMs: 200 },
  { label: "60x", candlesPerTick: 5, tickMs: 150 },
] as const;

export function lastVisibleCandleIndex(
  candles: Candle[],
  currentTime: string,
): number {
  let lo = 0;
  let hi = candles.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].closeTime <= currentTime) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

export function visibleCandles(
  candles: Candle[],
  currentTime: string,
): Candle[] {
  const idx = lastVisibleCandleIndex(candles, currentTime);
  if (idx < 0) return [];
  return candles.slice(0, idx + 1);
}

export function visibleEvents(
  events: MarketEvent[],
  currentTime: string,
): MarketEvent[] {
  return events.filter((event) => event.publishedAt <= currentTime);
}

export function visibleIndicators(
  indicators: IndicatorSnapshot[],
  currentTime: string,
): IndicatorSnapshot[] {
  return indicators.filter((ind) => ind.availableAt <= currentTime);
}

export function visibleBenchmark(
  benchmarks: BenchmarkPoint[],
  currentTime: string,
): BenchmarkPoint[] {
  return benchmarks.filter((b) => b.time <= currentTime);
}

export function lastVisiblePrice(
  candles: Candle[],
  currentTime: string,
): number | undefined {
  const idx = lastVisibleCandleIndex(candles, currentTime);
  return idx >= 0 ? candles[idx].close : undefined;
}

export function tradablePricesFor(
  scenario: ScenarioPackage,
  currentTime: string,
  broker: BrokerConfig = scenario.broker,
): TradablePrice[] {
  const result: TradablePrice[] = [];
  const half = broker.spreadBps / 2 / 10000;
  for (const symbol of scenario.meta.symbols) {
    const symbolCandles = scenario.candles.filter((c) => c.symbol === symbol);
    const idx = lastVisibleCandleIndex(symbolCandles, currentTime);
    if (idx < 0) continue;
    const price = symbolCandles[idx].close;
    result.push({
      symbol,
      time: symbolCandles[idx].closeTime,
      price,
      bid: price * (1 - half),
      ask: price * (1 + half),
    });
  }
  return result;
}

export function timeAtIndex(
  candles: Candle[],
  index: number,
  fallback: string,
): string {
  if (candles.length === 0) return fallback;
  const clamped = Math.max(0, Math.min(index, candles.length - 1));
  return candles[clamped].closeTime;
}
