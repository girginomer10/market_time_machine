import { describe, expect, it } from "vitest";
import {
  eventDisciplineEurGbpV1,
  eventDisciplineEurUsdV1,
  listBuiltInDrills,
} from "../../data/practice/drills";
import { listScenarios } from "../../data/scenarios";
import type {
  DrillAssessment,
  DrillDefinition,
  ReportPayload,
  ScenarioPackage,
} from "../../types";
import type { CompletedRun } from "../history/runHistory";
import { derivePracticeLedgerEntry } from "../history/practiceLedger";
import {
  buildDrillCheckpointSchedule,
  drillCheckpointScheduleFingerprint,
  drillRubricFingerprint,
} from "../practice/drills";
import {
  brokerConfigFingerprint,
  getBrokerPreset,
} from "../broker/executionModels";
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
  const sourceScenario = listScenarios().find(
    (scenario) => scenario.meta.id === report.scenarioId,
  );
  if (!report.provenance && sourceScenario) {
    report.provenance = {
      license: sourceScenario.meta.license,
      dataSources: [...sourceScenario.meta.dataSources],
      dataVersion: sourceScenario.meta.dataVersion,
      isSampleData: sourceScenario.meta.isSampleData ?? true,
    };
  }
  const brokerMode = overrides.brokerMode ?? "scenario";
  const broker =
    brokerMode === "scenario"
      ? sourceScenario?.broker
      : sourceScenario
        ? {
            ...getBrokerPreset(brokerMode),
            baseCurrency: sourceScenario.meta.baseCurrency,
          }
        : getBrokerPreset(brokerMode);
  const hasBrokerFingerprintOverride = Object.prototype.hasOwnProperty.call(
    overrides,
    "brokerFingerprint",
  );
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
    brokerFingerprint: hasBrokerFingerprintOverride
      ? overrides.brokerFingerprint
      : broker
        ? brokerConfigFingerprint(broker)
        : undefined,
  };
}

function drillAssessment(
  overrides: Partial<DrillAssessment> = {},
  definition = eventDisciplineEurGbpV1,
): DrillAssessment {
  const scenario = listScenarios().find(
    (candidate) => candidate.meta.id === definition.scenarioId,
  );
  if (!scenario) throw new Error("Fixture drill scenario is unavailable.");
  const checkpointSchedule = buildDrillCheckpointSchedule(definition, scenario);
  const eligibleEventCount = new Set(
    checkpointSchedule.flatMap((checkpoint) => checkpoint.eventIds),
  ).size;
  const componentScores = {
    plan_coverage: 100,
    checkpoint_coverage: 100,
    event_linkage: 100,
    rule_adherence: 100,
  } as const;
  return {
    drillId: definition.id,
    competencyId: definition.competencyId,
    definitionVersion: definition.definitionVersion,
    rubricVersion: definition.rubricVersion,
    rubricFingerprint: drillRubricFingerprint(definition.rubric),
    checkpointScheduleFingerprint: drillCheckpointScheduleFingerprint(
      buildDrillCheckpointSchedule(definition, scenario),
    ),
    eventLinkageEvidenceVersion: 1,
    status: "completed",
    overallScore: 100,
    methodology: "Process-only fixture rubric.",
    components: Object.entries(componentScores).map(([id, score]) => ({
      id: id as DrillAssessment["components"][number]["id"],
      label: id,
      weight:
        definition.rubric.weights[
          id as DrillAssessment["components"][number]["id"]
        ],
      status: "assessed" as const,
      score,
      evidence: "Fixture evidence.",
    })),
    eligibleCheckpointCount: checkpointSchedule.length,
    answeredCheckpointCount: checkpointSchedule.length,
    skippedCheckpointCount: 0,
    eligibleEventCount,
    linkedEventCount: eligibleEventCount,
    violationCount: 0,
    ...overrides,
  };
}

function authoredDefinitionFrom(
  definition: DrillDefinition,
): DrillDefinition {
  return {
    ...definition,
    id: `authored-${definition.id}`,
    competencyId: "authored-release-discipline",
    rubricVersion: "authored-release-discipline-v1",
    title: `Authored ${definition.title}`,
    rubric: {
      weights: { ...definition.rubric.weights },
      violationPenalty: 15,
    },
  };
}

function withAuthoredDefinition(
  scenarios: ScenarioPackage[],
  definition: DrillDefinition,
): ScenarioPackage[] {
  return scenarios.map((scenario) =>
    scenario.meta.id === definition.scenarioId
      ? {
          ...scenario,
          drills: [...(scenario.drills ?? []), definition],
        }
      : scenario,
  );
}

describe("practice coach", () => {
  it("starts a fresh learner with an explicit EUR/GBP baseline", () => {
    const plan = buildPracticeCoachPlan([], listScenarios());
    const scenario = listScenarios().find(
      (candidate) => candidate.meta.id === "eurgbp-brexit-2016",
    );

    expect(plan).toMatchObject({
      kind: "first_run",
      scenarioId: "eurgbp-brexit-2016",
      mode: "explorer",
      completedMilestones: 0,
      evidenceRunCount: 0,
      rubricVersion: "practice-coach-v1",
      scenarioDataVersion: scenario?.meta.dataVersion,
      brokerMode: "scenario",
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

  it("does not count no-trade replays as cross-regime practice", () => {
    const noTrade = completedRun(
      { executionCount: 0 },
      {
        totalTrades: 0,
        journalQuality: {
          status: "insufficient_evidence",
          executedDecisionCount: 0,
          linkedEntryCount: 0,
          coverageRate: 0,
          reasonRate: 0,
          riskPlanRate: 0,
          structuredPlanRate: 0,
          eventLinkRate: 0,
          evidence: [],
        },
      },
    );
    const secondNoTrade = completedRun(
      {
        id: "no-trade-second-regime",
        scenarioId: "qqq-rate-hike-2022",
        scenarioTitle: "Nasdaq 2022 Rate Shock",
        executionCount: 0,
      },
      {
        scenarioId: "qqq-rate-hike-2022",
        scenarioTitle: "Nasdaq 2022 Rate Shock",
        totalTrades: 0,
        journalQuality: {
          status: "insufficient_evidence",
          executedDecisionCount: 0,
          linkedEntryCount: 0,
          coverageRate: 0,
          reasonRate: 0,
          riskPlanRate: 0,
          structuredPlanRate: 0,
          eventLinkRate: 0,
          evidence: [],
        },
      },
    );

    expect(
      foundationMilestones([noTrade, secondNoTrade]).find(
        (milestone) => milestone.id === "practice_two_scenarios",
      )?.complete,
    ).toBe(false);
    expect(
      foundationMilestones([], [
        derivePracticeLedgerEntry(noTrade),
        derivePracticeLedgerEntry(secondNoTrade),
      ]).find((milestone) => milestone.id === "practice_two_scenarios")
        ?.complete,
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

  it("repeats a legacy completed attempt without claiming automatic event links", () => {
    const run = completedRun({}, {
      practiceAssessment: drillAssessment({
        eventLinkageEvidenceVersion: undefined,
      }),
    });

    expect(buildPracticeCoachPlan([run], listScenarios())).toMatchObject({
      title: "Repeat with explicit event links",
      focusLabel: "Explicit event evidence",
      target: { current: "Legacy linkage unassessed" },
    });
  });

  it("assigns the weakest measured component in the same drill context", () => {
    const weakEventLinkage = drillAssessment({
      overallScore: 90,
      linkedEventCount: 3,
      components: drillAssessment().components.map((component) =>
        component.id === "event_linkage"
          ? { ...component, score: 50 }
          : component,
      ),
    });
    const run = completedRun({}, { practiceAssessment: weakEventLinkage });

    expect(buildPracticeCoachPlan([run], listScenarios())).toMatchObject({
      title: "Link each decision to visible evidence",
      scenarioId: eventDisciplineEurGbpV1.scenarioId,
      drillId: eventDisciplineEurGbpV1.id,
      focusLabel: "Visible-event linkage",
      target: { current: "50%", target: "At least 100%" },
      brokerMode: "scenario",
    });
  });

  it("transfers a clean completed drill to the next available regime", () => {
    const run = completedRun({ brokerMode: "ideal" }, {
      practiceAssessment: drillAssessment(),
    });

    expect(buildPracticeCoachPlan([run], listScenarios())).toMatchObject({
      title: "Transfer clean Event Discipline to a new regime",
      scenarioId: "eurusd-covid-liquidity-2020",
      focusLabel: "Cross-regime process transfer",
      brokerMode: "scenario",
    });
  });

  it("does not let an authored completion stand in for the built-in drill on the same regime", () => {
    const authoredEurUsd = authoredDefinitionFrom(eventDisciplineEurUsdV1);
    const scenarios = withAuthoredDefinition(
      listScenarios(),
      authoredEurUsd,
    );
    const eurUsdScenario = scenarios.find(
      (scenario) => scenario.meta.id === authoredEurUsd.scenarioId,
    )!;
    const authoredAttempt = completedRun(
      {
        id: "authored-eurusd-completion",
        completedAt: "2026-07-13T10:00:00.000Z",
        scenarioId: eurUsdScenario.meta.id,
        scenarioTitle: eurUsdScenario.meta.title,
      },
      {
        scenarioId: eurUsdScenario.meta.id,
        scenarioTitle: eurUsdScenario.meta.title,
        practiceAssessment: drillAssessment({}, authoredEurUsd),
      },
    );
    const latestBuiltIn = completedRun(
      {
        id: "latest-built-in-eurgbp",
        completedAt: "2026-07-14T10:00:00.000Z",
      },
      { practiceAssessment: drillAssessment() },
    );

    const plan = buildPracticeCoachPlan(
      [authoredAttempt, latestBuiltIn],
      scenarios,
    );

    expect(plan).toMatchObject({
      title: "Transfer clean Event Discipline to a new regime",
      scenarioId: eventDisciplineEurUsdV1.scenarioId,
      drillId: eventDisciplineEurUsdV1.id,
      brokerMode: "scenario",
      focusLabel: "Cross-regime process transfer",
    });
    expect(plan?.drillId).not.toBe(authoredEurUsd.id);
  });

  it("does not mark a transfer candidate complete under a different broker context", () => {
    const scenarios = listScenarios();
    const eurUsdScenario = scenarios.find(
      (scenario) => scenario.meta.id === eventDisciplineEurUsdV1.scenarioId,
    )!;
    const idealBrokerAttempt = completedRun(
      {
        id: "ideal-broker-eurusd-completion",
        completedAt: "2026-07-13T10:00:00.000Z",
        scenarioId: eurUsdScenario.meta.id,
        scenarioTitle: eurUsdScenario.meta.title,
        brokerMode: "ideal",
      },
      {
        scenarioId: eurUsdScenario.meta.id,
        scenarioTitle: eurUsdScenario.meta.title,
        practiceAssessment: drillAssessment({}, eventDisciplineEurUsdV1),
      },
    );
    const latestBuiltIn = completedRun(
      {
        id: "latest-scenario-broker-eurgbp",
        completedAt: "2026-07-14T10:00:00.000Z",
      },
      { practiceAssessment: drillAssessment() },
    );

    const plan = buildPracticeCoachPlan(
      [idealBrokerAttempt, latestBuiltIn],
      scenarios,
    );

    expect(plan).toMatchObject({
      title: "Transfer clean Event Discipline to a new regime",
      scenarioId: eventDisciplineEurUsdV1.scenarioId,
      drillId: eventDisciplineEurUsdV1.id,
      brokerMode: "scenario",
    });
  });

  it("repeats an exact authored context when no compatible transfer catalog exists", () => {
    const authoredEurGbp = authoredDefinitionFrom(eventDisciplineEurGbpV1);
    const scenarios = withAuthoredDefinition(
      listScenarios(),
      authoredEurGbp,
    );
    const run = completedRun(
      { brokerMode: "ideal" },
      { practiceAssessment: drillAssessment({}, authoredEurGbp) },
    );

    const plan = buildPracticeCoachPlan([run], scenarios);

    expect(plan).toMatchObject({
      title: "Repeat the same context for a comparable trend",
      scenarioId: authoredEurGbp.scenarioId,
      drillId: authoredEurGbp.id,
      drillTitle: authoredEurGbp.title,
      mode: authoredEurGbp.mode,
      brokerMode: "ideal",
      focusLabel: "Comparable process trend",
      target: { label: `${authoredEurGbp.title} process` },
    });
    expect(plan?.rationale).toMatch(/exact authored competency and rubric/i);
  });

  it("repeats the latest exact context after every current regime is complete", () => {
    const scenarios = listScenarios();
    const runs = listBuiltInDrills().map((definition, index) => {
      const scenario = scenarios.find(
        (candidate) => candidate.meta.id === definition.scenarioId,
      )!;
      return completedRun(
        {
          id: `complete-${index}`,
          completedAt: new Date(
            Date.UTC(2026, 6, 13 + index),
          ).toISOString(),
          scenarioId: scenario.meta.id,
          scenarioTitle: scenario.meta.title,
          brokerMode:
            index === listBuiltInDrills().length - 1 ? "ideal" : "scenario",
        },
        {
          scenarioId: scenario.meta.id,
          scenarioTitle: scenario.meta.title,
          practiceAssessment: drillAssessment({}, definition),
        },
      );
    });
    const latestDefinition = listBuiltInDrills().at(-1)!;
    const latestScenario = scenarios.find(
      (scenario) => scenario.meta.id === latestDefinition.scenarioId,
    )!;

    const plan = buildPracticeCoachPlan(runs, scenarios);

    expect(plan).toMatchObject({
      title: "Repeat the same context for a comparable trend",
      scenarioId: latestScenario.meta.id,
      scenarioDataVersion: latestScenario.meta.dataVersion,
      drillId: latestDefinition.id,
      mode: latestDefinition.mode,
      brokerMode: "ideal",
      focusLabel: "Comparable process trend",
      sourceRunId: `complete-${runs.length - 1}`,
    });
    expect(plan?.objective).toMatch(/exact scenario data, drill, mode, and broker/i);
  });

  it("creates a new baseline instead of claiming comparability after data drift", () => {
    const scenarios = listScenarios();
    const currentScenario = scenarios.find(
      (scenario) => scenario.meta.id === eventDisciplineEurGbpV1.scenarioId,
    )!;
    const run = completedRun(
      { brokerMode: "ideal" },
      {
        practiceAssessment: drillAssessment(),
        provenance: {
          license: currentScenario.meta.license,
          dataSources: [...currentScenario.meta.dataSources],
          dataVersion: "unreviewed-prior-data-version",
          isSampleData: currentScenario.meta.isSampleData ?? true,
        },
      },
    );

    const plan = buildPracticeCoachPlan([run], scenarios);

    expect(plan).toMatchObject({
      title: "Re-establish Event Discipline on current data",
      scenarioId: currentScenario.meta.id,
      scenarioDataVersion: currentScenario.meta.dataVersion,
      brokerMode: "scenario",
      focusLabel: "Current-data process baseline",
    });
    expect(plan?.rationale).toMatch(/fresh baseline/i);
    expect(plan?.title).not.toMatch(/comparable trend/i);
    expect(plan?.availabilityNote).toMatch(/new comparison baseline/i);
    expect(plan?.target?.current).toBe("No current comparable score");
    expect(plan?.evidence).toMatch(/not shown as a current measured score/i);
    expect(plan?.evidence).not.toMatch(/100%/);
  });

  it("does not present a self-consistent partial schedule as a measured coach score", () => {
    const scenarios = listScenarios();
    const scenario = scenarios.find(
      (candidate) => candidate.meta.id === eventDisciplineEurGbpV1.scenarioId,
    )!;
    const partialSchedule = buildDrillCheckpointSchedule(
      eventDisciplineEurGbpV1,
      scenario,
    ).slice(0, 1);
    const partialEventCount = new Set(
      partialSchedule.flatMap((checkpoint) => checkpoint.eventIds),
    ).size;
    const run = completedRun(
      { brokerMode: "ideal" },
      {
        practiceAssessment: drillAssessment({
          checkpointScheduleFingerprint:
            drillCheckpointScheduleFingerprint(partialSchedule),
          eligibleCheckpointCount: partialSchedule.length,
          answeredCheckpointCount: partialSchedule.length,
          eligibleEventCount: partialEventCount,
          linkedEventCount: partialEventCount,
        }),
      },
    );

    const plan = buildPracticeCoachPlan([run], scenarios);

    expect(plan).toMatchObject({
      title: "Re-establish Event Discipline on current data",
      focusLabel: "Current-data process baseline",
      target: { current: "No current comparable score" },
    });
    expect(plan?.evidence).toMatch(/not shown as a current measured score/i);
    expect(plan?.evidence).not.toMatch(/100%/);
  });

  it("does not treat a legacy weight-only rubric as an exact coach context", () => {
    const scenarios = listScenarios();
    const currentScenario = scenarios.find(
      (scenario) => scenario.meta.id === eventDisciplineEurGbpV1.scenarioId,
    )!;
    const run = completedRun(
      { brokerMode: "ideal" },
      {
        practiceAssessment: drillAssessment({
          rubricFingerprint: undefined,
          overallScore: 85,
          components: drillAssessment().components.map((component) =>
            component.id === "plan_coverage"
              ? { ...component, score: 50 }
              : component,
          ),
        }),
      },
    );

    const plan = buildPracticeCoachPlan([run], scenarios);

    expect(plan).toMatchObject({
      title: "Re-establish Event Discipline on current data",
      scenarioId: currentScenario.meta.id,
      scenarioDataVersion: currentScenario.meta.dataVersion,
      brokerMode: "scenario",
      focusLabel: "Current-data process baseline",
    });
    expect(plan?.availabilityNote).toMatch(/new comparison baseline/i);
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
