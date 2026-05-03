import { describe, expect, it } from "vitest";
import { buildOverlayMarkers } from "./eventOverlay";
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
});
