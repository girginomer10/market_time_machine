import { describe, expect, it } from "vitest";

import type { BrokerConfig } from "../../types";
import {
  BROKER_PRESETS,
  HARSH_BROKER_CONFIG,
  IDEAL_BROKER_CONFIG,
  REALISTIC_BROKER_CONFIG,
  brokerConfigFingerprint,
  commissionFor,
  getBrokerPreset,
  isBrokerConfigFingerprint,
  isBrokerPresetName,
  marketFillPrice,
  slippageBpsFor,
} from "./executionModels";

describe("broker presets", () => {
  it("exposes ideal/realistic/harsh presets", () => {
    expect(Object.keys(BROKER_PRESETS).sort()).toEqual([
      "harsh",
      "ideal",
      "realistic",
    ]);
  });

  it("ideal preset has zero costs", () => {
    expect(IDEAL_BROKER_CONFIG.commissionRateBps).toBe(0);
    expect(IDEAL_BROKER_CONFIG.spreadBps).toBe(0);
    expect(IDEAL_BROKER_CONFIG.slippageModel).toBe("none");
    expect(IDEAL_BROKER_CONFIG.maxLeverage).toBe(1);
  });

  it("harsh preset is stricter than realistic", () => {
    expect(HARSH_BROKER_CONFIG.commissionRateBps).toBeGreaterThanOrEqual(
      REALISTIC_BROKER_CONFIG.commissionRateBps,
    );
    expect(HARSH_BROKER_CONFIG.spreadBps).toBeGreaterThan(
      REALISTIC_BROKER_CONFIG.spreadBps,
    );
    expect(HARSH_BROKER_CONFIG.maxLeverage).toBeGreaterThanOrEqual(
      REALISTIC_BROKER_CONFIG.maxLeverage,
    );
  });

  it("getBrokerPreset returns a fresh copy", () => {
    const a = getBrokerPreset("realistic");
    const b = getBrokerPreset("realistic");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.commissionRateBps = 999;
    expect(REALISTIC_BROKER_CONFIG.commissionRateBps).toBe(5);
  });

  it("isBrokerPresetName guards correctly", () => {
    expect(isBrokerPresetName("ideal")).toBe(true);
    expect(isBrokerPresetName("harsh")).toBe(true);
    expect(isBrokerPresetName("custom")).toBe(false);
  });

  it("fingerprints every broker setting in one canonical identity", () => {
    const current = brokerConfigFingerprint(REALISTIC_BROKER_CONFIG);
    expect(isBrokerConfigFingerprint(current)).toBe(true);
    for (const changed of [
      { ...REALISTIC_BROKER_CONFIG, baseCurrency: "EUR" },
      { ...REALISTIC_BROKER_CONFIG, commissionRateBps: 6 },
      { ...REALISTIC_BROKER_CONFIG, fixedFee: 1 },
      { ...REALISTIC_BROKER_CONFIG, spreadBps: 6 },
      { ...REALISTIC_BROKER_CONFIG, slippageModel: "none" as const },
      { ...REALISTIC_BROKER_CONFIG, slippageBps: 4 },
      { ...REALISTIC_BROKER_CONFIG, allowFractional: false },
      { ...REALISTIC_BROKER_CONFIG, allowShort: false },
      { ...REALISTIC_BROKER_CONFIG, maxLeverage: 3 },
      { ...REALISTIC_BROKER_CONFIG, maxParticipationRate: 0.2 },
      { ...REALISTIC_BROKER_CONFIG, partialFillPolicy: "disabled" as const },
      { ...REALISTIC_BROKER_CONFIG, stopFillPolicy: "trigger_price" as const },
      { ...REALISTIC_BROKER_CONFIG, marketHoursEnforced: false },
      { ...REALISTIC_BROKER_CONFIG, marginCallPolicy: "disabled" as const },
      { ...REALISTIC_BROKER_CONFIG, borrowRateBps: 201 },
    ]) {
      expect(brokerConfigFingerprint(changed)).not.toBe(current);
    }
  });

  it("rejects malformed, non-canonical, and invalid broker fingerprints", () => {
    const valid = brokerConfigFingerprint(IDEAL_BROKER_CONFIG);
    expect(isBrokerConfigFingerprint(valid.replace('"USD"', '""'))).toBe(false);
    expect(isBrokerConfigFingerprint(valid.replace('"fixedFee":0', '"fixedFee":-1'))).toBe(
      false,
    );
    expect(isBrokerConfigFingerprint(`${valid} `)).toBe(false);
    expect(isBrokerConfigFingerprint("broker-config-v1:{}")).toBe(false);
    expect(isBrokerConfigFingerprint("broker-config-v2:{}")).toBe(false);
  });
});

describe("marketFillPrice", () => {
  const ideal = IDEAL_BROKER_CONFIG;
  const realistic = REALISTIC_BROKER_CONFIG;

  it("ideal: buy and sell fill at reference price", () => {
    const buy = marketFillPrice(100, "buy", ideal);
    const sell = marketFillPrice(100, "sell", ideal);
    expect(buy.fillPrice).toBe(100);
    expect(sell.fillPrice).toBe(100);
    expect(buy.spreadCost).toBe(0);
    expect(buy.slippage).toBe(0);
  });

  it("realistic: buy is above reference, sell is below by symmetric amount", () => {
    const ref = 100;
    const buy = marketFillPrice(ref, "buy", realistic);
    const sell = marketFillPrice(ref, "sell", realistic);
    expect(buy.fillPrice).toBeGreaterThan(ref);
    expect(sell.fillPrice).toBeLessThan(ref);
    const buyAdj = buy.fillPrice - ref;
    const sellAdj = ref - sell.fillPrice;
    expect(buyAdj).toBeCloseTo(sellAdj, 10);
  });

  it("half spread is applied per side", () => {
    const broker: BrokerConfig = {
      ...realistic,
      spreadBps: 20,
      slippageModel: "none",
      slippageBps: 0,
    };
    const ref = 1000;
    const buy = marketFillPrice(ref, "buy", broker);
    expect(buy.spreadCost).toBeCloseTo(1, 6);
    expect(buy.fillPrice).toBeCloseTo(1001, 6);
  });

  it("volume-based slippage scales with participation", () => {
    const broker: BrokerConfig = {
      ...realistic,
      spreadBps: 0,
      slippageModel: "volume_based",
      slippageBps: 5,
    };
    const small = marketFillPrice(100, "buy", broker, {
      quantity: 1,
      candleVolumeNotional: 1_000_000,
    });
    const big = marketFillPrice(100, "buy", broker, {
      quantity: 1000,
      candleVolumeNotional: 100_000,
    });
    expect(big.slippage).toBeGreaterThan(small.slippage);
  });

  it("volatility-based slippage scales with sigma", () => {
    const broker: BrokerConfig = {
      ...realistic,
      spreadBps: 0,
      slippageModel: "volatility_based",
      slippageBps: 5,
    };
    const calm = marketFillPrice(100, "buy", broker, { volatility: 0 });
    const wild = marketFillPrice(100, "buy", broker, { volatility: 0.05 });
    expect(wild.slippage).toBeGreaterThan(calm.slippage);
  });
});

describe("slippageBpsFor", () => {
  it("returns 0 for none model", () => {
    expect(slippageBpsFor("none", 100, 100)).toBe(0);
  });

  it("returns base for fixed_bps model", () => {
    expect(slippageBpsFor("fixed_bps", 7, 100)).toBe(7);
  });

  it("falls back to base when volume context is missing", () => {
    expect(slippageBpsFor("volume_based", 5, 100)).toBe(5);
    expect(
      slippageBpsFor("volume_based", 5, 100, {
        quantity: 10,
        candleVolumeNotional: 0,
      }),
    ).toBe(5);
  });
});

describe("commissionFor", () => {
  it("computes percentage plus fixed fee", () => {
    const broker: BrokerConfig = {
      ...REALISTIC_BROKER_CONFIG,
      commissionRateBps: 10,
      fixedFee: 1,
    };
    expect(commissionFor(1000, broker)).toBeCloseTo(2, 6);
  });
});
