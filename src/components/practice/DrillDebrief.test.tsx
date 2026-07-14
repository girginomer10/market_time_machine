import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { eventDisciplineEurGbpV1 } from "../../data/practice/drills";
import { PRACTICE_DRILL_REFLECTION_MAX_LENGTH } from "../../types";
import type {
  DrillAssessment,
  PracticeDrillReportSnapshot,
} from "../../types";
import DrillDebrief from "./DrillDebrief";

function assessment(
  overrides: Partial<DrillAssessment> = {},
): DrillAssessment {
  return {
    drillId: eventDisciplineEurGbpV1.id,
    definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
    rubricVersion: eventDisciplineEurGbpV1.rubricVersion,
    status: "completed",
    overallScore: 84,
    methodology:
      "Process-only score. Missing evidence is omitted rather than scored as zero.",
    components: [
      {
        id: "plan_coverage",
        label: "Initial plan coverage",
        weight: 0.3,
        status: "assessed",
        score: 100,
        evidence: "All four required plan fields were recorded.",
      },
      {
        id: "checkpoint_coverage",
        label: "Checkpoint coverage",
        weight: 0.3,
        status: "assessed",
        score: 80,
        evidence: "Four checkpoint groups were answered.",
      },
      {
        id: "event_linkage",
        label: "Event linkage",
        weight: 0.2,
        status: "insufficient_evidence",
        evidence: "No answered checkpoint linked visible events.",
      },
      {
        id: "rule_adherence",
        label: "Rule adherence",
        weight: 0.2,
        status: "not_applicable",
        evidence: "No applicable rule evidence was recorded.",
      },
    ],
    eligibleCheckpointCount: 5,
    answeredCheckpointCount: 4,
    skippedCheckpointCount: 1,
    eligibleEventCount: 6,
    linkedEventCount: 4,
    violationCount: 1,
    ...overrides,
  };
}

function drillSnapshot(
  firstReflection = "The new evidence weakens the timing case, so I reduced risk.",
): PracticeDrillReportSnapshot {
  return {
    definition: eventDisciplineEurGbpV1,
    initialPlan: {
      thesis: "Policy divergence should keep the cross supported.",
      invalidation: "Official guidance reverses the expected divergence.",
      exitPlan: "Reduce first, then exit if the invalidation is confirmed.",
      acceptedRisk: "One percent of account equity.",
    },
    checkpoints: [
      {
        checkpoint: {
          id: "checkpoint-later",
          drillId: eventDisciplineEurGbpV1.id,
          definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
          replayIndex: 12,
          replayTime: "2016-06-24T16:00:00.000Z",
          eventIds: ["event-later"],
        },
        response: {
          id: "response-later",
          drillId: eventDisciplineEurGbpV1.id,
          definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
          checkpointId: "checkpoint-later",
          replayTime: "2016-06-24T16:00:00.000Z",
          eventIds: ["event-later"],
          status: "answered",
          action: "hold",
          reflection: "The plan still holds under the newly visible evidence.",
        },
        events: [
          {
            id: "event-later",
            publishedAt: "2016-06-24T15:45:00.000Z",
            title: "Bank guidance clarifies the policy response",
            type: "central_bank",
            importance: 4,
            source: "Official release",
          },
        ],
      },
      {
        checkpoint: {
          id: "checkpoint-first",
          drillId: eventDisciplineEurGbpV1.id,
          definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
          replayIndex: 8,
          replayTime: "2016-06-24T15:00:00.000Z",
          eventIds: ["event-first", "event-second"],
        },
        response: {
          id: "response-first",
          drillId: eventDisciplineEurGbpV1.id,
          definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
          checkpointId: "checkpoint-first",
          replayTime: "2016-06-24T15:00:00.000Z",
          eventIds: ["event-first", "event-second"],
          status: "answered",
          action: "reduce",
          reflection: firstReflection,
          positionQuantity: 0.5,
        },
        events: [
          {
            id: "event-second",
            publishedAt: "2016-06-24T14:55:00.000Z",
            title: "Second official event",
            type: "macro",
            importance: 4,
          },
          {
            id: "event-first",
            publishedAt: "2016-06-24T14:50:00.000Z",
            title: "First official event",
            type: "macro",
            importance: 5,
          },
        ],
      },
    ],
    violations: [
      {
        id: "violation-later",
        drillId: eventDisciplineEurGbpV1.id,
        definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
        code: "checkpoint_skipped",
        replayTime: "2016-06-24T16:30:00.000Z",
        checkpointId: "checkpoint-later",
        evidence: "The checkpoint was left unanswered before completion.",
      },
      {
        id: "violation-first",
        drillId: eventDisciplineEurGbpV1.id,
        definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
        code: "order_before_plan",
        replayTime: "2016-06-24T14:00:00.000Z",
        evidence: "An order was attempted before all required plan fields existed.",
      },
    ],
  };
}

describe("DrillDebrief", () => {
  it("reports process evidence, rubric, and a comparable score delta", () => {
    render(
      <DrillDebrief
        definition={eventDisciplineEurGbpV1}
        assessment={assessment()}
        previousComparableProcessScore={76}
      />,
    );

    expect(screen.getByText(eventDisciplineEurGbpV1.title)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Completed");
    expect(screen.getByText("84/100")).toBeInTheDocument();
    expect(screen.getByText("Previous comparable drill: 76/100")).toBeInTheDocument();
    expect(screen.getByText("+8 points")).toBeInTheDocument();

    const counts = screen.getByText("Answered checkpoints").closest("dl");
    expect(counts).not.toBeNull();
    expect(within(counts!).getByText("4/5")).toBeInTheDocument();
    expect(within(counts!).getByText("4/6")).toBeInTheDocument();
    expect(within(counts!).getAllByText("1")).toHaveLength(2);

    const planComponent = screen.getByText("Initial plan coverage").closest("li");
    expect(planComponent).not.toBeNull();
    expect(within(planComponent!).getByText("Weight 30%")).toBeInTheDocument();
    expect(within(planComponent!).getByText("100/100")).toBeInTheDocument();
    expect(screen.getByText("Not assessed")).toBeInTheDocument();
    expect(screen.getByText("Not applicable")).toBeInTheDocument();
    expect(screen.getByText(eventDisciplineEurGbpV1.rubricVersion)).toBeInTheDocument();
    expect(screen.getByText(/Process-only score/)).toBeInTheDocument();
    expect(screen.queryByText(/P\/L|profit|loss/i)).not.toBeInTheDocument();
  });

  it("does not invent an overall or comparison score without evidence", () => {
    render(
      <DrillDebrief
        definition={eventDisciplineEurGbpV1}
        assessment={assessment({
          status: "incomplete",
          overallScore: undefined,
          components: assessment().components.map((component) => ({
            ...component,
            status: "insufficient_evidence" as const,
            score: undefined,
          })),
        })}
        previousComparableProcessScore={76}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Incomplete");
    expect(screen.getAllByText("Not assessed")).toHaveLength(5);
    expect(screen.queryByText(/Previous comparable drill/)).not.toBeInTheDocument();
  });

  it("shows the captured plan, chronological checkpoint decisions, safe event titles, and violations", () => {
    const { container } = render(
      <DrillDebrief
        definition={eventDisciplineEurGbpV1}
        assessment={assessment()}
        practiceDrill={drillSnapshot()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Initial plan" })).toBeInTheDocument();
    expect(
      screen.getByText("Policy divergence should keep the cross supported."),
    ).toBeInTheDocument();
    expect(screen.getByText("One percent of account equity.")).toBeInTheDocument();

    const checkpointSection = screen
      .getByRole("heading", { name: "Checkpoint decision record" })
      .closest("section");
    expect(checkpointSection).not.toBeNull();
    const records = checkpointSection!.querySelectorAll(".drill-checkpoint-record");
    expect(records).toHaveLength(2);
    expect(records[0]).toHaveTextContent("2016-06-24 15:00Z");
    expect(records[0]).toHaveTextContent("Reduce");
    expect(records[0]).toHaveTextContent(
      "The new evidence weakens the timing case, so I reduced risk.",
    );
    expect(records[1]).toHaveTextContent("2016-06-24 16:00Z");
    expect(records[1]).toHaveTextContent("Hold");

    const firstEvent = within(records[0] as HTMLElement).getByText(
      "First official event",
    );
    const secondEvent = within(records[0] as HTMLElement).getByText(
      "Second official event",
    );
    expect(
      firstEvent.compareDocumentPosition(secondEvent) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const violationSection = screen
      .getByRole("heading", { name: "Rule evidence" })
      .closest("section");
    expect(violationSection).not.toBeNull();
    const violations = violationSection!.querySelectorAll(".drill-violation-list > li");
    expect(violations).toHaveLength(2);
    expect(violations[0]).toHaveTextContent("Order placed before the plan");
    expect(violations[1]).toHaveTextContent("Checkpoint skipped");
    expect(screen.queryByText(/P\/L|profit|loss/i)).not.toBeInTheDocument();
    expect(container.querySelector(".drill-legacy-evidence")).toBeNull();
  });

  it("bounds raw reflection text when rendering imported full-report evidence", () => {
    const overlongReflection = "x".repeat(
      PRACTICE_DRILL_REFLECTION_MAX_LENGTH + 25,
    );
    const { container } = render(
      <DrillDebrief
        definition={eventDisciplineEurGbpV1}
        assessment={assessment()}
        practiceDrill={drillSnapshot(overlongReflection)}
      />,
    );

    expect(container.querySelector("blockquote")?.textContent).toHaveLength(
      PRACTICE_DRILL_REFLECTION_MAX_LENGTH,
    );
  });
});
