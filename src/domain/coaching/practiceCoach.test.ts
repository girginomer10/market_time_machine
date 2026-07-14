import { describe, expect, it } from "vitest";
import { eventDisciplineEurGbpV1 } from "../../data/practice/drills";
import { listScenarios } from "../../data/scenarios";
import type { DrillAssessment, ReportPayload } from "../../types";
import type { CompletedRun } from "../history/runHistory";
import { derivePracticeLedgerEntry } from "../history/practiceLedger";
import {
  buildPracticeCoachPlan,
  foundationMilestones,
} from "./practiceCoach";

function completedRun(
  overrides: Partial<CompletedRun> = {},
  reportOverrides: Partial<ReportPayload> = {},
): CompletedRun {
  const report: ReportPayload = {
    scenarioId: "eurgbp-brexit-2016",
    scenarioTitle: "Brexit Referendum: EUR/GBP 2016",
    metrics: {
      totalReturn: 0.02,
      benchmarkReturn: 0.01,
      excessReturn: 0.01,
      maxDrawdown: 0.08,
      volatility: 0.1,
      winRate: 0.5,
      exposureTime: 0.4,
      turnover: 1,
      feesPaid: 10,
      slippagePaid: 5,
      initialEquity: 10_000,
      finalEquity: 10_200,
      benchmarkInitial: 10_000,
      benchmarkFinal: 10_100,
    },
    equityCurve: [],
    totalTrades: 1,
    behavioralFlags: [],
    journalQuality: {
      status: "assessed",
      score: 80,
      executedDecisionCount: 1,
      linkedEntryCount: 1,
      coverageRate: 1,
      reasonRate: 1,
      riskPlanRate: 1,
      structuredPlanRate: 1,
      eventLinkRate: 1,
      evidence: [],
    },
    ...reportOverrides,
  };
  return {
    id: "run-a",
    completedAt: "2026-07-13T10:00:00.000Z",
    scenarioId: report.scenarioId,
    scenarioTitle: report.scenarioTitle,
    mode: "explorer",
    brokerMode: "scenario",
    sampleData: false,
    totalReturn: report.metrics.totalReturn,
    benchmarkReturn: report.metrics.benchmarkReturn,
    excessReturn: report.metrics.excessReturn,
    maxDrawdown: report.metrics.maxDrawdown,
    scoreStatus: "scored",
    score: 72,
    executionCount: 1,
    closedTradeCount: 1,
    journalEntryCount: 1,
    journalCoverage: 1,
    report,
    ...overrides,
  };
}

function drillAssessment(
  overrides: Partial<DrillAssessment> = {},
): DrillAssessment {
  const componentScores = {
    plan_coverage: 100,
    checkpoint_coverage: 100,
    event_linkage: 100,
    rule_adherence: 100,
  } as const;
  return {
    drillId: eventDisciplineEurGbpV1.id,
    competencyId: eventDisciplineEurGbpV1.competencyId,
    definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
    rubricVersion: eventDisciplineEurGbpV1.rubricVersion,
    status: "completed",
    overallScore: 100,
    methodology: "Process-only fixture rubric.",
    components: Object.entries(componentScores).map(([id, score]) => ({
      id: id as DrillAssessment["components"][number]["id"],
      label: id,
      weight:
        eventDisciplineEurGbpV1.rubric.weights[
          id as DrillAssessment["components"][number]["id"]
        ],
      status: "assessed" as const,
      score,
      evidence: "Fixture evidence.",
    })),
    eligibleCheckpointCount: 5,
    answeredCheckpointCount: 5,
    skippedCheckpointCount: 0,
    eligibleEventCount: 6,
    linkedEventCount: 6,
    violationCount: 0,
    ...overrides,
  };
}

describe("practice coach", () => {
  it("starts a fresh learner with an explicit EUR/GBP baseline", () => {
    const plan = buildPracticeCoachPlan([], listScenarios());

    expect(plan).toMatchObject({
      kind: "first_run",
      scenarioId: "eurgbp-brexit-2016",
      mode: "explorer",
      completedMilestones: 0,
      evidenceRunCount: 0,
      rubricVersion: "practice-coach-v1",
    });
    expect(plan?.milestones.every((milestone) => !milestone.complete)).toBe(true);
  });

  it("does not mislabel a generic report recommendation as measured drill evidence", () => {
    const run = completedRun({}, {
      journalQuality: {
        status: "assessed",
        score: 40,
        executedDecisionCount: 2,
        linkedEntryCount: 1,
        coverageRate: 0.5,
        reasonRate: 1,
        riskPlanRate: 0.5,
        structuredPlanRate: 0.5,
        eventLinkRate: 0,
        evidence: [],
      },
      recommendations: [
        {
          id: "journal-coverage",
          priority: 1,
          title: "Journal every executed decision",
          rationale: "Sparse notes hide the decision process.",
          evidence: "1 of 2 decisions had a linked entry.",
          suggestedPractice: "Write the plan before every order.",
        },
      ],
    });

    const plan = buildPracticeCoachPlan([run], listScenarios());

    expect(plan).toMatchObject({
      kind: "next_run",
      title: "Create the first comparable process record",
      scenarioId: "eurgbp-brexit-2016",
      sourceRunId: "run-a",
      sourceRunTitle: "Brexit Referendum: EUR/GBP 2016",
      evidenceRunCount: 1,
      target: {
        label: "Versioned drill status",
        current: "No completed assessment",
        target: "1 completed Event Discipline attempt",
      },
    });
    expect(plan?.objective).toMatch(/every Event Discipline checkpoint/i);
    expect(plan?.title).not.toMatch(/journal every/i);
  });

  it("ignores malformed legacy recommendations instead of crashing the library", () => {
    const run = completedRun();
    run.report.recommendations = { unexpected: true } as unknown as NonNullable<
      ReportPayload["recommendations"]
    >;

    expect(buildPracticeCoachPlan([run], listScenarios())).toMatchObject({
      kind: "next_run",
      title: "Create the first comparable process record",
    });

    run.report.recommendations = [
      null,
      {
        id: "practice-exits",
        priority: 1,
        title: "Practice a complete trade lifecycle",
        rationale: "No realized exit was available.",
        evidence: "0 closed trades.",
        suggestedPractice: "Close one position before the replay ends.",
      },
    ] as unknown as NonNullable<ReportPayload["recommendations"]>;

    expect(buildPracticeCoachPlan([run], listScenarios())).toMatchObject({
      title: "Create the first comparable process record",
      evidenceRunCount: 1,
    });
  });

  it("does not complete the documented-decision milestone from a partial plan", () => {
    const partial = completedRun({}, {
      journalQuality: {
        status: "assessed",
        score: 25,
        executedDecisionCount: 1,
        linkedEntryCount: 1,
        coverageRate: 1,
        reasonRate: 0,
        riskPlanRate: 0,
        structuredPlanRate: 1,
        eventLinkRate: 1,
        evidence: [],
      },
    });

    expect(
      foundationMilestones([partial]).find(
        (milestone) => milestone.id === "document_every_decision",
      )?.complete,
    ).toBe(false);
  });

  it("does not treat a finished no-trade replay as an observable baseline", () => {
    const noTrade = completedRun({ executionCount: 0 }, {
      totalTrades: 0,
      journalQuality: {
        status: "not_applicable",
        executedDecisionCount: 0,
        linkedEntryCount: 0,
        coverageRate: 0,
        reasonRate: 0,
        riskPlanRate: 0,
        structuredPlanRate: 0,
        eventLinkRate: 0,
        evidence: [],
      },
    });

    expect(
      foundationMilestones([noTrade]).find(
        (milestone) => milestone.id === "complete_replay",
      )?.complete,
    ).toBe(false);
  });

  it("derives foundation milestones only from observable run evidence", () => {
    const documented = completedRun();
    const second = completedRun({
      id: "run-b",
      scenarioId: "qqq-rate-hike-2022",
      scenarioTitle: "Nasdaq 2022 Rate Shock",
    });

    expect(foundationMilestones([documented, second])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "complete_replay", complete: true }),
        expect.objectContaining({
          id: "document_every_decision",
          complete: true,
        }),
        expect.objectContaining({
          id: "practice_two_scenarios",
          complete: true,
        }),
      ]),
    );
    expect(buildPracticeCoachPlan([documented, second], listScenarios())?.steps).toEqual([
      "Brief",
      "Plan",
      "Execute",
      "Review",
    ]);
  });

  it("keeps long-horizon milestones from the compact ledger after full reports expire", () => {
    const documented = completedRun();
    const second = completedRun({
      id: "run-b",
      scenarioId: "eurusd-covid-liquidity-2020",
      scenarioTitle: "EUR/USD COVID Liquidity",
    });
    const ledger = [
      derivePracticeLedgerEntry(documented),
      derivePracticeLedgerEntry(second),
    ];

    expect(foundationMilestones([], ledger)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "complete_replay", complete: true }),
        expect.objectContaining({
          id: "document_every_decision",
          complete: true,
        }),
        expect.objectContaining({
          id: "practice_two_scenarios",
          complete: true,
        }),
      ]),
    );

    expect(buildPracticeCoachPlan([], listScenarios(), ledger)).toMatchObject({
      kind: "next_run",
      title: "Create the first comparable process record",
      completedMilestones: 3,
      evidenceRunCount: 2,
    });
  });

  it("uses the ledger for evidence breadth without inventing recommendation-specific scoring", () => {
    const latest = completedRun({}, {
      recommendations: [
        {
          id: "journal-coverage",
          priority: 1,
          title: "Journal every executed decision",
          rationale: "Sparse notes hide the decision process.",
          evidence: "1 of 2 decisions had a linked entry.",
          suggestedPractice: "Write the plan before every order.",
        },
      ],
    });
    const retainedLedger = Array.from({ length: 20 }, (_, index) =>
      derivePracticeLedgerEntry(
        completedRun({
          id: `ledger-${index}`,
          completedAt: new Date(Date.UTC(2026, 5, index + 1)).toISOString(),
        }),
      ),
    );

    expect(
      buildPracticeCoachPlan([latest], listScenarios(), retainedLedger),
    ).toMatchObject({
      title: "Create the first comparable process record",
      sourceRunId: "run-a",
      evidenceRunCount: 20,
    });
  });

  it("repeats an incomplete drill against explicit completion evidence", () => {
    const run = completedRun({}, {
      practiceAssessment: drillAssessment({
        status: "incomplete",
        answeredCheckpointCount: 4,
        linkedEventCount: 5,
        overallScore: 90,
      }),
    });

    expect(buildPracticeCoachPlan([run], listScenarios())).toMatchObject({
      title: "Finish every drill requirement",
      scenarioId: eventDisciplineEurGbpV1.scenarioId,
      drillId: eventDisciplineEurGbpV1.id,
      target: { current: "Incomplete" },
    });
  });

  it("assigns the weakest measured component in the same drill context", () => {
    const weakPlan = drillAssessment({
      overallScore: 85,
      components: drillAssessment().components.map((component) =>
        component.id === "plan_coverage"
          ? { ...component, score: 50 }
          : component,
      ),
    });
    const run = completedRun({}, { practiceAssessment: weakPlan });

    expect(buildPracticeCoachPlan([run], listScenarios())).toMatchObject({
      title: "Complete the plan before taking risk",
      scenarioId: eventDisciplineEurGbpV1.scenarioId,
      drillId: eventDisciplineEurGbpV1.id,
      focusLabel: "Initial plan coverage",
      target: { current: "50%", target: "At least 80%" },
    });
  });

  it("transfers a clean completed drill to the next available regime", () => {
    const run = completedRun({}, {
      practiceAssessment: drillAssessment(),
    });

    expect(buildPracticeCoachPlan([run], listScenarios())).toMatchObject({
      title: "Transfer clean Event Discipline to a new regime",
      scenarioId: "eurusd-covid-liquidity-2020",
      focusLabel: "Cross-regime process transfer",
    });
  });

  it("falls back safely when the source scenario was removed", () => {
    const run = completedRun({
      scenarioId: "removed-local-lab",
      scenarioTitle: "Removed Local Lab",
    }, {
      scenarioId: "removed-local-lab",
      scenarioTitle: "Removed Local Lab",
      recommendations: [
        {
          id: "practice-exits",
          priority: 1,
          title: "Practice a complete trade lifecycle",
          rationale: "No realized exit was available.",
          evidence: "0 closed trades.",
          suggestedPractice: "Close one position before the replay ends.",
        },
      ],
    });

    const plan = buildPracticeCoachPlan([run], listScenarios());

    expect(plan?.scenarioId).toBe("eurgbp-brexit-2016");
    expect(plan?.availabilityNote).toMatch(/original lab is unavailable/i);
  });
});
