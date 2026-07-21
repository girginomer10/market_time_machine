import { describe, expect, it } from "vitest";
import { makeScenario } from "../../test/fixtures";
import type { Candle, MarketEvent, ScenarioPackage } from "../../types";
import {
  findHindsightPatterns,
  isIsoTimestamp,
  validateBroker,
  validateCandles,
  validateEvents,
  validateMarketCalendar,
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

  it("rejects unsupported scenario metadata enums and duplicate modes", () => {
    const scenario = clone(makeScenario());
    const meta = scenario.meta as unknown as Record<string, unknown>;
    meta.assetClass = "collectible";
    meta.difficulty = "impossible";
    meta.defaultGranularity = "2h";
    meta.supportedModes = ["explorer", "explorer"];

    const codes = validateScenarioPackage(scenario as ScenarioPackage).errors.map(
      (issue) => issue.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "meta.asset_class_invalid",
        "meta.difficulty_invalid",
        "meta.default_granularity_invalid",
        "meta.supported_modes_invalid",
      ]),
    );
  });

  it("rejects unsupported event types and out-of-range importance", () => {
    const scenario = clone(makeScenario());
    Object.assign(scenario.events[0], { type: "rumor", importance: 9 });
    const codes = validateScenarioPackage(scenario).errors.map(
      (issue) => issue.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining(["events.type_invalid", "events.importance_invalid"]),
    );
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

  it.each([
    ["open", Number.POSITIVE_INFINITY],
    ["high", Number.NaN],
    ["low", 0],
    ["close", -1],
  ] as const)("flags non-finite or non-positive candle %s", (field, value) => {
    const pkg = makeScenario();
    pkg.candles[0][field] = value;
    const result = validateScenarioPackage(pkg);

    expect(
      result.errors.some(
        (issue) =>
          issue.code === "candles.ohlc_value_invalid" &&
          issue.path === `candles[0].${field}`,
      ),
    ).toBe(true);
  });

  it("flags invalid adjusted closes and non-finite volume", () => {
    const pkg = makeScenario();
    pkg.candles[0].adjustedClose = Number.POSITIVE_INFINITY;
    pkg.candles[1].volume = Number.NaN;
    const result = validateScenarioPackage(pkg);

    expect(
      result.errors.some(
        (issue) => issue.code === "candles.adjusted_close_invalid",
      ),
    ).toBe(true);
    expect(
      result.errors.some((issue) => issue.code === "candles.volume_invalid"),
    ).toBe(true);
  });

  it("flags non-finite scalar and record indicator values", () => {
    const pkg = makeScenario();
    pkg.indicators = [
      {
        symbol: pkg.meta.symbols[0],
        name: "scalar",
        time: pkg.candles[0].closeTime,
        availableAt: pkg.candles[0].closeTime,
        value: Number.POSITIVE_INFINITY,
      },
      {
        symbol: pkg.meta.symbols[0],
        name: "record",
        time: pkg.candles[0].closeTime,
        availableAt: pkg.candles[0].closeTime,
        value: { valid: 1, invalid: Number.NaN },
      },
    ];
    const result = validateScenarioPackage(pkg);

    expect(
      result.errors.filter(
        (issue) => issue.code === "indicators.value_invalid",
      ),
    ).toHaveLength(2);
    expect(
      result.errors.some(
        (issue) => issue.path === "indicators[1].value.invalid",
      ),
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

  it("flags corporate actions without valid economic terms", () => {
    const pkg = clone(makeScenario());
    pkg.corporateActions = [
      {
        symbol: pkg.meta.symbols[0],
        type: "dividend",
        effectiveAt: pkg.meta.startTime,
      },
      {
        symbol: pkg.meta.symbols[0],
        type: "split",
        effectiveAt: pkg.meta.startTime,
        ratio: Number.POSITIVE_INFINITY,
      },
    ];
    const result = validateScenarioPackage(pkg);

    expect(
      result.errors.some(
        (issue) => issue.code === "corporate_actions.dividend_amount_invalid",
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (issue) => issue.code === "corporate_actions.split_ratio_invalid",
      ),
    ).toBe(true);
  });

  it("validates every provided corporate-action numeric field", () => {
    const pkg = makeScenario();
    pkg.corporateActions = [
      {
        symbol: pkg.meta.symbols[0],
        type: "dividend",
        effectiveAt: pkg.meta.startTime,
        amount: 1,
        ratio: Number.POSITIVE_INFINITY,
      },
      {
        symbol: pkg.meta.symbols[0],
        type: "split",
        effectiveAt: pkg.meta.startTime,
        ratio: 2,
        amount: Number.NaN,
      },
    ];
    const result = validateScenarioPackage(pkg);

    expect(
      result.errors.some(
        (issue) =>
          issue.code === "corporate_actions.split_ratio_invalid" &&
          issue.path === "corporateActions[0].ratio",
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (issue) =>
          issue.code === "corporate_actions.dividend_amount_invalid" &&
          issue.path === "corporateActions[1].amount",
      ),
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

  it("tracks sort order independently for interleaved symbols", () => {
    const candle = (
      symbol: string,
      openTime: string,
      closeTime: string,
    ): Candle => ({
      symbol,
      openTime,
      closeTime,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 10,
    });
    const issues = validateCandles(
      [
        candle(
          "X",
          "2024-01-01T00:00:00Z",
          "2024-01-02T00:00:00Z",
        ),
        candle(
          "Y",
          "2024-01-01T00:00:00Z",
          "2024-01-02T00:00:00Z",
        ),
        candle(
          "X",
          "2023-12-31T00:00:00Z",
          "2024-01-01T00:00:00Z",
        ),
      ],
      new Set(["X", "Y"]),
      "1d",
    );

    expect(issues.some((issue) => issue.code === "candles.not_sorted")).toBe(
      true,
    );
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

  it.each([
    ["fixedFee", -1, "broker.fixed_fee_invalid"],
    ["slippageBps", -1, "broker.slippage_bps_invalid"],
    ["borrowRateBps", -1, "broker.borrow_rate_invalid"],
    ["commissionRateBps", Number.NaN, "broker.commission_negative"],
    ["spreadBps", Number.POSITIVE_INFINITY, "broker.spread_negative"],
    ["maxLeverage", Number.NaN, "broker.max_leverage_too_low"],
  ] as const)("rejects invalid %s", (field, value, code) => {
    const broker = {
      ...makeScenario().broker,
      [field]: value,
    };
    const issues = validateBroker(broker);

    expect(issues.some((issue) => issue.code === code)).toBe(true);
  });

  it("requires a participation rate for volume-limited fills", () => {
    const broker = {
      ...makeScenario().broker,
      partialFillPolicy: "volume_limited" as const,
      maxParticipationRate: undefined,
    };

    expect(
      validateBroker(broker).some(
        (issue) => issue.code === "broker.max_participation_missing",
      ),
    ).toBe(true);
  });
});

describe("validateMarketCalendar", () => {
  it("rejects invalid timezone, session time, and holiday values", () => {
    const meta = makeScenario().meta;
    const issues = validateMarketCalendar(
      {
        id: "broken-calendar",
        timezone: "Mars/Olympus_Mons",
        sessions: [
          { dayOfWeek: 1, open: "9:30", close: "25:00" },
        ],
        holidays: ["2024-02-30"],
      },
      meta,
    );

    expect(issues.some((issue) => issue.code === "calendar.timezone_invalid")).toBe(true);
    expect(issues.some((issue) => issue.code === "calendar.time_invalid")).toBe(true);
    expect(issues.some((issue) => issue.code === "calendar.holiday_invalid")).toBe(true);
  });

  it("rejects duplicate sessions and holidays", () => {
    const meta = makeScenario().meta;
    const issues = validateMarketCalendar(
      {
        id: "duplicate-calendar",
        timezone: "UTC",
        sessions: [
          { dayOfWeek: 1, open: "09:30", close: "16:00" },
          { dayOfWeek: 1, open: "09:30", close: "16:00" },
        ],
        holidays: ["2024-01-01", "2024-01-01"],
      },
      meta,
    );

    expect(issues.some((issue) => issue.code === "calendar.session_duplicate")).toBe(true);
    expect(issues.some((issue) => issue.code === "calendar.holiday_duplicate")).toBe(true);
  });

  it("requires a calendar when market-hours enforcement is enabled", () => {
    const scenario = clone(makeScenario());
    scenario.broker.marketHoursEnforced = true;
    scenario.marketCalendar = undefined;

    const result = validateScenarioPackage(scenario);
    expect(
      result.errors.some(
        (issue) => issue.code === "calendar.required_for_enforcement",
      ),
    ).toBe(true);
  });
});
