import { describe, expect, it } from "vitest";
import { validateScenarioPackage } from "../../domain/validation/scenario";
import { buildScenarioRegistry, getScenario, listScenarios } from "./index";
import { btc20202021Scenario } from "./btc-2020-2021";
import { eurGbpBrexit2016Scenario } from "./eurgbp-brexit-2016";
import { eurUsdCovidLiquidity2020Scenario } from "./eurusd-covid-liquidity-2020";
import { kreBankingCrisis2023Scenario } from "./kre-banking-crisis-2023";
import { qqqRateHike2022Scenario } from "./qqq-rate-hike-2022";
import { sp500Covid2020Scenario } from "./sp500-covid-2020";
import {
  EURGBP_BREXIT_2016_DATA_VERSION,
  EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION,
  scenarioReplayContractDataVersion,
} from "./dataVersions";

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

  it("pins every bundled scenario to a non-empty data version", () => {
    for (const pkg of [
      btc20202021Scenario,
      eurGbpBrexit2016Scenario,
      eurUsdCovidLiquidity2020Scenario,
      kreBankingCrisis2023Scenario,
      qqqRateHike2022Scenario,
      sp500Covid2020Scenario,
    ]) {
      expect(
        pkg.meta.dataVersion?.trim(),
        `${pkg.meta.id} dataVersion`,
      ).toBeTruthy();
    }
  });

  it("rejects duplicate scenario ids instead of silently overwriting them", () => {
    expect(() =>
      buildScenarioRegistry([btc20202021Scenario, btc20202021Scenario]),
    ).toThrow("Duplicate scenario id: btc-2020-2021");
  });

  it("keeps bundled replay-contract content recursively immutable", () => {
    const scenario = getScenario("eurgbp-brexit-2016")!;
    const originalClose = scenario.candles[0].close;

    expect(Object.isFrozen(scenario)).toBe(true);
    expect(Object.isFrozen(scenario.meta)).toBe(true);
    expect(Object.isFrozen(scenario.candles)).toBe(true);
    expect(Object.isFrozen(scenario.candles[0])).toBe(true);
    expect(Object.isFrozen(scenario.broker)).toBe(true);
    expect(() => {
      scenario.candles[0].close = originalClose + 1;
    }).toThrow(TypeError);
    expect(scenario.candles[0].close).toBe(originalClose);
    expect(scenarioReplayContractDataVersion(scenario)).toBe(
      scenario.meta.dataVersion,
    );
  });
});

describe("btc-2020-2021 scenario", () => {
  it("reveals the March 15 emergency Fed decision at the official 21:00Z publication time", () => {
    expect(
      btc20202021Scenario.events.find(
        (event) => event.id === "evt-2020-03-15-fed",
      ),
    ).toMatchObject({
      happenedAt: "2020-03-15T21:00:00.000Z",
      publishedAt: "2020-03-15T21:00:00.000Z",
    });
  });
});

describe("eurgbp-brexit-2016 scenario", () => {
  it("ships an observed official reference-rate path for beginners", () => {
    expect(eurGbpBrexit2016Scenario.meta).toMatchObject({
      id: "eurgbp-brexit-2016",
      difficulty: "beginner",
      isSampleData: false,
      dataFidelity: "mixed",
    });
    expect(eurGbpBrexit2016Scenario.candles).toHaveLength(152);
    expect(eurGbpBrexit2016Scenario.meta.dataVersion).toBe(
      EURGBP_BREXIT_2016_DATA_VERSION,
    );
    expect(
      eurGbpBrexit2016Scenario.candles.every(
        (candle) =>
          candle.open === candle.close &&
          candle.high === candle.close &&
          candle.low === candle.close &&
          candle.volume === 0,
      ),
    ).toBe(true);
  });

  it("attributes every replay event and the ECB source manifest", () => {
    expect(
      eurGbpBrexit2016Scenario.events.every(
        (event) => event.source && event.sourceUrl,
      ),
    ).toBe(true);
    expect(eurGbpBrexit2016Scenario.meta.sourceManifest).toContain(
      "scripts/import-ecb-eurgbp.mjs",
    );
    expect(eurGbpBrexit2016Scenario.meta.observedFields?.[0]).toContain(
      "ECB reference rate",
    );
    expect(eurGbpBrexit2016Scenario.meta.derivedFields).toEqual(
      expect.arrayContaining([
        expect.stringContaining("00:00Z-15:00Z"),
        expect.stringContaining("15:00Z replay close"),
      ]),
    );
  });
});

describe("eurusd-covid-liquidity-2020 scenario", () => {
  it("passes strict quality review with only expected ECB business-day gaps", () => {
    const result = validateScenarioPackage(eurUsdCovidLiquidity2020Scenario);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(
      result.warnings.every((warning) => warning.code === "candles.gap"),
    ).toBe(true);
  });

  it("ships the official observed ECB reference-rate path", () => {
    expect(eurUsdCovidLiquidity2020Scenario.meta).toMatchObject({
      id: "eurusd-covid-liquidity-2020",
      difficulty: "intermediate",
      isSampleData: false,
      dataFidelity: "mixed",
    });
    expect(eurUsdCovidLiquidity2020Scenario.candles).toHaveLength(104);
    expect(eurUsdCovidLiquidity2020Scenario.meta.dataVersion).toBe(
      EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION,
    );
    expect(eurUsdCovidLiquidity2020Scenario.candles[0]).toMatchObject({
      symbol: "EURUSD",
      closeTime: "2020-02-03T15:00:00.000Z",
      close: 1.1066,
    });
    expect(eurUsdCovidLiquidity2020Scenario.candles.at(-1)).toMatchObject({
      closeTime: "2020-06-30T15:00:00.000Z",
      close: 1.1198,
    });
    expect(
      eurUsdCovidLiquidity2020Scenario.candles.every(
        (candle) =>
          candle.open === candle.close &&
          candle.high === candle.close &&
          candle.low === candle.close &&
          candle.volume === 0,
      ),
    ).toBe(true);
    expect(eurUsdCovidLiquidity2020Scenario.meta.derivedFields).toEqual(
      expect.arrayContaining([
        expect.stringContaining("00:00Z-15:00Z"),
        expect.stringContaining("15:00Z replay close"),
      ]),
    );
  });

  it("uses the same observed reference series as its benchmark", () => {
    expect(eurUsdCovidLiquidity2020Scenario.benchmarks).toHaveLength(
      eurUsdCovidLiquidity2020Scenario.candles.length,
    );
    for (const [
      index,
      point,
    ] of eurUsdCovidLiquidity2020Scenario.benchmarks.entries()) {
      const candle = eurUsdCovidLiquidity2020Scenario.candles[index];
      expect(point).toMatchObject({
        symbol: candle.symbol,
        time: candle.closeTime,
        value: candle.close,
      });
    }
  });

  it("attributes official WHO, Federal Reserve, and ECB event evidence", () => {
    const sourceHosts = new Set(
      eurUsdCovidLiquidity2020Scenario.events.map(
        (event) => new URL(event.sourceUrl!).hostname,
      ),
    );
    expect(sourceHosts).toEqual(
      new Set(["www.ecb.europa.eu", "www.federalreserve.gov", "www.who.int"]),
    );
    expect(
      eurUsdCovidLiquidity2020Scenario.events.every(
        (event) => event.source && event.sourceUrl,
      ),
    ).toBe(true);
    expect(eurUsdCovidLiquidity2020Scenario.meta.sourceManifest).toEqual([
      "src/data/scenarios/eurusd-covid-liquidity-2020/README.md",
      "src/data/scenarios/eurusd-covid-liquidity-2020/ecb-eurusd.json",
      "scripts/import-ecb-eurusd.mjs",
    ]);
    expect(eurUsdCovidLiquidity2020Scenario.meta.observedFields?.[0]).toContain(
      "ECB reference rate",
    );
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
    expect(Date.parse(candles[candles.length - 1].closeTime)).toBeGreaterThan(
      Date.parse(candles[0].closeTime),
    );
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

  it("ships every event with a traceable source URL", () => {
    expect(btc20202021Scenario.events.length).toBeGreaterThan(10);
    expect(btc20202021Scenario.events.every((event) => event.source)).toBe(
      true,
    );
    expect(btc20202021Scenario.events.every((event) => event.sourceUrl)).toBe(
      true,
    );
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
    expect(Date.parse(candles[candles.length - 1].closeTime)).toBeGreaterThan(
      Date.parse("2020-12-30T00:00:00.000Z"),
    );
  });

  it("does not create candles on U.S. market holidays", () => {
    const candleDates = new Set(
      sp500Covid2020Scenario.candles.map((candle) =>
        candle.openTime.slice(0, 10),
      ),
    );
    for (const holiday of [
      "2020-01-20",
      "2020-02-17",
      "2020-04-10",
      "2020-05-25",
      "2020-07-03",
      "2020-09-07",
      "2020-11-26",
      "2020-12-25",
    ]) {
      expect(candleDates.has(holiday)).toBe(false);
    }
    expect(sp500Covid2020Scenario.candles).toHaveLength(253);
  });

  it("declares an exchange-local market calendar", () => {
    expect(sp500Covid2020Scenario.marketCalendar).toMatchObject({
      id: "us-equities-2020",
      timezone: "America/New_York",
    });
    expect(sp500Covid2020Scenario.marketCalendar?.sessions).toHaveLength(5);
  });

  it("computes RealizedVolatility10 from ten returns", () => {
    const candles = sp500Covid2020Scenario.candles;
    const first = sp500Covid2020Scenario.indicators.find(
      (indicator) => indicator.name === "RealizedVolatility10",
    );
    expect(first?.time).toBe(candles[10].closeTime);
    const returns = candles
      .slice(0, 11)
      .slice(1)
      .map((candle, index) => candle.close / candles[index].close - 1);
    const mean =
      returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance =
      returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (returns.length - 1);
    expect(first?.value).toBeCloseTo(
      Math.round(Math.sqrt(variance) * Math.sqrt(252) * 100 * 100) / 100,
      6,
    );
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

describe("qqq-rate-hike-2022 scenario", () => {
  it("declares the expected metadata", () => {
    expect(qqqRateHike2022Scenario.meta.id).toBe("qqq-rate-hike-2022");
    expect(qqqRateHike2022Scenario.meta.symbols).toContain("QQQ");
    expect(qqqRateHike2022Scenario.meta.defaultGranularity).toBe("1d");
    expect(qqqRateHike2022Scenario.meta.assetClass).toBe("etf");
    expect(qqqRateHike2022Scenario.meta.isSampleData).toBe(true);
  });

  it("contains a trading-day candle path through 2022", () => {
    const candles = qqqRateHike2022Scenario.candles;
    expect(candles.length).toBeGreaterThan(240);
    expect(candles[0].symbol).toBe("QQQ");
    expect(Date.parse(candles[0].closeTime)).toBeLessThan(
      Date.parse("2022-01-04T00:00:00.000Z"),
    );
    expect(Date.parse(candles[candles.length - 1].closeTime)).toBeGreaterThan(
      Date.parse("2022-12-29T00:00:00.000Z"),
    );
  });

  it("includes official-source inflation and central-bank events", () => {
    const types = new Set(qqqRateHike2022Scenario.events.map((e) => e.type));
    expect(types.has("macro")).toBe(true);
    expect(types.has("central_bank")).toBe(true);
    expect(
      qqqRateHike2022Scenario.events.every((event) => event.sourceUrl),
    ).toBe(true);
  });

  it("ships benchmarks aligned with candle close times", () => {
    const candleTimes = new Set(
      qqqRateHike2022Scenario.candles.map((c) => c.closeTime),
    );
    for (const point of qqqRateHike2022Scenario.benchmarks) {
      expect(candleTimes.has(point.time)).toBe(true);
    }
  });

  it("declares a 2022 U.S. equity calendar", () => {
    expect(qqqRateHike2022Scenario.marketCalendar?.timezone).toBe(
      "America/New_York",
    );
  });
});

describe("kre-banking-crisis-2023 scenario", () => {
  it("declares the expected metadata", () => {
    expect(kreBankingCrisis2023Scenario.meta.id).toBe(
      "kre-banking-crisis-2023",
    );
    expect(kreBankingCrisis2023Scenario.meta.symbols).toContain("KRE");
    expect(kreBankingCrisis2023Scenario.meta.defaultGranularity).toBe("1d");
    expect(kreBankingCrisis2023Scenario.meta.assetClass).toBe("etf");
    expect(kreBankingCrisis2023Scenario.meta.isSampleData).toBe(true);
  });

  it("contains a trading-day candle path through the bank stress window", () => {
    const candles = kreBankingCrisis2023Scenario.candles;
    expect(candles.length).toBeGreaterThan(80);
    expect(candles[0].symbol).toBe("KRE");
    expect(Date.parse(candles[0].closeTime)).toBeLessThan(
      Date.parse("2023-03-02T00:00:00.000Z"),
    );
    expect(Date.parse(candles[candles.length - 1].closeTime)).toBeGreaterThan(
      Date.parse("2023-06-29T00:00:00.000Z"),
    );
  });

  it("includes official-source bank failure and policy response events", () => {
    const types = new Set(
      kreBankingCrisis2023Scenario.events.map((e) => e.type),
    );
    expect(types.has("regulation")).toBe(true);
    expect(types.has("central_bank")).toBe(true);
    expect(types.has("corporate_action")).toBe(true);
    expect(
      kreBankingCrisis2023Scenario.events.every((event) => event.sourceUrl),
    ).toBe(true);
  });

  it("ships benchmarks aligned with candle close times", () => {
    const candleTimes = new Set(
      kreBankingCrisis2023Scenario.candles.map((c) => c.closeTime),
    );
    for (const point of kreBankingCrisis2023Scenario.benchmarks) {
      expect(candleTimes.has(point.time)).toBe(true);
    }
  });

  it("declares a 2023 U.S. equity calendar", () => {
    expect(kreBankingCrisis2023Scenario.marketCalendar?.timezone).toBe(
      "America/New_York",
    );
  });
});
