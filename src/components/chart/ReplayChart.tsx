import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "../../types";

type Props = {
  candles: Candle[];
};

export default function ReplayChart({ candles }: Props) {
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
          c.close >= c.open ? "rgba(46, 204, 113, 0.3)" : "rgba(239, 68, 68, 0.3)",
      })),
    [candles],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: "#aab3c5",
        fontFamily:
          'ui-monospace, "JetBrains Mono", "SF Mono", Consolas, monospace',
      },
      grid: {
        horzLines: { color: "rgba(255,255,255,0.04)" },
        vertLines: { color: "rgba(255,255,255,0.03)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.08)",
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const series = chart.addCandlestickSeries({
      upColor: "#2ecc71",
      downColor: "#ef4444",
      wickUpColor: "rgba(46, 204, 113, 0.7)",
      wickDownColor: "rgba(239, 68, 68, 0.7)",
      borderVisible: false,
    });

    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
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
        from: chartData[Math.max(0, chartData.length - 90)].time,
        to: last.time,
      });
    }
  }, [chartData, volumeData]);

  return (
    <div className="chart-wrap">
      <div className="chart-host" ref={containerRef} />
    </div>
  );
}
