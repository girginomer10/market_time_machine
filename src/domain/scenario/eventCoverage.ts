import type { MarketEvent } from "../../types";

export type EventCoverageSummary = {
  total: number;
  withSource: number;
  withSourceUrl: number;
  fullySourcedCount: number;
  missingSourceIds: string[];
  missingSourceUrlIds: string[];
  sourceUrlCoveragePct: number;
  fullySourced: boolean;
  label: string;
};

function hasText(value?: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function eventCoverageSummary(
  events: MarketEvent[],
): EventCoverageSummary {
  const missingSourceIds: string[] = [];
  const missingSourceUrlIds: string[] = [];
  let withSource = 0;
  let withSourceUrl = 0;
  let fullySourcedCount = 0;

  for (const event of events) {
    const sourcePresent = hasText(event.source);
    const sourceUrlPresent = hasText(event.sourceUrl);
    if (sourcePresent) {
      withSource += 1;
    } else {
      missingSourceIds.push(event.id);
    }

    if (sourceUrlPresent) {
      withSourceUrl += 1;
    } else {
      missingSourceUrlIds.push(event.id);
    }
    if (sourcePresent && sourceUrlPresent) fullySourcedCount += 1;
  }

  const sourceUrlCoveragePct =
    events.length > 0 ? (withSourceUrl / events.length) * 100 : 100;
  const fullySourced =
    missingSourceIds.length === 0 && missingSourceUrlIds.length === 0;

  return {
    total: events.length,
    withSource,
    withSourceUrl,
    fullySourcedCount,
    missingSourceIds,
    missingSourceUrlIds,
    sourceUrlCoveragePct,
    fullySourced,
    label: `${fullySourcedCount}/${events.length} sourced`,
  };
}
