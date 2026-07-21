import { describe, expect, it } from "vitest";
import { buildOverlayMarkers } from "./eventOverlay";
import { inferPricePrecision } from "./pricePrecision";
import type { Candle, MarketEvent } from "../../types";

function candle(index: number): Candle {
  const openTime = new Date(Date.UTC(2020, 0, index + 1)).toISOString();
  const closeTime = new Date(Date.UTC(2020, 0, index + 2) - 1).toISOString();
  return {
    symbol: "BTCUSD",
    openTime,
    closeTime,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1000,
  };
}

function event(id: string, publishedAt: string): MarketEvent {
  return {
    id,
    happenedAt: publishedAt,
    publishedAt,
    title: id,
    type: "news",
    summary: id,
    affectedSymbols: ["BTCUSD"],
    importance: 3,
    sentiment: "neutral",
  };
}

describe("buildOverlayMarkers", () => {
  it("only positions events inside the chart visible candle window", () => {
    const candles = Array.from({ length: 100 }, (_, index) => candle(index));
    const markers = buildOverlayMarkers(
      candles,
      [
        event("old", candles[0].closeTime),
        event("window-start", candles[10].closeTime),
        event("latest", candles[99].closeTime),
      ],
      new Map([
        ["old", 1],
        ["window-start", 2],
        ["latest", 3],
      ]),
    );

    expect(markers.map((marker) => marker.event.id)).toEqual([
      "window-start",
      "latest",
    ]);
    expect(markers[0].leftPct).toBe(0);
    expect(markers[1].leftPct).toBe(100);
  });

  it("places an intrabar publication on the first candle that closes after it", () => {
    const candles = [candle(0), candle(1), candle(2)];
    const publishedAt = new Date(
      (Date.parse(candles[0].closeTime) + Date.parse(candles[1].closeTime)) / 2,
    ).toISOString();
    const markers = buildOverlayMarkers(
      candles,
      [event("intrabar", publishedAt)],
      new Map([["intrabar", 1]]),
    );

    expect(markers[0].leftPct).toBe(50);
  });
});

describe("inferPricePrecision", () => {
  it("keeps conventional prices at two decimals and preserves FX reference rates", () => {
    expect(inferPricePrecision([candle(0)])).toBe(2);
    expect(
      inferPricePrecision([
        {
          ...candle(0),
          open: 0.77435,
          high: 0.77435,
          low: 0.77435,
          close: 0.77435,
        },
      ]),
    ).toBe(5);
  });
});
