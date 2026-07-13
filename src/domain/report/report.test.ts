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
    expect(report.score?.status).toBe("insufficient_evidence");
    expect(report.score?.overall).toBeUndefined();
    expect(report.recommendations?.[0].id).toBe(
      "complete-documented-decision",
    );
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
    expect(report.totalTrades).toBe(1);
    expect(report.closedTradeCount).toBe(1);
    expect(report.bestTrade?.realizedPnl).toBeCloseTo(30, 6);
  });

  it("starts the equity curve at initial capital and reconciles financing", () => {
    const scenario = makeScenario();
    const buy = fillFor({
      id: "buy1",
      quantity: 1,
      commission: 10,
      time: scenario.candles[0].closeTime,
    });
    const report = buildReport({
      scenario,
      fills: [buy],
      initialCash: scenario.meta.initialCash,
      financingPaid: 25,
    });
    expect(report.equityCurve[0]).toMatchObject({
      time: scenario.meta.startTime,
      portfolioValue: scenario.meta.initialCash,
      isInitial: true,
    });
    expect(report.equityCurve.at(-1)?.financingCost).toBe(25);
    expect(report.equityCurve.at(-1)?.portfolioValue).toBe(
      report.metrics.finalEquity,
    );
    expect(report.executionQuality?.borrowCostPaid).toBe(25);
  });

  it("counts historical partial fills after the order later completes", () => {
    const scenario = makeScenario();
    const fills = [
      fillFor({ id: "p1", orderId: "o1", quantity: 0.4 }),
      fillFor({ id: "p2", orderId: "o1", quantity: 0.6, time: scenario.candles[1].closeTime }),
    ];
    const report = buildReport({
      scenario,
      fills,
      orders: [
        {
          id: "o1",
          createdAt: scenario.meta.startTime,
          symbol: "TEST",
          side: "buy",
          type: "limit",
          quantity: 1,
          status: "filled",
        },
      ],
      initialCash: scenario.meta.initialCash,
    });
    expect(report.executionQuality?.partialFillCount).toBe(1);
  });

  it("includes journal, decision replay, outcomes, and attribution", () => {
    const scenario = makeScenario();
    const buy = fillFor({ id: "buy1", time: scenario.candles[0].closeTime });
    const sell = fillFor({
      id: "sell1",
      orderId: "sell-order",
      side: "sell",
      price: 120,
      time: scenario.candles[2].closeTime,
    });
    const report = buildReport({
      scenario,
      fills: [buy, sell],
      journal: [
        {
          id: "j1",
          time: sell.time,
          fillId: sell.id,
          note:
            "Took profit because momentum weakened; risk target and exit were planned.",
        },
      ],
      initialCash: scenario.meta.initialCash,
    });
    expect(report.tradeOutcomes).toHaveLength(1);
    expect(report.fills).toHaveLength(2);
    expect(report.journal?.[0].note).toContain("momentum");
    expect(report.decisionReplay?.[1].journalEntry?.id).toBe("j1");
    expect(report.decisionReplay?.[1].tradeOutcome?.realizedPnl).toBeCloseTo(20);
    expect(report.attribution?.realizedTradePnl).toBeCloseTo(20);
    expect(report.provenance).toMatchObject({
      license: "MIT",
      dataSources: ["test"],
      isSampleData: true,
    });
    expect(report.score?.components.map(({ id, weight }) => [id, weight])).toEqual(
      [
        ["risk_adjusted_return", 0.35],
        ["benchmark_outperformance", 0.25],
        ["drawdown_control", 0.2],
        ["decision_consistency", 0.1],
        ["journal_quality", 0.1],
      ],
    );
    expect(report.score?.status).toBe("scored");
    expect(report.score?.overall).toBeTypeOf("number");
    expect(report.journalQuality).toMatchObject({
      status: "assessed",
      executedDecisionCount: 2,
      linkedEntryCount: 1,
      reasonRate: 1,
      riskPlanRate: 1,
    });
    expect(report.decisionConsistency?.status).toBe("assessed");
  });

  it("groups partial fills into one structured decision with visible event context", () => {
    const scenario = makeScenario();
    const first = fillFor({
      id: "partial-1",
      orderId: "planned-order",
      quantity: 0.4,
      price: 105,
      time: scenario.candles[2].closeTime,
    });
    const second = fillFor({
      id: "partial-2",
      orderId: "planned-order",
      quantity: 0.6,
      price: 110,
      time: scenario.candles[3].closeTime,
    });
    const decisionPlan = {
      thesis: "The published event supports the recovery thesis.",
      invalidation: "Close below 95.",
      exitPlan: "Exit into a 20% rally.",
      acceptedRisk: "$50 maximum loss",
      linkedEventIds: ["evt-1", "evt-2"],
    };

    const report = buildReport({
      scenario,
      fills: [second, first],
      orders: [
        {
          id: "planned-order",
          createdAt: first.time,
          symbol: "TEST",
          side: "buy",
          type: "limit",
          quantity: 1,
          status: "filled",
          decisionPlan,
          note: decisionPlan.thesis,
        },
      ],
      initialCash: scenario.meta.initialCash,
    });

    expect(report.decisionReplay).toHaveLength(1);
    expect(report.decisionReplay?.[0]).toMatchObject({
      decisionPlan,
      actual: {
        fillCount: 2,
        executedQuantity: 1,
        averageFillPrice: 108,
        result: "not_realized",
      },
    });
    expect(report.decisionReplay?.[0].fills?.map((fill) => fill.id)).toEqual([
      "partial-1",
      "partial-2",
    ]);
    expect(report.decisionReplay?.[0].visibleEvents?.map((event) => event.id)).toEqual([
      "evt-1",
    ]);
    expect(report.decisionReplay?.[0].linkedEvents?.map((event) => event.id)).toEqual([
      "evt-1",
    ]);
    expect(report.journalQuality).toMatchObject({
      status: "assessed",
      structuredPlanRate: 1,
      eventLinkRate: 1,
      reasonRate: 1,
      riskPlanRate: 1,
    });
  });

  it("uses order submission time for decision chronology and visible information", () => {
    const scenario = makeScenario();
    const fill = fillFor({
      id: "pending-fill",
      orderId: "pending-order",
      time: scenario.candles[3].closeTime,
    });
    const createdAt = scenario.candles[1].closeTime;
    const report = buildReport({
      scenario,
      fills: [fill],
      orders: [
        {
          id: "pending-order",
          createdAt,
          symbol: "TEST",
          side: "buy",
          type: "limit",
          quantity: 1,
          status: "filled",
          decisionPlan: {
            thesis: "Enter before the scheduled information release.",
            linkedEventIds: ["evt-1"],
          },
        },
      ],
      initialCash: scenario.meta.initialCash,
    });

    expect(report.decisionReplay?.[0].decisionTime).toBe(createdAt);
    expect(report.decisionReplay?.[0].actual?.firstFillTime).toBe(fill.time);
    expect(report.decisionReplay?.[0].visibleEvents).toEqual([]);
    expect(report.decisionReplay?.[0].linkedEvents).toEqual([]);
  });

  it("carries field-level data fidelity into provenance", () => {
    const scenario = makeScenario();
    scenario.meta.dataFidelity = "mixed";
    scenario.meta.observedFields = ["Observed daily close"];
    scenario.meta.derivedFields = ["Open, high, and low reconstructed from close"];

    const report = buildReport({
      scenario,
      fills: [],
      initialCash: scenario.meta.initialCash,
    });

    expect(report.provenance).toMatchObject({
      dataFidelity: "mixed",
      observedFields: ["Observed daily close"],
      derivedFields: ["Open, high, and low reconstructed from close"],
    });
  });

  it("sorts mixed-offset and fractional timestamps by instant", () => {
    const scenario = makeScenario();
    const report = buildReport({
      scenario,
      fills: [],
      initialCash: scenario.meta.initialCash,
      financingCosts: [
        { time: "2024-01-01T23:00:00.500Z", amount: 5 },
        { time: "2024-01-02T00:30:00+02:00", amount: 3 },
      ],
    });

    const financingPoints = report.equityCurve.filter(
      (point) => point.financingCost !== undefined,
    );
    expect(financingPoints.map((point) => point.time)).toEqual([
      "2024-01-01T22:30:00.000Z",
      "2024-01-01T23:00:00.500Z",
    ]);
    expect(financingPoints.map((point) => point.financingCost)).toEqual([3, 5]);
    expect(
      report.equityCurve.every(
        (point, index, points) =>
          index === 0 ||
          Date.parse(points[index - 1].time) <= Date.parse(point.time),
      ),
    ).toBe(true);
  });

  it("applies raw splits and dividends at their effective timeline point", () => {
    const base = makeScenario();
    const closes = [100, 50, 55];
    const candles = base.candles.slice(0, closes.length).map((candle, index) => ({
      ...candle,
      open: index === 0 ? closes[index] : closes[index - 1],
      high: Math.max(closes[index], index === 0 ? closes[index] : closes[index - 1]),
      low: Math.min(closes[index], index === 0 ? closes[index] : closes[index - 1]),
      close: closes[index],
    }));
    const actionTime = candles[1].closeTime;
    const scenario = {
      ...base,
      meta: {
        ...base.meta,
        endTime: candles.at(-1)!.closeTime,
        priceAdjustment: "raw" as const,
      },
      candles,
      benchmarks: candles.map((candle) => ({
        symbol: candle.symbol,
        time: candle.closeTime,
        value: candle.close,
      })),
      corporateActions: [
        {
          symbol: "TEST",
          type: "split" as const,
          effectiveAt: actionTime,
          ratio: 2,
        },
        {
          symbol: "TEST",
          type: "dividend" as const,
          effectiveAt: actionTime,
          amount: 1,
        },
      ],
    };
    const report = buildReport({
      scenario,
      fills: [fillFor({ id: "buy", time: candles[0].closeTime })],
      initialCash: 1_000,
    });

    expect(
      report.equityCurve.find((point) => point.time === actionTime)
        ?.portfolioValue,
    ).toBeCloseTo(1_002);
    expect(report.metrics.finalEquity).toBeCloseTo(1_012);
  });

  it("does not re-mark a between-candle raw split with the pre-split close", () => {
    const base = makeScenario();
    const closes = [100, 50];
    const candles = base.candles.slice(0, closes.length).map((candle, index) => ({
      ...candle,
      open: index === 0 ? closes[index] : closes[index - 1],
      high: Math.max(closes[index], index === 0 ? closes[index] : closes[index - 1]),
      low: Math.min(closes[index], index === 0 ? closes[index] : closes[index - 1]),
      close: closes[index],
    }));
    const actionTime = "2024-01-02T12:00:00.000Z";
    const scenario = {
      ...base,
      meta: {
        ...base.meta,
        endTime: candles.at(-1)!.closeTime,
        priceAdjustment: "raw" as const,
      },
      candles,
      benchmarks: candles.map((candle) => ({
        symbol: candle.symbol,
        time: candle.closeTime,
        value: candle.close,
      })),
      corporateActions: [
        {
          symbol: "TEST",
          type: "split" as const,
          effectiveAt: actionTime,
          ratio: 2,
        },
      ],
    };
    const report = buildReport({
      scenario,
      fills: [fillFor({ id: "buy", time: candles[0].closeTime })],
      initialCash: 1_000,
    });

    expect(
      report.equityCurve.find((point) => point.time === actionTime)
        ?.portfolioValue,
    ).toBeCloseTo(1_000);
    expect(report.metrics.finalEquity).toBeCloseTo(1_000);
  });

  it("charges dividends to short positions for non-total-return data", () => {
    const base = makeScenario();
    const candles = base.candles.slice(0, 2).map((candle) => ({
      ...candle,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
    }));
    const actionTime = candles[1].closeTime;
    const scenario = {
      ...base,
      meta: {
        ...base.meta,
        endTime: actionTime,
        priceAdjustment: "split_adjusted" as const,
      },
      candles,
      benchmarks: candles.map((candle) => ({
        symbol: candle.symbol,
        time: candle.closeTime,
        value: candle.close,
      })),
      corporateActions: [
        {
          symbol: "TEST",
          type: "dividend" as const,
          effectiveAt: actionTime,
          amount: 3,
        },
      ],
    };
    const report = buildReport({
      scenario,
      fills: [
        fillFor({
          id: "short",
          side: "sell",
          time: candles[0].closeTime,
        }),
      ],
      initialCash: 1_000,
    });

    expect(report.metrics.finalEquity).toBeCloseTo(997);
  });
});
