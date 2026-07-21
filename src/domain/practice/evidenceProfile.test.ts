import { describe, expect, it } from "vitest";
import type { PracticeLedgerEntry } from "../history/practiceLedger";
import type { DrillAssessment, ReportPayload } from "../../types";
import {
  buildEvidenceProfile,
  evidenceConfidenceFor,
  practiceEvidenceScore,
  previousComparablePracticeScore,
  type ValidatedSourceScenario,
} from "./evidenceProfile";
import {
  drillCheckpointScheduleFingerprint,
  drillRubricFingerprint,
} from "./drills";
import {
  EURGBP_BREXIT_2016_DATA_VERSION,
  LEGACY_EURGBP_BREXIT_2016_DATA_VERSION,
} from "../../data/scenarios/dataVersions";
import {
  brokerConfigFingerprint,
  IDEAL_BROKER_CONFIG,
  REALISTIC_BROKER_CONFIG,
} from "../broker/executionModels";

const DEFAULT_RUBRIC_FINGERPRINT = drillRubricFingerprint({
  weights: {
    plan_coverage: 0,
    checkpoint_coverage: 0,
    event_linkage: 1,
    rule_adherence: 0,
  },
  violationPenalty: 20,
});
const DEFAULT_BROKER_FINGERPRINT = brokerConfigFingerprint(
  IDEAL_BROKER_CONFIG,
);
function assessment(
  score: number | undefined,
  overrides: Partial<DrillAssessment> = {},
): DrillAssessment {
  const assessed = score !== undefined;
  const drillId = overrides.drillId ?? "event-discipline-eurgbp-v1";
  const definitionVersion = overrides.definitionVersion ?? 1;
  const eligibleEventCount = 1_000;
  const linkedEventCount = assessed ? Math.round(score * 10) : 0;
  const checkpointScheduleFingerprint =
    overrides.checkpointScheduleFingerprint ??
    drillCheckpointScheduleFingerprint(
      [{
        id: "checkpoint-1",
        drillId,
        definitionVersion,
        replayIndex: 1,
        replayTime: new Date(Date.UTC(2026, 0, 1)).toISOString(),
        eventIds: Array.from(
          { length: eligibleEventCount },
          (_, index) => `event-${index + 1}`,
        ),
      }],
    );
  return {
    drillId,
    competencyId: "event-discipline",
    definitionVersion,
    rubricVersion: "event-process-v1",
    rubricFingerprint: DEFAULT_RUBRIC_FINGERPRINT,
    checkpointScheduleFingerprint,
    eventLinkageEvidenceVersion: 1,
    status: assessed ? "completed" : "incomplete",
    overallScore: score,
    methodology: "Process-only fixture rubric.",
    components: (
      [
        ["plan_coverage", 0, 100],
        ["checkpoint_coverage", 0, 100],
        ["event_linkage", 1, score],
        ["rule_adherence", 0, 100],
      ] as const
    ).map(([id, weight, componentScore]) => ({
      id,
      label: id,
      weight,
      status: assessed
        ? ("assessed" as const)
        : ("insufficient_evidence" as const),
      score: assessed ? componentScore : undefined,
      evidence: "Fixture evidence.",
    })),
    eligibleCheckpointCount: 1,
    answeredCheckpointCount: assessed ? 1 : 0,
    skippedCheckpointCount: 0,
    eligibleEventCount,
    linkedEventCount,
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
    brokerFingerprint: DEFAULT_BROKER_FINGERPRINT,
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
  it("isolates identical rubric labels when their scoring content differs", () => {
    const weights = {
      plan_coverage: 0,
      checkpoint_coverage: 0,
      event_linkage: 1,
      rule_adherence: 0,
    } as const;
    const firstFingerprint = drillRubricFingerprint({
      weights,
      violationPenalty: 20,
    });
    const secondFingerprint = drillRubricFingerprint({
      weights,
      violationPenalty: 5,
    });
    const profile = buildEvidenceProfile(
      [
        ledgerEntry("run-a", time(1), 70, {
          assessment: assessment(70, {
            rubricFingerprint: firstFingerprint,
          }),
        }),
        ledgerEntry("run-b", time(2), 90, {
          assessment: assessment(90, {
            rubricFingerprint: secondFingerprint,
          }),
        }),
      ],
      [],
    );

    expect(profile.assessedEntryCount).toBe(2);
    expect(profile.claims).toHaveLength(2);
    expect(profile.claims.map((claim) => claim.rubricFingerprint).sort()).toEqual(
      [firstFingerprint, secondFingerprint].sort(),
    );
    expect(profile.claims.map((claim) => claim.evidenceCount)).toEqual([1, 1]);
    expect(profile.claims.every((claim) => claim.trend.status === "insufficient_evidence"))
      .toBe(true);
    expect(new Set(profile.claims.map((claim) => claim.id)).size).toBe(2);
  });

  it("requires an explicit rubric fingerprint consistent with every component weight", () => {
    const missingFingerprint = ledgerEntry("missing-fingerprint", time(1), 82, {
      assessment: assessment(82, { rubricFingerprint: undefined }),
    });
    const mismatchedFingerprint = ledgerEntry(
      "mismatched-fingerprint",
      time(2),
      91,
      {
        assessment: assessment(91, {
          rubricFingerprint: drillRubricFingerprint({
            weights: {
              plan_coverage: 0.4,
              checkpoint_coverage: 0.2,
              event_linkage: 0.2,
              rule_adherence: 0.2,
            },
            violationPenalty: 20,
          }),
        }),
      },
    );

    expect(practiceEvidenceScore(missingFingerprint)).toBeUndefined();
    expect(practiceEvidenceScore(mismatchedFingerprint)).toBeUndefined();

    const profile = buildEvidenceProfile(
      [missingFingerprint, mismatchedFingerprint],
      [],
    );
    expect(profile).toMatchObject({
      ledgerEntryCount: 2,
      assessedEntryCount: 0,
    });
    expect(profile.claims).toHaveLength(2);
    expect(
      profile.claims.every(
        (claim) =>
          claim.status === "unassessed" &&
          claim.attemptCount === 1 &&
          claim.evidenceCount === 0 &&
          claim.latestScore === undefined,
      ),
    ).toBe(true);
  });

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
        scenarioDataFidelity: "mixed",
        sampleData: false,
        assessment: assessment(75, {
          drillId: "event-discipline-eurusd-v1",
        }),
      }),
      ledgerEntry("run-5", time(5), 80, {
        scenarioId: "scenario-b",
        scenarioTitle: "Scenario B",
        scenarioDataVersion: "data-v2",
        scenarioDataFidelity: "mixed",
        sampleData: false,
        assessment: assessment(80, {
          drillId: "event-discipline-eurusd-v1",
        }),
      }),
    ];
    const validated: ValidatedSourceScenario[] = [
      {
        scenarioId: "scenario-a",
        dataVersion: "data-v1",
        dataFidelity: "observed",
        sampleData: false,
        sourceReviewed: true,
      },
      {
        scenarioId: "scenario-b",
        dataVersion: "data-v2",
        dataFidelity: "mixed",
        sampleData: false,
        sourceReviewed: true,
      },
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
      sampleEvidenceCount: 0,
      dataFidelities: ["mixed", "observed"],
      confidence: "established",
      competencyId: "event-discipline",
      drillDefinitions: [
        { drillId: "event-discipline-eurgbp-v1", definitionVersion: 1 },
        { drillId: "event-discipline-eurusd-v1", definitionVersion: 1 },
      ],
    });

    const wrongVersion = buildEvidenceProfile(entries, [
      validated[0],
      {
        ...validated[1],
        dataVersion: "different-data",
      },
    ]);
    expect(wrongVersion.claims[0]).toMatchObject({
      validatedSourceScenarioCoverage: 1,
      confidence: "growing",
    });
  });

  it("requires exact fidelity and non-sample source review for validated coverage", () => {
    const sourceReference: ValidatedSourceScenario = {
      scenarioId: "scenario-a",
      dataVersion: "data-v1",
      dataFidelity: "observed",
      sampleData: false,
      sourceReviewed: true,
    };
    const observed = ledgerEntry("observed", time(1), 80);
    const sample = ledgerEntry("sample", time(2), 85, {
      sampleData: true,
    });

    expect(
      buildEvidenceProfile([observed], [sourceReference]).claims[0]
        .validatedSourceScenarioCoverage,
    ).toBe(1);
    expect(
      buildEvidenceProfile(
        [observed],
        [{ ...sourceReference, dataFidelity: "mixed" }],
      ).claims[0].validatedSourceScenarioCoverage,
    ).toBe(0);
    expect(
      buildEvidenceProfile(
        [observed],
        [{ ...sourceReference, sourceReviewed: false }],
      ).claims[0].validatedSourceScenarioCoverage,
    ).toBe(0);
    expect(
      buildEvidenceProfile(
        [sample],
        [{ ...sourceReference, sampleData: true }],
      ).claims[0],
    ).toMatchObject({
      sampleEvidenceCount: 1,
      validatedSourceScenarioCoverage: 0,
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

  it("does not compare scores across different competency identities", () => {
    const previous = ledgerEntry("previous", time(1), 40, {
      assessment: assessment(40, { competencyId: "other-competency" }),
    });
    const current = ledgerEntry("current", time(2), 80);
    const report = {
      scenarioId: current.scenarioId,
      provenance: { dataVersion: current.scenarioDataVersion },
      practiceAssessment: current.assessment,
    } as ReportPayload;

    expect(
      previousComparablePracticeScore(
        current.id,
        report,
        current.mode,
        current.brokerMode,
        current.brokerFingerprint,
        [previous, current],
      ),
    ).toBeUndefined();
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

  it("isolates different valid broker settings even when broker mode is unchanged", () => {
    const realisticFingerprint = brokerConfigFingerprint(
      REALISTIC_BROKER_CONFIG,
    );
    const claim = buildEvidenceProfile(
      [
        ledgerEntry("ideal", time(1), 40),
        ledgerEntry("realistic", time(2), 70, {
          brokerFingerprint: realisticFingerprint,
        }),
      ],
      [],
    ).claims[0];

    expect(realisticFingerprint).not.toBe(DEFAULT_BROKER_FINGERPRINT);
    expect(claim).toMatchObject({
      evidenceCount: 2,
      latestRunId: "realistic",
      latestScore: 70,
      trend: {
        status: "insufficient_evidence",
        currentRunId: "realistic",
        currentScore: 70,
      },
    });
  });

  it("keeps legacy broker-unidentified scores readable but never trends them", () => {
    const first = ledgerEntry("legacy-1", time(1), 50, {
      brokerFingerprint: undefined,
    });
    const second = ledgerEntry("legacy-2", time(2), 65, {
      brokerFingerprint: undefined,
    });
    const legacyClaim = buildEvidenceProfile([first, second], []).claims[0];

    expect(practiceEvidenceScore(first)).toBe(50);
    expect(practiceEvidenceScore(second)).toBe(65);
    expect(legacyClaim).toMatchObject({
      status: "assessed",
      attemptCount: 2,
      evidenceCount: 2,
      latestRunId: "legacy-2",
      latestScore: 65,
      trend: {
        status: "insufficient_evidence",
        currentRunId: "legacy-2",
        currentScore: 65,
      },
    });

    const currentIdentified = ledgerEntry("identified", time(3), 80);
    expect(
      buildEvidenceProfile([second, currentIdentified], []).claims[0],
    ).toMatchObject({
      evidenceCount: 2,
      trend: {
        status: "insufficient_evidence",
        currentRunId: "identified",
        currentScore: 80,
      },
    });
  });

  it("keeps reviewed version-identity migrations comparable and source-validated", () => {
    const entries = [
      ledgerEntry("legacy-version", time(1), 40, {
        scenarioId: "eurgbp-brexit-2016",
        scenarioDataVersion: LEGACY_EURGBP_BREXIT_2016_DATA_VERSION,
        scenarioDataFidelity: "mixed",
      }),
      ledgerEntry("content-version", time(2), 55, {
        scenarioId: "eurgbp-brexit-2016",
        scenarioDataVersion: EURGBP_BREXIT_2016_DATA_VERSION,
        scenarioDataFidelity: "mixed",
      }),
    ];

    const claim = buildEvidenceProfile(entries, [
      {
        scenarioId: "eurgbp-brexit-2016",
        dataVersion: EURGBP_BREXIT_2016_DATA_VERSION,
        dataFidelity: "mixed",
        sampleData: false,
        sourceReviewed: true,
      },
    ]).claims[0];

    expect(claim.validatedSourceScenarioCoverage).toBe(1);
    expect(claim.trend).toMatchObject({
      status: "improving",
      previousRunId: "legacy-version",
      currentRunId: "content-version",
      delta: 15,
    });
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
    expect(practiceEvidenceScore(noDecision)).toBeUndefined();
  });

  it("exposes a score only for fully measured completed evidence", () => {
    const completed = ledgerEntry("completed", time(1), 84);
    const incomplete = ledgerEntry("incomplete", time(2), 91, {
      assessment: assessment(91, { status: "incomplete" }),
    });
    const partial = ledgerEntry("partial", time(3), 88);
    partial.assessment = {
      ...partial.assessment!,
      components: partial.assessment!.components.map((component, index) =>
        index === 0
          ? { ...component, status: "insufficient_evidence", score: undefined }
          : component,
      ),
    };

    expect(practiceEvidenceScore(completed)).toBe(84);
    expect(practiceEvidenceScore(incomplete)).toBeUndefined();
    expect(practiceEvidenceScore(partial)).toBeUndefined();
    expect(
      practiceEvidenceScore({
        ...completed,
        assessment: {
          ...completed.assessment!,
          eligibleCheckpointCount: 1,
          answeredCheckpointCount: 1,
          eligibleEventCount: 1,
          linkedEventCount: 1,
        },
      }),
    ).toBeUndefined();
    expect(
      practiceEvidenceScore({
        ...completed,
        assessment: {
          ...completed.assessment!,
          eventLinkageEvidenceVersion: undefined,
        },
      }),
    ).toBeUndefined();

    const contradictory = ledgerEntry("contradictory", time(4), 100);
    contradictory.assessment = {
      ...contradictory.assessment!,
      linkedEventCount: 0,
    };
    expect(practiceEvidenceScore(contradictory)).toBeUndefined();
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
