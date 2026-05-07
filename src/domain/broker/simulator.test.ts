import { describe, expect, it } from "vitest";
import {
  commissionFor,
  createLimitOrder,
  createPendingOrder,
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

  it("detects stop-loss and take-profit triggers from candle ranges", () => {
    const stopLoss = {
      id: "o3",
      createdAt: TIME,
      symbol: "TEST",
      side: "sell" as const,
      type: "stop_loss" as const,
      quantity: 1,
      triggerPrice: 95,
      status: "pending" as const,
    };
    const takeProfit = {
      ...stopLoss,
      id: "o4",
      type: "take_profit" as const,
      triggerPrice: 110,
    };
    expect(
      isLimitOrderTriggered({ order: stopLoss, high: 101, low: 94 }),
    ).toBe(true);
    expect(
      isLimitOrderTriggered({ order: stopLoss, high: 101, low: 96 }),
    ).toBe(false);
    expect(
      isLimitOrderTriggered({ order: takeProfit, high: 111, low: 99 }),
    ).toBe(true);
    expect(
      isLimitOrderTriggered({ order: takeProfit, high: 109, low: 99 }),
    ).toBe(false);
  });

  it("creates triggered stop-loss orders with trigger prices", () => {
    const result = createPendingOrder({
      request: {
        symbol: "TEST",
        side: "sell",
        type: "stop_loss",
        quantity: 1,
        triggerPrice: 92,
      },
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
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.type).toBe("stop_loss");
      expect(result.order.triggerPrice).toBe(92);
      expect(result.order.status).toBe("pending");
    }
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

  it("partially fills volume-limited market orders", () => {
    const broker = makeBroker({
      commissionRateBps: 0,
      partialFillPolicy: "volume_limited",
      maxParticipationRate: 0.1,
    });
    const result = executeMarketOrder({
      request: { symbol: "TEST", side: "buy", type: "market", quantity: 20 },
      broker,
      cash: 10_000,
      tradablePrice: { symbol: "TEST", time: TIME, price: 100, bid: 100, ask: 100 },
      candleVolumeNotional: 10_000,
      currentTime: TIME,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fill.quantity).toBe(10);
      expect(result.fill.liquidityParticipation).toBeCloseTo(0.1, 6);
      expect(result.order.status).toBe("partially_filled");
      expect(result.order.remainingQuantity).toBe(10);
    }
  });

  it("fills sell stops at the candle open when price gaps through the trigger", () => {
    const placed = createPendingOrder({
      request: {
        symbol: "TEST",
        side: "sell",
        type: "stop_loss",
        quantity: 1,
        triggerPrice: 95,
      },
      broker: makeBroker({ stopFillPolicy: "gap_open" }),
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
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const result = executeLimitOrderFill({
      order: placed.order,
      broker: makeBroker({ stopFillPolicy: "gap_open" }),
      cash: 0,
      position: {
        symbol: "TEST",
        quantity: 1,
        averagePrice: 100,
        marketPrice: 90,
        marketValue: 90,
        unrealizedPnl: -10,
        realizedPnl: 0,
      },
      candle: {
        symbol: "TEST",
        openTime: "2024-01-04T00:00:00.000Z",
        closeTime: "2024-01-04T23:59:59.000Z",
        open: 90,
        high: 94,
        low: 88,
        close: 91,
        volume: 1000,
      },
      currentTime: "2024-01-04T23:59:59.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fill.price).toBe(90);
      expect(result.fill.executionPriceSource).toBe("gap_open");
    }
  });
});
