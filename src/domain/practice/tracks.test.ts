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
import type { PracticeLedgerEntry } from "../history/practiceLedger";
import type { DrillAssessment } from "../../types";
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
    brokerMode: "scenario",
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
        dataVersion:
          "ECB EXR D.GBP.EUR.SP00.A; retrieved 2026-07-13T00:00:00.000Z",
        marketEvidence: "source_observed",
        dataFidelity: "mixed",
      },
      {
        scenarioId: "eurusd-covid-liquidity-2020",
        dataVersion:
          "ECB EXR D.USD.EUR.SP00.A; retrieved 2026-07-14T00:00:00.000Z",
        marketEvidence: "source_observed",
        dataFidelity: "mixed",
      },
    ]);
    expect(volatilityDisciplineTrack).toMatchObject({
      status: "preview",
      units: [
        {
          status: "preview",
          scenario: { dataVersion: null, sampleData: true },
          evidenceScope: {
            marketEvidence: "synthetic",
            eventEvidence: "official_sources",
          },
        },
        {
          status: "preview",
          scenario: { dataVersion: null, sampleData: true },
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
