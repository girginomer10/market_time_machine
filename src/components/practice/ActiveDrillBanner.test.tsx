import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { eventDisciplineEurGbpV1 } from "../../data/practice/drills";
import ActiveDrillBanner from "./ActiveDrillBanner";

describe("ActiveDrillBanner", () => {
  it("shows the drill, ordered stage, complete plan, and answered count only", () => {
    render(
      <ActiveDrillBanner
        definition={eventDisciplineEurGbpV1}
        stage="execute"
        answeredCheckpointCount={2}
        initialPlan={{
          thesis: "Sterling uncertainty remains elevated.",
          invalidation: "Policy support reverses the risk signal.",
          exitPlan: "Reduce at the next visible checkpoint.",
          acceptedRisk: "One percent of account equity.",
        }}
      />,
    );

    expect(screen.getByText(eventDisciplineEurGbpV1.title)).toBeInTheDocument();
    const stages = screen.getByRole("list", { name: "Drill stage" });
    expect(within(stages).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("Brief"),
      expect.stringContaining("Plan"),
      expect.stringContaining("Execute"),
      expect.stringContaining("Review"),
    ]);
    expect(within(stages).getByText("Execute").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );

    expect(screen.getByText("Complete")).toBeInTheDocument();
    const checkpointLabel = screen.getByText("Checkpoint decisions recorded");
    const checkpointStatus = checkpointLabel.closest("div");
    expect(checkpointStatus).not.toBeNull();
    expect(within(checkpointStatus!).getByText("2")).toBeInTheDocument();
    expect(checkpointStatus).not.toHaveTextContent(/2\s*(?:\/|of)\s*\d/i);
  });

  it("distinguishes a partial initial plan from one not started", () => {
    const { rerender } = render(
      <ActiveDrillBanner
        definition={eventDisciplineEurGbpV1}
        stage="plan"
        answeredCheckpointCount={0}
        initialPlan={{ thesis: "A partial thesis." }}
      />,
    );

    expect(screen.getByText("In progress")).toBeInTheDocument();

    rerender(
      <ActiveDrillBanner
        definition={eventDisciplineEurGbpV1}
        stage="brief"
        answeredCheckpointCount={0}
      />,
    );
    expect(screen.getByText("Not started")).toBeInTheDocument();
  });
});
