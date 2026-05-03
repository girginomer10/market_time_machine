import type { Candle, MarketEvent } from "../../types";

const CHART_WINDOW_CANDLES = 90;

export type OverlayMarker = {
  event: MarketEvent;
  number: number;
  leftPct: number;
};

function eventIndex(candles: Candle[], event: MarketEvent): number {
  let result = -1;
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].closeTime <= event.publishedAt) result = i;
    else break;
  }
  return result < 0 ? 0 : result;
}

export function buildOverlayMarkers(
  candles: Candle[],
  events: MarketEvent[],
  eventNumbers: Map<string, number>,
): OverlayMarker[] {
  if (candles.length === 0) return [];
  const firstVisibleIndex = Math.max(0, candles.length - CHART_WINDOW_CANDLES);
  const visibleCount = candles.length - firstVisibleIndex;
  const denominator = Math.max(1, visibleCount - 1);
  return events.flatMap((event) => {
    const index = eventIndex(candles, event);
    if (index < firstVisibleIndex) return [];
    return [
      {
        event,
        number: eventNumbers.get(event.id) ?? 0,
        leftPct: ((index - firstVisibleIndex) / denominator) * 100,
      },
    ];
  });
}

export function firstChartWindowIndex(candleCount: number): number {
  return Math.max(0, candleCount - CHART_WINDOW_CANDLES);
}
