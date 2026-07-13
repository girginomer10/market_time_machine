import { beforeEach, describe, expect, it } from "vitest";
import type { ScenarioPackage } from "../../types";
import {
  getScenario,
  isUserScenario,
  registerUserScenario,
  removeUserScenario,
} from ".";
import { scenarioRegistry } from ".";

function userScenario(id = "user-scenario"): ScenarioPackage {
  return {
    meta: {
      id,
      title: "User Scenario",
      assetClass: "equity",
      symbols: ["TEST"],
      startTime: "2024-01-01T00:00:00.000Z",
      endTime: "2024-01-02T00:00:00.000Z",
      baseCurrency: "USD",
      initialCash: 10_000,
      defaultGranularity: "1d",
      difficulty: "beginner",
      tags: ["custom"],
      supportedModes: ["explorer", "professional"],
      benchmarkSymbol: "TEST",
      license: "Licensed for local use",
      dataSources: ["User import"],
    },
    instruments: [
      {
        symbol: "TEST",
        name: "Test Asset",
        assetClass: "equity",
        currency: "USD",
        timezone: "UTC",
      },
    ],
    candles: [
      {
        symbol: "TEST",
        openTime: "2024-01-01T00:00:00.000Z",
        closeTime: "2024-01-01T23:59:59.999Z",
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 1_000,
      },
      {
        symbol: "TEST",
        openTime: "2024-01-02T00:00:00.000Z",
        closeTime: "2024-01-02T23:59:59.999Z",
        open: 102,
        high: 108,
        low: 101,
        close: 106,
        volume: 1_000,
      },
    ],
    events: [],
    indicators: [],
    benchmarks: [
      { symbol: "TEST", time: "2024-01-01T23:59:59.999Z", value: 102 },
      { symbol: "TEST", time: "2024-01-02T23:59:59.999Z", value: 106 },
    ],
    broker: {
      baseCurrency: "USD",
      commissionRateBps: 0,
      fixedFee: 0,
      spreadBps: 2,
      slippageModel: "fixed_bps",
      slippageBps: 1,
      allowFractional: true,
      allowShort: false,
      maxLeverage: 1,
    },
  };
}

describe("user scenario registry", () => {
  beforeEach(() => {
    window.localStorage.clear();
    for (const id of Object.keys(scenarioRegistry)) {
      if (isUserScenario(id)) delete scenarioRegistry[id];
    }
  });

  it("validates, registers, persists, and removes a user scenario", () => {
    const result = registerUserScenario(userScenario());
    expect(result).toMatchObject({ ok: true, persisted: true });
    expect(getScenario("user-scenario")?.meta.title).toBe("User Scenario");
    expect(isUserScenario("user-scenario")).toBe(true);
    expect(window.localStorage.getItem("market-time-machine.user-scenarios.v1")).toContain(
      "user-scenario",
    );
    expect(removeUserScenario("user-scenario")).toBe(true);
    expect(getScenario("user-scenario")).toBeUndefined();
  });

  it("rejects malformed packages and bundled id replacement", () => {
    expect(registerUserScenario({ nope: true })).toMatchObject({ ok: false });
    expect(registerUserScenario(userScenario("btc-2020-2021"))).toMatchObject({
      ok: false,
      persisted: false,
    });
  });
});
