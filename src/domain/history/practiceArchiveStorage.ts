import {
  LEGACY_PRACTICE_LEDGER_STORAGE_KEY,
  LEGACY_RUN_HISTORY_STORAGE_KEY,
  PRACTICE_ARCHIVE_STORAGE_KEY,
  PracticeArchiveConcurrentMutationError,
  commitPracticeArchiveEnvelope,
  inspectPracticeArchiveEnvelope,
  removeLegacyPracticeArchiveKeysBestEffort,
} from "./practiceArchiveEnvelope";
import {
  MAX_PRACTICE_LEDGER_ENTRIES,
  derivePracticeLedgerEntry,
  loadPracticeLedger,
  normalizePracticeLedgerEntries,
  parsePracticeLedgerEntry,
  reconcilePracticeLedger,
  type PracticeLedgerEntry,
} from "./practiceLedger";
import {
  MAX_SAVED_RUNS,
  buildCompletedRun,
  isCompletedRun,
  loadRunHistory,
  type CompletedRunInput,
  type CompletedRun,
} from "./runHistory";
import {
  assertPracticeArchiveIdentityConsistency,
  mergePracticeArchive,
} from "./practiceArchive";

type ArchiveStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const MAX_CONCURRENT_MUTATION_ATTEMPTS = 8;
const MAX_ARCHIVED_ID_LENGTH = 4_096;
export const PRACTICE_ARCHIVE_MUTATION_LOCK_NAME =
  "market-time-machine.practice-archive-mutation.v1";

type PracticeArchiveLockManager = {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => T | PromiseLike<T>,
  ): Promise<T>;
};

function browserLockManager(): PracticeArchiveLockManager | undefined {
  if (typeof navigator === "undefined") return undefined;
  try {
    return (navigator as Navigator & { locks?: PracticeArchiveLockManager })
      .locks;
  } catch {
    return undefined;
  }
}

/**
 * Serializes the complete read/merge/write mutation across same-origin tabs
 * when Web Locks are available. The synchronous mutation's revision/CAS/retry
 * protocol remains the fail-safe fallback for older or restricted browsers.
 */
export async function withPracticeArchiveMutationLock<T>(
  mutation: () => T | PromiseLike<T>,
  lockManager: PracticeArchiveLockManager | undefined = browserLockManager(),
): Promise<T> {
  if (!lockManager) return mutation();
  return lockManager.request(
    PRACTICE_ARCHIVE_MUTATION_LOCK_NAME,
    { mode: "exclusive" },
    mutation,
  );
}

export type StoredPracticeArchiveData = {
  runs: CompletedRun[];
  ledger: PracticeLedgerEntry[];
};

export type LoadStoredPracticeArchiveOptions = {
  /**
   * Legacy layers are readable without mutation during React initialization.
   * The caller can then perform the migration inside the cross-tab lock.
   */
  migrateLegacy?: boolean;
};

export type PersistPracticeArchiveOptions = {
  /** Merge the requested data with the latest stored snapshot on attempt zero. */
  mergeWithStored?: boolean;
};

export type StoredPracticeArchiveDamage =
  | { damaged: false }
  | { damaged: true; serialized: string };

export type RemovePracticeArchiveRunResult = StoredPracticeArchiveData & {
  removedRunCount: number;
  removedLedgerCount: number;
};

export type RecordCompletedPracticeRunResult = StoredPracticeArchiveData & {
  run: CompletedRun;
  added: boolean;
  ledgerBackfilled: boolean;
};

function browserStorage(): ArchiveStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function sameContent(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function runCompletionContent(run: CompletedRun): unknown {
  const { completedAt: _completedAt, ...content } = run;
  return content;
}

function branchCompletionContent(run: CompletedRun): unknown {
  const {
    id: _id,
    runInstanceId: _runInstanceId,
    completedAt: _completedAt,
    ...content
  } = run;
  return content;
}

function sameRunCompletion(
  left: CompletedRun,
  right: CompletedRun,
): boolean {
  return sameContent(runCompletionContent(left), runCompletionContent(right));
}

function sameBranchCompletion(
  left: CompletedRun,
  right: CompletedRun,
): boolean {
  return sameContent(branchCompletionContent(left), branchCompletionContent(right));
}

function stableHashPart(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function completionBranchFingerprint(run: CompletedRun): string {
  const serialized = JSON.stringify(canonicalize(branchCompletionContent(run)));
  return `${stableHashPart(serialized, 0x811c9dc5)}${stableHashPart(
    serialized,
    0x9e3779b9,
  )}`;
}

function completionBranchIdentity(
  candidate: CompletedRun,
  collisionIndex: number,
): string {
  const suffix = `~branch-${completionBranchFingerprint(candidate)}${
    collisionIndex === 0 ? "" : `-${collisionIndex + 1}`
  }`;
  const root = candidate.runInstanceId ?? candidate.id;
  return `${root.slice(0, MAX_ARCHIVED_ID_LENGTH - suffix.length)}${suffix}`;
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

function validateStoredDataStrict(data: {
  runs: readonly unknown[];
  ledger: readonly unknown[];
}): StoredPracticeArchiveData {
  if (
    data.runs.length > MAX_SAVED_RUNS ||
    !data.runs.every(isCompletedRun) ||
    new Set(data.runs.map((run) => (run as CompletedRun).id)).size !==
      data.runs.length
  ) {
    throw new Error("The canonical practice archive contains invalid reports.");
  }

  if (data.ledger.length > MAX_PRACTICE_LEDGER_ENTRIES) {
    throw new Error(
      "The canonical practice archive contains too many compact entries.",
    );
  }
  const ledger = data.ledger.map((entry) =>
    parsePracticeLedgerEntry(entry, { rejectMalformedAssessment: true }),
  );
  if (
    ledger.some((entry) => entry === undefined) ||
    new Set(ledger.map((entry) => entry?.id)).size !== ledger.length
  ) {
    throw new Error(
      "The canonical practice archive contains invalid compact entries.",
    );
  }

  const validated = {
    runs: [...data.runs] as CompletedRun[],
    ledger: ledger as PracticeLedgerEntry[],
  };
  assertPracticeArchiveIdentityConsistency(
    validated.runs,
    validated.ledger,
    "Canonical practice archive",
  );
  return validated;
}

/**
 * Reads the canonical envelope as one strictly validated snapshot. Until the
 * first canonical write, the legacy per-layer readers remain the migration
 * fallback so existing browser data is not lost.
 */
export function loadStoredPracticeArchiveData(
  storage: ArchiveStorage | undefined = browserStorage(),
  options: LoadStoredPracticeArchiveOptions = {},
): StoredPracticeArchiveData {
  if (!storage) return { runs: [], ledger: [] };
  try {
    const state = inspectPracticeArchiveEnvelope(storage);
    if (state.status === "valid") {
      try {
        return validateStoredDataStrict(state.envelope);
      } catch {
        // A structurally valid canonical envelope is authoritative. If either
        // layer fails domain validation, fail the whole snapshot closed rather
        // than exposing a valid-looking half or resurrecting stale legacy data.
        return { runs: [], ledger: [] };
      }
    }
    if (state.status === "malformed") {
      // Once the canonical key exists it is authoritative, even when damaged.
      // Falling back here could resurrect stale legacy layers whose best-effort
      // cleanup failed after an earlier successful canonical commit.
      return { runs: [], ledger: [] };
    }
  } catch (error) {
    throw new Error(
      `Browser practice history could not be read safely (${error instanceof Error ? error.message : "unknown error"}).`,
    );
  }
  // Only a genuinely missing canonical key can use and migrate legacy layers.
  const runs = loadRunHistory(storage);
  const ledger = reconcilePracticeLedger(loadPracticeLedger(storage), runs);
  let legacy: StoredPracticeArchiveData;
  try {
    legacy = validateStoredDataStrict({ runs, ledger });
  } catch {
    return { runs: [], ledger: [] };
  }
  if (runs.length === 0 && ledger.length === 0) return legacy;
  if (options.migrateLegacy === false) return legacy;
  try {
    return persistPracticeArchiveAtomically(legacy, storage, {
      // A canonical archive may have appeared after the initial missing-key
      // read. Legacy migration is additive and must never replace that state.
      mergeWithStored: true,
    });
  } catch {
    // A failed migration leaves both legacy keys untouched. The validated data
    // remains usable in memory and a later write can retry the migration.
    return legacy;
  }
}

/** Distinguishes a genuinely empty archive from an authoritative damaged one. */
export function inspectStoredPracticeArchiveDamage(
  storage: ArchiveStorage | undefined = browserStorage(),
): StoredPracticeArchiveDamage {
  if (!storage) return { damaged: false };
  try {
    const state = inspectPracticeArchiveEnvelope(storage);
    if (state.status === "missing") return { damaged: false };
    if (state.status === "malformed") {
      return { damaged: true, serialized: state.serialized };
    }
    try {
      validateStoredDataStrict(state.envelope);
      return { damaged: false };
    } catch {
      return { damaged: true, serialized: state.serialized };
    }
  } catch (error) {
    throw new Error(
      `Browser practice history could not be inspected safely (${error instanceof Error ? error.message : "unknown error"}).`,
    );
  }
}

function restoreRemovedStorageValuesIfOwned(
  storage: ArchiveStorage,
  previous: ReadonlyMap<string, string | null>,
): boolean {
  const restored = new Set<string>();
  let preservedConcurrentValue = false;
  for (const [key, value] of previous) {
    const current = storage.getItem(key);
    if (current === value) continue;
    if (current !== null) {
      // The removal operation only ever writes null. Any other current bytes
      // belong to a newer writer and must not be rolled back.
      preservedConcurrentValue = true;
      continue;
    }
    if (value !== null) storage.setItem(key, value);
    restored.add(key);
  }
  for (const key of restored) {
    const value = previous.get(key) ?? null;
    if (storage.getItem(key) !== value) {
      throw new Error("Practice archive recovery rollback could not be verified.");
    }
  }
  return preservedConcurrentValue;
}

/**
 * Explicit recovery path for an otherwise immutable damaged canonical key.
 * Canonical and stale legacy layers are removed together so clearing damage
 * cannot resurrect an older, already superseded history snapshot.
 */
export function discardDamagedPracticeArchiveAtomically(
  storage: ArchiveStorage | undefined = browserStorage(),
): StoredPracticeArchiveData {
  if (!storage) {
    throw new Error("Browser storage is unavailable; damaged history was not removed.");
  }
  const damage = inspectStoredPracticeArchiveDamage(storage);
  if (!damage.damaged) {
    throw new Error("No damaged practice archive is available to remove.");
  }
  const keys = [
    PRACTICE_ARCHIVE_STORAGE_KEY,
    LEGACY_RUN_HISTORY_STORAGE_KEY,
    LEGACY_PRACTICE_LEDGER_STORAGE_KEY,
  ] as const;
  const previous = new Map(
    keys.map((key) => [key, storage.getItem(key)] as const),
  );
  if (previous.get(PRACTICE_ARCHIVE_STORAGE_KEY) !== damage.serialized) {
    throw new Error(
      "Practice history changed in another browser tab and was not removed.",
    );
  }
  try {
    if (storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY) !== damage.serialized) {
      throw new PracticeArchiveConcurrentMutationError();
    }
    for (const key of keys) storage.removeItem(key);
    if (keys.some((key) => storage.getItem(key) !== null)) {
      throw new Error("Practice archive recovery removal could not be verified.");
    }
    return { runs: [], ledger: [] };
  } catch (error) {
    try {
      const preservedConcurrentValue = restoreRemovedStorageValuesIfOwned(
        storage,
        previous,
      );
      if (preservedConcurrentValue) {
        throw new PracticeArchiveConcurrentMutationError(
          "Newer practice history was preserved during damaged-history recovery.",
        );
      }
    } catch (rollbackError) {
      if (rollbackError instanceof PracticeArchiveConcurrentMutationError) {
        throw new Error(
          "Practice history changed in another browser tab and was not removed.",
        );
      }
      throw new AggregateError(
        [error, rollbackError],
        "Damaged history could not be removed and its rollback could not be verified.",
      );
    }
    throw new Error("Damaged history could not be removed. Existing bytes were kept.");
  }
}

type StoredPracticeArchiveMutationSnapshot = {
  data: StoredPracticeArchiveData;
  serialized: string | null;
  revision: number;
};

function loadStoredPracticeArchiveDataForMutation(
  storage: ArchiveStorage,
): StoredPracticeArchiveMutationSnapshot {
  let state: ReturnType<typeof inspectPracticeArchiveEnvelope>;
  try {
    state = inspectPracticeArchiveEnvelope(storage);
  } catch {
    throw new Error("Browser storage could not be read safely.");
  }
  if (state.status === "malformed") {
    throw new Error(
      "The stored practice archive is damaged and was left unchanged.",
    );
  }
  if (state.status === "valid") {
    try {
      return {
        data: validateStoredDataStrict(state.envelope),
        serialized: state.serialized,
        revision: state.envelope.revision,
      };
    } catch {
      throw new Error(
        "The stored practice archive is damaged and was left unchanged.",
      );
    }
  }
  const runs = loadRunHistory(storage);
  return {
    data: validateStoredDataStrict({
      runs,
      ledger: reconcilePracticeLedger(loadPracticeLedger(storage), runs),
    }),
    serialized: null,
    revision: 0,
  };
}

function canonicalSnapshotIsCurrent(
  storage: ArchiveStorage,
  snapshot: StoredPracticeArchiveMutationSnapshot,
): boolean {
  return storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY) === snapshot.serialized;
}

function commitValidatedPracticeArchiveSnapshot(
  storage: ArchiveStorage,
  snapshot: StoredPracticeArchiveMutationSnapshot,
  next: StoredPracticeArchiveData,
): StoredPracticeArchiveData {
  let saved: StoredPracticeArchiveData | undefined;
  commitPracticeArchiveEnvelope(
    storage,
    next,
    (readback) => {
      const validated = validateStoredDataStrict(readback);
      if (!sameContent(validated, next)) {
        throw new Error("The canonical practice archive readback did not match.");
      }
      saved = validated;
    },
    {
      expectedPrevious: snapshot.serialized,
      revision: snapshot.revision + 1,
    },
  );
  if (!saved) throw new Error("The canonical archive was not validated.");
  return saved;
}

function concurrentMutationFailure(): Error {
  return new Error(
    "Practice history changed in another browser tab too quickly. Its newer data was kept; retry this action.",
  );
}

/**
 * Commits full reports and compact evidence through one canonical localStorage
 * key. The exact bytes and both domain layers are validated before legacy keys
 * are cleaned up, so readers can never observe a half-imported archive.
 */
export function persistPracticeArchiveAtomically(
  data: StoredPracticeArchiveData,
  storage: ArchiveStorage | undefined = browserStorage(),
  options: PersistPracticeArchiveOptions = {},
): StoredPracticeArchiveData {
  if (!storage) {
    throw new Error(
      "Browser storage is unavailable; the practice archive was not imported.",
    );
  }

  let normalized: StoredPracticeArchiveData;
  try {
    normalized = validateStoredDataStrict(data);
  } catch {
    throw new Error(
      "The practice archive contains invalid data and was not imported.",
    );
  }

  let rebased = normalized;
  for (
    let attempt = 0;
    attempt < MAX_CONCURRENT_MUTATION_ATTEMPTS;
    attempt += 1
  ) {
    let snapshot: StoredPracticeArchiveMutationSnapshot;
    try {
      snapshot = loadStoredPracticeArchiveDataForMutation(storage);
    } catch {
      throw new Error(
        "The stored practice archive is damaged and was left unchanged.",
      );
    }

    if (attempt > 0 || options.mergeWithStored === true) {
      // Import is additive. If another tab committed after the import's read
      // phase, merge the requested snapshot onto the newer canonical state
      // rather than replacing that state with stale bytes. Legacy migration
      // also opts into this on attempt zero because its initial missing-key
      // read necessarily happened before this mutation snapshot.
      const merged = mergePracticeArchive(snapshot.data, normalized);
      rebased = { runs: merged.runs, ledger: merged.ledger };
    }

    if (
      snapshot.serialized !== null &&
      sameContent(snapshot.data, rebased)
    ) {
      if (canonicalSnapshotIsCurrent(storage, snapshot)) return snapshot.data;
      continue;
    }

    try {
      const saved = commitValidatedPracticeArchiveSnapshot(
        storage,
        snapshot,
        rebased,
      );
      removeLegacyPracticeArchiveKeysBestEffort(storage, [
        LEGACY_RUN_HISTORY_STORAGE_KEY,
        LEGACY_PRACTICE_LEDGER_STORAGE_KEY,
      ]);
      return saved;
    } catch (error) {
      if (error instanceof PracticeArchiveConcurrentMutationError) continue;
      if (
        error instanceof AggregateError ||
        (error instanceof Error &&
          error.message.includes("previous value could not be restored"))
      ) {
        throw new Error(
          "The archive import failed and the previous browser data could not be fully restored. Export any visible data before retrying.",
        );
      }
      throw new Error(
        "Browser storage rejected the complete practice archive. No archive changes were kept.",
      );
    }
  }

  throw concurrentMutationFailure();
}

export function clearPracticeArchiveAtomically(
  storage: ArchiveStorage | undefined = browserStorage(),
): StoredPracticeArchiveData {
  if (!storage) {
    throw new Error("Practice history could not be cleared because browser storage is unavailable.");
  }
  try {
    const snapshot = loadStoredPracticeArchiveDataForMutation(storage);
    if (
      snapshot.serialized !== null &&
      snapshot.data.runs.length === 0 &&
      snapshot.data.ledger.length === 0
    ) {
      if (canonicalSnapshotIsCurrent(storage, snapshot)) return snapshot.data;
      throw new PracticeArchiveConcurrentMutationError();
    }
    const saved = commitValidatedPracticeArchiveSnapshot(
      storage,
      snapshot,
      { runs: [], ledger: [] },
    );
    removeLegacyPracticeArchiveKeysBestEffort(storage, [
      LEGACY_RUN_HISTORY_STORAGE_KEY,
      LEGACY_PRACTICE_LEDGER_STORAGE_KEY,
    ]);
    return saved;
  } catch (error) {
    throw new Error(
      error instanceof Error &&
        error.message.includes("could not be fully restored")
        ? "Practice history could not be cleared safely, and browser storage could not verify the previous data. Export any visible data before retrying."
        : error instanceof PracticeArchiveConcurrentMutationError
          ? "Practice history changed in another browser tab and was not cleared. Review the newer history, then retry."
        : "Practice history could not be cleared. Existing browser data was kept.",
    );
  }
}

type ResolvedCompletedRun = {
  run: CompletedRun;
  added: boolean;
  conflictingRun?: CompletedRun;
};

function ledgerEntryMatchesCompletedRun(
  entry: PracticeLedgerEntry,
  run: CompletedRun,
): boolean {
  const assessed = derivePracticeLedgerEntry(
    run,
    run.report.practiceAssessment,
  );
  if (sameContent(entry, assessed)) return true;
  const { practiceAssessment: _practiceAssessment, ...report } = run.report;
  return sameContent(entry, derivePracticeLedgerEntry({ ...run, report }));
}

function resolveCompletedRun(
  candidate: CompletedRun,
  current: StoredPracticeArchiveData,
): ResolvedCompletedRun {
  const candidateIdentities = runIdentityAliases(candidate);
  const existingRun = current.runs.find((run) =>
    identitiesOverlap(runIdentityAliases(run), candidateIdentities),
  );
  if (existingRun && sameRunCompletion(existingRun, candidate)) {
    return { run: existingRun, added: false };
  }

  const existingLedger = current.ledger.find((entry) =>
    identitiesOverlap(ledgerIdentityAliases(entry), candidateIdentities),
  );
  if (
    !existingRun &&
    (!existingLedger || ledgerEntryMatchesCompletedRun(existingLedger, candidate))
  ) {
    return { run: candidate, added: true };
  }

  // A restored mid-run session can legitimately complete twice with the same
  // runInstanceId. Different semantic completions are separate evidence, not
  // an idempotent repeat. Re-key the later branch deterministically and probe
  // for the next free suffix in the extraordinarily unlikely event of a hash
  // or imported-identity collision.
  for (let collisionIndex = 0; collisionIndex <= MAX_SAVED_RUNS; collisionIndex += 1) {
    const branchIdentity = completionBranchIdentity(candidate, collisionIndex);
    const forked = {
      ...candidate,
      id: branchIdentity,
      runInstanceId: branchIdentity,
    };
    const collidingRun = current.runs.find((run) =>
      identitiesOverlap(runIdentityAliases(run), [branchIdentity]),
    );
    const collidingLedger = current.ledger.find((entry) =>
      identitiesOverlap(ledgerIdentityAliases(entry), [branchIdentity]),
    );
    if (!collidingRun && !collidingLedger) {
      return { run: forked, added: true, conflictingRun: existingRun };
    }
    if (
      collidingRun &&
      sameBranchCompletion(collidingRun, forked) &&
      (!collidingLedger || ledgerEntryMatchesCompletedRun(collidingLedger, collidingRun))
    ) {
      return {
        run: collidingRun,
        added: false,
        conflictingRun: existingRun,
      };
    }
  }

  throw new Error(
    "Completed replay identity conflicts could not be resolved without losing evidence.",
  );
}

function buildRecordMutation(
  candidate: CompletedRun,
  current: StoredPracticeArchiveData,
): {
  next: StoredPracticeArchiveData;
  run: CompletedRun;
  added: boolean;
  ledgerBackfilled: boolean;
} {
  const resolved = resolveCompletedRun(candidate, current);
  const { run, added, conflictingRun } = resolved;
  const runAliases = runIdentityAliases(run);
  const runs = added
    ? [
        run,
        ...(conflictingRun ? [conflictingRun] : []),
        ...current.runs.filter(
          (entry) =>
            !identitiesOverlap(runIdentityAliases(entry), runAliases) &&
            (!conflictingRun || entry !== conflictingRun),
        ),
      ].slice(0, MAX_SAVED_RUNS)
    : current.runs;
  const incomingLedger = derivePracticeLedgerEntry(
    run,
    run.report.practiceAssessment,
  );
  const incomingLedgerIdentities = ledgerIdentityAliases(incomingLedger);
  const previousLedger = current.ledger.find((entry) =>
    identitiesOverlap(ledgerIdentityAliases(entry), incomingLedgerIdentities),
  );
  const mergedLedger = previousLedger
    ? {
        ...incomingLedger,
        assessment: incomingLedger.assessment ?? previousLedger.assessment,
      }
    : incomingLedger;
  const protectedLedger = conflictingRun
    ? current.ledger.filter((entry) =>
        identitiesOverlap(
          ledgerIdentityAliases(entry),
          runIdentityAliases(conflictingRun),
        ),
      )
    : [];
  const protectedLedgerIdentities = new Set(
    protectedLedger.flatMap(ledgerIdentityAliases),
  );
  const remainingLedger = normalizePracticeLedgerEntries(
    current.ledger.filter(
      (entry) =>
        !identitiesOverlap(
          ledgerIdentityAliases(entry),
          incomingLedgerIdentities,
        ) &&
        !ledgerIdentityAliases(entry).some((identity) =>
          protectedLedgerIdentities.has(identity),
        ),
    ),
  );
  // Keep both sides of a same-session completion branch inside the compact cap
  // even if imported timestamps are in the future.
  const remainingSlots = Math.max(
    0,
    MAX_PRACTICE_LEDGER_ENTRIES - 1 - protectedLedger.length,
  );
  const ledger = normalizePracticeLedgerEntries([
    mergedLedger,
    ...protectedLedger,
    ...remainingLedger.slice(0, remainingSlots),
  ]);
  const ledgerBackfilled =
    previousLedger === undefined &&
    ledger.some((entry) =>
      identitiesOverlap(ledgerIdentityAliases(entry), incomingLedgerIdentities),
    );
  return {
    next: { runs, ledger },
    run,
    added,
    ledgerBackfilled,
  };
}

export function recordCompletedPracticeRunAtomically(
  input: CompletedRunInput,
  storage: ArchiveStorage | undefined = browserStorage(),
): RecordCompletedPracticeRunResult {
  if (!storage) {
    throw new Error(
      "Completed replay could not be saved because browser storage is unavailable.",
    );
  }

  const candidate = buildCompletedRun(input);
  for (
    let attempt = 0;
    attempt < MAX_CONCURRENT_MUTATION_ATTEMPTS;
    attempt += 1
  ) {
    let snapshot: StoredPracticeArchiveMutationSnapshot;
    try {
      snapshot = loadStoredPracticeArchiveDataForMutation(storage);
    } catch {
      throw new Error(
        "Completed replay could not be saved because existing practice history is damaged or unreadable.",
      );
    }

    let mutation: ReturnType<typeof buildRecordMutation>;
    try {
      mutation = buildRecordMutation(candidate, snapshot.data);
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? error.message
          : "Completed replay identity could not be resolved safely.",
      );
    }
    const unchanged =
      sameContent(snapshot.data, mutation.next) && snapshot.serialized !== null;
    if (unchanged) {
      if (canonicalSnapshotIsCurrent(storage, snapshot)) {
        return {
          ...snapshot.data,
          run: mutation.run,
          added: mutation.added,
          ledgerBackfilled: mutation.ledgerBackfilled,
        };
      }
      continue;
    }

    try {
      const saved = commitValidatedPracticeArchiveSnapshot(
        storage,
        snapshot,
        mutation.next,
      );
      removeLegacyPracticeArchiveKeysBestEffort(storage, [
        LEGACY_RUN_HISTORY_STORAGE_KEY,
        LEGACY_PRACTICE_LEDGER_STORAGE_KEY,
      ]);
      return {
        ...saved,
        run: mutation.run,
        added: mutation.added,
        ledgerBackfilled: mutation.ledgerBackfilled,
      };
    } catch (error) {
      if (error instanceof PracticeArchiveConcurrentMutationError) continue;
      throw new Error(
        error instanceof Error &&
          error.message.includes("could not be restored")
          ? "Completed replay could not be saved safely, and browser storage could not verify the previous history. Export any visible data before retrying."
          : "Completed replay could not be saved. Existing practice history was kept.",
      );
    }
  }

  throw new Error(
    "Completed replay could not be saved because practice history kept changing in another browser tab. Its newer data was kept; retry this action.",
  );
}

export function removePracticeArchiveRunAtomically(
  runIdentity: string,
  storage: ArchiveStorage | undefined = browserStorage(),
): RemovePracticeArchiveRunResult {
  if (!storage) {
    throw new Error(
      "Completed replay could not be removed because browser storage is unavailable.",
    );
  }
  if (runIdentity.trim().length === 0) {
    throw new Error("Completed replay identity is missing.");
  }

  for (
    let attempt = 0;
    attempt < MAX_CONCURRENT_MUTATION_ATTEMPTS;
    attempt += 1
  ) {
    let snapshot: StoredPracticeArchiveMutationSnapshot;
    try {
      snapshot = loadStoredPracticeArchiveDataForMutation(storage);
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? error.message
          : "Completed replay could not be read safely.",
      );
    }

    const matchingIdentities = new Set([runIdentity]);
    const runs = snapshot.data.runs.filter((run) => {
      const matches =
        run.id === runIdentity || run.runInstanceId === runIdentity;
      if (!matches) return true;
      matchingIdentities.add(run.id);
      if (run.runInstanceId) matchingIdentities.add(run.runInstanceId);
      return false;
    });
    const ledger = snapshot.data.ledger.filter(
      (entry) =>
        ![entry.id, entry.runId, entry.runInstanceId].some(
          (identity) => identity && matchingIdentities.has(identity),
        ),
    );
    const removedRunCount = snapshot.data.runs.length - runs.length;
    const removedLedgerCount = snapshot.data.ledger.length - ledger.length;
    if (removedRunCount === 0 && removedLedgerCount === 0) {
      if (canonicalSnapshotIsCurrent(storage, snapshot)) {
        return {
          ...snapshot.data,
          removedRunCount,
          removedLedgerCount,
        };
      }
      continue;
    }

    try {
      const saved = commitValidatedPracticeArchiveSnapshot(
        storage,
        snapshot,
        { runs, ledger },
      );
      removeLegacyPracticeArchiveKeysBestEffort(storage, [
        LEGACY_RUN_HISTORY_STORAGE_KEY,
        LEGACY_PRACTICE_LEDGER_STORAGE_KEY,
      ]);
      return { ...saved, removedRunCount, removedLedgerCount };
    } catch (error) {
      if (error instanceof PracticeArchiveConcurrentMutationError) continue;
      throw new Error(
        error instanceof Error &&
          error.message.includes("could not be restored")
          ? "Completed replay could not be removed safely, and browser storage could not verify the previous history. Export any visible data before retrying."
          : "Completed replay could not be removed. Existing practice history was kept.",
      );
    }
  }

  throw new Error(
    "Completed replay could not be removed because practice history kept changing in another browser tab. Its newer data was kept; retry this action.",
  );
}
