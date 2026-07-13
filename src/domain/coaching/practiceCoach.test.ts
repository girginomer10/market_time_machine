import { describe, expect, it } from "vitest";
import { listScenarios } from "../../data/scenarios";
import type { ReportPayload } from "../../types";
import type { CompletedRun } from "../history/runHistory";
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

  it("turns the latest report recommendation into an evidence-backed next plan", () => {
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
      title: "Journal every executed decision",
      scenarioId: "eurgbp-brexit-2016",
      sourceRunId: "run-a",
      sourceRunTitle: "Brexit Referendum: EUR/GBP 2016",
      evidenceRunCount: 1,
      target: {
        label: "Decision-note coverage",
        current: "50%",
        target: "At least 80%",
      },
    });
  });

  it("ignores malformed legacy recommendations instead of crashing the library", () => {
    const run = completedRun();
    run.report.recommendations = { unexpected: true } as unknown as NonNullable<
      ReportPayload["recommendations"]
    >;

    expect(buildPracticeCoachPlan([run], listScenarios())).toMatchObject({
      kind: "next_run",
      title: "Broaden your regime practice",
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
      title: "Practice a complete trade lifecycle",
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
