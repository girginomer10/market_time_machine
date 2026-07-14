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

function normalizeRunsStrict(
  candidates: readonly unknown[],
  context: string,
): CompletedRun[] {
  const byId = new Map<string, CompletedRun>();
  for (const candidate of candidates) {
    if (!isCompletedRun(candidate)) {
      throw new PracticeArchiveError(`${context} contains a malformed run.`);
    }
    const existing = byId.get(candidate.id);
    if (existing && !sameContent(existing, candidate)) {
      throw new PracticeArchiveError(
        `${context} contains conflicting runs with id "${candidate.id}".`,
      );
    }
    if (!existing) byId.set(candidate.id, candidate);
  }
  return [...byId.values()]
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
  return [...byId.values()]
    .sort(compareLedgerNewestFirst)
    .slice(0, MAX_PRACTICE_LEDGER_ENTRIES);
}

function unassessedLedgerEntry(run: CompletedRun): PracticeLedgerEntry {
  const { practiceAssessment: _practiceAssessment, ...report } = run.report;
  return derivePracticeLedgerEntry({ ...run, report });
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
  const runById = new Map(normalizedRuns.map((run) => [run.id, run]));
  for (const entry of normalizedLedger) {
    const run = runById.get(entry.runId);
    if (!run) continue;
    const expected = derivePracticeLedgerEntry(
      run,
      run.report.practiceAssessment,
    );
    if (!sameContent(entry, expected)) {
      throw new PracticeArchiveError(
        `Practice archive ledger entry "${entry.id}" conflicts with its full run.`,
      );
    }
  }

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
  const conflicts: PracticeArchiveMergeConflict[] = [];

  for (const entry of normalizedIncoming) {
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
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
  const conflicts: PracticeArchiveMergeConflict[] = [];

  for (const entry of normalizedIncoming) {
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
    } else if (!sameContent(existing, entry)) {
      conflicts.push({ collection: "ledger", id: entry.id });
    }
  }

  const entries = [...byId.values()]
    .sort(compareLedgerNewestFirst)
    .slice(0, MAX_PRACTICE_LEDGER_ENTRIES);
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
  const runs = mergeRuns(current.runs, incoming.runs);
  const ledger = mergeLedger(current.ledger, incoming.ledger);
  const conflicts = [...runs.conflicts, ...ledger.conflicts].sort(
    (left, right) =>
      left.collection.localeCompare(right.collection) ||
      left.id.localeCompare(right.id),
  );

  return {
    runs: runs.entries,
    ledger: ledger.entries,
    addedRunIds: runs.addedIds,
    addedLedgerIds: ledger.addedIds,
    conflicts,
    conflictCount: conflicts.length,
  };
}
