import { describe, expect, it } from "vitest";
import { makeScenario } from "../../test/fixtures";
import type { Candle, MarketEvent, ScenarioPackage } from "../../types";
import {
  findHindsightPatterns,
  isIsoTimestamp,
  validateBroker,
  validateCandles,
  validateEvents,
  validateScenarioPackage,
} from "./scenario";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("isIsoTimestamp", () => {
  it("accepts canonical UTC timestamps", () => {
    expect(isIsoTimestamp("2024-01-01T00:00:00.000Z")).toBe(true);
  });

  it("accepts second-precision timestamps", () => {
    expect(isIsoTimestamp("2024-01-01T00:00:00Z")).toBe(true);
  });

  it("accepts timezone offset timestamps", () => {
    expect(isIsoTimestamp("2024-01-01T00:00:00+00:00")).toBe(true);
    expect(isIsoTimestamp("2024-01-01T00:00:00-05:00")).toBe(true);
  });

  it("rejects date-only strings", () => {
    expect(isIsoTimestamp("2024-01-01")).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(isIsoTimestamp("not a date")).toBe(false);
    expect(isIsoTimestamp("")).toBe(false);
    expect(isIsoTimestamp("2024-13-01T00:00:00Z")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isIsoTimestamp(123)).toBe(false);
    expect(isIsoTimestamp(null)).toBe(false);
    expect(isIsoTimestamp(undefined)).toBe(false);
  });
});

describe("findHindsightPatterns", () => {
  it("flags 'triggered a rally' phrasing", () => {
    expect(
      findHindsightPatterns("The Fed cut rates, triggering a powerful rally."),
    ).not.toHaveLength(0);
  });

  it("flags 'kicked off the bull run' phrasing", () => {
    expect(findHindsightPatterns("This kicked off the bull run.")).not.toHaveLength(
      0,
    );
  });

  it("flags 'in hindsight' phrasing", () => {
    expect(findHindsightPatterns("In hindsight, the move was obvious.")).not.toHaveLength(
      0,
    );
  });

  it("flags 'before the crash' phrasing", () => {
    expect(findHindsightPatterns("Days before the crash, sentiment was high.")).not.toHaveLength(
      0,
    );
  });

  it("does not flag neutral announcement phrasing", () => {
    expect(
      findHindsightPatterns(
        "The Federal Reserve announced an emergency rate cut of 50 basis points.",
      ),
    ).toEqual([]);
  });

  it("does not flag historical references that aren't hindsight", () => {
    expect(
      findHindsightPatterns(
        "Bitcoin trades above its 2017 all-time high for the first time.",
      ),
    ).toEqual([]);
  });
});

describe("validateScenarioPackage", () => {
  it("returns valid for a clean fixture scenario", () => {
    const result = validateScenarioPackage(makeScenario());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("flags an empty candle array", () => {
    const pkg = makeScenario();
    const broken: ScenarioPackage = { ...pkg, candles: [] };
    const result = validateScenarioPackage(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some((i) => i.code === "candles.empty")).toBe(true);
  });

  it("flags out-of-order candles", () => {
    const pkg = clone(makeScenario());
    [pkg.candles[0], pkg.candles[1]] = [pkg.candles[1], pkg.candles[0]];
    const result = validateScenarioPackage(pkg);
    expect(result.errors.some((i) => i.code === "candles.not_sorted")).toBe(true);
  });

  it("flags non-ISO candle timestamps", () => {
    const pkg = clone(makeScenario());
    pkg.candles[0].closeTime = "not-a-date";
    const result = validateScenarioPackage(pkg);
    expect(
      result.errors.some((i) => i.code === "candles.close_time_invalid"),
    ).toBe(true);
  });

  it("flags candles with unknown symbols", () => {
    const pkg = clone(makeScenario());
    pkg.candles[0].symbol = "OTHER";
    const result = validateScenarioPackage(pkg);
    expect(result.errors.some((i) => i.code === "candles.symbol_unknown")).toBe(
      true,
    );
  });

  it("flags candles with inconsistent OHLC", () => {
    const pkg = clone(makeScenario());
    pkg.candles[0].high = pkg.candles[0].low - 1;
    const result = validateScenarioPackage(pkg);
    expect(
      result.errors.some((i) => i.code === "candles.ohlc_inconsistent"),
    ).toBe(true);
  });

  it("flags events missing publishedAt", () => {
    const pkg = clone(makeScenario());
    (pkg.events[0] as Partial<MarketEvent>).publishedAt = undefined;
    const result = validateScenarioPackage(pkg);
    expect(
      result.errors.some((i) => i.code === "events.published_at_missing"),
    ).toBe(true);
  });

  it("flags duplicate event ids", () => {
    const pkg = clone(makeScenario());
    pkg.events.push({ ...pkg.events[0] });
    const result = validateScenarioPackage(pkg);
    expect(result.errors.some((i) => i.code === "events.id_duplicate")).toBe(
      true,
    );
  });

  it("warns on hindsight phrasing in event summaries", () => {
    const pkg = clone(makeScenario());
    pkg.events[0].summary =
      "The Fed cut rates, triggering a powerful rally that lifted risk assets.";
    const result = validateScenarioPackage(pkg);
    expect(
      result.warnings.some((i) => i.code === "events.hindsight_phrasing"),
    ).toBe(true);
  });

  it("warns when events are missing source attribution", () => {
    const pkg = clone(makeScenario());
    const result = validateScenarioPackage(pkg);

    expect(result.warnings.some((i) => i.code === "events.source_missing")).toBe(
      true,
    );
    expect(
      result.warnings.some((i) => i.code === "events.source_url_missing"),
    ).toBe(true);
  });

  it("flags events that reference unknown symbols", () => {
    const pkg = clone(makeScenario());
    pkg.events[0].affectedSymbols = ["MISSING"];
    const result = validateScenarioPackage(pkg);
    expect(result.errors.some((i) => i.code === "events.symbol_unknown")).toBe(
      true,
    );
  });

  it("flags scenario meta with inverted range", () => {
    const pkg = clone(makeScenario());
    pkg.meta.endTime = pkg.meta.startTime;
    const result = validateScenarioPackage(pkg);
    expect(result.errors.some((i) => i.code === "meta.range_inverted")).toBe(
      true,
    );
  });

  it("flags broker with negative commission", () => {
    const pkg = clone(makeScenario());
    pkg.broker.commissionRateBps = -1;
    const result = validateScenarioPackage(pkg);
    expect(
      result.errors.some((i) => i.code === "broker.commission_negative"),
    ).toBe(true);
  });

  it("flags broker with leverage below 1", () => {
    const pkg = clone(makeScenario());
    pkg.broker.maxLeverage = 0;
    const result = validateScenarioPackage(pkg);
    expect(
      result.errors.some((i) => i.code === "broker.max_leverage_too_low"),
    ).toBe(true);
  });
});

describe("validateCandles", () => {
  it("flags overlapping candles", () => {
    const symbols = new Set(["X"]);
    const candles: Candle[] = [
      {
        symbol: "X",
        openTime: "2024-01-01T00:00:00.000Z",
        closeTime: "2024-01-02T00:00:00.000Z",
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 10,
      },
      {
        symbol: "X",
        openTime: "2024-01-01T12:00:00.000Z",
        closeTime: "2024-01-02T12:00:00.000Z",
        open: 2,
        high: 3,
        low: 2,
        close: 3,
        volume: 10,
      },
    ];
    const issues = validateCandles(candles, symbols, "1d");
    expect(issues.some((i) => i.code === "candles.overlap")).toBe(true);
  });

  it("flags negative volume", () => {
    const symbols = new Set(["X"]);
    const candles: Candle[] = [
      {
        symbol: "X",
        openTime: "2024-01-01T00:00:00.000Z",
        closeTime: "2024-01-02T00:00:00.000Z",
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: -5,
      },
    ];
    const issues = validateCandles(candles, symbols, "1d");
    expect(issues.some((i) => i.code === "candles.negative_volume")).toBe(true);
  });
});

describe("validateEvents", () => {
  it("warns when publishedAt precedes happenedAt", () => {
    const events: MarketEvent[] = [
      {
        id: "x",
        happenedAt: "2024-01-05T00:00:00.000Z",
        publishedAt: "2024-01-01T00:00:00.000Z",
        title: "Pre-announcement",
        type: "news",
        summary: "Announced ahead of effective date.",
        affectedSymbols: ["X"],
        importance: 3,
      },
    ];
    const meta = {
      id: "t",
      title: "t",
      assetClass: "crypto" as const,
      symbols: ["X"],
      startTime: "2024-01-01T00:00:00.000Z",
      endTime: "2024-01-31T00:00:00.000Z",
      baseCurrency: "USD",
      initialCash: 1000,
      defaultGranularity: "1d" as const,
      difficulty: "beginner" as const,
      tags: [],
      supportedModes: ["explorer" as const],
      license: "MIT",
      dataSources: ["t"],
    };
    const issues = validateEvents(events, new Set(["X"]), meta);
    expect(
      issues.some((i) => i.code === "events.published_before_happened"),
    ).toBe(true);
  });
});

describe("validateBroker", () => {
  it("warns when fixed_bps slippage model lacks slippageBps", () => {
    const issues = validateBroker({
      baseCurrency: "USD",
      commissionRateBps: 5,
      fixedFee: 0,
      spreadBps: 5,
      slippageModel: "fixed_bps",
      allowFractional: true,
      allowShort: false,
      maxLeverage: 1,
    });
    expect(issues.some((i) => i.code === "broker.slippage_bps_missing")).toBe(
      true,
    );
  });
});
