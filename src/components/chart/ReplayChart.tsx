import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, MarketEvent } from "../../types";
import {
  buildOverlayMarkers,
  firstChartWindowIndex,
  type OverlayMarker,
} from "./eventOverlay";

type Props = {
  candles: Candle[];
  events: MarketEvent[];
  eventNumbers: Map<string, number>;
  hoveredEventId?: string;
  onHoverEvent: (id?: string) => void;
};

export default function ReplayChart({
  candles,
  events,
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
