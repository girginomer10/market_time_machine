import { describe, expect, it } from "vitest";
import {
  lastVisibleCandleIndex,
  tradablePricesFor,
  visibleBenchmark,
  visibleCandles,
  visibleEvents,
} from "./engine";
import { makeScenario } from "../../test/fixtures";

describe("replay visibility rules", () => {
  const scenario = makeScenario();
  const candles = scenario.candles;

  it("hides candles whose closeTime is in the future", () => {
    const visible = visibleCandles(candles, candles[2].closeTime);
    expect(visible).toHaveLength(3);
    expect(visible[visible.length - 1].closeTime).toBe(candles[2].closeTime);
  });

  it("never returns candles with closeTime greater than the current replay time", () => {
    const cutoff = candles[3].closeTime;
    const visible = visibleCandles(candles, cutoff);
    for (const candle of visible) {
      expect(candle.closeTime <= cutoff).toBe(true);
    }
  });

  it("returns -1 when no candle has been published yet", () => {
    expect(lastVisibleCandleIndex(candles, "2023-12-31T00:00:00.000Z")).toBe(
      -1,
    );
  });

  it("hides events whose publishedAt is after the current time even when they happened earlier", () => {
    const beforePublication = "2024-01-04T00:00:00.000Z";
    const afterPublication = "2024-01-06T00:00:00.000Z";
    const hiddenEvents = visibleEvents(scenario.events, beforePublication);
    expect(hiddenEvents.find((e) => e.id === "evt-2")).toBeUndefined();
    const allEvents = visibleEvents(scenario.events, afterPublication);
    expect(allEvents.find((e) => e.id === "evt-2")).toBeDefined();
  });

  it("only includes benchmark points up to the current time", () => {
    const cutoff = scenario.benchmarks[2].time;
    const series = visibleBenchmark(scenario.benchmarks, cutoff);
    expect(series).toHaveLength(3);
    expect(series.every((p) => p.time <= cutoff)).toBe(true);
  });

  it("uses the last visible candle close as tradable price", () => {
    const cutoff = candles[1].closeTime;
    const prices = tradablePricesFor(scenario, cutoff);
    expect(prices).toHaveLength(1);
    expect(prices[0].price).toBe(candles[1].close);
  });

  it("uses the active broker spread when building tradable prices", () => {
    const cutoff = candles[1].closeTime;
    const prices = tradablePricesFor(scenario, cutoff, {
      ...scenario.broker,
      spreadBps: 100,
    });
    expect(prices).toHaveLength(1);
    expect(prices[0].bid).toBeCloseTo(candles[1].close * 0.995, 6);
    expect(prices[0].ask).toBeCloseTo(candles[1].close * 1.005, 6);
  });
});
