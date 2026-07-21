import type { PracticeLedgerEntry } from "../history/practiceLedger";
import type { CompletedRun } from "../history/runHistory";
import type {
  DataFidelity,
  DrillAssessment,
  ReportPayload,
  ScenarioMode,
} from "../../types";
import {
  assessmentMatchesCheckpointScheduleFingerprint,
  assessmentHasConsistentRubricFingerprint,
  completedAssessmentMatchesAggregateEvidence,
  effectiveAssessmentRubricFingerprint,
} from "./drills";
import { isBrokerConfigFingerprint } from "../broker/executionModels";
import {
  canonicalScenarioDataVersion,
  scenarioDataVersionsEqual,
} from "../../data/scenarios/dataVersions";

export type EvidenceConfidence =
  | "insufficient_evidence"
  | "limited"
  | "growing"
  | "established";

export type EvidenceTrendStatus =
  | "insufficient_evidence"
  | "improving"
  | "stable"
  | "declining";

/**
 * Callers explicitly curate this list. A null dataVersion means the reviewed
 * scenario intentionally has no version; it is not a wildcard.
 */
export type ValidatedSourceScenario = {
  scenarioId: string;
  dataVersion: string | null;
  dataFidelity: DataFidelity;
  sampleData: boolean;
  sourceReviewed: boolean;
};

export type ValidatedPracticeSchedule = {
  scenarioId: string;
  dataVersion: string | null;
  drillId: string;
  definitionVersion: number;
  rubricVersion: string;
  rubricFingerprint: string;
  checkpointScheduleFingerprint: string;
  mode: ScenarioMode;
};

export type EvidenceTrend = {
  status: EvidenceTrendStatus;
  currentRunId?: string;
  previousRunId?: string;
  currentScore?: number;
  previousScore?: number;
  delta?: number;
};

export type EvidenceDrillDefinitionIdentity = {
  drillId: string;
  definitionVersion: number;
};

export type PracticeEvidenceClaim = {
  id: string;
  competencyId: string;
  rubricVersion: string;
  rubricFingerprint: string;
  drillDefinitions: EvidenceDrillDefinitionIdentity[];
  status: "assessed" | "unassessed";
  attemptCount: number;
  evidenceCount: number;
  latestRunId?: string;
  latestScore?: number;
  scenarioIds: string[];
  scenarioCoverage: number;
  validatedSourceScenarioIds: string[];
  validatedSourceScenarioCoverage: number;
  sampleEvidenceCount: number;
  dataFidelities: DataFidelity[];
  confidence: EvidenceConfidence;
  trend: EvidenceTrend;
};

export type PracticeEvidenceProfile = {
  ledgerEntryCount: number;
  assessedEntryCount: number;
  claims: PracticeEvidenceClaim[];
};

type AssessmentEntry = {
  entry: PracticeLedgerEntry;
  assessment: DrillAssessment;
  score?: number;
};

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function compareOldestFirst(left: PracticeLedgerEntry, right: PracticeLedgerEntry): number {
  return (
    timestamp(left.completedAt) - timestamp(right.completedAt) ||
    left.id.localeCompare(right.id)
  );
}

function finiteScore(value: number | undefined): number | undefined {
  return value !== undefined &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : undefined;
}

export function completedPracticeAssessmentScore(
  assessment: DrillAssessment | undefined,
  executionCount: number,
): number | undefined {
  return assessment?.status === "completed" &&
    assessment.eventLinkageEvidenceVersion === 1 &&
    Boolean(assessment.rubricFingerprint?.trim()) &&
    assessmentMatchesCheckpointScheduleFingerprint(assessment) &&
    assessmentHasConsistentRubricFingerprint(assessment) &&
    completedAssessmentMatchesAggregateEvidence(assessment) &&
    executionCount > 0 &&
    assessment.components.every(
      (component) =>
        component.status === "assessed" && component.score !== undefined,
    )
    ? finiteScore(assessment.overallScore)
    : undefined;
}

export function practiceEvidenceScore(
  entry: PracticeLedgerEntry,
): number | undefined {
  return completedPracticeAssessmentScore(
    entry.assessment,
    entry.facts.executionCount,
  );
}

export function previousComparablePracticeScore(
  currentRunId: string,
  report: ReportPayload,
  mode: ScenarioMode,
  brokerMode: CompletedRun["brokerMode"],
  brokerFingerprint: string | undefined,
  ledger: readonly PracticeLedgerEntry[],
): number | undefined {
  const assessment = report.practiceAssessment;
  if (!assessment || !isBrokerConfigFingerprint(brokerFingerprint)) {
    return undefined;
  }
  const rubricFingerprint = effectiveAssessmentRubricFingerprint(assessment);
  const currentEntry = ledger.find(
    (entry) =>
      entry.id === currentRunId ||
      entry.runId === currentRunId ||
      entry.runInstanceId === currentRunId,
  );
  if (
    !currentEntry ||
    currentEntry.scenarioId !== report.scenarioId ||
    !scenarioDataVersionsEqual(
      currentEntry.scenarioId,
      currentEntry.scenarioDataVersion,
      report.provenance?.dataVersion,
    ) ||
    currentEntry.mode !== mode ||
    currentEntry.brokerMode !== brokerMode ||
    currentEntry.brokerFingerprint !== brokerFingerprint ||
    currentEntry.assessment?.drillId !== assessment.drillId ||
    competencyIdFor(currentEntry.assessment) !== competencyIdFor(assessment) ||
    currentEntry.assessment.definitionVersion !== assessment.definitionVersion ||
    currentEntry.assessment.rubricVersion !== assessment.rubricVersion ||
    effectiveAssessmentRubricFingerprint(currentEntry.assessment) !==
      rubricFingerprint ||
    currentEntry.assessment.checkpointScheduleFingerprint !==
      assessment.checkpointScheduleFingerprint ||
    practiceEvidenceScore(currentEntry) === undefined
  ) {
    return undefined;
  }
  const previous = [...ledger]
    .filter(
      (entry) =>
        entry.id !== currentRunId &&
        entry.runId !== currentRunId &&
        entry.runInstanceId !== currentRunId &&
        entry.scenarioId === report.scenarioId &&
        scenarioDataVersionsEqual(
          entry.scenarioId,
          entry.scenarioDataVersion,
          report.provenance?.dataVersion,
        ) &&
        entry.mode === mode &&
        entry.brokerMode === brokerMode &&
        entry.brokerFingerprint === brokerFingerprint &&
        entry.assessment?.drillId === assessment.drillId &&
        competencyIdFor(entry.assessment) === competencyIdFor(assessment) &&
        entry.assessment.definitionVersion === assessment.definitionVersion &&
        entry.assessment.rubricVersion === assessment.rubricVersion &&
        effectiveAssessmentRubricFingerprint(entry.assessment) ===
          rubricFingerprint &&
        entry.assessment.checkpointScheduleFingerprint ===
          assessment.checkpointScheduleFingerprint &&
        practiceEvidenceScore(entry) !== undefined,
    )
    .sort(
      (left, right) =>
        Date.parse(right.completedAt) - Date.parse(left.completedAt) ||
        right.id.localeCompare(left.id),
    )[0];
  return previous ? practiceEvidenceScore(previous) : undefined;
}

export function rubricContentReference(fingerprint: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash ^= fingerprint.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `content-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function competencyIdFor(assessment: DrillAssessment): string {
  return assessment.competencyId?.trim() || assessment.drillId;
}

function claimBaseId(assessment: DrillAssessment): string {
  return [competencyIdFor(assessment), assessment.rubricVersion].join(":");
}

function claimGroupKey(assessment: DrillAssessment): string {
  return JSON.stringify([
    competencyIdFor(assessment),
    assessment.rubricVersion,
    effectiveAssessmentRubricFingerprint(assessment),
  ]);
}

function comparableContextKey(item: AssessmentEntry): string | undefined {
  const { entry, assessment } = item;
  if (!isBrokerConfigFingerprint(entry.brokerFingerprint)) return undefined;
  return JSON.stringify([
    entry.scenarioId,
    canonicalScenarioDataVersion(
      entry.scenarioId,
      entry.scenarioDataVersion,
    ),
    assessment.drillId,
    assessment.definitionVersion,
    assessment.rubricVersion,
    effectiveAssessmentRubricFingerprint(assessment),
    assessment.checkpointScheduleFingerprint ?? "<legacy-schedule>",
    entry.mode,
    entry.brokerMode,
    entry.brokerFingerprint,
  ]);
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function exactDrillDefinitions(
  items: readonly AssessmentEntry[],
): EvidenceDrillDefinitionIdentity[] {
  const definitions = new Map<string, EvidenceDrillDefinitionIdentity>();
  for (const { assessment } of items) {
    const identity = {
      drillId: assessment.drillId,
      definitionVersion: assessment.definitionVersion,
    };
    definitions.set(JSON.stringify(identity), identity);
  }
  return [...definitions.values()].sort(
    (left, right) =>
      left.drillId.localeCompare(right.drillId) ||
      left.definitionVersion - right.definitionVersion,
  );
}

function roundedDelta(value: number): number {
  return Math.round(value * 10) / 10;
}

export function evidenceConfidenceFor(
  evidenceCount: number,
  validatedSourceScenarioCoverage: number,
): EvidenceConfidence {
  if (evidenceCount <= 0) return "insufficient_evidence";
  if (evidenceCount <= 2) return "limited";
  if (evidenceCount >= 5 && validatedSourceScenarioCoverage >= 2) {
    return "established";
  }
  return "growing";
}

export function trendForComparableAssessments(
  entries: readonly AssessmentEntry[],
): EvidenceTrend {
  const assessed = entries
    .filter((item) => item.score !== undefined)
    .sort((left, right) => compareOldestFirst(left.entry, right.entry));
  const current = assessed.at(-1);
  if (!current) return { status: "insufficient_evidence" };
  const currentContext = comparableContextKey(current);
  if (!currentContext) {
    return {
      status: "insufficient_evidence",
      currentRunId: current.entry.runId,
      currentScore: current.score,
    };
  }
  const previous = [...assessed]
    .slice(0, -1)
    .reverse()
    .find((candidate) => comparableContextKey(candidate) === currentContext);
  if (!previous || current.score === undefined || previous.score === undefined) {
    return {
      status: "insufficient_evidence",
      currentRunId: current.entry.runId,
      currentScore: current.score,
    };
  }
  const rawDelta = current.score - previous.score;
  const delta = roundedDelta(rawDelta);
  return {
    status:
      rawDelta >= 10
        ? "improving"
        : rawDelta <= -10
          ? "declining"
          : "stable",
    currentRunId: current.entry.runId,
    previousRunId: previous.entry.runId,
    currentScore: current.score,
    previousScore: previous.score,
    delta,
  };
}

function isValidatedSourceEntry(
  entry: PracticeLedgerEntry,
  validated: readonly ValidatedSourceScenario[],
): boolean {
  return validated.some(
    (reference) =>
      reference.scenarioId === entry.scenarioId &&
      scenarioDataVersionsEqual(
        entry.scenarioId,
        reference.dataVersion,
        entry.scenarioDataVersion,
      ) &&
      entry.scenarioDataFidelity === reference.dataFidelity &&
      entry.sampleData === false &&
      reference.sampleData === false &&
      reference.sourceReviewed === true,
  );
}

function matchesValidatedPracticeSchedule(
  entry: PracticeLedgerEntry,
  references: readonly ValidatedPracticeSchedule[],
): boolean {
  const assessment = entry.assessment;
  return Boolean(
    assessment?.rubricFingerprint &&
      assessment.checkpointScheduleFingerprint &&
      references.some(
        (reference) =>
          reference.scenarioId === entry.scenarioId &&
          scenarioDataVersionsEqual(
            entry.scenarioId,
            reference.dataVersion,
            entry.scenarioDataVersion,
          ) &&
          reference.drillId === assessment.drillId &&
          reference.definitionVersion === assessment.definitionVersion &&
          reference.rubricVersion === assessment.rubricVersion &&
          reference.rubricFingerprint === assessment.rubricFingerprint &&
          reference.checkpointScheduleFingerprint ===
            assessment.checkpointScheduleFingerprint &&
          reference.mode === entry.mode,
      ),
  );
}

function claimFor(
  items: AssessmentEntry[],
  validated: readonly ValidatedSourceScenario[],
): PracticeEvidenceClaim {
  const ordered = [...items].sort((left, right) =>
    compareOldestFirst(left.entry, right.entry),
  );
  const first = ordered[0];
  const assessed = ordered.filter((item) => item.score !== undefined);
  const latest = assessed.at(-1);
  const scenarioIds = uniqueSorted(
    assessed.map((item) => item.entry.scenarioId),
  );
  const validatedSourceScenarioIds = uniqueSorted(
    assessed
      .filter((item) => isValidatedSourceEntry(item.entry, validated))
      .map((item) => item.entry.scenarioId),
  );
  const dataFidelities = uniqueSorted(
    assessed.flatMap((item) =>
      item.entry.scenarioDataFidelity
        ? [item.entry.scenarioDataFidelity]
        : [],
    ),
  ) as DataFidelity[];
  const evidenceCount = assessed.length;
  return {
    id: claimBaseId(first.assessment),
    competencyId: competencyIdFor(first.assessment),
    rubricVersion: first.assessment.rubricVersion,
    rubricFingerprint: effectiveAssessmentRubricFingerprint(first.assessment),
    drillDefinitions: exactDrillDefinitions(ordered),
    status: evidenceCount > 0 ? "assessed" : "unassessed",
    attemptCount: ordered.length,
    evidenceCount,
    latestRunId: latest?.entry.runId,
    latestScore: latest?.score,
    scenarioIds,
    scenarioCoverage: scenarioIds.length,
    validatedSourceScenarioIds,
    validatedSourceScenarioCoverage: validatedSourceScenarioIds.length,
    sampleEvidenceCount: assessed.filter((item) => item.entry.sampleData).length,
    dataFidelities,
    confidence: evidenceConfidenceFor(
      evidenceCount,
      validatedSourceScenarioIds.length,
    ),
    trend: trendForComparableAssessments(ordered),
  };
}

export function buildEvidenceProfile(
  entries: readonly PracticeLedgerEntry[],
  validatedSourceScenarios: readonly ValidatedSourceScenario[],
  validatedPracticeSchedules?: readonly ValidatedPracticeSchedule[],
): PracticeEvidenceProfile {
  const groups = new Map<string, AssessmentEntry[]>();
  for (const entry of [...entries].sort(compareOldestFirst)) {
    if (!entry.assessment) continue;
    const assessment = entry.assessment;
    const id = claimGroupKey(assessment);
    const group = groups.get(id) ?? [];
    group.push({
      entry,
      assessment,
      score:
        validatedPracticeSchedules === undefined ||
        matchesValidatedPracticeSchedule(entry, validatedPracticeSchedules)
          ? practiceEvidenceScore(entry)
          : undefined,
    });
    groups.set(id, group);
  }
  const groupedClaims = [...groups.values()].map((items) =>
    claimFor(items, validatedSourceScenarios),
  );
  const baseIdCounts = new Map<string, number>();
  for (const claim of groupedClaims) {
    baseIdCounts.set(claim.id, (baseIdCounts.get(claim.id) ?? 0) + 1);
  }
  const claims = groupedClaims
    .map((claim) =>
      baseIdCounts.get(claim.id) === 1
        ? claim
        : {
            ...claim,
            id: `${claim.id}:${claim.rubricFingerprint}`,
          },
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    ledgerEntryCount: entries.length,
    assessedEntryCount: claims.reduce(
      (sum, claim) => sum + claim.evidenceCount,
      0,
    ),
    claims,
  };
}
