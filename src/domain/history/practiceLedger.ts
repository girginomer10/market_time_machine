import type { CompletedRun } from "./runHistory";
import type {
  DataFidelity,
  DrillAssessment,
  DrillAssessmentComponent,
  DrillAssessmentComponentId,
  ScenarioMode,
} from "../../types";

export const PRACTICE_LEDGER_STORAGE_KEY =
  "market-time-machine.practice-ledger.v1";
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
  facts: PracticeRunFacts;
  /** Absent for legacy and ordinary replay runs; absence is never scored as zero. */
  assessment?: DrillAssessment;
};

type LedgerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type PracticeLedgerDocument = {
  format: typeof PRACTICE_LEDGER_FORMAT;
  version: typeof PRACTICE_LEDGER_VERSION;
  entries: PracticeLedgerEntry[];
};

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
        answeredCheckpointCount !== eligibleCheckpointCount ||
        skippedCheckpointCount !== 0 ||
        linkedEventCount !== eligibleEventCount)) ||
    (overallScore !== undefined &&
      (expectedOverallScore === undefined ||
        Math.abs(overallScore - expectedOverallScore) > 0.11))
  ) {
    return undefined;
  }
  return {
    drillId,
    ...(competencyId ? { competencyId } : {}),
    definitionVersion,
    rubricVersion,
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
  const facts = parseFacts(value.facts);
  const assessment =
    value.assessment === undefined
      ? undefined
      : parseDrillAssessment(value.assessment);
  if (
    !id ||
    !runId ||
    runInstanceId === null ||
    !completedAt ||
    !Number.isFinite(Date.parse(completedAt)) ||
    !scenarioId ||
    !scenarioTitle ||
    scenarioDataVersion === null ||
    typeof value.sampleData !== "boolean" ||
    !SCENARIO_MODES.has(value.mode as ScenarioMode) ||
    !BROKER_MODES.has(value.brokerMode as CompletedRun["brokerMode"]) ||
    (value.scenarioDataFidelity !== undefined &&
      !DATA_FIDELITIES.has(value.scenarioDataFidelity as DataFidelity)) ||
    !facts ||
    (options.rejectMalformedAssessment &&
      value.assessment !== undefined &&
      assessment === undefined)
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
  return [...byId.values()]
    .sort(compareNewestFirst)
    .slice(0, MAX_PRACTICE_LEDGER_ENTRIES);
}

function documentFor(entries: PracticeLedgerEntry[]): PracticeLedgerDocument {
  return {
    format: PRACTICE_LEDGER_FORMAT,
    version: PRACTICE_LEDGER_VERSION,
    entries,
  };
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

export function persistPracticeLedger(
  entries: readonly PracticeLedgerEntry[],
  storage: LedgerStorage | undefined = browserStorage(),
): PracticeLedgerEntry[] {
  const retained = normalizePracticeLedgerEntries(entries);
  if (!storage) return retained;
  if (retained.length === 0) {
    try {
      storage.removeItem(PRACTICE_LEDGER_STORAGE_KEY);
    } catch {
      // Clearing is best effort when browser storage is unavailable.
    }
    return [];
  }
  const fallback = loadPracticeLedger(storage);
  let candidate = retained;
  while (candidate.length > 0) {
    try {
      storage.setItem(
        PRACTICE_LEDGER_STORAGE_KEY,
        JSON.stringify(documentFor(candidate)),
      );
      return candidate;
    } catch {
      candidate = candidate.slice(0, -1);
    }
  }
  return fallback;
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
  try {
    storage?.removeItem(PRACTICE_LEDGER_STORAGE_KEY);
  } catch {
    // Clearing is best effort in privacy-restricted browsers.
  }
}
