import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getScenario } from "../../data/scenarios";
import { brokerConfigFingerprint } from "../../domain/broker/executionModels";
import type { PracticeCoachPlan } from "../../domain/coaching/practiceCoach";
import PracticeCoach from "./PracticeCoach";

const FOUNDATION_BROKER_FINGERPRINT = brokerConfigFingerprint(
  getScenario("eurgbp-brexit-2016")!.broker,
);

function plan(overrides: Partial<PracticeCoachPlan> = {}): PracticeCoachPlan {
  return {
    kind: "first_run",
    rubricVersion: "practice-coach-v1",
    trackId: "orientation",
    trackTitle: "Practice orientation",
    completedMilestones: 0,
    totalMilestones: 3,
    title: "Make one complete, documented decision",
    objective: "Complete one replay and review the evidence.",
    rationale: "A baseline is required before a focused recommendation.",
    scenarioId: "eurgbp-brexit-2016",
    scenarioTitle: "Brexit Referendum: EUR/GBP 2016",
    drillId: "event-discipline-eurgbp-v1",
    drillTitle: "EUR/GBP Brexit — Event Discipline",
    mode: "explorer",
    scenarioDataVersion: null,
    brokerMode: "scenario",
    brokerFingerprint: FOUNDATION_BROKER_FINGERPRINT,
    focusLabel: "Structured decision baseline",
    steps: ["Brief", "Plan", "Execute", "Review"],
    milestones: [
      {
        id: "complete_replay",
        title: "Complete one replay",
        description: "Finish a lab.",
        complete: false,
      },
      {
        id: "document_every_decision",
        title: "Document every executed decision",
        description: "Link every decision.",
        complete: false,
      },
      {
        id: "practice_two_scenarios",
        title: "Practice across two regimes",
        description: "Finish two scenarios.",
        complete: false,
      },
    ],
    evidenceRunCount: 0,
    ctaLabel: "Review first practice",
    ...overrides,
  };
}

describe("PracticeCoach", () => {
  it("shows a first practice and prepares its briefing", () => {
    const onPrepare = vi.fn();
    render(<PracticeCoach plan={plan()} onPrepare={onPrepare} />);

    expect(screen.getByText("Personal Decision Gym v2")).toBeInTheDocument();
    expect(screen.getByText("Today’s practice")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", {
        name: "Practice orientation progress",
      }),
    ).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getAllByText("Pending")).toHaveLength(3);
    expect(screen.getByText("Evidence sample: 0 runs")).toBeInTheDocument();
    expect(screen.getByText("Rubric: practice-coach-v1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review first practice" }));
    expect(onPrepare).toHaveBeenCalledWith("eurgbp-brexit-2016", "explorer");
  });

  it("shows report evidence, a target, and the source-report action", () => {
    const onViewSource = vi.fn();
    render(
      <PracticeCoach
        plan={plan({
          kind: "next_run",
          title: "Journal every executed decision",
          evidence: "1 of 2 decisions had a linked entry.",
          completedMilestones: 1,
          sourceRunId: "run-a",
          sourceRunTitle: "Brexit Referendum: EUR/GBP 2016",
          evidenceRunCount: 1,
          target: {
            label: "Decision-note coverage",
            current: "50%",
            target: "At least 80%",
          },
          ctaLabel: "Review focused replay",
        })}
        onPrepare={vi.fn()}
        onViewSource={onViewSource}
      />,
    );

    expect(screen.getByText("Next practice")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 decisions had a linked entry.")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("At least 80%")).toBeInTheDocument();
    expect(
      screen.getByText("Source run: Brexit Referendum: EUR/GBP 2016"),
    ).toBeInTheDocument();
    expect(screen.getByText("Evidence sample: 1 run")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View source report" }));
    expect(onViewSource).toHaveBeenCalledWith("run-a");
  });
});
