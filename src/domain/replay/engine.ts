import type {
  BenchmarkPoint,
  BrokerConfig,
  Candle,
  IndicatorSnapshot,
  MarketEvent,
  ScenarioPackage,
  TradablePrice,
} from "../../types";
import { timestampAtOrBefore, timestampMs } from "./timestamps";

export const REPLAY_SPEEDS = [
  { label: "step", candlesPerTick: 1, tickMs: Infinity },
  { label: "1x", candlesPerTick: 1, tickMs: 1500 },
  { label: "5x", candlesPerTick: 1, tickMs: 400 },
  { label: "20x", candlesPerTick: 2, tickMs: 200 },
  { label: "60x", candlesPerTick: 5, tickMs: 150 },
] as const;

const scenarioCandleCache = new WeakMap<
  ScenarioPackage,
  Map<string, Candle[]>
>();
const replayTimelineCache = new WeakMap<ScenarioPackage, string[]>();

export function candlesForSymbol(
  scenario: ScenarioPackage,
  symbol: string,
): Candle[] {
  let bySymbol = scenarioCandleCache.get(scenario);
  if (!bySymbol) {
    bySymbol = new Map<string, Candle[]>();
    for (const candle of scenario.candles) {
      const entries = bySymbol.get(candle.symbol) ?? [];
      entries.push(candle);
      bySymbol.set(candle.symbol, entries);
    }
    scenarioCandleCache.set(scenario, bySymbol);
  }
  return bySymbol.get(symbol) ?? [];
}

/**
 * The replay clock advances across every symbol, while chart rendering can
 * continue to select a single primary symbol. Equivalent timestamp strings
 * are collapsed by instant, and a later declared scenario end is retained so
 * time-based accounting and order expiry can run through the full scenario.
 */
export function replayTimeline(scenario: ScenarioPackage): string[] {
  const cached = replayTimelineCache.get(scenario);
  if (cached) return cached;

  const byEpoch = new Map<number, string>();
  for (const candle of scenario.candles) {
    const epoch = timestampMs(candle.closeTime);
    if (epoch !== undefined && !byEpoch.has(epoch)) {
      byEpoch.set(epoch, candle.closeTime);
    }
  }

  let latestCandleEpoch = Number.NEGATIVE_INFINITY;
  for (const epoch of byEpoch.keys()) {
    latestCandleEpoch = Math.max(latestCandleEpoch, epoch);
  }
  const declaredEndEpoch = timestampMs(scenario.meta.endTime);
  if (
    declaredEndEpoch !== undefined &&
    declaredEndEpoch > latestCandleEpoch &&
    !byEpoch.has(declaredEndEpoch)
  ) {
    byEpoch.set(declaredEndEpoch, scenario.meta.endTime);
  }

  const timeline = [...byEpoch.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, time]) => time);
  replayTimelineCache.set(scenario, timeline);
  return timeline;
}

export function lastVisibleCandleIndex(
  candles: Candle[],
  currentTime: string,
): number {
  const currentMs = timestampMs(currentTime);
  if (currentMs === undefined) return -1;
  let lo = 0;
  let hi = candles.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const closeMs = timestampMs(candles[mid].closeTime);
    if (closeMs !== undefined && closeMs <= currentMs) {
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
  return events.filter((event) =>
    timestampAtOrBefore(event.publishedAt, currentTime),
  );
}

export function visibleIndicators(
  indicators: IndicatorSnapshot[],
  currentTime: string,
): IndicatorSnapshot[] {
  return indicators.filter((ind) =>
    timestampAtOrBefore(ind.availableAt, currentTime),
  );
}

export function visibleBenchmark(
  benchmarks: BenchmarkPoint[],
  currentTime: string,
): BenchmarkPoint[] {
  return benchmarks.filter((b) => timestampAtOrBefore(b.time, currentTime));
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
    const symbolCandles = candlesForSymbol(scenario, symbol);
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
  entries: Candle[] | string[],
  index: number,
  fallback: string,
): string {
  if (entries.length === 0) return fallback;
  const clamped = Math.max(0, Math.min(index, entries.length - 1));
  const entry = entries[clamped];
  return typeof entry === "string" ? entry : entry.closeTime;
}
