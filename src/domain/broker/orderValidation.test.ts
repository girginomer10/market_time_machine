import { describe, expect, it } from "vitest";

import type { BrokerConfig, Position } from "../../types";
import {
  IDEAL_BROKER_CONFIG,
  REALISTIC_BROKER_CONFIG,
} from "./executionModels";
import {
  REJECTION_REASONS,
  buyingPower,
  checkBuyingPower,
  checkLiquidity,
  checkLongShortConstraint,
  checkLotSize,
  checkQuantity,
  checkTradability,
  normalizeQuantity,
  validateMarketOrder,
} from "./orderValidation";

const cashOnly: BrokerConfig = {
  ...IDEAL_BROKER_CONFIG,
  allowFractional: false,
  allowShort: false,
  maxLeverage: 1,
};

const marginBroker: BrokerConfig = {
  ...REALISTIC_BROKER_CONFIG,
  allowShort: true,
  maxLeverage: 4,
};

function makePosition(quantity: number, price = 100): Position {
  return {
    symbol: "TEST",
    quantity,
    averagePrice: price,
    marketPrice: price,
    marketValue: quantity * price,
    unrealizedPnl: 0,
    realizedPnl: 0,
  };
}

describe("checkQuantity", () => {
  it("rejects zero, negative, and non-finite values", () => {
    expect(checkQuantity(0).ok).toBe(false);
    expect(checkQuantity(-1).ok).toBe(false);
    expect(checkQuantity(Number.NaN).ok).toBe(false);
    expect(checkQuantity(Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  it("accepts positive finite quantities", () => {
    expect(checkQuantity(1).ok).toBe(true);
    expect(checkQuantity(0.0001).ok).toBe(true);
  });
});

describe("normalizeQuantity / checkLotSize", () => {
  it("floors to integers when fractional disabled", () => {
    expect(normalizeQuantity(2.7, cashOnly)).toBe(2);
  });

  it("preserves fractional when allowed", () => {
    expect(normalizeQuantity(2.7, IDEAL_BROKER_CONFIG)).toBeCloseTo(2.7, 10);
  });

  it("snaps to lot size", () => {
    const broker = { ...IDEAL_BROKER_CONFIG, allowFractional: false };
    const q = normalizeQuantity(7, broker, {
      symbol: "X",
      name: "x",
      assetClass: "equity",
      currency: "USD",
      timezone: "UTC",
      lotSize: 5,
    });
    expect(q).toBe(5);
  });

  it("checkLotSize fails when normalized rounds to zero", () => {
    const result = checkLotSize(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("QUANTITY_BELOW_LOT_SIZE");
    }
  });

  it("checkLotSize passes when normalized is positive", () => {
    expect(checkLotSize(1).ok).toBe(true);
  });
});

describe("buyingPower / checkBuyingPower", () => {
  it("buying power equals cash * leverage", () => {
    expect(buyingPower(100, cashOnly)).toBe(100);
    expect(buyingPower(100, marginBroker)).toBe(400);
  });

  it("rejects insufficient cash on cash account", () => {
    const r = checkBuyingPower({
      cash: 100,
      notional: 200,
      fees: 0,
      broker: cashOnly,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("INSUFFICIENT_CASH");
      expect(r.message).toBe(REJECTION_REASONS.INSUFFICIENT_CASH);
    }
  });

  it("uses leverage if available before failing", () => {
    const ok = checkBuyingPower({
      cash: 100,
      notional: 300,
      fees: 0,
      broker: marginBroker,
    });
    expect(ok.ok).toBe(true);
  });

  it("rejects EXCEEDS_LEVERAGE when over even with leverage", () => {
    const r = checkBuyingPower({
      cash: 100,
      notional: 1000,
      fees: 0,
      broker: marginBroker,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("EXCEEDS_LEVERAGE");
    }
  });

  it("includes fees in cost", () => {
    const r = checkBuyingPower({
      cash: 100,
      notional: 99,
      fees: 5,
      broker: cashOnly,
    });
    expect(r.ok).toBe(false);
  });
});

describe("checkLongShortConstraint", () => {
  it("allows buys regardless", () => {
    const r = checkLongShortConstraint({
      side: "buy",
      quantity: 5,
      broker: cashOnly,
    });
    expect(r.ok).toBe(true);
  });

  it("allows sell when sufficient long position exists", () => {
    const r = checkLongShortConstraint({
      side: "sell",
      quantity: 5,
      position: makePosition(10),
      broker: cashOnly,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects insufficient_position when partial holdings + no shorting", () => {
    const r = checkLongShortConstraint({
      side: "sell",
      quantity: 10,
      position: makePosition(3),
      broker: cashOnly,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INSUFFICIENT_POSITION");
  });

  it("rejects shorting_disabled when no holdings + no shorting", () => {
    const r = checkLongShortConstraint({
      side: "sell",
      quantity: 5,
      broker: cashOnly,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SHORTING_DISABLED");
  });

  it("allows short when broker allows", () => {
    const r = checkLongShortConstraint({
      side: "sell",
      quantity: 5,
      broker: marginBroker,
    });
    expect(r.ok).toBe(true);
  });
});

describe("checkLiquidity", () => {
  it("passes when no participation cap configured", () => {
    expect(
      checkLiquidity({ quantity: 1000, referencePrice: 100 }).ok,
    ).toBe(true);
  });

  it("rejects when order exceeds participation cap", () => {
    const r = checkLiquidity({
      quantity: 100,
      referencePrice: 100,
      candleVolumeNotional: 10_000,
      maxParticipationRate: 0.1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EXCEEDS_LIQUIDITY_LIMIT");
  });

  it("passes when within cap", () => {
    const r = checkLiquidity({
      quantity: 1,
      referencePrice: 100,
      candleVolumeNotional: 10_000,
      maxParticipationRate: 0.1,
    });
    expect(r.ok).toBe(true);
  });
});

describe("checkTradability", () => {
  it("rejects when no price", () => {
    const r = checkTradability({ hasPrice: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_TRADABLE_PRICE");
  });

  it("rejects when market explicitly closed", () => {
    const r = checkTradability({ hasPrice: true, marketOpen: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MARKET_CLOSED");
  });

  it("passes when market is open with price", () => {
    expect(
      checkTradability({ hasPrice: true, marketOpen: true }).ok,
    ).toBe(true);
  });
});

describe("validateMarketOrder", () => {
  it("returns ok when all checks pass", () => {
    const r = validateMarketOrder({
      side: "buy",
      rawQuantity: 1,
      normalizedQuantity: 1,
      referencePrice: 100,
      cash: 1000,
      fees: 1,
      broker: cashOnly,
      hasPrice: true,
      marketOpen: true,
    });
    expect(r.ok).toBe(true);
  });

  it("short-circuits on the first failure (no price beats invalid quantity)", () => {
    const r = validateMarketOrder({
      side: "buy",
      rawQuantity: -1,
      normalizedQuantity: 0,
      referencePrice: 100,
      cash: 1000,
      fees: 0,
      broker: cashOnly,
      hasPrice: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_TRADABLE_PRICE");
  });

  it("rejects sell with insufficient position", () => {
    const r = validateMarketOrder({
      side: "sell",
      rawQuantity: 5,
      normalizedQuantity: 5,
      referencePrice: 100,
      cash: 0,
      fees: 0,
      position: makePosition(2),
      broker: cashOnly,
      hasPrice: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INSUFFICIENT_POSITION");
  });

  it("rejects buy on insufficient cash", () => {
    const r = validateMarketOrder({
      side: "buy",
      rawQuantity: 100,
      normalizedQuantity: 100,
      referencePrice: 100,
      cash: 100,
      fees: 0,
      broker: cashOnly,
      hasPrice: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INSUFFICIENT_CASH");
  });

  it("respects liquidity cap", () => {
    const r = validateMarketOrder({
      side: "buy",
      rawQuantity: 100,
      normalizedQuantity: 100,
      referencePrice: 100,
      cash: 100_000,
      fees: 0,
      broker: marginBroker,
      hasPrice: true,
      candleVolumeNotional: 10_000,
      maxParticipationRate: 0.5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EXCEEDS_LIQUIDITY_LIMIT");
  });
});
