import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, MarketEvent } from "../../types";
import type { Fill, Order } from "../../types";
import {
  buildOverlayMarkers,
  firstChartWindowIndex,
  type OverlayMarker,
} from "./eventOverlay";

type Props = {
  candles: Candle[];
  events: MarketEvent[];
  fills: Fill[];
  orders: Order[];
  eventNumbers: Map<string, number>;
  hoveredEventId?: string;
  onHoverEvent: (id?: string) => void;
};

export default function ReplayChart({
  candles,
  events,
  fills,
  orders,
  eventNumbers,
  hoveredEventId,
  onHoverEvent,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const chartData = useMemo(
    () =>
      candles.map((c) => ({
        time: Math.floor(Date.parse(c.openTime) / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    [candles],
  );

  const volumeData = useMemo(
    () =>
      candles.map((c) => ({
        time: Math.floor(Date.parse(c.openTime) / 1000) as UTCTimestamp,
        value: c.volume,
        color:
          c.close >= c.open
            ? "rgba(79, 197, 138, 0.28)"
            : "rgba(242, 106, 111, 0.28)",
      })),
    [candles],
  );

  const overlayMarkers = useMemo<OverlayMarker[]>(() => {
    return buildOverlayMarkers(candles, events, eventNumbers);
  }, [candles, events, eventNumbers]);
  const tradeMarkers = useMemo(() => {
    if (candles.length === 0) return [];
    const first = firstChartWindowIndex(candles.length);
    const visibleWindow = candles.slice(first);
    const timeToIndex = new Map(
      visibleWindow.map((candle, index) => [candle.closeTime, index]),
    );
    const denominator = Math.max(1, visibleWindow.length - 1);
    const fillMarkers = fills
      .map((fill) => {
        const index = timeToIndex.get(fill.time);
        if (index === undefined) return undefined;
        return {
          id: fill.id,
          leftPct: (index / denominator) * 100,
          label: fill.forcedLiquidation ? "L" : fill.side === "buy" ? "B" : "S",
          tone: fill.forcedLiquidation ? "liquidation" : fill.side,
          title: `${fill.side} ${fill.quantity} ${fill.symbol} @ ${fill.price}`,
        };
      })
      .filter((marker): marker is NonNullable<typeof marker> => Boolean(marker));
    const orderMarkers = orders
      .filter((order) => order.status === "pending" || order.status === "partially_filled")
      .map((order) => ({
        id: order.id,
        leftPct: 98,
        label: order.type === "limit" ? "LMT" : order.type === "stop_loss" ? "STP" : "TGT",
        tone: "working",
        title: `${order.type} ${order.side} ${order.remainingQuantity ?? order.quantity} ${order.symbol}`,
      }));
    return [...fillMarkers, ...orderMarkers];
  }, [candles, fills, orders]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: "#b6c0ce",
        fontFamily:
          'ui-monospace, "IBM Plex Mono", "SF Mono", Consolas, monospace',
      },
      grid: {
        horzLines: { color: "rgba(255,255,255,0.04)" },
        vertLines: { color: "rgba(255,255,255,0.025)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.14)",
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.14)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const series = chart.addCandlestickSeries({
      upColor: "#4fc58a",
      downColor: "#f26a6f",
      wickUpColor: "rgba(79, 197, 138, 0.75)",
      wickDownColor: "rgba(242, 106, 111, 0.75)",
      borderVisible: false,
    });

    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.84, bottom: 0 },
    });

    chartRef.current = chart;
    seriesRef.current = series;
    volumeRef.current = volume;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !volumeRef.current) return;
    seriesRef.current.setData(chartData);
    volumeRef.current.setData(volumeData);
    if (chartData.length > 0) {
      const last = chartData[chartData.length - 1];
      chartRef.current?.timeScale().scrollToPosition(2, false);
      chartRef.current?.timeScale().setVisibleRange({
        from: chartData[firstChartWindowIndex(chartData.length)].time,
        to: last.time,
      });
    }
  }, [chartData, volumeData]);

  return (
    <div className="chart-wrap">
      <div className="chart-event-layer" aria-label="Visible event markers">
        {overlayMarkers.map(({ event, number, leftPct }) => (
          <button
            key={event.id}
            className={
              hoveredEventId === event.id
                ? "chart-event-marker active"
                : "chart-event-marker"
            }
            style={{ left: `${leftPct}%` }}
            onMouseEnter={() => onHoverEvent(event.id)}
            onMouseLeave={() => onHoverEvent(undefined)}
            title={event.title}
            aria-label={`Event ${number}: ${event.title}`}
          >
            {number}
          </button>
        ))}
      </div>
      <div className="chart-trade-layer" aria-label="Visible order and fill markers">
        {tradeMarkers.map((marker) => (
          <span
            key={marker.id}
            className={`chart-trade-marker ${marker.tone}`}
            style={{ left: `${marker.leftPct}%` }}
            title={marker.title}
          >
            {marker.label}
          </span>
        ))}
      </div>
      <div className="now-line" aria-hidden>
        <span>Now</span>
      </div>
      <div className="future-note" aria-hidden>
        Future hidden until replay advances
      </div>
      <div className="chart-host" ref={containerRef} />
    </div>
  );
}
