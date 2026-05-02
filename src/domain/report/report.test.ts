import { describe, expect, it } from "vitest";
import { buildReport } from "./report";
import { maxDrawdown } from "../analytics/metrics";
import { makeScenario } from "../../test/fixtures";
import type { Fill } from "../../types";

function fillFor(overrides: Partial<Fill>): Fill {
  return {
    id: overrides.id ?? "f1",
    orderId: overrides.orderId ?? "o1",
    time: overrides.time ?? "2024-01-02T23:59:59.000Z",
    symbol: "TEST",
    side: "buy",
    quantity: 1,
    price: 100,
    referencePrice: 100,
    commission: 0,
    spreadCost: 0,
    slippage: 0,
    totalCost: 100,
    ...overrides,
  };
}

describe("report builder", () => {
  it("computes max drawdown correctly", () => {
    expect(maxDrawdown([100, 120, 90, 110, 80])).toBeCloseTo(
      (120 - 80) / 120,
      6,
    );
    expect(maxDrawdown([])).toBe(0);
    expect(maxDrawdown([100, 105, 110])).toBe(0);
  });

  it("compares portfolio with buy-and-hold benchmark", () => {
    const scenario = makeScenario();
    const report = buildReport({
      scenario,
      fills: [],
      initialCash: scenario.meta.initialCash,
    });
    expect(report.metrics.totalReturn).toBeCloseTo(0, 6);
    const firstClose = scenario.candles[0].close;
    const lastClose = scenario.candles[scenario.candles.length - 1].close;
    const expectedBenchmark = lastClose / firstClose - 1;
    expect(report.metrics.benchmarkReturn).toBeCloseTo(expectedBenchmark, 6);
  });

  it("captures fees and slippage from filled trades", () => {
    const scenario = makeScenario();
    const fill = fillFor({
      id: "buy1",
      quantity: 5,
      price: 100,
      commission: 5,
      spreadCost: 0.5,
      slippage: 0.25,
      totalCost: 505.5,
      time: scenario.candles[1].closeTime,
    });
    const report = buildReport({
      scenario,
      fills: [fill],
      initialCash: scenario.meta.initialCash,
    });
    expect(report.metrics.feesPaid).toBeCloseTo(5.5, 6);
    expect(report.metrics.slippagePaid).toBeCloseTo(0.25 * 5, 6);
  });

  it("identifies best closed trade", () => {
    const scenario = makeScenario();
    const buy = fillFor({
      id: "buy1",
      quantity: 1,
      price: 100,
      time: scenario.candles[1].closeTime,
    });
    const sell = fillFor({
      id: "sell1",
      side: "sell",
      quantity: 1,
      price: 130,
      time: scenario.candles[3].closeTime,
    });
    const report = buildReport({
      scenario,
      fills: [buy, sell],
      initialCash: scenario.meta.initialCash,
    });
    expect(report.totalTrades).toBe(2);
    expect(report.bestTrade?.realizedPnl).toBeCloseTo(30, 6);
  });
});
