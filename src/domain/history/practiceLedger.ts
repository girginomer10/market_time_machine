import {
  MAX_SAVED_RUNS,
  isCompletedRun,
  type CompletedRun,
} from "./runHistory";
import type {
  DataFidelity,
  DrillAssessment,
  DrillAssessmentComponent,
  DrillAssessmentComponentId,
  ScenarioMode,
} from "../../types";
import {
  commitPracticeArchiveEnvelope,
  inspectPracticeArchiveEnvelope,
  LEGACY_PRACTICE_LEDGER_STORAGE_KEY,
  LEGACY_RUN_HISTORY_STORAGE_KEY,
  removeLegacyPracticeArchiveKeysBestEffort,
} from "./practiceArchiveEnvelope";
import {
  assessmentMatchesCheckpointScheduleFingerprint,
  assessmentHasConsistentRubricFingerprint,
  completedAssessmentMatchesAggregateEvidence,
  parseDrillCheckpointScheduleFingerprint,
} from "../practice/drills";
import { assertPracticeArchiveIdentityConsistency } from "./practiceArchive";
import { isBrokerConfigFingerprint } from "../broker/executionModels";

export const PRACTICE_LEDGER_STORAGE_KEY =
  LEGACY_PRACTICE_LEDGER_STORAGE_KEY;
export const PRACTICE_LEDGER_FORMAT = "market-time-machine-practice-ledger";
export const PRACTICE_LEDGER_VERSION = 1;
export const MAX_PRACTICE_LEDGER_ENTRIES = 250;

const SCENARIO_MODES = new Set<ScenarioMode>([
  "explorer",
  "professional",
  "blind",
  "challenge",
]);
const BROKER_MODES = new Set<CompletedRun["brokerMode"]>([
  "scenario",
  "ideal",
  "realistic",
  "harsh",
]);
const DATA_FIDELITIES = new Set<DataFidelity>([
  "observed",
  "derived",
  "synthetic",
  "mixed",
]);
const ASSESSMENT_COMPONENT_IDS = new Set<DrillAssessmentComponentId>([
  "plan_coverage",
  "checkpoint_coverage",
  "event_linkage",
  "rule_adherence",
]);

export type PracticeRunFacts = {
  executionCount: number;
  closedTradeCount: number;
  journalEntryCount: number;
  executedDecisionCount: number;
  linkedDecisionCount: number;
  behavioralFlagCount: number;
  forcedLiquidationCount: number;
  journalCoverage?: number;
  reasonRate?: number;
  riskPlanRate?: number;
  structuredPlanRate?: number;
  eventLinkRate?: number;
};

export type PracticeLedgerEntry = {
  /** Stable compact-record key. New runs use runInstanceId; legacy runs use id. */
  id: string;
  runId: string;
  runInstanceId?: string;
  completedAt: string;
  scenarioId: string;
  scenarioTitle: string;
  scenarioDataVersion?: string;
  scenarioDataFidelity?: DataFidelity;
  sampleData: boolean;
  mode: ScenarioMode;
  brokerMode: CompletedRun["brokerMode"];
  /** Exact execution settings; absent only on legacy evidence. */
  brokerFingerprint?: string;
  facts: PracticeRunFacts;
  /** Absent for legacy and ordinary replay runs; absence is never scored as zero. */
  assessment?: DrillAssessment;
};

type LedgerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): LedgerStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return nonEmptyString(value) ?? null;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

function optionalRate(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return boundedNumber(value, 0, 1) ?? null;
}

function parseAssessmentComponent(
  value: unknown,
): DrillAssessmentComponent | undefined {
  if (!isRecord(value)) return undefined;
  const id = nonEmptyString(value.id) as DrillAssessmentComponentId | undefined;
  const label = nonEmptyString(value.label);
  const evidence = typeof value.evidence === "string" ? value.evidence : undefined;
  const weight = boundedNumber(value.weight, 0, 1);
  const status = value.status;
  const score =
    value.score === undefined ? undefined : boundedNumber(value.score, 0, 100);
  if (
    !id ||
    !ASSESSMENT_COMPONENT_IDS.has(id) ||
    !label ||
    evidence === undefined ||
    weight === undefined ||
    (status !== "assessed" &&
      status !== "not_applicable" &&
      status !== "insufficient_evidence") ||
    (status === "assessed" ? score === undefined : value.score !== undefined)
  ) {
    return undefined;
  }
  return {
    id,
    label,
    weight,
    status,
    score,
    evidence,
  };
}

export function parseDrillAssessment(value: unknown): DrillAssessment | undefined {
  if (!isRecord(value) || !Array.isArray(value.components)) return undefined;
  const drillId = nonEmptyString(value.drillId);
  const competencyId = optionalString(value.competencyId);
  const definitionVersion = nonNegativeInteger(value.definitionVersion);
  const rubricVersion = nonEmptyString(value.rubricVersion);
  const rubricFingerprint = optionalString(value.rubricFingerprint);
  const checkpointScheduleFingerprint = optionalString(
    value.checkpointScheduleFingerprint,
  );
  const eventLinkageEvidenceVersion = value.eventLinkageEvidenceVersion;
  const methodology = typeof value.methodology === "string" ? value.methodology : undefined;
  const overallScore =
    value.overallScore === undefined
      ? undefined
      : boundedNumber(value.overallScore, 0, 100);
  const components = value.components.map(parseAssessmentComponent);
  const counts = [
    value.eligibleCheckpointCount,
    value.answeredCheckpointCount,
    value.skippedCheckpointCount,
    value.eligibleEventCount,
    value.linkedEventCount,
    value.violationCount,
  ].map(nonNegativeInteger);
  if (
    !drillId ||
    competencyId === null ||
    definitionVersion === undefined ||
    definitionVersion < 1 ||
    !rubricVersion ||
    rubricFingerprint === null ||
    checkpointScheduleFingerprint === null ||
    (checkpointScheduleFingerprint !== undefined &&
      !parseDrillCheckpointScheduleFingerprint(
        checkpointScheduleFingerprint,
      )) ||
    (eventLinkageEvidenceVersion !== undefined &&
      eventLinkageEvidenceVersion !== 1) ||
    methodology === undefined ||
    (value.status !== "completed" && value.status !== "incomplete") ||
    (value.overallScore !== undefined && overallScore === undefined) ||
    components.some((component) => component === undefined) ||
    components.length !== ASSESSMENT_COMPONENT_IDS.size ||
    new Set(
      components.map((component) => component?.id),
    ).size !== ASSESSMENT_COMPONENT_IDS.size ||
    counts.some((count) => count === undefined)
  ) {
    return undefined;
  }
  const [
    eligibleCheckpointCount,
    answeredCheckpointCount,
    skippedCheckpointCount,
    eligibleEventCount,
    linkedEventCount,
    violationCount,
  ] = counts as number[];
  const assessedComponents = (components as DrillAssessmentComponent[]).filter(
    (component) =>
      component.status === "assessed" && component.score !== undefined,
  );
  const assessedWeight = assessedComponents.reduce(
    (sum, component) => sum + component.weight,
    0,
  );
  const expectedOverallScore =
    assessedWeight > 0
      ? Math.round(
          (assessedComponents.reduce(
            (sum, component) => sum + (component.score ?? 0) * component.weight,
            0,
          ) /
            assessedWeight) *
            10,
        ) / 10
      : undefined;
  if (
    answeredCheckpointCount + skippedCheckpointCount >
      eligibleCheckpointCount ||
    linkedEventCount > eligibleEventCount ||
    Math.abs(
      (components as DrillAssessmentComponent[]).reduce(
        (sum, component) => sum + component.weight,
        0,
      ) - 1,
    ) > 0.000001 ||
    (value.status === "completed" &&
      (overallScore === undefined ||
        eligibleCheckpointCount <= 0 ||
        eligibleEventCount <= 0 ||
        answeredCheckpointCount !== eligibleCheckpointCount ||
        skippedCheckpointCount !== 0 ||
        (components as DrillAssessmentComponent[]).some(
          (component) =>
            component.status !== "assessed" || component.score === undefined,
        ))) ||
    (overallScore !== undefined &&
      (expectedOverallScore === undefined ||
        Math.abs(overallScore - expectedOverallScore) > 0.11))
  ) {
    return undefined;
  }
  const assessment: DrillAssessment = {
    drillId,
    ...(competencyId ? { competencyId } : {}),
    definitionVersion,
    rubricVersion,
    ...(rubricFingerprint ? { rubricFingerprint } : {}),
    ...(checkpointScheduleFingerprint
      ? { checkpointScheduleFingerprint }
      : {}),
    ...(eventLinkageEvidenceVersion === 1
      ? { eventLinkageEvidenceVersion: 1 as const }
      : {}),
    status: value.status,
    overallScore,
    methodology,
    components: components as DrillAssessmentComponent[],
    eligibleCheckpointCount,
    answeredCheckpointCount,
    skippedCheckpointCount,
    eligibleEventCount,
    linkedEventCount,
    violationCount,
  };
  return assessmentHasConsistentRubricFingerprint(assessment) &&
    (assessment.status !== "completed" ||
      assessment.rubricFingerprint === undefined ||
      completedAssessmentMatchesAggregateEvidence(assessment)) &&
    (!assessment.checkpointScheduleFingerprint ||
      assessmentMatchesCheckpointScheduleFingerprint(assessment))
    ? assessment
    : undefined;
}

function parseFacts(value: unknown): PracticeRunFacts | undefined {
  if (!isRecord(value)) return undefined;
  const counts = [
    value.executionCount,
    value.closedTradeCount,
    value.journalEntryCount,
    value.executedDecisionCount,
    value.linkedDecisionCount,
    value.behavioralFlagCount,
    value.forcedLiquidationCount,
  ].map(nonNegativeInteger);
  const rates = [
    value.journalCoverage,
    value.reasonRate,
    value.riskPlanRate,
    value.structuredPlanRate,
    value.eventLinkRate,
  ].map(optionalRate);
  if (
    counts.some((count) => count === undefined) ||
    rates.some((rate) => rate === null)
  ) {
    return undefined;
  }
  const [
    executionCount,
    closedTradeCount,
    journalEntryCount,
    executedDecisionCount,
    linkedDecisionCount,
    behavioralFlagCount,
    forcedLiquidationCount,
  ] = counts as number[];
  const [
    journalCoverage,
    reasonRate,
    riskPlanRate,
    structuredPlanRate,
    eventLinkRate,
  ] = rates as Array<number | undefined>;
  if (linkedDecisionCount > executedDecisionCount) return undefined;
  return {
    executionCount,
    closedTradeCount,
    journalEntryCount,
    executedDecisionCount,
    linkedDecisionCount,
    behavioralFlagCount,
    forcedLiquidationCount,
    journalCoverage,
    reasonRate,
    riskPlanRate,
    structuredPlanRate,
    eventLinkRate,
  };
}

export function parsePracticeLedgerEntry(
  value: unknown,
  options: { rejectMalformedAssessment?: boolean } = {},
): PracticeLedgerEntry | undefined {
  if (!isRecord(value)) return undefined;
  const id = nonEmptyString(value.id);
  const runId = nonEmptyString(value.runId);
  const runInstanceId = optionalString(value.runInstanceId);
  const completedAt = nonEmptyString(value.completedAt);
  const scenarioId = nonEmptyString(value.scenarioId);
  const scenarioTitle = nonEmptyString(value.scenarioTitle);
  const scenarioDataVersion = optionalString(value.scenarioDataVersion);
  const brokerFingerprint =
    value.brokerFingerprint === undefined
      ? undefined
      : isBrokerConfigFingerprint(value.brokerFingerprint)
        ? value.brokerFingerprint
        : null;
  const facts = parseFacts(value.facts);
  const parsedAssessment =
    value.assessment === undefined
      ? undefined
      : parseDrillAssessment(value.assessment);
  const inconsistentCompletedAssessment = Boolean(
    parsedAssessment?.status === "completed" &&
      facts &&
      facts.executionCount <= 0,
  );
  const assessment = inconsistentCompletedAssessment
    ? undefined
    : parsedAssessment;
  if (
    !id ||
    !runId ||
    runInstanceId === null ||
    !completedAt ||
    !Number.isFinite(Date.parse(completedAt)) ||
    !scenarioId ||
    !scenarioTitle ||
    scenarioDataVersion === null ||
    brokerFingerprint === null ||
    typeof value.sampleData !== "boolean" ||
    !SCENARIO_MODES.has(value.mode as ScenarioMode) ||
    !BROKER_MODES.has(value.brokerMode as CompletedRun["brokerMode"]) ||
    (value.scenarioDataFidelity !== undefined &&
      !DATA_FIDELITIES.has(value.scenarioDataFidelity as DataFidelity)) ||
    !facts ||
    (options.rejectMalformedAssessment &&
      value.assessment !== undefined &&
      (parsedAssessment === undefined || inconsistentCompletedAssessment))
  ) {
    return undefined;
  }
  return {
    id,
    runId,
    runInstanceId: runInstanceId ?? undefined,
    completedAt,
    scenarioId,
    scenarioTitle,
    scenarioDataVersion: scenarioDataVersion ?? undefined,
    scenarioDataFidelity: value.scenarioDataFidelity as
      | DataFidelity
      | undefined,
    sampleData: value.sampleData,
    mode: value.mode as ScenarioMode,
    brokerMode: value.brokerMode as CompletedRun["brokerMode"],
    brokerFingerprint,
    facts,
    // A malformed or foreign assessment is discarded without losing factual
    // legacy evidence. Unknown fields, including raw text, are never copied.
    assessment,
  };
}

function compareNewestFirst(
  left: PracticeLedgerEntry,
  right: PracticeLedgerEntry,
): number {
  return (
    Date.parse(right.completedAt) - Date.parse(left.completedAt) ||
    left.id.localeCompare(right.id)
  );
}

export function normalizePracticeLedgerEntries(
  entries: readonly PracticeLedgerEntry[],
): PracticeLedgerEntry[] {
  const byId = new Map<string, PracticeLedgerEntry>();
  for (const candidate of entries) {
    const entry = parsePracticeLedgerEntry(candidate);
    if (!entry) continue;
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      continue;
    }
    const preferred =
      entry.assessment && !existing.assessment
        ? entry
        : existing.assessment && !entry.assessment
          ? existing
          : compareNewestFirst(entry, existing) <= 0
            ? entry
            : existing;
    byId.set(entry.id, preferred);
  }
  const retained: PracticeLedgerEntry[] = [];
  const identities = new Set<string>();
  for (const entry of [...byId.values()].sort(compareNewestFirst)) {
    const aliases = [entry.id, entry.runId, entry.runInstanceId].filter(
      (identity): identity is string => Boolean(identity),
    );
    if (aliases.some((identity) => identities.has(identity))) continue;
    retained.push(entry);
    aliases.forEach((identity) => identities.add(identity));
    if (retained.length === MAX_PRACTICE_LEDGER_ENTRIES) break;
  }
  return retained;
}

export function derivePracticeLedgerEntry(
  run: CompletedRun,
  assessment?: DrillAssessment,
): PracticeLedgerEntry {
  const practiceAssessment = assessment ?? run.report.practiceAssessment;
  const quality = run.report.journalQuality;
  const executionCount = Math.max(0, run.executionCount);
  const fillDecisionCount = new Set(
    run.report.fills?.map((fill) => fill.orderId) ?? [],
  ).size;
  const forcedLiquidationCount =
    run.report.executionQuality?.forcedLiquidationCount ??
    run.report.fills?.filter((fill) => fill.forcedLiquidation).length ??
    0;
  return {
    id: run.runInstanceId ?? run.id,
    runId: run.id,
    runInstanceId: run.runInstanceId,
    completedAt: run.completedAt,
    scenarioId: run.scenarioId,
    scenarioTitle: run.scenarioTitle,
    scenarioDataVersion: run.report.provenance?.dataVersion,
    scenarioDataFidelity: run.report.provenance?.dataFidelity,
    sampleData: run.sampleData,
    mode: run.mode,
    brokerMode: run.brokerMode,
    brokerFingerprint: run.brokerFingerprint,
    facts: {
      executionCount,
      closedTradeCount: Math.max(0, run.closedTradeCount),
      journalEntryCount: Math.max(0, run.journalEntryCount),
      executedDecisionCount:
        quality?.executedDecisionCount ?? fillDecisionCount,
      linkedDecisionCount: quality?.linkedEntryCount ?? 0,
      behavioralFlagCount: run.report.behavioralFlags.length,
      forcedLiquidationCount,
      journalCoverage: run.journalCoverage ?? quality?.coverageRate,
      reasonRate: quality?.reasonRate,
      riskPlanRate: quality?.riskPlanRate,
      structuredPlanRate: quality?.structuredPlanRate,
      eventLinkRate: quality?.eventLinkRate,
    },
    assessment: practiceAssessment
      ? parseDrillAssessment(practiceAssessment)
      : undefined,
  };
}

export function loadPracticeLedger(
  storage: LedgerStorage | undefined = browserStorage(),
): PracticeLedgerEntry[] {
  if (!storage) return [];
  try {
    const canonicalState = inspectPracticeArchiveEnvelope(storage);
    if (canonicalState.status === "malformed") return [];
    if (canonicalState.status === "valid") {
      const canonical = canonicalState.envelope;
      if (
        canonical.ledger.length > MAX_PRACTICE_LEDGER_ENTRIES ||
        canonical.runs.length > MAX_SAVED_RUNS ||
        !canonical.runs.every(isCompletedRun) ||
        new Set(canonical.runs.map((run) => (run as CompletedRun).id)).size !==
          canonical.runs.length
      ) {
        return [];
      }
      const parsedEntries = canonical.ledger.map((entry) =>
        parsePracticeLedgerEntry(entry, { rejectMalformedAssessment: true }),
      );
      if (
        parsedEntries.some((entry) => entry === undefined) ||
        new Set(parsedEntries.map((entry) => entry?.id)).size !==
          parsedEntries.length
      ) {
        return [];
      }
      const entries = parsedEntries as PracticeLedgerEntry[];
      assertPracticeArchiveIdentityConsistency(
        canonical.runs as CompletedRun[],
        entries,
        "Canonical practice archive",
      );
      return normalizePracticeLedgerEntries(entries);
    }
    const serialized = storage.getItem(PRACTICE_LEDGER_STORAGE_KEY);
    if (!serialized) return [];
    const parsed: unknown = JSON.parse(serialized);
    if (
      !isRecord(parsed) ||
      parsed.format !== PRACTICE_LEDGER_FORMAT ||
      parsed.version !== PRACTICE_LEDGER_VERSION ||
      !Array.isArray(parsed.entries)
    ) {
      return [];
    }
    return normalizePracticeLedgerEntries(
      parsed.entries.flatMap((entry) => {
        const sanitized = parsePracticeLedgerEntry(entry);
        return sanitized ? [sanitized] : [];
      }),
    );
  } catch {
    return [];
  }
}

function storedRunCandidates(storage: LedgerStorage): unknown[] {
  const canonicalState = inspectPracticeArchiveEnvelope(storage);
  if (canonicalState.status === "malformed") {
    throw new Error("Canonical practice archive is malformed.");
  }
  if (canonicalState.status === "valid") {
    const canonical = canonicalState.envelope;
    const parsedLedger = canonical.ledger.map((entry) =>
      parsePracticeLedgerEntry(entry, { rejectMalformedAssessment: true }),
    );
    if (
      canonical.runs.length > MAX_SAVED_RUNS ||
      !canonical.runs.every(isCompletedRun) ||
      new Set(canonical.runs.map((run) => (run as CompletedRun).id)).size !==
        canonical.runs.length ||
      canonical.ledger.length > MAX_PRACTICE_LEDGER_ENTRIES ||
      parsedLedger.some((entry) => entry === undefined) ||
      new Set(parsedLedger.map((entry) => entry?.id)).size !==
        parsedLedger.length
    ) {
      throw new Error("Canonical practice archive is malformed.");
    }
    assertPracticeArchiveIdentityConsistency(
      canonical.runs as CompletedRun[],
      parsedLedger as PracticeLedgerEntry[],
      "Canonical practice archive",
    );
    return canonical.runs;
  }
  const serialized = storage.getItem(LEGACY_RUN_HISTORY_STORAGE_KEY);
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .filter(isCompletedRun)
      .filter((run) => {
        if (seen.has(run.id)) return false;
        seen.add(run.id);
        return true;
      })
      .slice(0, MAX_SAVED_RUNS);
  } catch {
    return [];
  }
}

export function persistPracticeLedger(
  entries: readonly PracticeLedgerEntry[],
  storage: LedgerStorage | undefined = browserStorage(),
): PracticeLedgerEntry[] {
  if (!storage) return normalizePracticeLedgerEntries(entries);
  const fallback = loadPracticeLedger(storage);
  const parsedEntries = entries.map((entry) =>
    parsePracticeLedgerEntry(entry, { rejectMalformedAssessment: true }),
  );
  if (parsedEntries.some((entry) => entry === undefined)) return fallback;
  const strictEntries = parsedEntries as PracticeLedgerEntry[];
  try {
    assertPracticeArchiveIdentityConsistency(
      [],
      strictEntries,
      "Practice ledger write",
    );
  } catch {
    return fallback;
  }
  const retained = normalizePracticeLedgerEntries(strictEntries);
  let runs: unknown[];
  try {
    runs = storedRunCandidates(storage);
  } catch {
    return fallback;
  }
  let candidate = retained;
  const clearing = candidate.length === 0;
  try {
    assertPracticeArchiveIdentityConsistency(
      runs as CompletedRun[],
      candidate,
      "Practice archive write",
    );
  } catch {
    return fallback;
  }
  while (candidate.length > 0) {
    try {
      commitPracticeArchiveEnvelope(storage, { runs, ledger: candidate });
      removeLegacyPracticeArchiveKeysBestEffort(storage, [
        LEGACY_RUN_HISTORY_STORAGE_KEY,
        PRACTICE_LEDGER_STORAGE_KEY,
      ]);
      return candidate;
    } catch {
      candidate = candidate.slice(0, -1);
    }
  }
  if (!clearing) return fallback;
  try {
    commitPracticeArchiveEnvelope(storage, { runs, ledger: [] });
    removeLegacyPracticeArchiveKeysBestEffort(storage, [
      LEGACY_RUN_HISTORY_STORAGE_KEY,
      PRACTICE_LEDGER_STORAGE_KEY,
    ]);
    return [];
  } catch {
    return fallback;
  }
}

export function reconcilePracticeLedger(
  entries: readonly PracticeLedgerEntry[],
  legacyRuns: readonly CompletedRun[],
): PracticeLedgerEntry[] {
  const existing = normalizePracticeLedgerEntries(entries);
  const knownIds = new Set(
    existing.flatMap((entry) => [
      entry.id,
      entry.runId,
      ...(entry.runInstanceId ? [entry.runInstanceId] : []),
    ]),
  );
  const additions = legacyRuns.flatMap((run) => {
    const entry = derivePracticeLedgerEntry(run);
    const identities = [
      entry.id,
      entry.runId,
      ...(entry.runInstanceId ? [entry.runInstanceId] : []),
    ];
    if (identities.some((id) => knownIds.has(id))) return [];
    identities.forEach((id) => knownIds.add(id));
    return [entry];
  });
  return normalizePracticeLedgerEntries([...existing, ...additions]);
}

export function upsertPracticeLedgerEntry(
  entry: PracticeLedgerEntry,
  storage: LedgerStorage | undefined = browserStorage(),
): PracticeLedgerEntry[] {
  const incoming = parsePracticeLedgerEntry(entry);
  if (!incoming) return loadPracticeLedger(storage);
  const existing = loadPracticeLedger(storage);
  const previous = existing.find((candidate) => candidate.id === incoming.id);
  const merged = previous
    ? {
        ...incoming,
        assessment: incoming.assessment ?? previous.assessment,
      }
    : incoming;
  return persistPracticeLedger(
    [merged, ...existing.filter((candidate) => candidate.id !== incoming.id)],
    storage,
  );
}

export function recordPracticeLedgerEntry(
  run: CompletedRun,
  assessment?: DrillAssessment,
  storage: LedgerStorage | undefined = browserStorage(),
): PracticeLedgerEntry[] {
  return upsertPracticeLedgerEntry(
    derivePracticeLedgerEntry(run, assessment),
    storage,
  );
}

export function removePracticeLedgerEntry(
  runId: string,
  storage: LedgerStorage | undefined = browserStorage(),
): PracticeLedgerEntry[] {
  return persistPracticeLedger(
    loadPracticeLedger(storage).filter(
      (entry) =>
        entry.id !== runId &&
        entry.runId !== runId &&
        entry.runInstanceId !== runId,
    ),
    storage,
  );
}

export function clearPracticeLedger(
  storage: LedgerStorage | undefined = browserStorage(),
): void {
  if (storage) persistPracticeLedger([], storage);
}
