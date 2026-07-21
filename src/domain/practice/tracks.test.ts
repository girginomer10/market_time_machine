import { describe, expect, it } from "vitest";
import { listBuiltInDrills } from "../../data/practice/drills";
import {
  decisionFoundationsTrack,
  eventPressureTransferTrack,
  listBuiltInPracticeTracks,
  volatilityDisciplineTrack,
} from "../../data/practice/tracks";
import { eurGbpBrexit2016Scenario } from "../../data/scenarios/eurgbp-brexit-2016";
import { eurUsdCovidLiquidity2020Scenario } from "../../data/scenarios/eurusd-covid-liquidity-2020";
import { kreBankingCrisis2023Scenario } from "../../data/scenarios/kre-banking-crisis-2023";
import { qqqRateHike2022Scenario } from "../../data/scenarios/qqq-rate-hike-2022";
import { LEGACY_EURGBP_BREXIT_2016_DATA_VERSION } from "../../data/scenarios/dataVersions";
import {
  brokerConfigFingerprint,
  getBrokerPreset,
} from "../broker/executionModels";
import type { PracticeLedgerEntry } from "../history/practiceLedger";
import type { DrillAssessment } from "../../types";
import { drillCheckpointScheduleFingerprint } from "./drills";
import {
  ledgerAttemptCompletesTrackUnit,
  practiceTrackProgress,
  validatePracticeTrackCatalog,
  type PracticeTrack,
  type PracticeTrackUnit,
} from "./tracks";

const scenarios = [
  eurGbpBrexit2016Scenario,
  eurUsdCovidLiquidity2020Scenario,
  qqqRateHike2022Scenario,
  kreBankingCrisis2023Scenario,
];
const drills = listBuiltInDrills();

function completeAssessment(unit: PracticeTrackUnit): DrillAssessment {
  return {
    drillId: unit.drill.id,
    definitionVersion: unit.drill.definitionVersion,
    rubricVersion: unit.drill.rubricVersion,
    rubricFingerprint: unit.drill.rubricFingerprint,
    checkpointScheduleFingerprint: unit.drill.checkpointScheduleFingerprint,
    eventLinkageEvidenceVersion: 1,
    status: "completed",
    overallScore: 100,
    methodology: "Process-only score.",
    components: [
      {
        id: "plan_coverage",
        label: "Initial plan coverage",
        weight: 0.3,
        status: "assessed",
        score: 100,
        evidence: "All required plan fields were recorded.",
      },
      {
        id: "checkpoint_coverage",
        label: "Checkpoint coverage",
        weight: 0.3,
        status: "assessed",
        score: 100,
        evidence: "Every checkpoint was answered.",
      },
      {
        id: "event_linkage",
        label: "Event linkage",
        weight: 0.2,
        status: "assessed",
        score: 100,
        evidence: "Every eligible event was linked.",
      },
      {
        id: "rule_adherence",
        label: "Rule adherence",
        weight: 0.2,
        status: "assessed",
        score: 100,
        evidence: "No rule violations were recorded.",
      },
    ],
    eligibleCheckpointCount: 5,
    answeredCheckpointCount: 5,
    skippedCheckpointCount: 0,
    eligibleEventCount: 6,
    linkedEventCount: 6,
    violationCount: 0,
  };
}

function attemptFor(
  unit: PracticeTrackUnit,
  input: {
    id?: string;
    entry?: Partial<PracticeLedgerEntry>;
    assessment?: Partial<DrillAssessment>;
  } = {},
): PracticeLedgerEntry {
  return {
    id: input.id ?? `attempt-${unit.id}`,
    runId: input.id ?? `run-${unit.id}`,
    runInstanceId: input.id ?? `instance-${unit.id}`,
    completedAt: "2026-07-14T10:00:00.000Z",
    scenarioId: unit.scenario.id,
    scenarioTitle: unit.title,
    scenarioDataVersion: unit.scenario.dataVersion ?? undefined,
    scenarioDataFidelity: unit.scenario.dataFidelity,
    sampleData: unit.scenario.sampleData,
    mode: unit.drill.mode,
    brokerMode: unit.broker.mode,
    brokerFingerprint: unit.broker.fingerprint,
    facts: {
      executionCount: 1,
      closedTradeCount: 1,
      journalEntryCount: 1,
      executedDecisionCount: 1,
      linkedDecisionCount: 1,
      behavioralFlagCount: 0,
      forcedLiquidationCount: 0,
    },
    assessment: {
      ...completeAssessment(unit),
      ...input.assessment,
    },
    ...input.entry,
  };
}

function withComponentScore(
  assessment: DrillAssessment,
  id: DrillAssessment["components"][number]["id"],
  score: number,
): DrillAssessment["components"] {
  return assessment.components.map((component) =>
    component.id === id ? { ...component, score } : component,
  );
}

describe("practice track catalog", () => {
  it("publishes three explicit tracks with validated and preview provenance", () => {
    expect(listBuiltInPracticeTracks()).toEqual([
      decisionFoundationsTrack,
      eventPressureTransferTrack,
      volatilityDisciplineTrack,
    ]);
    expect(decisionFoundationsTrack).toMatchObject({
      status: "open",
      units: [{ status: "validated" }],
    });
    expect(eventPressureTransferTrack).toMatchObject({
      status: "open",
      completionPolicy: { minimumSourceReviewedScenarios: 2 },
    });
    expect(
      eventPressureTransferTrack.units.map((unit) => ({
        scenarioId: unit.scenario.id,
        dataVersion: unit.scenario.dataVersion,
        marketEvidence: unit.evidenceScope.marketEvidence,
        dataFidelity: unit.evidenceScope.dataFidelity,
      })),
    ).toEqual([
      {
        scenarioId: "eurgbp-brexit-2016",
        dataVersion: eurGbpBrexit2016Scenario.meta.dataVersion,
        marketEvidence: "source_observed",
        dataFidelity: "mixed",
      },
      {
        scenarioId: "eurusd-covid-liquidity-2020",
        dataVersion: eurUsdCovidLiquidity2020Scenario.meta.dataVersion,
        marketEvidence: "source_observed",
        dataFidelity: "mixed",
      },
    ]);
    expect(volatilityDisciplineTrack).toMatchObject({
      status: "preview",
      units: [
        {
          status: "preview",
          scenario: {
            dataVersion: "synthetic-qqq-rate-hike-2022-v1",
            sampleData: true,
          },
          evidenceScope: {
            marketEvidence: "synthetic",
            eventEvidence: "official_sources",
          },
        },
        {
          status: "preview",
          scenario: {
            dataVersion: "synthetic-kre-banking-crisis-2023-v1",
            sampleData: true,
          },
          evidenceScope: {
            marketEvidence: "synthetic",
            eventEvidence: "official_sources",
          },
        },
      ],
    });
  });

  it("validates every versioned scenario, drill, mode, and evidence reference", () => {
    expect(
      validatePracticeTrackCatalog(listBuiltInPracticeTracks(), {
        scenarios,
        drills,
      }),
    ).toEqual({ valid: true, issues: [] });
    for (const track of listBuiltInPracticeTracks()) {
      for (const unit of track.units) {
        const scenario = scenarios.find(
          (candidate) => candidate.meta.id === unit.scenario.id,
        );
        expect(scenario).toBeDefined();
        expect(unit.broker).toEqual({
          mode: "scenario",
          fingerprint: brokerConfigFingerprint(scenario!.broker),
        });
      }
    }
  });

  it("rejects missing, malformed, or drifted broker identities", () => {
    const source = decisionFoundationsTrack.units[0];
    const missingBroker = {
      ...source,
      id: "missing-broker-unit-v1",
      broker: undefined,
    } as unknown as PracticeTrackUnit;
    const malformedBroker = {
      ...source,
      id: "malformed-broker-unit-v1",
      broker: { mode: "scenario", fingerprint: "short-hash" },
    } as PracticeTrackUnit;
    const driftedBroker = {
      ...source,
      id: "drifted-broker-unit-v1",
      broker: {
        mode: "scenario",
        fingerprint: brokerConfigFingerprint({
          ...eurGbpBrexit2016Scenario.broker,
          spreadBps: eurGbpBrexit2016Scenario.broker.spreadBps + 1,
        }),
      },
    } as PracticeTrackUnit;

    const result = validatePracticeTrackCatalog(
      [
        {
          ...decisionFoundationsTrack,
          id: "invalid-broker-identities-v1",
          units: [missingBroker, malformedBroker, driftedBroker],
        },
      ],
      { scenarios, drills },
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unit.broker_identity_invalid",
          path: "tracks[0].units[0].broker",
        }),
        expect.objectContaining({
          code: "unit.broker_identity_invalid",
          path: "tracks[0].units[1].broker",
        }),
        expect.objectContaining({
          code: "unit.broker_reference_mismatch",
          path: "tracks[0].units[2].broker",
        }),
      ]),
    );

    const scenarioDrift = validatePracticeTrackCatalog(
      listBuiltInPracticeTracks(),
      {
        scenarios: scenarios.map((scenario) =>
          scenario.meta.id === eurGbpBrexit2016Scenario.meta.id
            ? {
                ...scenario,
                broker: {
                  ...scenario.broker,
                  spreadBps: scenario.broker.spreadBps + 1,
                },
              }
            : scenario,
        ),
        drills,
      },
    );
    expect(scenarioDrift.issues).toContainEqual(
      expect.objectContaining({
        code: "unit.broker_reference_mismatch",
        path: "tracks[0].units[0].broker",
      }),
    );
  });

  it("treats broker execution identity as part of a unit reference", () => {
    const source = decisionFoundationsTrack.units[0];
    const idealBroker = {
      mode: "ideal",
      fingerprint: brokerConfigFingerprint({
        ...getBrokerPreset("ideal"),
        baseCurrency: eurGbpBrexit2016Scenario.meta.baseCurrency,
      }),
    } as const;
    const result = validatePracticeTrackCatalog(
      [
        {
          ...decisionFoundationsTrack,
          id: "execution-variant-track-v1",
          units: [
            source,
            {
              ...source,
              id: "decision-foundations-eurgbp-ideal-v1",
              order: 2,
              broker: idealBroker,
            },
          ],
        },
      ],
      { scenarios, drills },
    );

    expect(result.issues).not.toContainEqual(
      expect.objectContaining({ code: "unit.reference_duplicate" }),
    );
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it("cannot promote a synthetic sample preview unit into completion credit", () => {
    const promotedUnit = {
      ...volatilityDisciplineTrack.units[0],
      status: "validated",
    } as PracticeTrackUnit;
    const promotedTrack = {
      ...volatilityDisciplineTrack,
      id: "forged-validated-synthetic-track-v1",
      status: "open",
      units: [promotedUnit],
    } as PracticeTrack;

    const validation = validatePracticeTrackCatalog([promotedTrack], {
      scenarios,
      drills,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: "unit.completion_evidence_invalid",
        path: "tracks[0].units[0].evidenceScope",
      }),
    );
    const syntheticAttempt = attemptFor(promotedUnit);
    expect(
      ledgerAttemptCompletesTrackUnit(promotedUnit, syntheticAttempt),
    ).toBe(false);
    expect(practiceTrackProgress(promotedTrack, [syntheticAttempt])).toMatchObject({
      status: "not_started",
      completedUnitCount: 0,
      creditableUnitCount: 1,
      units: [{ status: "incomplete" }],
    });
  });

  it("preserves credit across the reviewed EUR/GBP version-identity migration", () => {
    const unit = decisionFoundationsTrack.units[0];
    expect(
      ledgerAttemptCompletesTrackUnit(
        unit,
        attemptFor(unit, {
          entry: {
            scenarioDataVersion: LEGACY_EURGBP_BREXIT_2016_DATA_VERSION,
          },
        }),
      ),
    ).toBe(true);
  });

  it("rejects mismatched versions, drill refs, modes, and provenance", () => {
    const source = decisionFoundationsTrack.units[0];
    const invalidUnit = {
      ...source,
      id: "invalid-reference-unit-v1",
      scenario: {
        ...source.scenario,
        dataVersion: "forged-import-version",
        dataFidelity: "synthetic",
        sampleData: true,
      },
      drill: {
        ...source.drill,
        definitionVersion: 99,
        mode: "professional",
      },
      evidenceScope: {
        ...source.evidenceScope,
        marketEvidence: "synthetic",
        dataFidelity: "synthetic",
        sampleData: true,
      },
    } as PracticeTrackUnit;
    const invalidTrack = {
      ...decisionFoundationsTrack,
      id: "invalid-reference-track-v1",
      units: [invalidUnit],
    } as PracticeTrack;
    const result = validatePracticeTrackCatalog([invalidTrack], {
      scenarios,
      drills,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "unit.scenario_version_invalid",
        "unit.data_fidelity_mismatch",
        "unit.sample_data_mismatch",
        "unit.synthetic_evidence_invalid",
        "unit.drill_reference_mismatch",
      ]),
    );
  });

  it("rejects duplicate references and under-specified multi-regime tracks", () => {
    const source = eventPressureTransferTrack.units[0];
    const duplicateTrack = {
      ...eventPressureTransferTrack,
      id: "duplicate-transfer-track-v1",
      units: [source, { ...source }],
    } as PracticeTrack;
    const result = validatePracticeTrackCatalog([duplicateTrack], {
      scenarios,
      drills,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "unit.id_invalid",
        "unit.reference_duplicate",
        "track.multi_regime_evidence_insufficient",
      ]),
    );
  });
});

describe("practice track progress", () => {
  const foundationUnit = decisionFoundationsTrack.units[0];

  it("credits a unit only when one ledger attempt satisfies every criterion", () => {
    const attempt = attemptFor(foundationUnit);

    expect(ledgerAttemptCompletesTrackUnit(foundationUnit, attempt)).toBe(true);
    expect(
      ledgerAttemptCompletesTrackUnit(foundationUnit, {
        ...attempt,
        facts: { ...attempt.facts, executionCount: 0 },
      }),
    ).toBe(false);
    expect(
      ledgerAttemptCompletesTrackUnit(foundationUnit, {
        ...attempt,
        assessment: {
          ...attempt.assessment!,
          eventLinkageEvidenceVersion: undefined,
        },
      }),
    ).toBe(false);
    expect(practiceTrackProgress(decisionFoundationsTrack, [attempt])).toEqual({
      trackId: decisionFoundationsTrack.id,
      trackVersion: 1,
      status: "completed",
      completedUnitCount: 1,
      creditableUnitCount: 1,
      units: [
        {
          unitId: foundationUnit.id,
          unitVersion: 1,
          status: "completed",
          creditedAttemptId: attempt.id,
        },
      ],
    });
  });

  it("rejects a completed-looking attempt scored against a partial schedule", () => {
    const partialFingerprint = drillCheckpointScheduleFingerprint([
      {
        id: "forged-one",
        drillId: foundationUnit.drill.id,
        definitionVersion: foundationUnit.drill.definitionVersion,
        replayIndex: 1,
        replayTime: "2016-01-05T00:00:00.000Z",
        eventIds: ["forged-event"],
      },
    ]);
    const forged = attemptFor(foundationUnit, {
      assessment: {
        checkpointScheduleFingerprint: partialFingerprint,
        eligibleCheckpointCount: 1,
        answeredCheckpointCount: 1,
        eligibleEventCount: 1,
        linkedEventCount: 1,
      },
    });

    expect(ledgerAttemptCompletesTrackUnit(foundationUnit, forged)).toBe(false);
  });

  it("rejects reduced totals even when the canonical unit schedule fingerprint is copied", () => {
    const forged = attemptFor(foundationUnit, {
      assessment: {
        checkpointScheduleFingerprint:
          foundationUnit.drill.checkpointScheduleFingerprint,
        eligibleCheckpointCount: 1,
        answeredCheckpointCount: 1,
        eligibleEventCount: 1,
        linkedEventCount: 1,
      },
    });

    expect(ledgerAttemptCompletesTrackUnit(foundationUnit, forged)).toBe(false);
  });

  it("rejects direct in-memory component scores that contradict aggregate evidence", () => {
    const forged = attemptFor(foundationUnit, {
      assessment: {
        linkedEventCount: 0,
      },
    });

    expect(forged.assessment?.components).toContainEqual(
      expect.objectContaining({ id: "event_linkage", score: 100 }),
    );
    expect(ledgerAttemptCompletesTrackUnit(foundationUnit, forged)).toBe(false);
  });

  it("does not merge passing criteria across separate attempts", () => {
    const base = completeAssessment(foundationUnit);
    const weakPlan = attemptFor(foundationUnit, {
      id: "weak-plan",
      assessment: {
        components: withComponentScore(base, "plan_coverage", 70),
      },
    });
    const weakCheckpoint = attemptFor(foundationUnit, {
      id: "weak-checkpoint",
      assessment: {
        components: withComponentScore(base, "checkpoint_coverage", 90),
      },
    });

    expect(
      practiceTrackProgress(decisionFoundationsTrack, [
        weakPlan,
        weakCheckpoint,
      ]),
    ).toMatchObject({
      status: "not_started",
      completedUnitCount: 0,
      units: [{ status: "incomplete" }],
    });
  });

  it("requires the exact broker mode and complete configuration identity", () => {
    const scenarioAttempt = attemptFor(foundationUnit);
    const idealFingerprint = brokerConfigFingerprint({
      ...getBrokerPreset("ideal"),
      baseCurrency: eurGbpBrexit2016Scenario.meta.baseCurrency,
    });
    const changedScenarioFingerprint = brokerConfigFingerprint({
      ...eurGbpBrexit2016Scenario.broker,
      spreadBps: eurGbpBrexit2016Scenario.broker.spreadBps + 1,
    });

    expect(ledgerAttemptCompletesTrackUnit(foundationUnit, scenarioAttempt)).toBe(
      true,
    );
    expect(
      ledgerAttemptCompletesTrackUnit(foundationUnit, {
        ...scenarioAttempt,
        brokerMode: "ideal",
        brokerFingerprint: idealFingerprint,
      }),
    ).toBe(false);
    expect(
      ledgerAttemptCompletesTrackUnit(foundationUnit, {
        ...scenarioAttempt,
        brokerFingerprint: changedScenarioFingerprint,
      }),
    ).toBe(false);
    expect(
      ledgerAttemptCompletesTrackUnit(foundationUnit, {
        ...scenarioAttempt,
        brokerFingerprint: undefined,
      }),
    ).toBe(false);
  });

  it("denies imported-scenario lookalikes without the curated exact version", () => {
    const wrongId = attemptFor(foundationUnit, {
      id: "imported-copy-id",
      entry: { scenarioId: "user-imported-eurgbp" },
    });
    const spoofedVersion = attemptFor(foundationUnit, {
      id: "imported-copy-version",
      entry: { scenarioDataVersion: "user supplied lookalike" },
    });
    const spoofedSampleFlag = attemptFor(foundationUnit, {
      id: "imported-copy-sample",
      entry: { sampleData: true },
    });

    expect(ledgerAttemptCompletesTrackUnit(foundationUnit, wrongId)).toBe(false);
    expect(
      ledgerAttemptCompletesTrackUnit(foundationUnit, spoofedVersion),
    ).toBe(false);
    expect(
      ledgerAttemptCompletesTrackUnit(foundationUnit, spoofedSampleFlag),
    ).toBe(false);
    expect(
      practiceTrackProgress(decisionFoundationsTrack, [
        wrongId,
        spoofedVersion,
        spoofedSampleFlag,
      ]).status,
    ).toBe("not_started");
  });

  it("requires the curated rubric fingerprint and rejects legacy weight-only evidence", () => {
    const current = attemptFor(foundationUnit);
    const changedPenaltyIdentity = attemptFor(foundationUnit, {
      id: "changed-rubric-content",
      assessment: {
        rubricFingerprint: `${foundationUnit.drill.rubricFingerprint}:changed`,
      },
    });
    const forgedCurrentIdentity = attemptFor(foundationUnit, {
      id: "forged-current-rubric-content",
      assessment: {
        rubricFingerprint: foundationUnit.drill.rubricFingerprint,
        components: completeAssessment(foundationUnit).components.map(
          (component) =>
            component.id === "plan_coverage"
              ? { ...component, weight: component.weight + 0.1 }
              : component.id === "checkpoint_coverage"
                ? { ...component, weight: component.weight - 0.1 }
                : component,
        ),
      },
    });
    const legacy = attemptFor(foundationUnit, {
      id: "legacy-without-fingerprint",
      assessment: { rubricFingerprint: undefined },
    });
    const legacyWrongWeights = attemptFor(foundationUnit, {
      id: "legacy-wrong-weights",
      assessment: {
        rubricFingerprint: undefined,
        components: completeAssessment(foundationUnit).components.map(
          (component) =>
            component.id === "plan_coverage"
              ? { ...component, weight: 0.4 }
              : component.id === "checkpoint_coverage"
                ? { ...component, weight: 0.2 }
                : component,
        ),
      },
    });

    expect(ledgerAttemptCompletesTrackUnit(foundationUnit, current)).toBe(true);
    expect(
      ledgerAttemptCompletesTrackUnit(foundationUnit, changedPenaltyIdentity),
    ).toBe(false);
    expect(
      ledgerAttemptCompletesTrackUnit(foundationUnit, forgedCurrentIdentity),
    ).toBe(false);
    expect(ledgerAttemptCompletesTrackUnit(foundationUnit, legacy)).toBe(false);
    expect(
      ledgerAttemptCompletesTrackUnit(foundationUnit, legacyWrongWeights),
    ).toBe(false);
  });

  it("never grants completion credit to synthetic preview units", () => {
    const previewUnit = volatilityDisciplineTrack.units[0];
    const attempt = attemptFor(previewUnit);

    expect(ledgerAttemptCompletesTrackUnit(previewUnit, attempt)).toBe(false);
    expect(practiceTrackProgress(volatilityDisciplineTrack, [attempt])).toMatchObject({
      status: "preview",
      completedUnitCount: 0,
      creditableUnitCount: 0,
      units: [{ status: "preview" }, { status: "preview" }],
    });
  });
});
