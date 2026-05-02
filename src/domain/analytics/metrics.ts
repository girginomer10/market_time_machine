import type { Granularity } from "../../types";

export function totalReturn(
  initialEquity: number,
  finalEquity: number,
): number {
  if (!isFinite(initialEquity) || initialEquity === 0) return 0;
  return finalEquity / initialEquity - 1;
}

export function benchmarkReturn(
  initialBenchmark: number,
  finalBenchmark: number,
): number {
  if (!isFinite(initialBenchmark) || initialBenchmark === 0) return 0;
  return finalBenchmark / initialBenchmark - 1;
}

export function excessReturn(
  totalReturnValue: number,
  benchmarkReturnValue: number,
): number {
  return totalReturnValue - benchmarkReturnValue;
}

export function simpleReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    if (prev !== 0 && isFinite(prev)) {
      out.push(values[i] / prev - 1);
    } else {
      out.push(0);
    }
  }
  return out;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function volatility(returns: number[]): number {
  return stdDev(returns);
}

export function annualizedVolatility(
  returns: number[],
  periodsPerYear: number,
): number {
  return volatility(returns) * Math.sqrt(Math.max(periodsPerYear, 0));
}

export function maxDrawdown(values: number[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

export function sharpeRatio(
  returns: number[],
  periodsPerYear: number,
  riskFreeRate = 0,
): number | undefined {
  if (returns.length < 2) return undefined;
  const periodRf = riskFreeRate / periodsPerYear;
  const excess = returns.map((r) => r - periodRf);
  const sd = stdDev(excess);
  if (sd === 0) return undefined;
  return (mean(excess) / sd) * Math.sqrt(periodsPerYear);
}

export function sortinoRatio(
  returns: number[],
  periodsPerYear: number,
  riskFreeRate = 0,
): number | undefined {
  if (returns.length < 2) return undefined;
  const periodRf = riskFreeRate / periodsPerYear;
  const excess = returns.map((r) => r - periodRf);
  const downside = excess.filter((r) => r < 0);
  const sd = stdDev(downside);
  if (sd === 0) return undefined;
  return (mean(excess) / sd) * Math.sqrt(periodsPerYear);
}

export function calmarRatio(
  totalReturnValue: number,
  maxDrawdownValue: number,
): number | undefined {
  if (maxDrawdownValue <= 0) return undefined;
  return totalReturnValue / maxDrawdownValue;
}

export function periodsPerYearForGranularity(g: Granularity): number {
  switch (g) {
    case "1m":
      return 365 * 24 * 60;
    case "5m":
      return 365 * 24 * 12;
    case "15m":
      return 365 * 24 * 4;
    case "1h":
      return 365 * 24;
    case "4h":
      return 365 * 6;
    case "1d":
      return 365;
    default:
      return 365;
  }
}
