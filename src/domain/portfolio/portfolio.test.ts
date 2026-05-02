import { describe, expect, it } from "vitest";
import {
  applyFill,
  emptyPortfolio,
  markToMarket,
  snapshotPortfolio,
} from "./portfolio";
import type { Fill } from "../../types";

function makeFill(overrides: Partial<Fill>): Fill {
  return {
    id: overrides.id ?? "f1",
    orderId: "o1",
    time: "2024-01-01T00:00:00.000Z",
    symbol: "TEST",
    side: "buy",
    quantity: 1,
    price: 100,
    referencePrice: 100,
    commission: 1,
    spreadCost: 0,
    slippage: 0,
    totalCost: 101,
    ...overrides,
  };
}

describe("portfolio engine", () => {
  it("starts with cash and no positions", () => {
    const p = emptyPortfolio(1000);
    expect(p.cash).toBe(1000);
    expect(Object.keys(p.positions)).toHaveLength(0);
  });

  it("subtracts cash and increases position on buy", () => {
    const p = applyFill(emptyPortfolio(1000), makeFill({ quantity: 5, price: 100, commission: 5 }));
    expect(p.cash).toBeCloseTo(1000 - 500 - 5, 6);
    expect(p.positions.TEST.quantity).toBe(5);
    expect(p.positions.TEST.averagePrice).toBe(100);
  });

  it("computes weighted average price across multiple buys", () => {
    let p = emptyPortfolio(10_000);
    p = applyFill(p, makeFill({ id: "f1", quantity: 2, price: 100, commission: 0 }));
    p = applyFill(p, makeFill({ id: "f2", quantity: 3, price: 110, commission: 0 }));
    expect(p.positions.TEST.quantity).toBe(5);
    expect(p.positions.TEST.averagePrice).toBeCloseTo(106, 4);
  });

  it("realizes pnl on sell", () => {
    let p = emptyPortfolio(1000);
    p = applyFill(p, makeFill({ id: "f1", quantity: 5, price: 100, commission: 0 }));
    p = applyFill(
      p,
      makeFill({
        id: "f2",
        side: "sell",
        quantity: 2,
        price: 120,
        commission: 0,
      }),
    );
    expect(p.realizedPnl).toBeCloseTo((120 - 100) * 2, 6);
    expect(p.positions.TEST.quantity).toBe(3);
  });

  it("tracks short positions and realizes pnl when covered", () => {
    let p = emptyPortfolio(1000);
    p = applyFill(
      p,
      makeFill({
        id: "short1",
        side: "sell",
        quantity: 2,
        price: 100,
        commission: 0,
      }),
    );
    expect(p.positions.TEST.quantity).toBe(-2);
    expect(p.positions.TEST.averagePrice).toBe(100);
    expect(p.cash).toBeCloseTo(1200, 6);

    p = markToMarket(p, [
      { symbol: "TEST", time: "2024-01-02T00:00:00Z", price: 80, bid: 80, ask: 80 },
    ]);
    expect(p.positions.TEST.unrealizedPnl).toBeCloseTo(40, 6);

    p = applyFill(
      p,
      makeFill({
        id: "cover1",
        side: "buy",
        quantity: 1,
        price: 80,
        commission: 0,
      }),
    );
    expect(p.realizedPnl).toBeCloseTo(20, 6);
    expect(p.positions.TEST.quantity).toBe(-1);
    expect(p.positions.TEST.averagePrice).toBe(100);
  });

  it("marks open positions to last visible price", () => {
    let p = emptyPortfolio(1000);
    p = applyFill(p, makeFill({ quantity: 5, price: 100, commission: 0 }));
    p = markToMarket(p, [
      { symbol: "TEST", time: "2024-01-02T00:00:00Z", price: 130, bid: 130, ask: 130 },
    ]);
    expect(p.positions.TEST.marketPrice).toBe(130);
    expect(p.positions.TEST.unrealizedPnl).toBeCloseTo(150, 6);
  });

  it("snapshot total value equals cash + positions value", () => {
    let p = emptyPortfolio(1000);
    p = applyFill(p, makeFill({ quantity: 5, price: 100, commission: 0 }));
    p = markToMarket(p, [
      { symbol: "TEST", time: "now", price: 110, bid: 110, ask: 110 },
    ]);
    const snap = snapshotPortfolio(p, "now");
    expect(snap.totalValue).toBeCloseTo(snap.cash + snap.positionsValue, 6);
  });
});
