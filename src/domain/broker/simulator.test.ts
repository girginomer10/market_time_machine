import { describe, expect, it } from "vitest";
import {
  commissionFor,
  createLimitOrder,
  createPendingOrder,
  executeLimitOrderFill,
  executeMarketRemainderFill,
  executeMarketOrder,
  executePendingOrderFill,
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

  it("rejects an explicitly non-tradable instrument even when a price exists", () => {
    const result = executeMarketOrder({
      request: { symbol: "TEST", side: "buy", type: "market", quantity: 1 },
      broker: makeBroker(),
      cash: 1000,
      tradablePrice: {
        symbol: "TEST",
        time: TIME,
        price: 100,
        bid: 100,
        ask: 100,
      },
      instrumentTradable: false,
      currentTime: TIME,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.order.rejectionCode).toBe("INSTRUMENT_NOT_TRADABLE");
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

  it("rejects a new short that would exceed account-level leverage", () => {
    const result = executeMarketOrder({
      request: { symbol: "TEST", side: "sell", type: "market", quantity: 60 },
      broker: makeBroker({ allowShort: true, maxLeverage: 2 }),
      cash: 3000,
      position: {
        symbol: "TEST",
        quantity: -20,
        averagePrice: 100,
        marketPrice: 100,
        marketValue: -2000,
        unrealizedPnl: 0,
        realizedPnl: 0,
      },
      accountEquity: 1000,
      positionsGrossNotional: 2000,
      tradablePrice: {
        symbol: "TEST",
        time: TIME,
        price: 100,
        bid: 100,
        ask: 100,
      },
      currentTime: TIME,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.order.rejectionCode).toBe("EXCEEDS_LEVERAGE");
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

  it("records spreadCost as a total monetary amount", () => {
    const result = executeMarketOrder({
      request: { symbol: "TEST", side: "buy", type: "market", quantity: 100 },
      broker: makeBroker({
        commissionRateBps: 0,
        spreadBps: 20,
        maxLeverage: 2,
      }),
      cash: 20_000,
      tradablePrice: {
        symbol: "TEST",
        time: TIME,
        price: 100,
        bid: 99.9,
        ask: 100.1,
      },
      currentTime: TIME,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fill.spreadCost).toBeCloseTo(10, 6);
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

  it("reserves account-level exposure when placing working orders", () => {
    const result = createLimitOrder({
      request: {
        symbol: "TEST",
        side: "buy",
        type: "limit",
        quantity: 6,
        limitPrice: 100,
      },
      broker: makeBroker({ maxLeverage: 2 }),
      cash: 500,
      accountEquity: 1000,
      positionsGrossNotional: 500,
      reservedGrossNotional: 1000,
      tradablePrice: {
        symbol: "TEST",
        time: TIME,
        price: 100,
        bid: 100,
        ask: 100,
      },
      currentTime: TIME,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.order.rejectionCode).toBe("EXCEEDS_LEVERAGE");
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
      expect(result.order.closedAt).toBeUndefined();
    }
  });

  it("fills a partial market-order remainder on a later candle", () => {
    const broker = makeBroker({
      commissionRateBps: 0,
      partialFillPolicy: "volume_limited",
      maxParticipationRate: 0.1,
    });
    const initial = executeMarketOrder({
      request: { symbol: "TEST", side: "buy", type: "market", quantity: 20 },
      broker,
      cash: 10_000,
      tradablePrice: {
        symbol: "TEST",
        time: TIME,
        price: 100,
        bid: 100,
        ask: 100,
      },
      candleVolumeNotional: 10_000,
      currentTime: TIME,
    });
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(
      isLimitOrderTriggered({ order: initial.order, high: 101, low: 99 }),
    ).toBe(true);

    const remainder = executeMarketRemainderFill({
      order: initial.order,
      broker,
      cash: 9000,
      position: {
        symbol: "TEST",
        quantity: 10,
        averagePrice: 100,
        marketPrice: 100,
        marketValue: 1000,
        unrealizedPnl: 0,
        realizedPnl: 0,
      },
      currentTime: "2024-01-04T00:00:00.000Z",
      candle: {
        symbol: "TEST",
        openTime: "2024-01-03T00:00:00.000Z",
        closeTime: "2024-01-04T00:00:00.000Z",
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 100,
      },
      candleVolumeNotional: 10_000,
    });

    expect(remainder.ok).toBe(true);
    if (remainder.ok) {
      expect(remainder.fill.quantity).toBe(10);
      expect(remainder.order.status).toBe("filled");
      expect(remainder.order.remainingQuantity).toBe(0);
      expect(remainder.order.filledQuantity).toBe(20);
      expect(remainder.order.closedAt).toBe("2024-01-04T00:00:00.000Z");
    }
  });

  it("quantizes volume-capped fills to the instrument lot rules", () => {
    const result = executeMarketOrder({
      request: { symbol: "TEST", side: "buy", type: "market", quantity: 10 },
      broker: makeBroker({
        commissionRateBps: 0,
        allowFractional: false,
        partialFillPolicy: "volume_limited",
        maxParticipationRate: 0.25,
      }),
      cash: 10_000,
      tradablePrice: {
        symbol: "TEST",
        time: TIME,
        price: 100,
        bid: 100,
        ask: 100,
      },
      candleVolumeNotional: 1000,
      currentTime: TIME,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fill.quantity).toBe(2);
  });

  it("caps fills by remaining executable liquidity for the candle", () => {
    const result = executeMarketOrder({
      request: { symbol: "TEST", side: "buy", type: "market", quantity: 10 },
      broker: makeBroker({
        commissionRateBps: 0,
        allowFractional: false,
        partialFillPolicy: "volume_limited",
        maxParticipationRate: 1,
      }),
      cash: 10_000,
      tradablePrice: {
        symbol: "TEST",
        time: TIME,
        price: 100,
        bid: 100,
        ask: 100,
      },
      candleVolumeNotional: 100_000,
      availableCandleLiquidityNotional: 250,
      currentTime: TIME,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fill.quantity).toBe(2);
  });

  it("queues a GTC market order when current liquidity is below one lot", () => {
    const result = executeMarketOrder({
      request: {
        symbol: "TEST",
        side: "buy",
        type: "market",
        quantity: 2,
        timeInForce: "gtc",
      },
      broker: makeBroker({
        commissionRateBps: 0,
        allowFractional: false,
        partialFillPolicy: "volume_limited",
        maxParticipationRate: 1,
      }),
      cash: 10_000,
      tradablePrice: {
        symbol: "TEST",
        time: TIME,
        price: 100,
        bid: 100,
        ask: 100,
      },
      candleVolumeNotional: 10_000,
      availableCandleLiquidityNotional: 50,
      currentTime: TIME,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.deferredForLiquidity).toBe(true);
      expect(result.order.status).toBe("pending");
      expect(result.order.remainingQuantity).toBe(2);
      expect(result.order.closedAt).toBeUndefined();
      expect(result.order.rejectionReason).toBeUndefined();

      const retried = executeMarketRemainderFill({
        order: result.order,
        broker: makeBroker({
          commissionRateBps: 0,
          allowFractional: false,
          partialFillPolicy: "volume_limited",
          maxParticipationRate: 1,
        }),
        cash: 10_000,
        currentTime: "2024-01-04T00:00:00.000Z",
        candle: {
          symbol: "TEST",
          openTime: TIME,
          closeTime: "2024-01-04T00:00:00.000Z",
          open: 100,
          high: 100,
          low: 100,
          close: 100,
          volume: 10,
        },
        candleVolumeNotional: 1_000,
        availableCandleLiquidityNotional: 1_000,
      });
      expect(retried.ok).toBe(true);
      if (retried.ok) {
        expect(retried.order.status).toBe("filled");
        expect(retried.fill.quantity).toBe(2);
      }
    }
  });

  it("keeps a partially filled GTC market remainder working at zero liquidity", () => {
    const result = executeMarketRemainderFill({
      order: {
        id: "partial-gtc",
        createdAt: TIME,
        symbol: "TEST",
        side: "buy",
        type: "market",
        quantity: 3,
        filledQuantity: 1,
        remainingQuantity: 2,
        averageFillPrice: 100,
        timeInForce: "gtc",
        status: "partially_filled",
      },
      broker: makeBroker({
        commissionRateBps: 0,
        allowFractional: false,
        partialFillPolicy: "volume_limited",
        maxParticipationRate: 1,
      }),
      cash: 10_000,
      currentTime: "2024-01-04T00:00:00.000Z",
      candle: {
        symbol: "TEST",
        openTime: TIME,
        closeTime: "2024-01-04T00:00:00.000Z",
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 0,
      },
      candleVolumeNotional: 0,
      availableCandleLiquidityNotional: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.deferredForLiquidity).toBe(true);
      expect(result.order.status).toBe("partially_filled");
      expect(result.order.filledQuantity).toBe(1);
      expect(result.order.remainingQuantity).toBe(2);
      expect(result.order.closedAt).toBeUndefined();
    }
  });

  it("latches a triggered GTC stop when its candle has sub-lot liquidity", () => {
    const result = executePendingOrderFill({
      order: {
        id: "deferred-stop",
        createdAt: TIME,
        symbol: "TEST",
        side: "sell",
        type: "stop_loss",
        quantity: 1,
        remainingQuantity: 1,
        triggerPrice: 95,
        timeInForce: "gtc",
        status: "pending",
      },
      broker: makeBroker({
        commissionRateBps: 0,
        allowFractional: false,
        partialFillPolicy: "volume_limited",
        maxParticipationRate: 1,
      }),
      cash: 0,
      position: {
        symbol: "TEST",
        quantity: 1,
        averagePrice: 100,
        marketPrice: 95,
        marketValue: 95,
        unrealizedPnl: -5,
        realizedPnl: 0,
      },
      currentTime: "2024-01-04T00:00:00.000Z",
      candle: {
        symbol: "TEST",
        openTime: TIME,
        closeTime: "2024-01-04T00:00:00.000Z",
        open: 100,
        high: 101,
        low: 94,
        close: 95,
        volume: 0.5,
      },
      candleVolumeNotional: 47.5,
      availableCandleLiquidityNotional: 47.5,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.deferredForLiquidity).toBe(true);
      expect(result.order.status).toBe("pending");
      expect(result.order.triggeredAt).toBe("2024-01-04T00:00:00.000Z");
      expect(
        isLimitOrderTriggered({ order: result.order, high: 100, low: 100 }),
      ).toBe(true);
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

  it("does not misclassify an intrabar take-profit touch as a gap", () => {
    const order = {
      id: "tp",
      createdAt: TIME,
      symbol: "TEST",
      side: "sell" as const,
      type: "take_profit" as const,
      quantity: 1,
      remainingQuantity: 1,
      filledQuantity: 0,
      triggerPrice: 110,
      status: "pending" as const,
    };
    const result = executePendingOrderFill({
      order,
      broker: makeBroker({
        commissionRateBps: 0,
        stopFillPolicy: "gap_open",
      }),
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
      currentTime: "2024-01-04T00:00:00.000Z",
      candle: {
        symbol: "TEST",
        openTime: "2024-01-03T00:00:00.000Z",
        closeTime: "2024-01-04T00:00:00.000Z",
        open: 100,
        high: 111,
        low: 99,
        close: 110,
        volume: 1000,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fill.price).toBe(110);
      expect(result.fill.executionPriceSource).toBe("stop_trigger");
    }
  });

  it("fills a favorably gapped sell take-profit at the candle open", () => {
    const result = executePendingOrderFill({
      order: {
        id: "tp-gap",
        createdAt: TIME,
        symbol: "TEST",
        side: "sell",
        type: "take_profit",
        quantity: 1,
        remainingQuantity: 1,
        triggerPrice: 110,
        status: "pending",
      },
      broker: makeBroker({
        commissionRateBps: 0,
        stopFillPolicy: "gap_open",
      }),
      cash: 0,
      position: {
        symbol: "TEST",
        quantity: 1,
        averagePrice: 100,
        marketPrice: 120,
        marketValue: 120,
        unrealizedPnl: 20,
        realizedPnl: 0,
      },
      currentTime: "2024-01-04T00:00:00.000Z",
      candle: {
        symbol: "TEST",
        openTime: "2024-01-03T00:00:00.000Z",
        closeTime: "2024-01-04T00:00:00.000Z",
        open: 120,
        high: 121,
        low: 119,
        close: 120,
        volume: 1000,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fill.price).toBe(120);
      expect(result.fill.executionPriceSource).toBe("gap_open");
    }
  });

  it("applies spread and volatility slippage to triggered orders", () => {
    const result = executePendingOrderFill({
      order: {
        id: "stop-costs",
        createdAt: TIME,
        symbol: "TEST",
        side: "sell",
        type: "stop_loss",
        quantity: 2,
        remainingQuantity: 2,
        triggerPrice: 95,
        status: "pending",
      },
      broker: makeBroker({
        commissionRateBps: 0,
        spreadBps: 20,
        slippageModel: "volatility_based",
        slippageBps: 10,
        stopFillPolicy: "trigger_price",
      }),
      cash: 0,
      position: {
        symbol: "TEST",
        quantity: 2,
        averagePrice: 100,
        marketPrice: 95,
        marketValue: 190,
        unrealizedPnl: -10,
        realizedPnl: 0,
      },
      currentTime: "2024-01-04T00:00:00.000Z",
      volatility: 0.05,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fill.price).toBeLessThan(95);
      expect(result.fill.spreadCost).toBeGreaterThan(0);
      expect(result.fill.slippage).toBeGreaterThan(0.095);
    }
  });

  it("keeps trigger-price policy after a triggered order waits for liquidity", () => {
    const result = executePendingOrderFill({
      order: {
        id: "deferred-stop",
        createdAt: TIME,
        triggeredAt: "2024-01-03T00:00:00.000Z",
        symbol: "TEST",
        side: "sell",
        type: "stop_loss",
        quantity: 1,
        remainingQuantity: 1,
        triggerPrice: 95,
        status: "pending",
      },
      broker: makeBroker({
        commissionRateBps: 0,
        spreadBps: 0,
        slippageModel: "none",
        stopFillPolicy: "trigger_price",
      }),
      cash: 0,
      position: {
        symbol: "TEST",
        quantity: 1,
        averagePrice: 100,
        marketPrice: 120,
        marketValue: 120,
        unrealizedPnl: 20,
        realizedPnl: 0,
      },
      currentTime: "2024-01-04T00:00:00.000Z",
      candle: {
        symbol: "TEST",
        openTime: "2024-01-03T00:00:00.000Z",
        closeTime: "2024-01-04T00:00:00.000Z",
        open: 120,
        high: 121,
        low: 119,
        close: 120,
        volume: 1000,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fill.price).toBe(95);
      expect(result.fill.executionPriceSource).toBe("stop_trigger");
    }
  });
});
