import type { MarketEvent } from "../../types";

export type EventCoverageSummary = {
  total: number;
  withSource: number;
  withSourceUrl: number;
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

  for (const event of events) {
    if (hasText(event.source)) {
      withSource += 1;
    } else {
      missingSourceIds.push(event.id);
    }

    if (hasText(event.sourceUrl)) {
      withSourceUrl += 1;
    } else {
      missingSourceUrlIds.push(event.id);
    }
  }

  const sourceUrlCoveragePct =
    events.length > 0 ? (withSourceUrl / events.length) * 100 : 100;
  const fullySourced =
    missingSourceIds.length === 0 && missingSourceUrlIds.length === 0;

  return {
    total: events.length,
    withSource,
    withSourceUrl,
    missingSourceIds,
    missingSourceUrlIds,
    sourceUrlCoveragePct,
    fullySourced,
    label: `${withSourceUrl}/${events.length} sourced`,
  };
}
