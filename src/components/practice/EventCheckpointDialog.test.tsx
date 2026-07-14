import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { eventDisciplineEurGbpV1 } from "../../data/practice/drills";
import type { DrillCheckpoint, DrillDefinition, MarketEvent } from "../../types";
import EventCheckpointDialog, {
  CHECKPOINT_REFLECTION_MAX_LENGTH,
} from "./EventCheckpointDialog";

const checkpoint: DrillCheckpoint = {
  id: "checkpoint-visible",
  drillId: eventDisciplineEurGbpV1.id,
  definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
  replayIndex: 12,
  replayTime: "2016-06-24T15:00:00.000Z",
  eventIds: ["visible-a", "visible-b"],
};

function marketEvent(id: string, title: string): MarketEvent {
  return {
    id,
    happenedAt: "2016-06-24T06:00:00.000Z",
    publishedAt: "2016-06-24T06:00:00.000Z",
    title,
    type: "news",
    summary: `${title} summary`,
    affectedSymbols: ["EURGBP"],
    importance: 5,
    source: "Official source",
    sourceUrl: `https://example.com/${id}`,
  };
}

describe("EventCheckpointDialog", () => {
  it("shows only events in the visible checkpoint and requires both responses", () => {
    const onSubmit = vi.fn();
    render(
      <EventCheckpointDialog
        definition={eventDisciplineEurGbpV1}
        checkpoint={checkpoint}
        visibleEvents={[
          marketEvent("visible-a", "Referendum result becomes visible"),
          marketEvent("future-event", "A future event must stay hidden"),
          marketEvent("visible-b", "Bank of England publishes a response"),
        ]}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Referendum result becomes visible")).toBeInTheDocument();
    expect(screen.getByText("Bank of England publishes a response")).toBeInTheDocument();
    expect(screen.queryByText("A future event must stay hidden")).not.toBeInTheDocument();
    expect(screen.getByText("2 events")).toBeInTheDocument();

    const submit = screen.getByRole("button", {
      name: "Record decision and continue",
    });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Reduce" }));
    expect(submit).toBeDisabled();

    const reflection = screen.getByRole("textbox", {
      name: "What changed in your plan or risk?",
    });
    expect(reflection).toBeRequired();
    expect(reflection).toHaveAttribute("aria-required", "true");
    expect(reflection).toHaveAttribute(
      "maxlength",
      String(CHECKPOINT_REFLECTION_MAX_LENGTH),
    );
    fireEvent.change(reflection, { target: { value: "   " } });
    expect(submit).toBeDisabled();

    fireEvent.change(reflection, {
      target: {
        value: "Dollar funding stress invalidates my original risk limit.  ",
      },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith(
      "reduce",
      "Dollar funding stress invalidates my original risk limit.",
    );
  });

  it("allows action-only submission when the drill makes reflection optional", () => {
    const onSubmit = vi.fn();
    const optionalDefinition: DrillDefinition = {
      ...eventDisciplineEurGbpV1,
      checkpointRule: {
        ...eventDisciplineEurGbpV1.checkpointRule,
        requireReflection: false,
      },
    };
    render(
      <EventCheckpointDialog
        definition={optionalDefinition}
        checkpoint={checkpoint}
        visibleEvents={[marketEvent("visible-a", "Visible event")]}
        onSubmit={onSubmit}
      />,
    );

    const reflection = screen.getByRole("textbox", {
      name: "What changed in your plan or risk?",
    });
    expect(reflection).not.toBeRequired();
    expect(reflection).toHaveAttribute("aria-required", "false");
    expect(screen.getByText("Optional · 0/2000 characters")).toBeInTheDocument();
    expect(
      screen.getByText(/reflection is optional for this drill/),
    ).toBeInTheDocument();

    const submit = screen.getByRole("button", {
      name: "Record decision and continue",
    });
    fireEvent.click(screen.getByRole("radio", { name: "Hold" }));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith("hold", "");
  });

  it("caps reflection authoring at the UI-safe limit before submission", () => {
    const onSubmit = vi.fn();
    render(
      <EventCheckpointDialog
        definition={eventDisciplineEurGbpV1}
        checkpoint={checkpoint}
        visibleEvents={[marketEvent("visible-a", "Visible event")]}
        onSubmit={onSubmit}
      />,
    );

    const reflection = screen.getByRole("textbox", {
      name: "What changed in your plan or risk?",
    }) as HTMLTextAreaElement;
    fireEvent.change(reflection, {
      target: { value: "x".repeat(CHECKPOINT_REFLECTION_MAX_LENGTH + 25) },
    });
    expect(reflection.value).toHaveLength(CHECKPOINT_REFLECTION_MAX_LENGTH);
    expect(
      screen.getByText(
        `Required · ${CHECKPOINT_REFLECTION_MAX_LENGTH}/${CHECKPOINT_REFLECTION_MAX_LENGTH} characters`,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Wait" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Record decision and continue" }),
    );
    expect(onSubmit).toHaveBeenCalledWith(
      "wait",
      "x".repeat(CHECKPOINT_REFLECTION_MAX_LENGTH),
    );
  });

  it("traps focus, blocks Escape bypass, and restores focus after completion", () => {
    const onSubmit = vi.fn();
    const launch = document.createElement("button");
    launch.textContent = "Launch checkpoint";
    document.body.append(launch);
    launch.focus();

    const { unmount } = render(
      <EventCheckpointDialog
        definition={eventDisciplineEurGbpV1}
        checkpoint={checkpoint}
        visibleEvents={[marketEvent("visible-a", "Visible event")]}
        onSubmit={onSubmit}
      />,
    );

    const hold = screen.getByRole("radio", { name: "Hold" });
    expect(hold).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    const sourceLink = screen.getByRole("link", { name: "Source: Official source" });
    const reflection = screen.getByRole("textbox", {
      name: "What changed in your plan or risk?",
    });
    sourceLink.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(reflection).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(sourceLink).toHaveFocus();

    unmount();
    expect(launch).toHaveFocus();
    launch.remove();
  });
});
