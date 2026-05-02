import { describe, expect, it } from "vitest";

import {
  HARSH_MARGIN_POLICY,
  IDEAL_MARGIN_POLICY,
  MARGIN_POLICY_PRESETS,
  REALISTIC_MARGIN_POLICY,
  accountEquity,
  borrowCostFor,
  canOpenAdditionalNotional,
  getMarginPolicyPreset,
  initialMarginRequired,
  isMarginCall,
  maintenanceMarginRequired,
  marginPolicyFromBroker,
  marginSnapshot,
  marginUtilization,
  requiresLiquidation,
} from "./margin";
import { REALISTIC_BROKER_CONFIG } from "./executionModels";

describe("margin presets", () => {
  it("ideal policy is full upfront, no maintenance call", () => {
    expect(IDEAL_MARGIN_POLICY.initialMarginRate).toBe(1);
    expect(IDEAL_MARGIN_POLICY.borrowRateBps).toBe(0);
  });

  it("harsh is stricter than realistic", () => {
    expect(HARSH_MARGIN_POLICY.maintenanceMarginRate).toBeGreaterThan(
      REALISTIC_MARGIN_POLICY.maintenanceMarginRate,
    );
    expect(HARSH_MARGIN_POLICY.liquidationThreshold).toBeGreaterThan(
      REALISTIC_MARGIN_POLICY.liquidationThreshold,
    );
    expect(HARSH_MARGIN_POLICY.borrowRateBps).toBeGreaterThan(
      REALISTIC_MARGIN_POLICY.borrowRateBps,
    );
  });

  it("getMarginPolicyPreset returns a fresh copy", () => {
    const a = getMarginPolicyPreset("realistic");
    a.initialMarginRate = 0.99;
    expect(MARGIN_POLICY_PRESETS.realistic.initialMarginRate).toBe(0.5);
  });
});

describe("marginPolicyFromBroker", () => {
  it("derives 1/leverage as initial margin rate", () => {
    const p = marginPolicyFromBroker({
      ...REALISTIC_BROKER_CONFIG,
      maxLeverage: 4,
    });
    expect(p.initialMarginRate).toBeCloseTo(0.25, 6);
    expect(p.maintenanceMarginRate).toBeGreaterThanOrEqual(0.05);
  });

  it("clamps leverage to at least 1", () => {
    const p = marginPolicyFromBroker({
      ...REALISTIC_BROKER_CONFIG,
      maxLeverage: 0,
    });
    expect(p.initialMarginRate).toBe(1);
  });
});

describe("margin requirements", () => {
  it("initial scales with rate", () => {
    expect(initialMarginRequired(1000, REALISTIC_MARGIN_POLICY)).toBe(500);
  });

  it("maintenance uses absolute notional", () => {
    expect(maintenanceMarginRequired(-1000, REALISTIC_MARGIN_POLICY)).toBe(
      250,
    );
  });

  it("equity is cash + net positions value", () => {
    expect(accountEquity(100, 50)).toBe(150);
    expect(accountEquity(100, -20)).toBe(80);
  });

  it("utilization is gross / equity", () => {
    expect(marginUtilization(200, 100)).toBe(2);
    expect(marginUtilization(0, 100)).toBe(0);
    expect(marginUtilization(100, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("marginSnapshot", () => {
  it("flags margin call when equity dips below maintenance", () => {
    const snap = marginSnapshot({
      cash: 100,
      positionsGrossNotional: 1000,
      positionsNetValue: 100,
      policy: REALISTIC_MARGIN_POLICY,
    });
    expect(snap.equity).toBe(200);
    expect(snap.maintenanceMarginRequirement).toBe(250);
    expect(snap.isMarginCall).toBe(true);
  });

  it("flags liquidation when equity below liquidation level", () => {
    const snap = marginSnapshot({
      cash: 100,
      positionsGrossNotional: 1000,
      positionsNetValue: 50,
      policy: REALISTIC_MARGIN_POLICY,
    });
    expect(snap.requiresLiquidation).toBe(true);
  });

  it("no margin call when no exposure", () => {
    const snap = marginSnapshot({
      cash: 100,
      positionsGrossNotional: 0,
      positionsNetValue: 0,
      policy: REALISTIC_MARGIN_POLICY,
    });
    expect(snap.isMarginCall).toBe(false);
    expect(snap.requiresLiquidation).toBe(false);
  });

  it("excessEquity is equity minus maintenance requirement", () => {
    const snap = marginSnapshot({
      cash: 1000,
      positionsGrossNotional: 1000,
      positionsNetValue: 0,
      policy: REALISTIC_MARGIN_POLICY,
    });
    expect(snap.excessEquity).toBe(750);
  });
});

describe("isMarginCall / requiresLiquidation helpers", () => {
  it("isMarginCall agrees with maintenance threshold", () => {
    expect(isMarginCall(1000, 300, REALISTIC_MARGIN_POLICY)).toBe(false);
    expect(isMarginCall(1000, 200, REALISTIC_MARGIN_POLICY)).toBe(true);
  });

  it("requiresLiquidation agrees with threshold", () => {
    expect(requiresLiquidation(1000, 250, REALISTIC_MARGIN_POLICY)).toBe(
      false,
    );
    expect(requiresLiquidation(1000, 100, REALISTIC_MARGIN_POLICY)).toBe(
      true,
    );
  });
});

describe("borrowCostFor", () => {
  it("returns 0 when no rate or no time", () => {
    expect(borrowCostFor(1000, 30, IDEAL_MARGIN_POLICY)).toBe(0);
    expect(borrowCostFor(1000, 0, REALISTIC_MARGIN_POLICY)).toBe(0);
    expect(borrowCostFor(0, 30, REALISTIC_MARGIN_POLICY)).toBe(0);
  });

  it("approximates annualized rate * fractional period", () => {
    const cost = borrowCostFor(10_000, 365, REALISTIC_MARGIN_POLICY);
    expect(cost).toBeCloseTo(200, 6);
  });

  it("scales linearly with notional and days", () => {
    const a = borrowCostFor(10_000, 30, REALISTIC_MARGIN_POLICY);
    const b = borrowCostFor(20_000, 30, REALISTIC_MARGIN_POLICY);
    const c = borrowCostFor(10_000, 60, REALISTIC_MARGIN_POLICY);
    expect(b).toBeCloseTo(a * 2, 6);
    expect(c).toBeCloseTo(a * 2, 6);
  });
});

describe("canOpenAdditionalNotional", () => {
  it("allows when excess equity covers initial margin", () => {
    const ok = canOpenAdditionalNotional(
      {
        cash: 1000,
        positionsGrossNotional: 0,
        positionsNetValue: 0,
        policy: REALISTIC_MARGIN_POLICY,
      },
      1000,
    );
    expect(ok).toBe(true);
  });

  it("denies when additional initial margin exceeds excess equity", () => {
    const ok = canOpenAdditionalNotional(
      {
        cash: 100,
        positionsGrossNotional: 1000,
        positionsNetValue: 0,
        policy: REALISTIC_MARGIN_POLICY,
      },
      10_000,
    );
    expect(ok).toBe(false);
  });
});
