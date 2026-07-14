import type { PracticeLedgerEntry } from "../history/practiceLedger";
import type { DataFidelity, DrillAssessment } from "../../types";

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

function competencyIdFor(assessment: DrillAssessment): string {
  return assessment.competencyId?.trim() || assessment.drillId;
}

function claimId(assessment: DrillAssessment): string {
  return [competencyIdFor(assessment), assessment.rubricVersion].join(":");
}

function comparableContextKey(item: AssessmentEntry): string {
  const { entry, assessment } = item;
  return JSON.stringify([
    entry.scenarioId,
    entry.scenarioDataVersion ?? null,
    assessment.drillId,
    assessment.definitionVersion,
    assessment.rubricVersion,
    entry.mode,
    entry.brokerMode,
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
  const dataVersion = entry.scenarioDataVersion ?? null;
  return validated.some(
    (reference) =>
      reference.scenarioId === entry.scenarioId &&
      reference.dataVersion === dataVersion,
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
    id: claimId(first.assessment),
    competencyId: competencyIdFor(first.assessment),
    rubricVersion: first.assessment.rubricVersion,
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
): PracticeEvidenceProfile {
  const groups = new Map<string, AssessmentEntry[]>();
  for (const entry of [...entries].sort(compareOldestFirst)) {
    if (!entry.assessment) continue;
    const assessment = entry.assessment;
    const id = claimId(assessment);
    const group = groups.get(id) ?? [];
    group.push({
      entry,
      assessment,
      score:
        assessment.status === "completed" &&
        entry.facts.executionCount > 0 &&
        assessment.components.every(
          (component) =>
            component.status === "assessed" && component.score !== undefined,
        )
          ? finiteScore(assessment.overallScore)
          : undefined,
    });
    groups.set(id, group);
  }
  const claims = [...groups.values()]
    .map((items) => claimFor(items, validatedSourceScenarios))
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
