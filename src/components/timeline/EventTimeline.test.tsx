import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EventTimeline from "./EventTimeline";
import type { MarketEvent } from "../../types";

const visibleEvent: MarketEvent = {
  id: "visible",
  happenedAt: "2020-03-12T12:00:00.000Z",
  publishedAt: "2020-03-12T13:00:00.000Z",
  title: "Visible shock headline",
  type: "macro",
  summary: "This event is already inside the information firewall.",
  affectedSymbols: ["BTCUSD"],
  importance: 5,
  sentiment: "negative",
};

const futureEvent: MarketEvent = {
  ...visibleEvent,
  id: "future",
  title: "Future headline",
  summary: "This event should not be passed into the timeline yet.",
};

describe("EventTimeline", () => {
  it("renders only the visible events it receives", () => {
    render(
      <EventTimeline
        events={[visibleEvent]}
        eventNumbers={new Map([["visible", 1]])}
        onHoverEvent={vi.fn()}
      />,
    );

    expect(screen.getByText("Visible shock headline")).toBeInTheDocument();
    expect(screen.queryByText(futureEvent.title)).not.toBeInTheDocument();
  });
});
