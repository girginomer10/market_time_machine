import {
  MAX_PRACTICE_LEDGER_ENTRIES,
  derivePracticeLedgerEntry,
  parsePracticeLedgerEntry,
  type PracticeLedgerEntry,
} from "./practiceLedger";
import {
  MAX_SAVED_RUNS,
  isCompletedRun,
  type CompletedRun,
} from "./runHistory";
import { getScenario } from "../../data/scenarios";
import {
  getBuiltInDrill,
  getDrillForScenario,
} from "../../data/practice/drills";
import { scenarioDataVersionsEqual } from "../../data/scenarios/dataVersions";
import { buildDrillCheckpointSchedule } from "../practice/drills";

export const PRACTICE_ARCHIVE_FORMAT =
  "market-time-machine-practice-archive";
export const PRACTICE_ARCHIVE_VERSION = 2;
export const LEGACY_RUN_HISTORY_FORMAT = "market-time-machine-run-history";
export const LEGACY_RUN_HISTORY_VERSION = 1;

export type PracticeArchive = {
  format: typeof PRACTICE_ARCHIVE_FORMAT;
  version: typeof PRACTICE_ARCHIVE_VERSION;
  exportedAt: string;
  runs: CompletedRun[];
  ledger: PracticeLedgerEntry[];
};

export type PracticeArchiveMergeConflict = {
  collection: "runs" | "ledger";
  id: string;
};

export type PracticeArchiveMergeResult = {
  runs: CompletedRun[];
  ledger: PracticeLedgerEntry[];
  addedRunIds: string[];
  addedLedgerIds: string[];
  conflicts: PracticeArchiveMergeConflict[];
  conflictCount: number;
};

type ArchiveData = Pick<PracticeArchive, "runs" | "ledger">;

export class PracticeArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PracticeArchiveError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function compareRunsNewestFirst(left: CompletedRun, right: CompletedRun): number {
  return (
    Date.parse(right.completedAt) - Date.parse(left.completedAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareLedgerNewestFirst(
  left: PracticeLedgerEntry,
  right: PracticeLedgerEntry,
): number {
  return (
    Date.parse(right.completedAt) - Date.parse(left.completedAt) ||
    left.id.localeCompare(right.id)
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child !== undefined) result[key] = canonicalize(child);
  }
  return result;
}

function sameContent(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

/**
 * A current or explicitly reviewed built-in replay contract is authoritative.
 * Self-consistent imported JSON may retain historical/custom evidence, but it
 * cannot redefine a known drill's checkpoint schedule or display-only events.
 */
function practiceSnapshotMatchesAuthoritativeCatalog(run: CompletedRun): boolean {
  const snapshot = run.report.practiceDrill;
  if (!snapshot) return true;
  const scenario = getScenario(run.scenarioId);
  const reservedBuiltIn = getBuiltInDrill(snapshot.definition.id);
  if (!scenario) return reservedBuiltIn === undefined;
  if (
    !scenarioDataVersionsEqual(
      run.scenarioId,
      run.report.provenance?.dataVersion,
      scenario.meta.dataVersion,
    )
  ) {
    // Unknown historical versions remain readable but are not eligible for
    // current evidence or track credit elsewhere in the product.
    return true;
  }
  const definition = getDrillForScenario(snapshot.definition.id, scenario);
  if (!definition) return reservedBuiltIn === undefined;
  if (!sameContent(snapshot.definition, definition)) return false;

  const eventById = new Map(scenario.events.map((event) => [event.id, event]));
  const expected = buildDrillCheckpointSchedule(definition, scenario);
  if (snapshot.checkpoints.length !== expected.length) return false;
  return expected.every((checkpoint, index) => {
    const retained = snapshot.checkpoints[index];
    if (!retained || !sameContent(retained.checkpoint, checkpoint)) return false;
    const expectedEvents = checkpoint.eventIds.flatMap((eventId) => {
      const event = eventById.get(eventId);
      return event
        ? [
            {
              id: event.id,
              publishedAt: event.publishedAt,
              title: event.title,
              type: event.type,
              importance: event.importance,
              source: event.source,
            },
          ]
        : [];
    });
    return sameContent(retained.events, expectedEvents);
  });
}

function runIdentityAliases(run: CompletedRun): string[] {
  return [...new Set([run.id, run.runInstanceId].filter(Boolean) as string[])];
}

function ledgerIdentityAliases(entry: PracticeLedgerEntry): string[] {
  return [
    ...new Set(
      [entry.id, entry.runId, entry.runInstanceId].filter(Boolean) as string[],
    ),
  ];
}

function identitiesOverlap(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const rightSet = new Set(right);
  return left.some((identity) => rightSet.has(identity));
}

function runsShareIdentity(left: CompletedRun, right: CompletedRun): boolean {
  return identitiesOverlap(runIdentityAliases(left), runIdentityAliases(right));
}

function normalizeRunsStrict(
  candidates: readonly unknown[],
  context: string,
): CompletedRun[] {
  const byId = new Map<string, CompletedRun>();
  for (const candidate of candidates) {
    if (!isCompletedRun(candidate)) {
      throw new PracticeArchiveError(`${context} contains a malformed run.`);
    }
    if (!practiceSnapshotMatchesAuthoritativeCatalog(candidate)) {
      throw new PracticeArchiveError(
        `${context} contains a run whose drill schedule does not match the authoritative scenario.`,
      );
    }
    const existing = byId.get(candidate.id);
    if (existing && !sameContent(existing, candidate)) {
      throw new PracticeArchiveError(
        `${context} contains conflicting runs with id "${candidate.id}".`,
      );
    }
    if (!existing) byId.set(candidate.id, candidate);
  }
  const runs = [...byId.values()];
  assertPracticeArchiveIdentityConsistency(runs, [], context);
  return runs
    .sort(compareRunsNewestFirst)
    .slice(0, MAX_SAVED_RUNS);
}

function normalizeLedgerStrict(
  candidates: readonly unknown[],
  context: string,
): PracticeLedgerEntry[] {
  const byId = new Map<string, PracticeLedgerEntry>();
  for (const candidate of candidates) {
    const sanitized = parsePracticeLedgerEntry(candidate, {
      rejectMalformedAssessment: true,
    });
    if (!sanitized) {
      throw new PracticeArchiveError(
        `${context} contains a malformed ledger entry.`,
      );
    }
    const existing = byId.get(sanitized.id);
    if (existing && !sameContent(existing, sanitized)) {
      throw new PracticeArchiveError(
        `${context} contains conflicting ledger entries with id "${sanitized.id}".`,
      );
    }
    if (!existing) byId.set(sanitized.id, sanitized);
  }
  const entries = [...byId.values()];
  assertPracticeArchiveIdentityConsistency([], entries, context);
  return entries
    .sort(compareLedgerNewestFirst)
    .slice(0, MAX_PRACTICE_LEDGER_ENTRIES);
}

function unassessedLedgerEntry(run: CompletedRun): PracticeLedgerEntry {
  const { practiceAssessment: _practiceAssessment, ...report } = run.report;
  return derivePracticeLedgerEntry({ ...run, report });
}

function ledgerEntryMatchesRun(
  entry: PracticeLedgerEntry,
  run: CompletedRun,
): boolean {
  return (
    sameContent(
      entry,
      derivePracticeLedgerEntry(run, run.report.practiceAssessment),
    ) || sameContent(entry, unassessedLedgerEntry(run))
  );
}

function ledgerEntryReferencesRun(
  entry: PracticeLedgerEntry,
  run: CompletedRun,
): boolean {
  return identitiesOverlap(
    ledgerIdentityAliases(entry),
    runIdentityAliases(run),
  );
}

export function assertPracticeArchiveIdentityConsistency(
  runs: readonly CompletedRun[],
  ledger: readonly PracticeLedgerEntry[],
  context = "Practice archive",
): void {
  const runOwners = new Map<string, number>();
  for (const [runIndex, run] of runs.entries()) {
    for (const identity of runIdentityAliases(run)) {
      const owner = runOwners.get(identity);
      if (owner !== undefined && owner !== runIndex) {
        throw new PracticeArchiveError(
          `${context} contains conflicting runs with identity "${identity}".`,
        );
      }
      runOwners.set(identity, runIndex);
    }
  }

  const ledgerOwners = new Map<string, number>();
  for (const [entryIndex, entry] of ledger.entries()) {
    for (const identity of ledgerIdentityAliases(entry)) {
      const owner = ledgerOwners.get(identity);
      if (owner !== undefined && owner !== entryIndex) {
        throw new PracticeArchiveError(
          `${context} contains conflicting ledger entries with replay identity "${identity}".`,
        );
      }
      ledgerOwners.set(identity, entryIndex);
    }
  }

  for (const entry of ledger) {
    const referencedRuns = runs.filter((run) =>
      ledgerEntryReferencesRun(entry, run),
    );
    if (
      referencedRuns.length > 1 ||
      (referencedRuns.length === 1 &&
        !ledgerEntryMatchesRun(entry, referencedRuns[0]))
    ) {
      throw new PracticeArchiveError(
        `${context} ledger entry "${entry.id}" conflicts with its full run identity.`,
      );
    }
  }
}

function archiveDocument(
  runs: readonly CompletedRun[],
  ledger: readonly PracticeLedgerEntry[],
  exportedAt: string,
): PracticeArchive {
  if (!isValidTimestamp(exportedAt)) {
    throw new PracticeArchiveError("Archive export timestamp is invalid.");
  }
  const normalizedRuns = normalizeRunsStrict(runs, "Practice archive");
  const normalizedLedger = normalizeLedgerStrict(ledger, "Practice archive");
  assertPracticeArchiveIdentityConsistency(normalizedRuns, normalizedLedger);

  return {
    format: PRACTICE_ARCHIVE_FORMAT,
    version: PRACTICE_ARCHIVE_VERSION,
    exportedAt,
    runs: normalizedRuns,
    ledger: normalizedLedger,
  };
}

export function exportPracticeArchive(
  runs: readonly CompletedRun[],
  ledger: readonly PracticeLedgerEntry[],
  exportedAt = new Date().toISOString(),
): string {
  return JSON.stringify(archiveDocument(runs, ledger, exportedAt), null, 2);
}

export function parsePracticeArchive(serialized: string): PracticeArchive {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new PracticeArchiveError("Archive is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new PracticeArchiveError("Archive root must be an object.");
  }
  if (!isValidTimestamp(parsed.exportedAt)) {
    throw new PracticeArchiveError("Archive export timestamp is invalid.");
  }
  if (!Array.isArray(parsed.runs)) {
    throw new PracticeArchiveError("Archive runs must be an array.");
  }

  if (
    parsed.format === PRACTICE_ARCHIVE_FORMAT &&
    parsed.version === PRACTICE_ARCHIVE_VERSION
  ) {
    if (!Array.isArray(parsed.ledger)) {
      throw new PracticeArchiveError("Archive ledger must be an array.");
    }
    return archiveDocument(parsed.runs, parsed.ledger, parsed.exportedAt);
  }

  if (
    parsed.format === LEGACY_RUN_HISTORY_FORMAT &&
    parsed.version === LEGACY_RUN_HISTORY_VERSION
  ) {
    const runs = normalizeRunsStrict(parsed.runs, "Legacy run history");
    return {
      format: PRACTICE_ARCHIVE_FORMAT,
      version: PRACTICE_ARCHIVE_VERSION,
      exportedAt: parsed.exportedAt,
      runs,
      ledger: normalizeLedgerStrict(
        runs.map(unassessedLedgerEntry),
        "Migrated legacy run history",
      ),
    };
  }

  throw new PracticeArchiveError("Archive format or version is unsupported.");
}

function mergeRuns(
  current: readonly CompletedRun[],
  incoming: readonly CompletedRun[],
): {
  entries: CompletedRun[];
  addedIds: string[];
  conflicts: PracticeArchiveMergeConflict[];
} {
  const normalizedCurrent = normalizeRunsStrict(current, "Current archive");
  const normalizedIncoming = normalizeRunsStrict(incoming, "Imported archive");
  const currentIds = new Set(normalizedCurrent.map((entry) => entry.id));
  const byId = new Map(normalizedCurrent.map((entry) => [entry.id, entry]));
  const retained = [...normalizedCurrent];
  const conflicts: PracticeArchiveMergeConflict[] = [];

  for (const entry of normalizedIncoming) {
    const existing = retained.find((run) => runsShareIdentity(run, entry));
    if (!existing) {
      byId.set(entry.id, entry);
      retained.push(entry);
    } else if (!sameContent(existing, entry)) {
      conflicts.push({ collection: "runs", id: entry.id });
    }
  }

  const entries = [...byId.values()]
    .sort(compareRunsNewestFirst)
    .slice(0, MAX_SAVED_RUNS);
  return {
    entries,
    addedIds: entries
      .filter((entry) => !currentIds.has(entry.id))
      .map((entry) => entry.id),
    conflicts,
  };
}

function mergeLedger(
  current: readonly PracticeLedgerEntry[],
  incoming: readonly PracticeLedgerEntry[],
): {
  entries: PracticeLedgerEntry[];
  addedIds: string[];
  conflicts: PracticeArchiveMergeConflict[];
} {
  const normalizedCurrent = normalizeLedgerStrict(current, "Current archive");
  const normalizedIncoming = normalizeLedgerStrict(
    incoming,
    "Imported archive",
  );
  const currentIds = new Set(normalizedCurrent.map((entry) => entry.id));
  const byId = new Map(normalizedCurrent.map((entry) => [entry.id, entry]));
  const retained = [...normalizedCurrent];
  const conflicts: PracticeArchiveMergeConflict[] = [];

  for (const entry of normalizedIncoming) {
    const existing = retained.find((candidate) =>
      identitiesOverlap(
        ledgerIdentityAliases(candidate),
        ledgerIdentityAliases(entry),
      ),
    );
    if (!existing) {
      byId.set(entry.id, entry);
      retained.push(entry);
    } else if (!sameContent(existing, entry)) {
      conflicts.push({ collection: "ledger", id: entry.id });
    }
  }

  const entries = [...byId.values()].sort(compareLedgerNewestFirst);
  return {
    entries,
    addedIds: entries
      .filter((entry) => !currentIds.has(entry.id))
      .map((entry) => entry.id),
    conflicts,
  };
}

export function mergePracticeArchive(
  current: ArchiveData,
  incoming: ArchiveData,
): PracticeArchiveMergeResult {
  const normalizedCurrentRuns = normalizeRunsStrict(
    current.runs,
    "Current archive",
  );
  const normalizedCurrentLedger = normalizeLedgerStrict(
    current.ledger,
    "Current archive",
  );
  assertPracticeArchiveIdentityConsistency(
    normalizedCurrentRuns,
    normalizedCurrentLedger,
    "Current archive",
  );
  const normalizedIncomingRuns = normalizeRunsStrict(
    incoming.runs,
    "Imported archive",
  );
  const normalizedIncomingLedger = normalizeLedgerStrict(
    incoming.ledger,
    "Imported archive",
  );
  const currentRunIds = new Set(normalizedCurrentRuns.map((run) => run.id));
  const incompatibleIncomingRunIds = new Set<string>();
  const eligibleIncomingRuns = normalizedIncomingRuns.filter((run) => {
    if (currentRunIds.has(run.id)) return true;
    const retainedEvidence = normalizedCurrentLedger.filter((entry) =>
      ledgerEntryReferencesRun(entry, run),
    );
    if (
      retainedEvidence.length === 0 ||
      retainedEvidence.every((entry) => ledgerEntryMatchesRun(entry, run))
    ) {
      return true;
    }
    incompatibleIncomingRunIds.add(run.id);
    return false;
  });
  const runs = mergeRuns(normalizedCurrentRuns, eligibleIncomingRuns);
  const ledger = mergeLedger(normalizedCurrentLedger, normalizedIncomingLedger);
  const crossLayerConflicts: PracticeArchiveMergeConflict[] = [];
  const ledgerEntries = ledger.entries
    .filter((entry) => {
      const referencedRuns = runs.entries.filter((run) =>
        ledgerEntryReferencesRun(entry, run),
      );
      if (
        referencedRuns.length === 0 ||
        (referencedRuns.length === 1 &&
          ledgerEntryMatchesRun(entry, referencedRuns[0]))
      ) {
        return true;
      }
      crossLayerConflicts.push({ collection: "ledger", id: entry.id });
      return false;
    })
    .sort(compareLedgerNewestFirst)
    .slice(0, MAX_PRACTICE_LEDGER_ENTRIES);
  const retainedLedgerIds = new Set(ledgerEntries.map((entry) => entry.id));
  const conflictsByIdentity = new Map<string, PracticeArchiveMergeConflict>();
  for (const conflict of [
    ...runs.conflicts,
    ...ledger.conflicts,
    ...crossLayerConflicts,
    ...[...incompatibleIncomingRunIds].map((id) => ({
      collection: "runs" as const,
      id,
    })),
  ]) {
    conflictsByIdentity.set(`${conflict.collection}:${conflict.id}`, conflict);
  }
  const conflicts = [...conflictsByIdentity.values()].sort(
    (left, right) =>
      left.collection.localeCompare(right.collection) ||
      left.id.localeCompare(right.id),
  );

  return {
    runs: runs.entries,
    ledger: ledgerEntries,
    addedRunIds: runs.addedIds,
    addedLedgerIds: ledger.addedIds.filter((id) => retainedLedgerIds.has(id)),
    conflicts,
    conflictCount: conflicts.length,
  };
}
