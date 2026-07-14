import {
  PRACTICE_LEDGER_STORAGE_KEY,
  persistPracticeLedger,
  type PracticeLedgerEntry,
} from "./practiceLedger";
import {
  RUN_HISTORY_STORAGE_KEY,
  persistRunHistory,
  type CompletedRun,
} from "./runHistory";

type ArchiveStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StoredPracticeArchiveData = {
  runs: CompletedRun[];
  ledger: PracticeLedgerEntry[];
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
  return JSON.stringify(left) === JSON.stringify(right);
}

function restoreKey(
  storage: ArchiveStorage,
  key: string,
  previous: string | null,
): void {
  if (storage.getItem(key) === previous) return;
  if (previous === null) storage.removeItem(key);
  else storage.setItem(key, previous);
}

/**
 * Persists the two archive layers as one user-visible operation. The existing
 * values are restored if either bounded writer cannot retain the complete
 * merged payload (for example because browser storage is full).
 */
export function persistPracticeArchiveAtomically(
  data: StoredPracticeArchiveData,
  storage: ArchiveStorage | undefined = browserStorage(),
): StoredPracticeArchiveData {
  if (!storage) {
    throw new Error(
      "Browser storage is unavailable; the practice archive was not imported.",
    );
  }

  let previousRuns: string | null;
  let previousLedger: string | null;
  try {
    previousRuns = storage.getItem(RUN_HISTORY_STORAGE_KEY);
    previousLedger = storage.getItem(PRACTICE_LEDGER_STORAGE_KEY);
  } catch {
    throw new Error(
      "Browser storage could not be read; the practice archive was not imported.",
    );
  }

  try {
    const runs = persistRunHistory([...data.runs], storage);
    if (!sameContent(runs, data.runs)) {
      throw new Error("The complete report history could not be retained.");
    }
    const ledger = persistPracticeLedger(data.ledger, storage);
    if (!sameContent(ledger, data.ledger)) {
      throw new Error("The complete compact ledger could not be retained.");
    }
    return { runs, ledger };
  } catch {
    try {
      restoreKey(storage, RUN_HISTORY_STORAGE_KEY, previousRuns);
      restoreKey(storage, PRACTICE_LEDGER_STORAGE_KEY, previousLedger);
    } catch {
      throw new Error(
        "The archive import failed and the previous browser data could not be fully restored. Export any visible data before retrying.",
      );
    }
    throw new Error(
      "The practice archive did not fit in browser storage. No archive changes were kept.",
    );
  }
}
