import { describe, expect, it } from "vitest";
import type { PracticeLedgerEntry } from "../history/practiceLedger";
import type { DrillAssessment } from "../../types";
import {
  buildEvidenceProfile,
  evidenceConfidenceFor,
  type ValidatedSourceScenario,
} from "./evidenceProfile";

function assessment(
  score: number | undefined,
  overrides: Partial<DrillAssessment> = {},
): DrillAssessment {
  const assessed = score !== undefined;
  return {
    drillId: "event-discipline-eurgbp-v1",
    competencyId: "event-discipline",
    definitionVersion: 1,
    rubricVersion: "event-process-v1",
    status: assessed ? "completed" : "incomplete",
    overallScore: score,
    methodology: "Process-only fixture rubric.",
    components: [
      "plan_coverage",
      "checkpoint_coverage",
      "event_linkage",
      "rule_adherence",
    ].map((id) => ({
      id: id as DrillAssessment["components"][number]["id"],
      label: id,
      weight: 0.25,
      status: assessed ? ("assessed" as const) : ("insufficient_evidence" as const),
      score,
      evidence: "Fixture evidence.",
    })),
    eligibleCheckpointCount: 5,
    answeredCheckpointCount: assessed ? 5 : 0,
    skippedCheckpointCount: 0,
    eligibleEventCount: 6,
    linkedEventCount: assessed ? 6 : 0,
    violationCount: 0,
    ...overrides,
  };
}

function ledgerEntry(
  id: string,
  completedAt: string,
  score: number | undefined,
  overrides: Partial<PracticeLedgerEntry> = {},
): PracticeLedgerEntry {
  return {
    id,
    runId: id,
    runInstanceId: id,
    completedAt,
    scenarioId: "scenario-a",
    scenarioTitle: "Scenario A",
    scenarioDataVersion: "data-v1",
    scenarioDataFidelity: "observed",
    sampleData: false,
    mode: "explorer",
    brokerMode: "scenario",
    facts: {
      executionCount: 1,
      closedTradeCount: 1,
      journalEntryCount: 1,
      executedDecisionCount: 1,
      linkedDecisionCount: 1,
      behavioralFlagCount: 0,
      forcedLiquidationCount: 0,
      journalCoverage: 1,
      reasonRate: 1,
      riskPlanRate: 1,
      structuredPlanRate: 1,
      eventLinkRate: 1,
    },
    assessment: assessment(score),
    ...overrides,
  };
}

function time(day: number): string {
  return new Date(Date.UTC(2026, 6, day, 10)).toISOString();
}

describe("evidence profile", () => {
  it("groups a competency across exact drill definitions but isolates rubric versions", () => {
    const entries = [
      ledgerEntry("run-a", time(1), 20),
      ledgerEntry("run-b", time(2), 40, {
        assessment: assessment(40, {
          drillId: "event-discipline-eurusd-v1",
        }),
      }),
      ledgerEntry("run-c", time(3), 60, {
        assessment: assessment(60, { definitionVersion: 2 }),
      }),
      ledgerEntry("run-d", time(4), 95, {
        assessment: assessment(95, { rubricVersion: "event-process-v2" }),
      }),
    ];

    const profile = buildEvidenceProfile(entries, []);

    expect(profile.claims).toHaveLength(2);
    expect(profile.claims[0]).toMatchObject({
      id: "event-discipline:event-process-v1",
      competencyId: "event-discipline",
      rubricVersion: "event-process-v1",
      attemptCount: 3,
      evidenceCount: 3,
      latestScore: 60,
      drillDefinitions: [
        { drillId: "event-discipline-eurgbp-v1", definitionVersion: 1 },
        { drillId: "event-discipline-eurgbp-v1", definitionVersion: 2 },
        { drillId: "event-discipline-eurusd-v1", definitionVersion: 1 },
      ],
      trend: {
        status: "insufficient_evidence",
        currentRunId: "run-c",
      },
    });
    expect(profile.claims[1]).toMatchObject({
      id: "event-discipline:event-process-v2",
      rubricVersion: "event-process-v2",
      evidenceCount: 1,
      latestScore: 95,
    });
    expect(JSON.stringify(profile)).not.toContain("overall report");
  });

  it("uses explicit evidence-breadth confidence thresholds", () => {
    expect(evidenceConfidenceFor(0, 0)).toBe("insufficient_evidence");
    expect(evidenceConfidenceFor(1, 0)).toBe("limited");
    expect(evidenceConfidenceFor(2, 2)).toBe("limited");
    expect(evidenceConfidenceFor(3, 0)).toBe("growing");
    expect(evidenceConfidenceFor(5, 1)).toBe("growing");
    expect(evidenceConfidenceFor(5, 2)).toBe("established");
  });

  it("counts exact validated scenario versions and is input-order deterministic", () => {
    const entries = [
      ledgerEntry("run-1", time(1), 60),
      ledgerEntry("run-2", time(2), 65),
      ledgerEntry("run-3", time(3), 70),
      ledgerEntry("run-4", time(4), 75, {
        scenarioId: "scenario-b",
        scenarioTitle: "Scenario B",
        scenarioDataVersion: "data-v2",
        scenarioDataFidelity: "synthetic",
        sampleData: true,
        assessment: assessment(75, {
          drillId: "event-discipline-eurusd-v1",
        }),
      }),
      ledgerEntry("run-5", time(5), 80, {
        scenarioId: "scenario-b",
        scenarioTitle: "Scenario B",
        scenarioDataVersion: "data-v2",
        scenarioDataFidelity: "synthetic",
        sampleData: true,
        assessment: assessment(80, {
          drillId: "event-discipline-eurusd-v1",
        }),
      }),
    ];
    const validated: ValidatedSourceScenario[] = [
      { scenarioId: "scenario-a", dataVersion: "data-v1" },
      { scenarioId: "scenario-b", dataVersion: "data-v2" },
    ];

    const ordered = buildEvidenceProfile(entries, validated);
    const shuffled = buildEvidenceProfile(
      [entries[3], entries[0], entries[4], entries[2], entries[1]],
      [...validated].reverse(),
    );

    expect(shuffled).toEqual(ordered);
    expect(ordered.claims[0]).toMatchObject({
      evidenceCount: 5,
      scenarioIds: ["scenario-a", "scenario-b"],
      scenarioCoverage: 2,
      validatedSourceScenarioIds: ["scenario-a", "scenario-b"],
      validatedSourceScenarioCoverage: 2,
      sampleEvidenceCount: 2,
      dataFidelities: ["observed", "synthetic"],
      confidence: "established",
      competencyId: "event-discipline",
      drillDefinitions: [
        { drillId: "event-discipline-eurgbp-v1", definitionVersion: 1 },
        { drillId: "event-discipline-eurusd-v1", definitionVersion: 1 },
      ],
    });

    const wrongVersion = buildEvidenceProfile(entries, [
      validated[0],
      { scenarioId: "scenario-b", dataVersion: "different-data" },
    ]);
    expect(wrongVersion.claims[0]).toMatchObject({
      validatedSourceScenarioCoverage: 1,
      confidence: "growing",
    });
  });

  it("classifies comparable score deltas at the documented ten-point boundary", () => {
    const improving = buildEvidenceProfile(
      [ledgerEntry("run-1", time(1), 40), ledgerEntry("run-2", time(2), 50)],
      [],
    ).claims[0].trend;
    expect(improving).toMatchObject({
      status: "improving",
      previousRunId: "run-1",
      currentRunId: "run-2",
      delta: 10,
    });

    const stable = buildEvidenceProfile(
      [
        ledgerEntry("run-1", time(1), 40),
        ledgerEntry("run-2", time(2), 49.9),
      ],
      [],
    ).claims[0].trend;
    expect(stable).toMatchObject({ status: "stable", delta: 9.9 });

    const declining = buildEvidenceProfile(
      [ledgerEntry("run-1", time(1), 50), ledgerEntry("run-2", time(2), 40)],
      [],
    ).claims[0].trend;
    expect(declining).toMatchObject({ status: "declining", delta: -10 });
  });

  it("requires the latest score to have a prior identical practice context", () => {
    const differentBroker = buildEvidenceProfile(
      [
        ledgerEntry("run-1", time(1), 40),
        ledgerEntry("run-2", time(2), 70, { brokerMode: "realistic" }),
      ],
      [],
    ).claims[0];
    expect(differentBroker.trend).toEqual({
      status: "insufficient_evidence",
      currentRunId: "run-2",
      currentScore: 70,
    });

    const differentDataVersion = buildEvidenceProfile(
      [
        ledgerEntry("run-1", time(1), 40),
        ledgerEntry("run-2", time(2), 70, {
          scenarioDataVersion: "data-v2",
        }),
      ],
      [],
    ).claims[0];
    expect(differentDataVersion.trend.status).toBe("insufficient_evidence");

    const differentMode = buildEvidenceProfile(
      [
        ledgerEntry("run-1", time(1), 40),
        ledgerEntry("run-2", time(2), 70, { mode: "professional" }),
      ],
      [],
    ).claims[0];
    expect(differentMode.trend.status).toBe("insufficient_evidence");

    const differentDrill = buildEvidenceProfile(
      [
        ledgerEntry("run-1", time(1), 40),
        ledgerEntry("run-2", time(2), 70, {
          assessment: assessment(70, {
            drillId: "event-discipline-eurusd-v1",
          }),
        }),
      ],
      [],
    ).claims[0];
    expect(differentDrill).toMatchObject({
      evidenceCount: 2,
      trend: { status: "insufficient_evidence", currentRunId: "run-2" },
    });

    const differentDefinitionVersion = buildEvidenceProfile(
      [
        ledgerEntry("run-1", time(1), 40),
        ledgerEntry("run-2", time(2), 70, {
          assessment: assessment(70, { definitionVersion: 2 }),
        }),
      ],
      [],
    ).claims[0];
    expect(differentDefinitionVersion.trend.status).toBe(
      "insufficient_evidence",
    );
  });

  it("falls back to the exact drill id for legacy assessments", () => {
    const profile = buildEvidenceProfile(
      [
        ledgerEntry("legacy-a-1", time(1), 50, {
          assessment: assessment(50, {
            competencyId: undefined,
            drillId: "legacy-drill-a",
          }),
        }),
        ledgerEntry("legacy-a-2", time(2), 60, {
          assessment: assessment(60, {
            competencyId: undefined,
            drillId: "legacy-drill-a",
            definitionVersion: 2,
          }),
        }),
        ledgerEntry("legacy-b", time(3), 70, {
          assessment: assessment(70, {
            competencyId: undefined,
            drillId: "legacy-drill-b",
          }),
        }),
      ],
      [],
    );

    expect(profile.claims.map((claim) => claim.competencyId)).toEqual([
      "legacy-drill-a",
      "legacy-drill-b",
    ]);
    expect(profile.claims[0]).toMatchObject({
      evidenceCount: 2,
      drillDefinitions: [
        { drillId: "legacy-drill-a", definitionVersion: 1 },
        { drillId: "legacy-drill-a", definitionVersion: 2 },
      ],
      trend: { status: "insufficient_evidence" },
    });
  });

  it("keeps missing assessment evidence unassessed instead of scoring zero", () => {
    const unassessed = ledgerEntry("run-1", time(1), undefined);
    const legacy = { ...ledgerEntry("legacy", time(2), undefined) };
    delete legacy.assessment;

    const profile = buildEvidenceProfile([legacy, unassessed], []);

    expect(profile).toMatchObject({
      ledgerEntryCount: 2,
      assessedEntryCount: 0,
    });
    expect(profile.claims).toHaveLength(1);
    expect(profile.claims[0]).toMatchObject({
      status: "unassessed",
      attemptCount: 1,
      evidenceCount: 0,
      latestScore: undefined,
      confidence: "insufficient_evidence",
      trend: { status: "insufficient_evidence" },
    });
  });

  it("does not promote a scored but incomplete drill into evidence", () => {
    const incomplete = ledgerEntry("incomplete", time(1), 88, {
      assessment: assessment(88, {
        status: "incomplete",
        answeredCheckpointCount: 4,
        linkedEventCount: 5,
      }),
    });

    const profile = buildEvidenceProfile([incomplete], []);

    expect(profile).toMatchObject({ assessedEntryCount: 0 });
    expect(profile.claims[0]).toMatchObject({
      status: "unassessed",
      attemptCount: 1,
      evidenceCount: 0,
      latestScore: undefined,
      confidence: "insufficient_evidence",
      trend: { status: "insufficient_evidence" },
    });
  });

  it("does not count a completed label without an executed decision", () => {
    const noDecision = ledgerEntry("no-decision", time(1), 100);
    noDecision.facts = { ...noDecision.facts, executionCount: 0 };

    const profile = buildEvidenceProfile([noDecision], []);

    expect(profile).toMatchObject({ assessedEntryCount: 0 });
    expect(profile.claims[0]).toMatchObject({
      status: "unassessed",
      attemptCount: 1,
      evidenceCount: 0,
    });
  });

  it("breaks timestamp ties by run id for stable latest evidence", () => {
    const sameTime = time(1);
    const profile = buildEvidenceProfile(
      [
        ledgerEntry("run-z", sameTime, 75),
        ledgerEntry("run-a", sameTime, 25),
      ],
      [],
    );

    expect(profile.claims[0]).toMatchObject({
      latestRunId: "run-z",
      latestScore: 75,
      trend: {
        previousRunId: "run-a",
        currentRunId: "run-z",
        status: "improving",
      },
    });
  });
});
