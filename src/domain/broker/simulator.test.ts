import { describe, expect, it } from "vitest";
import {
  commissionFor,
  createLimitOrder,
  executeLimitOrderFill,
  executeMarketOrder,
  isLimitOrderTriggered,
  priceWithSpreadAndSlippage,
} from "./simulator";
import { makeBroker } from "../../test/fixtures";

const TIME = "2024-01-03T00:00:00.000Z";

describe("broker simulator", () => {
  it("rejects when no tradable price is available", () => {
    const result = executeMarketOrder({
      request: { symbol: "TEST", side: "buy", type: "market", quantity: 1 },
      broker: makeBroker(),
      cash: 1000,
      currentTime: TIME,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/tradable price/i);
    }
  });

  it("applies spread to fill price for buys", () => {
    const broker = makeBroker({ spreadBps: 20 });
    const { fillPrice, spreadCost } = priceWithSpreadAndSlippage(
      100,
      "buy",
      broker,
    );
    expect(spreadCost).toBeCloseTo(0.1, 6);
    expect(fillPrice).toBeCloseTo(100.1, 6);
  });

  it("applies negative spread to fill price for sells", () => {
    const broker = makeBroker({ spreadBps: 20 });
    const { fillPrice } = priceWithSpreadAndSlippage(100, "sell", broker);
    expect(fillPrice).toBeCloseTo(99.9, 6);
  });

  it("computes commission as bps + fixed fee", () => {
    const broker = makeBroker({ commissionRateBps: 30, fixedFee: 1 });
    expect(commissionFor(1000, broker)).toBeCloseTo(1000 * 0.003 + 1, 6);
  });

  it("rejects buy when cash is insufficient", () => {
    const broker = makeBroker({
      commissionRateBps: 50,
      spreadBps: 0,
    });
    const result = executeMarketOrder({
      request: { symbol: "TEST", side: "buy", type: "market", quantity: 11 },
      broker,
      cash: 1000,
      tradablePrice: { symbol: "TEST", time: TIME, price: 100, bid: 100, ask: 100 },
      currentTime: TIME,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/insufficient cash/i);
    }
  });

  it("rejects sell when no position", () => {
    const result = executeMarketOrder({
      request: { symbol: "TEST", side: "sell", type: "market", quantity: 1 },
      broker: makeBroker(),
      cash: 0,
      tradablePrice: { symbol: "TEST", time: TIME, price: 100, bid: 100, ask: 100 },
      currentTime: TIME,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/shorting disabled/i);
    }
  });

  it("rejects sell when the requested quantity exceeds an existing long position", () => {
    const result = executeMarketOrder({
      request: { symbol: "TEST", side: "sell", type: "market", quantity: 2 },
      broker: makeBroker(),
      cash: 0,
      position: {
        symbol: "TEST",
        quantity: 1,
        averagePrice: 100,
        marketPrice: 100,
        marketValue: 100,
        unrealizedPnl: 0,
        realizedPnl: 0,
      },
      tradablePrice: { symbol: "TEST", time: TIME, price: 100, bid: 100, ask: 100 },
      currentTime: TIME,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/insufficient position/i);
    }
  });

  it("fills a buy order with commission and updates totals", () => {
    const broker = makeBroker({ commissionRateBps: 10, spreadBps: 0 });
    const result = executeMarketOrder({
      request: { symbol: "TEST", side: "buy", type: "market", quantity: 5 },
      broker,
      cash: 1000,
      tradablePrice: { symbol: "TEST", time: TIME, price: 100, bid: 100, ask: 100 },
      currentTime: TIME,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fill.price).toBeCloseTo(100, 6);
      expect(result.fill.commission).toBeCloseTo(500 * 0.001, 6);
      expect(result.fill.totalCost).toBeCloseTo(500 + 500 * 0.001, 6);
    }
  });

  it("uses volume-aware slippage in the main execution path", () => {
    const broker = makeBroker({
      slippageModel: "volume_based",
      slippageBps: 10,
      spreadBps: 0,
      commissionRateBps: 0,
      maxLeverage: 2,
    });
    const result = executeMarketOrder({
      request: { symbol: "TEST", side: "buy", type: "market", quantity: 50 },
      broker,
      cash: 10_000,
      tradablePrice: { symbol: "TEST", time: TIME, price: 100, bid: 100, ask: 100 },
      candleVolumeNotional: 10_000,
      currentTime: TIME,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fill.slippage).toBeGreaterThan(0.1);
      expect(result.fill.price).toBeGreaterThan(100.1);
    }
  });

  it("creates a pending limit order after validating quantity and buying power", () => {
    const result = createLimitOrder({
      request: {
        symbol: "TEST",
        side: "buy",
        type: "limit",
        quantity: 2,
        limitPrice: 95,
      },
      broker: makeBroker(),
      cash: 1000,
      tradablePrice: { symbol: "TEST", time: TIME, price: 100, bid: 100, ask: 100 },
      currentTime: TIME,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.status).toBe("pending");
      expect(result.order.limitPrice).toBe(95);
    }
  });

  it("detects buy and sell limit triggers from candle ranges", () => {
    const buy = {
      id: "o1",
      createdAt: TIME,
      symbol: "TEST",
      side: "buy" as const,
      type: "limit" as const,
      quantity: 1,
      limitPrice: 95,
      status: "pending" as const,
    };
    const sell = { ...buy, id: "o2", side: "sell" as const, limitPrice: 105 };
    expect(isLimitOrderTriggered({ order: buy, high: 101, low: 94 })).toBe(true);
    expect(isLimitOrderTriggered({ order: buy, high: 101, low: 96 })).toBe(false);
    expect(isLimitOrderTriggered({ order: sell, high: 106, low: 99 })).toBe(true);
    expect(isLimitOrderTriggered({ order: sell, high: 104, low: 99 })).toBe(false);
  });

  it("fills triggered limit orders at the limit price with commission", () => {
    const placed = createLimitOrder({
      request: {
        symbol: "TEST",
        side: "buy",
        type: "limit",
        quantity: 2,
        limitPrice: 95,
      },
      broker: makeBroker({ commissionRateBps: 10 }),
      cash: 1000,
      tradablePrice: { symbol: "TEST", time: TIME, price: 100, bid: 100, ask: 100 },
      currentTime: TIME,
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const result = executeLimitOrderFill({
      order: placed.order,
      broker: makeBroker({ commissionRateBps: 10 }),
      cash: 1000,
      currentTime: "2024-01-04T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fill.orderId).toBe(placed.order.id);
      expect(result.fill.price).toBe(95);
      expect(result.fill.commission).toBeCloseTo(190 * 0.001, 6);
      expect(result.order.status).toBe("filled");
    }
  });
});
