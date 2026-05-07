import { describe, expect, it } from "vitest";
import type { MarketEvent } from "../../types";
import { eventCoverageSummary } from "./eventCoverage";

function event(overrides: Partial<MarketEvent> = {}): MarketEvent {
  return {
    id: "evt-1",
    happenedAt: "2021-01-01T00:00:00.000Z",
    publishedAt: "2021-01-01T00:00:00.000Z",
    title: "Event",
    type: "news",
    summary: "Scenario event.",
    affectedSymbols: ["BTCUSD"],
    importance: 3,
    source: "Official release",
    sourceUrl: "https://example.com/source",
    ...overrides,
  };
}

describe("eventCoverageSummary", () => {
  it("marks a fully sourced event set", () => {
    const summary = eventCoverageSummary([event(), event({ id: "evt-2" })]);

    expect(summary.total).toBe(2);
    expect(summary.withSource).toBe(2);
    expect(summary.withSourceUrl).toBe(2);
    expect(summary.fullySourced).toBe(true);
    expect(summary.label).toBe("2/2 sourced");
  });

  it("tracks source and URL gaps separately", () => {
    const summary = eventCoverageSummary([
      event({ id: "has-both" }),
      event({ id: "missing-source", source: "" }),
      event({ id: "missing-url", sourceUrl: undefined }),
    ]);

    expect(summary.withSource).toBe(2);
    expect(summary.withSourceUrl).toBe(2);
    expect(summary.fullySourced).toBe(false);
    expect(summary.missingSourceIds).toEqual(["missing-source"]);
    expect(summary.missingSourceUrlIds).toEqual(["missing-url"]);
  });

  it("treats an empty event set as complete", () => {
    const summary = eventCoverageSummary([]);

    expect(summary.sourceUrlCoveragePct).toBe(100);
    expect(summary.fullySourced).toBe(true);
    expect(summary.label).toBe("0/0 sourced");
  });
});
