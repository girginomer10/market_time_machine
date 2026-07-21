export const PRACTICE_ARCHIVE_STORAGE_KEY =
  "market-time-machine.practice-archive-storage.v1";
export const PRACTICE_ARCHIVE_STORAGE_FORMAT =
  "market-time-machine-practice-storage";
export const PRACTICE_ARCHIVE_STORAGE_VERSION = 1;
export const LEGACY_RUN_HISTORY_STORAGE_KEY =
  "market-time-machine.run-history.v1";
export const LEGACY_PRACTICE_LEDGER_STORAGE_KEY =
  "market-time-machine.practice-ledger.v1";

export type PracticeArchiveEnvelope = {
  format: typeof PRACTICE_ARCHIVE_STORAGE_FORMAT;
  version: typeof PRACTICE_ARCHIVE_STORAGE_VERSION;
  /** Monotonic for every verified canonical-envelope replacement. */
  revision: number;
  /** Identifies the exact writer so rollback never removes another tab's bytes. */
  commitId: string;
  runs: unknown[];
  ledger: unknown[];
};

export type PracticeArchiveEnvelopeStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type PracticeArchiveEnvelopeState =
  | { status: "missing"; serialized: null }
  | { status: "malformed"; serialized: string }
  | {
      status: "valid";
      envelope: PracticeArchiveEnvelope;
      serialized: string;
    };

export class PracticeArchiveConcurrentMutationError extends Error {
  constructor(message = "The practice archive changed in another browser context.") {
    super(message);
    this.name = "PracticeArchiveConcurrentMutationError";
  }
}

export type CommitPracticeArchiveEnvelopeOptions = {
  /** Exact canonical bytes observed by the read phase; null means absent. */
  expectedPrevious?: string | null;
  /** Callers with a validated snapshot should provide snapshot.revision + 1. */
  revision?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function serializePracticeArchiveEnvelope(data: {
  runs: readonly unknown[];
  ledger: readonly unknown[];
}, revision = 0, commitId = "snapshot"): string {
  return JSON.stringify({
    format: PRACTICE_ARCHIVE_STORAGE_FORMAT,
    version: PRACTICE_ARCHIVE_STORAGE_VERSION,
    revision,
    commitId,
    runs: data.runs,
    ledger: data.ledger,
  });
}

export function inspectPracticeArchiveEnvelope(
  storage: Pick<Storage, "getItem">,
): PracticeArchiveEnvelopeState {
  const serialized = storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY);
  if (serialized === null) return { status: "missing", serialized: null };
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (
      !isRecord(parsed) ||
      parsed.format !== PRACTICE_ARCHIVE_STORAGE_FORMAT ||
      parsed.version !== PRACTICE_ARCHIVE_STORAGE_VERSION ||
      (parsed.revision !== undefined &&
        (!Number.isSafeInteger(parsed.revision) || Number(parsed.revision) < 0)) ||
      (parsed.commitId !== undefined &&
        (typeof parsed.commitId !== "string" ||
          parsed.commitId.trim().length === 0 ||
          parsed.commitId.length > 256)) ||
      !Array.isArray(parsed.runs) ||
      !Array.isArray(parsed.ledger)
    ) {
      return { status: "malformed", serialized };
    }
    return {
      status: "valid",
      envelope: {
        format: PRACTICE_ARCHIVE_STORAGE_FORMAT,
        version: PRACTICE_ARCHIVE_STORAGE_VERSION,
        // Canonical v1 envelopes written before the concurrency protocol are
        // valid revision-zero ancestors and migrate on their next mutation.
        revision: parsed.revision === undefined ? 0 : Number(parsed.revision),
        commitId:
          parsed.commitId === undefined ? "legacy-v1" : String(parsed.commitId),
        runs: parsed.runs,
        ledger: parsed.ledger,
      },
      serialized,
    };
  } catch {
    return { status: "malformed", serialized };
  }
}

/**
 * Returns only structurally valid canonical envelopes. Callers that need to
 * distinguish an absent envelope from a damaged one can use the inspector.
 */
export function readPracticeArchiveEnvelope(
  storage: Pick<Storage, "getItem">,
): (PracticeArchiveEnvelope & { serialized: string }) | undefined {
  const state = inspectPracticeArchiveEnvelope(storage);
  if (state.status !== "valid") return undefined;
  return { ...state.envelope, serialized: state.serialized };
}

function nextCommitId(): string {
  try {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  } catch {
    // Fall through to a per-process identifier for restricted browser contexts.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function restoreCanonicalValueIfOwned(
  storage: PracticeArchiveEnvelopeStorage,
  previous: string | null,
  attemptedCommitId: string,
): void {
  const current = storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY);
  if (current === previous) return;

  if (current !== null) {
    try {
      const parsed: unknown = JSON.parse(current);
      if (!isRecord(parsed) || parsed.commitId !== attemptedCommitId) {
        throw new PracticeArchiveConcurrentMutationError(
          "A newer practice archive commit was preserved during recovery.",
        );
      }
    } catch (error) {
      if (error instanceof PracticeArchiveConcurrentMutationError) throw error;
      throw new PracticeArchiveConcurrentMutationError(
        "Unrecognized practice archive bytes were preserved during recovery.",
      );
    }
  } else {
    throw new PracticeArchiveConcurrentMutationError(
      "A concurrent practice archive removal was preserved during recovery.",
    );
  }

  if (previous === null) storage.removeItem(PRACTICE_ARCHIVE_STORAGE_KEY);
  else storage.setItem(PRACTICE_ARCHIVE_STORAGE_KEY, previous);

  if (storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY) !== previous) {
    throw new Error("Canonical practice archive rollback could not be verified.");
  }
}

/**
 * Commits both archive layers with one localStorage mutation and verifies the
 * exact bytes read back. If a non-conforming storage implementation mutates
 * before throwing, the previous canonical value is restored and verified.
 */
export function commitPracticeArchiveEnvelope(
  storage: PracticeArchiveEnvelopeStorage,
  data: { runs: readonly unknown[]; ledger: readonly unknown[] },
  validateReadback?: (envelope: PracticeArchiveEnvelope) => void,
  options: CommitPracticeArchiveEnvelopeOptions = {},
): string {
  const previous = storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY);
  if (
    Object.prototype.hasOwnProperty.call(options, "expectedPrevious") &&
    previous !== options.expectedPrevious
  ) {
    throw new PracticeArchiveConcurrentMutationError();
  }

  const previousState = inspectPracticeArchiveEnvelope(storage);
  if (previousState.serialized !== previous) {
    throw new PracticeArchiveConcurrentMutationError();
  }
  const previousRevision =
    previousState.status === "valid" ? previousState.envelope.revision : 0;
  const revision = options.revision ?? previousRevision + 1;
  if (
    !Number.isSafeInteger(revision) ||
    revision <= previousRevision
  ) {
    throw new Error("Canonical practice archive revision did not advance.");
  }
  const commitId = nextCommitId();
  const serialized = serializePracticeArchiveEnvelope(data, revision, commitId);
  // Keep the validation/serialization work outside the narrow write window,
  // then confirm the exact parent bytes once more immediately before setItem.
  if (storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY) !== previous) {
    throw new PracticeArchiveConcurrentMutationError();
  }
  try {
    storage.setItem(PRACTICE_ARCHIVE_STORAGE_KEY, serialized);
    if (storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY) !== serialized) {
      throw new Error("Canonical practice archive readback did not match.");
    }
    if (validateReadback) {
      const parsed = JSON.parse(serialized) as PracticeArchiveEnvelope;
      validateReadback(parsed);
    }
    if (storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY) !== serialized) {
      throw new PracticeArchiveConcurrentMutationError(
        "The practice archive changed before its commit could be finalized.",
      );
    }
    return serialized;
  } catch (error) {
    try {
      restoreCanonicalValueIfOwned(storage, previous, commitId);
    } catch (rollbackError) {
      if (rollbackError instanceof PracticeArchiveConcurrentMutationError) {
        throw rollbackError;
      }
      throw new AggregateError(
        [error, rollbackError],
        "Canonical practice archive write failed and its previous value could not be restored.",
      );
    }
    throw error;
  }
}

export function removeLegacyPracticeArchiveKeysBestEffort(
  storage: Pick<Storage, "removeItem">,
  keys: readonly string[],
): void {
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // A verified canonical envelope is authoritative. Legacy cleanup can be
      // retried by a later successful write without invalidating this commit.
    }
  }
}
