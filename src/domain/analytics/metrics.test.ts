import { describe, expect, it } from "vitest";
import {
  annualizedVolatility,
  benchmarkReturn,
  calmarRatio,
  excessReturn,
  maxDrawdown,
  mean,
  periodsPerYearForGranularity,
  sharpeRatio,
  simpleReturns,
  sortinoRatio,
  stdDev,
  totalReturn,
  volatility,
} from "./metrics";

describe("totalReturn", () => {
  it("computes percentage gain", () => {
    expect(totalReturn(100, 150)).toBeCloseTo(0.5);
  });

  it("returns 0 when initial is zero", () => {
    expect(totalReturn(0, 100)).toBe(0);
  });

  it("handles loss", () => {
    expect(totalReturn(200, 150)).toBeCloseTo(-0.25);
  });
});

describe("benchmarkReturn", () => {
  it("matches totalReturn shape", () => {
    expect(benchmarkReturn(100, 110)).toBeCloseTo(0.1);
  });

  it("returns 0 when initial is zero", () => {
    expect(benchmarkReturn(0, 100)).toBe(0);
  });
});

describe("excessReturn", () => {
  it("subtracts benchmark from total", () => {
    expect(excessReturn(0.2, 0.1)).toBeCloseTo(0.1);
    expect(excessReturn(-0.05, 0.1)).toBeCloseTo(-0.15);
  });
});

describe("simpleReturns", () => {
  it("computes period-over-period returns", () => {
    expect(simpleReturns([100, 110, 99])).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(-0.1, 5),
    ]);
  });

  it("returns empty array for short series", () => {
    expect(simpleReturns([])).toEqual([]);
    expect(simpleReturns([100])).toEqual([]);
  });
});

describe("mean and stdDev", () => {
  it("computes the arithmetic mean", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it("computes sample stdDev", () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });

  it("returns 0 for short series in stdDev", () => {
    expect(stdDev([])).toBe(0);
    expect(stdDev([5])).toBe(0);
  });
});

describe("volatility / annualizedVolatility", () => {
  it("equals stdDev of returns", () => {
    const returns = [0.01, -0.02, 0.015, 0.0];
    expect(volatility(returns)).toBeCloseTo(stdDev(returns));
  });

  it("scales by sqrt(periodsPerYear)", () => {
    const returns = [0.01, -0.01, 0.02, -0.005, 0.01];
    expect(annualizedVolatility(returns, 252)).toBeCloseTo(
      volatility(returns) * Math.sqrt(252),
    );
  });
});

describe("maxDrawdown", () => {
  it("captures peak-to-trough drop", () => {
    expect(maxDrawdown([100, 120, 90, 110, 80])).toBeCloseTo((120 - 80) / 120);
  });

  it("returns 0 for monotonically rising series", () => {
    expect(maxDrawdown([100, 110, 130])).toBe(0);
  });

  it("returns 0 for an empty series", () => {
    expect(maxDrawdown([])).toBe(0);
  });
});

describe("sharpeRatio / sortinoRatio", () => {
  it("returns undefined when there is no variance", () => {
    expect(sharpeRatio([0.01, 0.01, 0.01], 252)).toBeUndefined();
  });

  it("returns undefined for short series", () => {
    expect(sharpeRatio([0.01], 252)).toBeUndefined();
  });

  it("produces a finite number for varied returns", () => {
    const value = sharpeRatio([0.01, -0.005, 0.02, -0.01, 0.015], 252);
    expect(value).toBeDefined();
    expect(Number.isFinite(value)).toBe(true);
  });

  it("sortino uses only downside deviation", () => {
    const all = sharpeRatio([0.01, -0.02, 0.03, -0.01], 252);
    const sortino = sortinoRatio([0.01, -0.02, 0.03, -0.01], 252);
    expect(sortino).toBeDefined();
    expect(all).toBeDefined();
    expect(sortino).not.toBe(all);
  });
});

describe("calmarRatio", () => {
  it("divides return by drawdown", () => {
    expect(calmarRatio(0.4, 0.2)).toBeCloseTo(2);
  });

  it("returns undefined when drawdown is zero", () => {
    expect(calmarRatio(0.4, 0)).toBeUndefined();
  });
});

describe("periodsPerYearForGranularity", () => {
  it("maps daily to 365", () => {
    expect(periodsPerYearForGranularity("1d")).toBe(365);
  });

  it("maps hourly to 8760", () => {
    expect(periodsPerYearForGranularity("1h")).toBe(365 * 24);
  });
});
