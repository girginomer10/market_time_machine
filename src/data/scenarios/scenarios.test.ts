import { describe, expect, it } from "vitest";
import { validateScenarioPackage } from "../../domain/validation/scenario";
import { listScenarios } from "./index";
import { btc20202021Scenario } from "./btc-2020-2021";

describe("scenario registry", () => {
  it("ships at least one scenario", () => {
    expect(listScenarios().length).toBeGreaterThan(0);
  });

  it("every shipped scenario passes validation with zero errors", () => {
    for (const pkg of listScenarios()) {
      const result = validateScenarioPackage(pkg);
      const errorSummary = result.errors
        .map((e) => `${e.code}${e.path ? ` @ ${e.path}` : ""}: ${e.message}`)
        .join("\n");
      expect(
        result.valid,
        `Scenario ${pkg.meta.id} reported errors:\n${errorSummary}`,
      ).toBe(true);
    }
  });
});

describe("btc-2020-2021 scenario", () => {
  it("declares the expected metadata", () => {
    expect(btc20202021Scenario.meta.id).toBe("btc-2020-2021");
    expect(btc20202021Scenario.meta.symbols).toContain("BTCUSD");
    expect(btc20202021Scenario.meta.defaultGranularity).toBe("1d");
    expect(btc20202021Scenario.meta.license).toBeTruthy();
    expect(btc20202021Scenario.meta.dataSources.length).toBeGreaterThan(0);
  });

  it("contains a daily candle for every day in the range", () => {
    const candles = btc20202021Scenario.candles;
    expect(candles.length).toBeGreaterThan(700);
    expect(candles[0].symbol).toBe("BTCUSD");
    expect(
      Date.parse(candles[candles.length - 1].closeTime),
    ).toBeGreaterThan(Date.parse(candles[0].closeTime));
  });

  it("ships every event with both happenedAt and publishedAt", () => {
    for (const ev of btc20202021Scenario.events) {
      expect(ev.happenedAt).toBeTruthy();
      expect(ev.publishedAt).toBeTruthy();
    }
  });

  it("ships at least one corporate_action and one regulation event", () => {
    const types = new Set(btc20202021Scenario.events.map((e) => e.type));
    expect(types.has("corporate_action")).toBe(true);
    expect(types.has("regulation")).toBe(true);
  });

  it("ships benchmarks aligned with candle close times", () => {
    const candleTimes = new Set(
      btc20202021Scenario.candles.map((c) => c.closeTime),
    );
    for (const point of btc20202021Scenario.benchmarks) {
      expect(candleTimes.has(point.time)).toBe(true);
    }
  });

  it("declares broker assumptions", () => {
    const broker = btc20202021Scenario.broker;
    expect(broker.baseCurrency).toBe("USD");
    expect(broker.commissionRateBps).toBeGreaterThan(0);
    expect(broker.allowFractional).toBe(true);
  });
});
