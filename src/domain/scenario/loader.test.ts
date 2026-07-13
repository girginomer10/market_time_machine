import { describe, expect, it } from "vitest";

import { makeScenario } from "../../test/fixtures";
import { assembleScenario } from "./loader";

describe("assembleScenario", () => {
  it("sorts timestamped data by instant across ISO timezone encodings", () => {
    const base = makeScenario();
    const earlierCandle = {
      ...base.candles[0],
      openTime: "2023-12-31T23:00:00-04:00",
      closeTime: "2024-01-01T00:00:00-04:00",
    };
    const laterCandle = {
      ...base.candles[1],
      openTime: "2024-01-01T04:00:00Z",
      closeTime: "2024-01-01T05:00:00Z",
    };
    const earlierEvent = {
      ...base.events[0],
      id: "earlier",
      happenedAt: "2024-01-01T00:00:00-04:00",
      publishedAt: "2024-01-01T00:00:00-04:00",
    };
    const laterEvent = {
      ...base.events[0],
      id: "later",
      happenedAt: "2024-01-01T04:30:00Z",
      publishedAt: "2024-01-01T04:30:00Z",
    };
    const earlierAction = {
      symbol: base.meta.symbols[0],
      type: "dividend" as const,
      effectiveAt: "2024-01-01T00:00:00-04:00",
      amount: 1,
    };
    const laterAction = {
      ...earlierAction,
      effectiveAt: "2024-01-01T04:30:00Z",
    };

    const assembled = assembleScenario({
      scenario: base.meta,
      instruments: base.instruments,
      candles: [laterCandle, earlierCandle],
      events: [laterEvent, earlierEvent],
      indicators: base.indicators,
      benchmarks: base.benchmarks,
      broker: base.broker,
      marketCalendar: base.marketCalendar,
      corporateActions: [laterAction, earlierAction],
    });

    expect(assembled.candles.map((c) => c.closeTime)).toEqual([
      earlierCandle.closeTime,
      laterCandle.closeTime,
    ]);
    expect(assembled.events.map((event) => event.id)).toEqual([
      "earlier",
      "later",
    ]);
    expect(assembled.corporateActions?.map((action) => action.effectiveAt)).toEqual(
      [earlierAction.effectiveAt, laterAction.effectiveAt],
    );
  });
});
