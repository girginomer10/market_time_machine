import { describe, expect, it } from "vitest";
import type { Candle, Fill } from "../../types";
import {
  averageLoss,
  averageWin,
  bestTrade,
  exposureTime,
  feesTotal,
  profitFactor,
  portfolioExposureTime,
  realizeTrades,
  slippageTotal,
  tradeOutcomes,
  turnover,
  winRate,
  worstTrade,
} from "./trades";

function fill(overrides: Partial<Fill> & {
  id: string;
  side: Fill["side"];
  time: string;
  price: number;
  quantity: number;
}): Fill {
  return {
    id: overrides.id,
    orderId: overrides.orderId ?? overrides.id,
    time: overrides.time,
    symbol: overrides.symbol ?? "BTC",
    side: overrides.side,
    quantity: overrides.quantity,
    price: overrides.price,
    referencePrice: overrides.referencePrice ?? overrides.price,
    commission: overrides.commission ?? 0,
    spreadCost: overrides.spreadCost ?? 0,
    slippage: overrides.slippage ?? 0,
    totalCost: overrides.totalCost ?? 0,
    note: overrides.note,
  };
}

function candle(time: string, close: number, symbol = "BTC"): Candle {
  return {
    symbol,
    openTime: time,
    closeTime: time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  };
}

describe("realizeTrades", () => {
  it("matches buys and sells in FIFO order with commission proration", () => {
    const fills: Fill[] = [
      fill({ id: "b1", side: "buy", time: "2020-01-01", price: 100, quantity: 1, commission: 1 }),
      fill({ id: "b2", side: "buy", time: "2020-01-02", price: 110, quantity: 1, commission: 1 }),
      fill({ id: "s1", side: "sell", time: "2020-01-03", price: 130, quantity: 2, commission: 2 }),
    ];
    const trades = realizeTrades(fills);
    expect(trades).toHaveLength(1);
    expect(trades[0].matchedQuantity).toBe(2);
    expect(trades[0].realizedPnl).toBeCloseTo((130 - 100) + (130 - 110) - 2 - 1 - 1);
  });

  it("handles partial fills against a lot", () => {
    const fills: Fill[] = [
      fill({ id: "b1", side: "buy", time: "2020-01-01", price: 100, quantity: 2, commission: 2 }),
      fill({ id: "s1", side: "sell", time: "2020-01-02", price: 120, quantity: 1, commission: 1 }),
    ];
    const trades = realizeTrades(fills);
    expect(trades[0].matchedQuantity).toBe(1);
    expect(trades[0].realizedPnl).toBeCloseTo(20 - 1 - 1);
  });

  it("treats a sell with no inventory as a short opening", () => {
    const fills: Fill[] = [
      fill({ id: "s1", side: "sell", time: "2020-01-01", price: 100, quantity: 1, commission: 1 }),
    ];
    const trades = realizeTrades(fills);
    expect(trades).toHaveLength(0);
  });

  it("matches short sales with buy-to-cover fills", () => {
    const fills: Fill[] = [
      fill({ id: "s1", side: "sell", time: "2020-01-01", price: 100, quantity: 2, commission: 2 }),
      fill({ id: "b1", side: "buy", time: "2020-01-02", price: 80, quantity: 1, commission: 1 }),
    ];
    const trades = realizeTrades(fills);
    expect(trades).toHaveLength(1);
    expect(trades[0].positionSide).toBe("short");
    expect(trades[0].matchedQuantity).toBe(1);
    expect(trades[0].matchedCostBasis).toBe(100);
    expect(trades[0].realizedPnl).toBeCloseTo(18);
  });

  it("allocates commissions when a fill closes and reverses", () => {
    const fills: Fill[] = [
      fill({ id: "b1", side: "buy", time: "2020-01-01", price: 100, quantity: 1, commission: 1 }),
      fill({ id: "s1", side: "sell", time: "2020-01-02", price: 110, quantity: 2, commission: 2 }),
      fill({ id: "b2", side: "buy", time: "2020-01-03", price: 90, quantity: 1, commission: 1 }),
    ];
    const trades = realizeTrades(fills);
    expect(trades).toHaveLength(2);
    expect(trades[0].realizedPnl).toBeCloseTo(8);
    expect(trades[1].realizedPnl).toBeCloseTo(18);
  });

  it("orders mixed-offset timestamps by instant rather than text", () => {
    const fills: Fill[] = [
      fill({
        id: "close",
        side: "sell",
        time: "2024-01-01T23:00:00.500Z",
        price: 120,
        quantity: 1,
      }),
      fill({
        id: "open",
        side: "buy",
        time: "2024-01-02T00:30:00+02:00",
        price: 100,
        quantity: 1,
      }),
    ];

    const trades = realizeTrades(fills);
    expect(trades).toHaveLength(1);
    expect(trades[0].positionSide).toBe("long");
    expect(trades[0].realizedPnl).toBeCloseTo(20);
  });
});

describe("tradeOutcomes / best / worst / winRate", () => {
  it("computes contribution percentage relative to total gain", () => {
    const fills: Fill[] = [
      fill({ id: "b1", side: "buy", time: "2020-01-01", price: 100, quantity: 1 }),
      fill({ id: "s1", side: "sell", time: "2020-01-02", price: 120, quantity: 1 }),
    ];
    const outcomes = tradeOutcomes(fills, 1020, 1000);
    expect(outcomes[0].realizedPnl).toBeCloseTo(20);
    expect(outcomes[0].contributionPct).toBeCloseTo(1);
  });

  it("returns best/worst only when sign matches", () => {
    const fills: Fill[] = [
      fill({ id: "b1", side: "buy", time: "2020-01-01", price: 100, quantity: 1 }),
      fill({ id: "s1", side: "sell", time: "2020-01-02", price: 90, quantity: 1 }),
    ];
    const outcomes = tradeOutcomes(fills, 990, 1000);
    expect(bestTrade(outcomes)).toBeUndefined();
    expect(worstTrade(outcomes)?.realizedPnl).toBeCloseTo(-10);
  });

  it("computes winRate", () => {
    const fills: Fill[] = [
      fill({ id: "b1", side: "buy", time: "2020-01-01", price: 100, quantity: 1 }),
      fill({ id: "s1", side: "sell", time: "2020-01-02", price: 120, quantity: 1 }),
      fill({ id: "b2", side: "buy", time: "2020-01-03", price: 100, quantity: 1 }),
      fill({ id: "s2", side: "sell", time: "2020-01-04", price: 90, quantity: 1 }),
    ];
    const outcomes = tradeOutcomes(fills, 1010, 1000);
    expect(winRate(outcomes)).toBeCloseTo(0.5);
  });
});

describe("profitFactor / averageWin / averageLoss", () => {
  it("computes profit factor as gross win / gross loss", () => {
    const outcomes = [
      { fill: {} as Fill, realizedPnl: 30, contributionPct: 0 },
      { fill: {} as Fill, realizedPnl: -10, contributionPct: 0 },
      { fill: {} as Fill, realizedPnl: 20, contributionPct: 0 },
    ];
    expect(profitFactor(outcomes)).toBeCloseTo(50 / 10);
  });

  it("returns Infinity when there are wins but no losses", () => {
    const outcomes = [
      { fill: {} as Fill, realizedPnl: 30, contributionPct: 0 },
    ];
    expect(profitFactor(outcomes)).toBe(Infinity);
  });

  it("returns averages or undefined when empty", () => {
    expect(averageWin([])).toBeUndefined();
    expect(averageLoss([])).toBeUndefined();
    const outcomes = [
      { fill: {} as Fill, realizedPnl: 10, contributionPct: 0 },
      { fill: {} as Fill, realizedPnl: -4, contributionPct: 0 },
    ];
    expect(averageWin(outcomes)).toBeCloseTo(10);
    expect(averageLoss(outcomes)).toBeCloseTo(-4);
  });
});

describe("feesTotal / slippageTotal / turnover", () => {
  it("sums commissions and spread cost", () => {
    const fills: Fill[] = [
      fill({ id: "x", side: "buy", time: "t", price: 100, quantity: 1, commission: 1, spreadCost: 0.5 }),
      fill({ id: "y", side: "sell", time: "t", price: 110, quantity: 1, commission: 1, spreadCost: 0.5 }),
    ];
    expect(feesTotal(fills)).toBeCloseTo(3);
  });

  it("treats spread cost as the fill's total monetary cost", () => {
    const fills: Fill[] = [
      fill({ id: "x", side: "buy", time: "t", price: 100, quantity: 10, spreadCost: 0.1 }),
    ];
    expect(feesTotal(fills)).toBeCloseTo(0.1);
  });

  it("multiplies slippage by quantity", () => {
    const fills: Fill[] = [
      fill({ id: "x", side: "buy", time: "t", price: 100, quantity: 2, slippage: 0.5 }),
    ];
    expect(slippageTotal(fills)).toBeCloseTo(1);
  });

  it("computes notional turnover", () => {
    const fills: Fill[] = [
      fill({ id: "x", side: "buy", time: "t", price: 100, quantity: 1 }),
      fill({ id: "y", side: "sell", time: "t", price: 110, quantity: 1 }),
    ];
    expect(turnover(fills)).toBeCloseTo(210);
  });
});

describe("exposureTime", () => {
  it("counts candles where the position is non-zero", () => {
    const candles = [
      candle("2020-01-01", 100),
      candle("2020-01-02", 105),
      candle("2020-01-03", 110),
      candle("2020-01-04", 108),
    ];
    const fills: Fill[] = [
      fill({ id: "b", side: "buy", time: "2020-01-02", price: 105, quantity: 1 }),
      fill({ id: "s", side: "sell", time: "2020-01-03", price: 110, quantity: 1 }),
    ];
    expect(exposureTime(candles, fills, "BTC")).toBeCloseTo(2 / 4);
  });

  it("returns 0 when there are no candles", () => {
    expect(exposureTime([], [], "BTC")).toBe(0);
  });

  it("counts short positions as exposure", () => {
    const candles = [
      candle("2020-01-01", 100),
      candle("2020-01-02", 95),
      candle("2020-01-03", 90),
    ];
    const fills: Fill[] = [
      fill({ id: "s", side: "sell", time: "2020-01-01", price: 100, quantity: 1 }),
      fill({ id: "b", side: "buy", time: "2020-01-02", price: 95, quantity: 1 }),
    ];
    expect(exposureTime(candles, fills, "BTC")).toBeCloseTo(2 / 3);
  });

  it("computes exposure across a multi-symbol portfolio timeline", () => {
    const candles = [
      candle("2020-01-01", 100, "BTC"),
      candle("2020-01-02", 101, "BTC"),
      candle("2020-01-01T12:00", 50, "ETH"),
      candle("2020-01-03", 55, "ETH"),
    ];
    const fills: Fill[] = [
      fill({ id: "s", side: "sell", time: "2020-01-01", price: 100, quantity: 1 }),
      fill({ id: "b", side: "buy", time: "2020-01-03", price: 90, quantity: 1 }),
    ];
    expect(portfolioExposureTime(candles, fills, ["BTC", "ETH"])).toBe(1);
  });
});
