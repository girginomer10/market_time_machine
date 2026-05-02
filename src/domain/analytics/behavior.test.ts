import { describe, expect, it } from "vitest";
import type { Candle, Fill } from "../../types";
import {
  defaultDetectorParams,
  detectAllBehavioralFlags,
  detectEarlyProfitTake,
  detectFomoBuy,
  detectOvertrading,
  detectPanicSell,
} from "./behavior";

function makeFill(over: Partial<Fill> & {
  id: string;
  side: Fill["side"];
  time: string;
  price: number;
  quantity: number;
}): Fill {
  return {
    id: over.id,
    orderId: over.orderId ?? over.id,
    time: over.time,
    symbol: over.symbol ?? "BTC",
    side: over.side,
    quantity: over.quantity,
    price: over.price,
    referencePrice: over.referencePrice ?? over.price,
    commission: over.commission ?? 0,
    spreadCost: over.spreadCost ?? 0,
    slippage: over.slippage ?? 0,
    totalCost: over.totalCost ?? 0,
  };
}

function priceCandle(time: string, price: number, symbol = "BTC"): Candle {
  return {
    symbol,
    openTime: time,
    closeTime: time,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 0,
  };
}

describe("detectPanicSell", () => {
  it("flags a sell after drawdown that recovers", () => {
    const candles = [
      priceCandle("2020-01-01", 100),
      priceCandle("2020-01-02", 95),
      priceCandle("2020-01-03", 90),
      priceCandle("2020-01-04", 85),
      priceCandle("2020-01-05", 88),
      priceCandle("2020-01-06", 92),
      priceCandle("2020-01-07", 98),
      priceCandle("2020-01-08", 105),
    ];
    const sell = makeFill({
      id: "s1",
      side: "sell",
      time: "2020-01-04",
      price: 85,
      quantity: 1,
    });
    const flag = detectPanicSell({ fill: sell, candlesForSymbol: candles });
    expect(flag).toBeDefined();
    expect(flag?.type).toBe("panic_sell");
    expect(flag?.tradeIds).toEqual(["s1"]);
  });

  it("does not flag a buy", () => {
    const candles = [
      priceCandle("2020-01-01", 100),
      priceCandle("2020-01-02", 90),
      priceCandle("2020-01-03", 110),
    ];
    const buy = makeFill({
      id: "b1",
      side: "buy",
      time: "2020-01-02",
      price: 90,
      quantity: 1,
    });
    expect(
      detectPanicSell({ fill: buy, candlesForSymbol: candles }),
    ).toBeUndefined();
  });

  it("does not flag a sell when there was no recent drawdown", () => {
    const candles = [
      priceCandle("2020-01-01", 100),
      priceCandle("2020-01-02", 101),
      priceCandle("2020-01-03", 102),
      priceCandle("2020-01-04", 103),
      priceCandle("2020-01-05", 104),
    ];
    const sell = makeFill({
      id: "s1",
      side: "sell",
      time: "2020-01-03",
      price: 102,
      quantity: 1,
    });
    expect(
      detectPanicSell({ fill: sell, candlesForSymbol: candles }),
    ).toBeUndefined();
  });

  it("does not flag a sell when price keeps falling afterward", () => {
    const candles = [
      priceCandle("2020-01-01", 100),
      priceCandle("2020-01-02", 92),
      priceCandle("2020-01-03", 85),
      priceCandle("2020-01-04", 80),
      priceCandle("2020-01-05", 75),
    ];
    const sell = makeFill({
      id: "s1",
      side: "sell",
      time: "2020-01-03",
      price: 85,
      quantity: 1,
    });
    expect(
      detectPanicSell({ fill: sell, candlesForSymbol: candles }),
    ).toBeUndefined();
  });
});

describe("detectFomoBuy", () => {
  it("flags a buy after a sharp rally with poor forward return", () => {
    const candles = [
      priceCandle("2020-01-01", 100),
      priceCandle("2020-01-02", 103),
      priceCandle("2020-01-03", 106),
      priceCandle("2020-01-04", 110),
      priceCandle("2020-01-05", 115),
      priceCandle("2020-01-06", 113),
      priceCandle("2020-01-07", 110),
      priceCandle("2020-01-08", 108),
      priceCandle("2020-01-09", 105),
      priceCandle("2020-01-10", 102),
      priceCandle("2020-01-11", 100),
    ];
    const buy = makeFill({
      id: "b1",
      side: "buy",
      time: "2020-01-05",
      price: 115,
      quantity: 1,
    });
    const flag = detectFomoBuy({
      fill: buy,
      candlesForSymbol: candles,
      params: {
        ...defaultDetectorParams.fomoBuy,
        lookbackCandles: 4,
        lookaheadCandles: 5,
      },
    });
    expect(flag).toBeDefined();
    expect(flag?.type).toBe("fomo_buy");
  });

  it("does not flag a sell", () => {
    const candles = [
      priceCandle("2020-01-01", 100),
      priceCandle("2020-01-02", 110),
      priceCandle("2020-01-03", 100),
    ];
    const sell = makeFill({
      id: "s1",
      side: "sell",
      time: "2020-01-02",
      price: 110,
      quantity: 1,
    });
    expect(detectFomoBuy({ fill: sell, candlesForSymbol: candles })).toBeUndefined();
  });

  it("does not flag a buy with positive forward return", () => {
    const candles = [
      priceCandle("2020-01-01", 100),
      priceCandle("2020-01-02", 105),
      priceCandle("2020-01-03", 110),
      priceCandle("2020-01-04", 115),
      priceCandle("2020-01-05", 120),
      priceCandle("2020-01-06", 125),
    ];
    const buy = makeFill({
      id: "b1",
      side: "buy",
      time: "2020-01-03",
      price: 110,
      quantity: 1,
    });
    expect(detectFomoBuy({ fill: buy, candlesForSymbol: candles })).toBeUndefined();
  });
});

describe("detectEarlyProfitTake", () => {
  it("flags a profitable close with strong subsequent gain", () => {
    const candles = [
      priceCandle("2020-01-01", 100),
      priceCandle("2020-01-02", 105),
      priceCandle("2020-01-03", 110),
      priceCandle("2020-01-04", 115),
      priceCandle("2020-01-05", 125),
      priceCandle("2020-01-06", 135),
    ];
    const sell = makeFill({
      id: "s1",
      side: "sell",
      time: "2020-01-03",
      price: 110,
      quantity: 1,
    });
    const flag = detectEarlyProfitTake({
      closingFill: sell,
      realizedReturn: 0.1,
      candlesForSymbol: candles,
      params: {
        ...defaultDetectorParams.earlyProfitTake,
        lookaheadCandles: 5,
      },
    });
    expect(flag).toBeDefined();
    expect(flag?.type).toBe("early_profit_take");
  });

  it("does not flag a buy", () => {
    const candles = [priceCandle("2020-01-01", 100)];
    const buy = makeFill({
      id: "b1",
      side: "buy",
      time: "2020-01-01",
      price: 100,
      quantity: 1,
    });
    expect(
      detectEarlyProfitTake({
        closingFill: buy,
        realizedReturn: 0.2,
        candlesForSymbol: candles,
      }),
    ).toBeUndefined();
  });

  it("does not flag when realized return is below threshold", () => {
    const candles = [
      priceCandle("2020-01-01", 100),
      priceCandle("2020-01-02", 200),
    ];
    const sell = makeFill({
      id: "s1",
      side: "sell",
      time: "2020-01-01",
      price: 100,
      quantity: 1,
    });
    expect(
      detectEarlyProfitTake({
        closingFill: sell,
        realizedReturn: 0.001,
        candlesForSymbol: candles,
      }),
    ).toBeUndefined();
  });
});

describe("detectOvertrading", () => {
  const baseFills: Fill[] = Array.from({ length: 20 }, (_, i) =>
    makeFill({
      id: `f${i}`,
      side: i % 2 === 0 ? "buy" : "sell",
      time: `2020-01-${String(i + 1).padStart(2, "0")}`,
      price: 100,
      quantity: 1,
      commission: 5,
      spreadCost: 5,
    }),
  );

  it("flags when turnover, fees, and excess return all qualify", () => {
    const flag = detectOvertrading({
      fills: baseFills,
      candleCount: 20,
      feesPaid: 200,
      slippagePaid: 0,
      initialEquity: 1000,
      excessReturn: -0.05,
    });
    expect(flag).toBeDefined();
    expect(flag?.type).toBe("overtrading");
  });

  it("does not flag when the user beats the benchmark", () => {
    const flag = detectOvertrading({
      fills: baseFills,
      candleCount: 20,
      feesPaid: 200,
      slippagePaid: 0,
      initialEquity: 1000,
      excessReturn: 0.5,
    });
    expect(flag).toBeUndefined();
  });

  it("does not flag when fee drag is small", () => {
    const flag = detectOvertrading({
      fills: baseFills,
      candleCount: 20,
      feesPaid: 0.1,
      slippagePaid: 0,
      initialEquity: 1000,
      excessReturn: -0.5,
    });
    expect(flag).toBeUndefined();
  });
});

describe("detectAllBehavioralFlags", () => {
  it("aggregates multiple detectors", () => {
    const candles = [
      priceCandle("2020-01-01", 100),
      priceCandle("2020-01-02", 95),
      priceCandle("2020-01-03", 90),
      priceCandle("2020-01-04", 85),
      priceCandle("2020-01-05", 92),
      priceCandle("2020-01-06", 100),
      priceCandle("2020-01-07", 108),
      priceCandle("2020-01-08", 115),
    ];
    const fills: Fill[] = [
      makeFill({ id: "s1", side: "sell", time: "2020-01-04", price: 85, quantity: 1 }),
    ];
    const candlesBySymbol = new Map<string, Candle[]>();
    candlesBySymbol.set("BTC", candles);

    const flags = detectAllBehavioralFlags({
      fills,
      candlesBySymbol,
      totalCandleCount: candles.length,
      feesPaid: 0,
      slippagePaid: 0,
      initialEquity: 1000,
      excessReturn: 0,
      realizedTradeReturns: new Map([["s1", 0]]),
    });
    expect(flags.some((f) => f.type === "panic_sell")).toBe(true);
  });
});
