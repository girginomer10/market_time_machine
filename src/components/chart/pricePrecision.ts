import type { Candle } from "../../types";

function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = Math.abs(value).toFixed(8).replace(/0+$/, "");
  const decimal = normalized.indexOf(".");
  return decimal < 0 ? 0 : normalized.length - decimal - 1;
}

export function inferPricePrecision(candles: Candle[]): number {
  const observed = candles.slice(-120).flatMap((candle) => [
    candle.open,
    candle.high,
    candle.low,
    candle.close,
  ]);
  const precision = observed.reduce(
    (maximum, value) => Math.max(maximum, decimalPlaces(value)),
    0,
  );
  return Math.max(2, Math.min(6, precision));
}
