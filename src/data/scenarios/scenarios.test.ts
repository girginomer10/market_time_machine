import { describe, expect, it } from "vitest";
import { validateScenarioPackage } from "../../domain/validation/scenario";
import { listScenarios } from "./index";
import { btc20202021Scenario } from "./btc-2020-2021";
import { sp500Covid2020Scenario } from "./sp500-covid-2020";

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

describe("sp500-covid-2020 scenario", () => {
  it("declares the expected metadata", () => {
    expect(sp500Covid2020Scenario.meta.id).toBe("sp500-covid-2020");
    expect(sp500Covid2020Scenario.meta.symbols).toContain("SPY");
    expect(sp500Covid2020Scenario.meta.defaultGranularity).toBe("1d");
    expect(sp500Covid2020Scenario.meta.assetClass).toBe("etf");
    expect(sp500Covid2020Scenario.meta.isSampleData).toBe(true);
  });

  it("contains a trading-day candle path through 2020", () => {
    const candles = sp500Covid2020Scenario.candles;
    expect(candles.length).toBeGreaterThan(250);
    expect(candles[0].symbol).toBe("SPY");
    expect(Date.parse(candles[0].closeTime)).toBeLessThan(
      Date.parse("2020-01-03T00:00:00.000Z"),
    );
    expect(
      Date.parse(candles[candles.length - 1].closeTime),
    ).toBeGreaterThan(Date.parse("2020-12-30T00:00:00.000Z"));
  });

  it("includes official-source crisis, policy, macro, and vaccine events", () => {
    const types = new Set(sp500Covid2020Scenario.events.map((e) => e.type));
    expect(types.has("price_event")).toBe(true);
    expect(types.has("central_bank")).toBe(true);
    expect(types.has("macro")).toBe(true);
    expect(types.has("regulation")).toBe(true);
    expect(types.has("corporate_action")).toBe(true);
    expect(
      sp500Covid2020Scenario.events.every((event) => event.sourceUrl),
    ).toBe(true);
  });

  it("ships benchmarks aligned with candle close times", () => {
    const candleTimes = new Set(
      sp500Covid2020Scenario.candles.map((c) => c.closeTime),
    );
    for (const point of sp500Covid2020Scenario.benchmarks) {
      expect(candleTimes.has(point.time)).toBe(true);
    }
  });
});
