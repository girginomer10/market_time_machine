import { describe, expect, it } from "vitest";
import {
  PRACTICE_ARCHIVE_STORAGE_KEY,
  inspectPracticeArchiveEnvelope,
  serializePracticeArchiveEnvelope,
} from "./practiceArchiveEnvelope";
import {
  MAX_PRACTICE_LEDGER_ENTRIES,
  PRACTICE_LEDGER_FORMAT,
  PRACTICE_LEDGER_STORAGE_KEY,
  PRACTICE_LEDGER_VERSION,
  type PracticeLedgerEntry,
} from "./practiceLedger";
import {
  RUN_HISTORY_STORAGE_KEY,
  type CompletedRun,
  type CompletedRunInput,
} from "./runHistory";
import {
  clearPracticeArchiveAtomically,
  discardDamagedPracticeArchiveAtomically,
  inspectStoredPracticeArchiveDamage,
  loadStoredPracticeArchiveData,
  persistPracticeArchiveAtomically,
  PRACTICE_ARCHIVE_MUTATION_LOCK_NAME,
  recordCompletedPracticeRunAtomically,
  removePracticeArchiveRunAtomically,
  withPracticeArchiveMutationLock,
} from "./practiceArchiveStorage";
import {
  brokerConfigFingerprint,
  IDEAL_BROKER_CONFIG,
} from "../broker/executionModels";

const TEST_BROKER_FINGERPRINT = brokerConfigFingerprint(IDEAL_BROKER_CONFIG);

describe("practice archive Web Lock boundary", () => {
  it("runs the entire mutation inside the named exclusive lock", async () => {
    let lockHeld = false;
    const lockManager = {
      request: async <T,>(
        name: string,
        options: { mode: "exclusive" },
        callback: () => T | PromiseLike<T>,
      ): Promise<T> => {
        expect(name).toBe(PRACTICE_ARCHIVE_MUTATION_LOCK_NAME);
        expect(options).toEqual({ mode: "exclusive" });
        lockHeld = true;
        try {
          return await callback();
        } finally {
          lockHeld = false;
        }
      },
    };

    await expect(
      withPracticeArchiveMutationLock(() => {
        expect(lockHeld).toBe(true);
        return "saved";
      }, lockManager),
    ).resolves.toBe("saved");
    expect(lockHeld).toBe(false);
  });

  it("uses the guarded synchronous protocol when Web Locks are unavailable", async () => {
    await expect(
      withPracticeArchiveMutationLock(() => "fallback", undefined),
    ).resolves.toBe("fallback");
  });
});

describe("practice archive read failures", () => {
  it("surfaces storage access failures instead of reporting an empty archive", () => {
    const storage = {
      getItem: () => {
        throw new Error("privacy denied");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };

    expect(() => loadStoredPracticeArchiveData(storage)).toThrow(
      /could not be read safely.*privacy denied/i,
    );
    expect(() => inspectStoredPracticeArchiveDamage(storage)).toThrow(
      /could not be inspected safely.*privacy denied/i,
    );
  });
});

function run(id: string): CompletedRun {
  return {
    id,
    runInstanceId: id,
    completedAt: "2026-07-14T12:00:00.000Z",
    scenarioId: "scenario-a",
    scenarioTitle: "Scenario A",
    mode: "explorer",
    brokerMode: "scenario",
    brokerFingerprint: TEST_BROKER_FINGERPRINT,
    sampleData: true,
    totalReturn: 0,
    benchmarkReturn: 0,
    excessReturn: 0,
    maxDrawdown: 0,
    scoreStatus: "unavailable",
    executionCount: 0,
    closedTradeCount: 0,
    journalEntryCount: 0,
    report: {
      scenarioId: "scenario-a",
      scenarioTitle: "Scenario A",
      metrics: {
        totalReturn: 0,
        benchmarkReturn: 0,
        excessReturn: 0,
        maxDrawdown: 0,
        volatility: 0,
        winRate: 0,
        exposureTime: 0,
        turnover: 0,
        feesPaid: 0,
        slippagePaid: 0,
        initialEquity: 10_000,
        finalEquity: 10_000,
        benchmarkInitial: 10_000,
        benchmarkFinal: 10_000,
      },
      equityCurve: [],
      totalTrades: 0,
      behavioralFlags: [],
      provenance: {
        license: "Fixture",
        dataSources: ["Fixture"],
        isSampleData: true,
      },
    },
  };
}

function ledger(id: string): PracticeLedgerEntry {
  return {
    id,
    runId: id,
    runInstanceId: id,
    completedAt: "2026-07-14T12:00:00.000Z",
    scenarioId: "scenario-a",
    scenarioTitle: "Scenario A",
    sampleData: true,
    mode: "explorer",
    brokerMode: "scenario",
    brokerFingerprint: TEST_BROKER_FINGERPRINT,
    facts: {
      executionCount: 0,
      closedTradeCount: 0,
      journalEntryCount: 0,
      executedDecisionCount: 0,
      linkedDecisionCount: 0,
      behavioralFlagCount: 0,
      forcedLiquidationCount: 0,
    },
  };
}

function completedRunInput(id: string): CompletedRunInput {
  const source = run(id);
  return {
    report: source.report,
    runInstanceId: id,
    mode: source.mode,
    brokerMode: source.brokerMode,
    brokerFingerprint: source.brokerFingerprint!,
    completedAt: source.completedAt,
  };
}

function restoredBranchInput(
  id: string,
  completedAt = "2026-07-14T13:00:00.000Z",
): CompletedRunInput {
  const input = completedRunInput(id);
  return {
    ...input,
    completedAt,
    report: {
      ...input.report,
      metrics: {
        ...input.report.metrics,
        totalReturn: 0.1,
        excessReturn: 0.1,
        finalEquity: 11_000,
      },
    },
  };
}

function legacyLedger(entries: PracticeLedgerEntry[]): string {
  return JSON.stringify({
    format: PRACTICE_LEDGER_FORMAT,
    version: PRACTICE_LEDGER_VERSION,
    entries,
  });
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  return { storage, values };
}

describe("canonical practice archive storage", () => {
  it("commits and strictly reads both layers from one canonical key", () => {
    const { storage } = memoryStorage();
    const data = { runs: [run("new")], ledger: [ledger("new")] };

    expect(persistPracticeArchiveAtomically(data, storage)).toEqual(data);
    expect(storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toContain(
      '"id":"new"',
    );
    expect(storage.getItem(RUN_HISTORY_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(PRACTICE_LEDGER_STORAGE_KEY)).toBeNull();
    expect(loadStoredPracticeArchiveData(storage)).toEqual(data);
  });

  it("falls back to legacy layers and migrates them without losing either layer", () => {
    const data = { runs: [run("legacy")], ledger: [ledger("legacy")] };
    const { storage } = memoryStorage({
      [RUN_HISTORY_STORAGE_KEY]: JSON.stringify(data.runs),
      [PRACTICE_LEDGER_STORAGE_KEY]: legacyLedger(data.ledger),
    });

    expect(loadStoredPracticeArchiveData(storage)).toEqual(data);
    expect(storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(RUN_HISTORY_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(PRACTICE_LEDGER_STORAGE_KEY)).toBeNull();
    expect(loadStoredPracticeArchiveData(storage)).toEqual(data);
  });

  it("can read validated legacy layers without mutating storage", () => {
    const data = { runs: [run("legacy-read-only")], ledger: [ledger("legacy-read-only")] };
    const { storage } = memoryStorage({
      [RUN_HISTORY_STORAGE_KEY]: JSON.stringify(data.runs),
      [PRACTICE_LEDGER_STORAGE_KEY]: legacyLedger(data.ledger),
    });

    expect(
      loadStoredPracticeArchiveData(storage, { migrateLegacy: false }),
    ).toEqual(data);
    expect(storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(RUN_HISTORY_STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(PRACTICE_LEDGER_STORAGE_KEY)).not.toBeNull();
  });

  it("merges a canonical archive that appears during legacy migration", () => {
    const legacy = {
      runs: [run("legacy-race")],
      ledger: [ledger("legacy-race")],
    };
    const concurrent = {
      runs: [run("concurrent-race")],
      ledger: [ledger("concurrent-race")],
    };
    const { storage: base } = memoryStorage({
      [RUN_HISTORY_STORAGE_KEY]: JSON.stringify(legacy.runs),
      [PRACTICE_LEDGER_STORAGE_KEY]: legacyLedger(legacy.ledger),
    });
    let canonicalReads = 0;
    const storage = {
      ...base,
      getItem: (key: string) => {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY) {
          canonicalReads += 1;
          // The outer loader, legacy run reader, and legacy ledger reader each
          // confirmed that the canonical key was missing. Inject immediately
          // before the migration mutation takes its own snapshot.
          if (canonicalReads === 4) {
            base.setItem(
              key,
              serializePracticeArchiveEnvelope(
                concurrent,
                1,
                "concurrent-migration",
              ),
            );
          }
        }
        return base.getItem(key);
      },
    };

    const saved = loadStoredPracticeArchiveData(storage);

    expect(saved.runs.map((entry) => entry.id).sort()).toEqual([
      "concurrent-race",
      "legacy-race",
    ]);
    expect(saved.ledger.map((entry) => entry.id).sort()).toEqual([
      "concurrent-race",
      "legacy-race",
    ]);
    expect(loadStoredPracticeArchiveData(base)).toEqual(saved);
    expect(base.getItem(RUN_HISTORY_STORAGE_KEY)).toBeNull();
    expect(base.getItem(PRACTICE_LEDGER_STORAGE_KEY)).toBeNull();
  });

  it("reads revisionless canonical v1 bytes and upgrades them on mutation", () => {
    const legacyData = {
      runs: [run("legacy-canonical")],
      ledger: [ledger("legacy-canonical")],
    };
    const revisionless = JSON.parse(
      serializePracticeArchiveEnvelope(legacyData),
    ) as Record<string, unknown>;
    delete revisionless.revision;
    delete revisionless.commitId;
    const { storage } = memoryStorage({
      [PRACTICE_ARCHIVE_STORAGE_KEY]: JSON.stringify(revisionless),
    });

    expect(loadStoredPracticeArchiveData(storage)).toEqual(legacyData);
    recordCompletedPracticeRunAtomically(
      completedRunInput("after-revision-upgrade"),
      storage,
    );
    const state = inspectPracticeArchiveEnvelope(storage);
    expect(state.status).toBe("valid");
    if (state.status === "valid") {
      expect(state.envelope.revision).toBe(1);
      expect(state.envelope.commitId).not.toBe("legacy-v1");
    }
  });

  it("refuses to migrate a legacy aggregate with foreign compact evidence", () => {
    const legacyRun = run("legacy-owner");
    const foreignLedger = {
      ...ledger("foreign-ledger"),
      runId: legacyRun.id,
      runInstanceId: undefined,
    };
    const serializedRuns = JSON.stringify([legacyRun]);
    const serializedLedger = legacyLedger([foreignLedger]);
    const { storage } = memoryStorage({
      [RUN_HISTORY_STORAGE_KEY]: serializedRuns,
      [PRACTICE_LEDGER_STORAGE_KEY]: serializedLedger,
    });

    expect(loadStoredPracticeArchiveData(storage)).toEqual({
      runs: [],
      ledger: [],
    });
    expect(() =>
      recordCompletedPracticeRunAtomically(
        completedRunInput("must-not-overwrite-invalid-legacy"),
        storage,
      ),
    ).toThrow(/damaged or unreadable/i);
    expect(storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(RUN_HISTORY_STORAGE_KEY)).toBe(serializedRuns);
    expect(storage.getItem(PRACTICE_LEDGER_STORAGE_KEY)).toBe(serializedLedger);
  });

  it("records a completed run and derived evidence with exactly one canonical write", () => {
    const { storage: base } = memoryStorage();
    let canonicalWrites = 0;
    const storage = {
      ...base,
      setItem: (key: string, value: string) => {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY) canonicalWrites += 1;
        base.setItem(key, value);
      },
    };

    const saved = recordCompletedPracticeRunAtomically(
      completedRunInput("atomic-new"),
      storage,
    );

    expect(canonicalWrites).toBe(1);
    expect(saved).toMatchObject({
      added: true,
      ledgerBackfilled: true,
      run: { id: "atomic-new" },
    });
    expect(saved.runs.map((entry) => entry.id)).toEqual(["atomic-new"]);
    expect(saved.ledger.map((entry) => entry.id)).toEqual(["atomic-new"]);
    expect(loadStoredPracticeArchiveData(storage)).toEqual({
      runs: saved.runs,
      ledger: saved.ledger,
    });
  });

  it("backfills missing evidence for a duplicate completed run in one commit", () => {
    const existing = run("duplicate-run");
    const { storage: base } = memoryStorage();
    persistPracticeArchiveAtomically({ runs: [existing], ledger: [] }, base);
    let canonicalWrites = 0;
    const storage = {
      ...base,
      setItem: (key: string, value: string) => {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY) canonicalWrites += 1;
        base.setItem(key, value);
      },
    };

    const saved = recordCompletedPracticeRunAtomically(
      completedRunInput("duplicate-run"),
      storage,
    );

    expect(canonicalWrites).toBe(1);
    expect(saved.added).toBe(false);
    expect(saved.ledgerBackfilled).toBe(true);
    expect(saved.runs).toEqual([existing]);
    expect(saved.ledger.map((entry) => entry.id)).toEqual(["duplicate-run"]);
  });

  it("forks divergent completions from a restored run identity and keeps exact repeats idempotent", () => {
    const { storage: base } = memoryStorage();
    const first = recordCompletedPracticeRunAtomically(
      completedRunInput("restored-session"),
      base,
    );
    const second = recordCompletedPracticeRunAtomically(
      restoredBranchInput("restored-session"),
      base,
    );

    expect(first.run.id).toBe("restored-session");
    expect(second.added).toBe(true);
    expect(second.run.id).toMatch(
      /^restored-session~branch-[0-9a-f]{16}$/,
    );
    expect(second.runs.map((entry) => entry.id)).toEqual([
      second.run.id,
      "restored-session",
    ]);
    expect(second.ledger.map((entry) => entry.id)).toEqual([
      second.run.id,
      "restored-session",
    ]);
    expect(second.runs.map((entry) => entry.totalReturn).sort()).toEqual([
      0,
      0.1,
    ]);

    const repeated = recordCompletedPracticeRunAtomically(
      restoredBranchInput("restored-session", "2026-07-14T14:00:00.000Z"),
      base,
    );
    expect(repeated.added).toBe(false);
    expect(repeated.run.id).toBe(second.run.id);
    expect(repeated.runs).toHaveLength(2);
    expect(repeated.ledger).toHaveLength(2);
  });

  it("retains both completion branches while respecting full and compact caps", () => {
    const original = run("capped-restored-session");
    const otherRuns = Array.from({ length: 11 }, (_, index) =>
      run(`capped-run-${index}`),
    );
    const futureLedger = Array.from({ length: 249 }, (_, index) => ({
      ...ledger(`future-evidence-${index}`),
      completedAt: new Date(Date.UTC(2030, 0, 1, 0, index)).toISOString(),
    }));
    const { storage } = memoryStorage();
    persistPracticeArchiveAtomically(
      {
        runs: [...otherRuns, original],
        ledger: [...futureLedger, ledger(original.id)],
      },
      storage,
    );

    const saved = recordCompletedPracticeRunAtomically(
      restoredBranchInput(original.id),
      storage,
    );

    expect(saved.runs).toHaveLength(12);
    expect(saved.runs.some((entry) => entry.id === original.id)).toBe(true);
    expect(saved.runs.some((entry) => entry.id === saved.run.id)).toBe(true);
    expect(saved.ledger).toHaveLength(MAX_PRACTICE_LEDGER_ENTRIES);
    expect(saved.ledger.some((entry) => entry.id === original.id)).toBe(true);
    expect(saved.ledger.some((entry) => entry.id === saved.run.id)).toBe(true);
  });

  it("rebases a record when another tab commits before the expected-byte check", () => {
    const { storage: base } = memoryStorage();
    persistPracticeArchiveAtomically(
      { runs: [run("seed")], ledger: [ledger("seed")] },
      base,
    );
    let canonicalReads = 0;
    let injected = false;
    const storage = {
      ...base,
      getItem: (key: string) => {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY) {
          canonicalReads += 1;
          if (canonicalReads === 2 && !injected) {
            injected = true;
            recordCompletedPracticeRunAtomically(
              completedRunInput("other-tab"),
              base,
            );
          }
        }
        return base.getItem(key);
      },
    };

    const saved = recordCompletedPracticeRunAtomically(
      completedRunInput("foreground-tab"),
      storage,
    );

    expect(saved.runs.map((entry) => entry.id).sort()).toEqual([
      "foreground-tab",
      "other-tab",
      "seed",
    ]);
    expect(saved.ledger.map((entry) => entry.id).sort()).toEqual([
      "foreground-tab",
      "other-tab",
      "seed",
    ]);
    const state = inspectPracticeArchiveEnvelope(base);
    expect(state.status).toBe("valid");
    if (state.status === "valid") expect(state.envelope.revision).toBe(3);
  });

  it("preserves a newer commit that lands after this writer's canonical set", () => {
    const { storage: base } = memoryStorage();
    persistPracticeArchiveAtomically(
      { runs: [run("seed")], ledger: [ledger("seed")] },
      base,
    );
    let injected = false;
    const storage = {
      ...base,
      setItem: (key: string, value: string) => {
        base.setItem(key, value);
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY && !injected) {
          injected = true;
          recordCompletedPracticeRunAtomically(
            completedRunInput("after-set-tab"),
            base,
          );
        }
      },
    };

    const saved = recordCompletedPracticeRunAtomically(
      completedRunInput("setting-tab"),
      storage,
    );

    expect(saved.runs.map((entry) => entry.id).sort()).toEqual([
      "after-set-tab",
      "seed",
      "setting-tab",
    ]);
    expect(loadStoredPracticeArchiveData(base)).toEqual({
      runs: saved.runs,
      ledger: saved.ledger,
    });
  });

  it("retains a newly completed run's compact evidence at the 250-entry cap", () => {
    const futureLedger = Array.from(
      { length: MAX_PRACTICE_LEDGER_ENTRIES },
      (_, index) => ({
        ...ledger(`future-${index}`),
        completedAt: new Date(Date.UTC(2030, 0, 1, 0, index)).toISOString(),
      }),
    );
    const { storage } = memoryStorage();
    persistPracticeArchiveAtomically(
      { runs: [], ledger: futureLedger },
      storage,
    );

    const saved = recordCompletedPracticeRunAtomically(
      completedRunInput("fresh-local-run"),
      storage,
    );

    expect(saved.added).toBe(true);
    expect(saved.ledgerBackfilled).toBe(true);
    expect(saved.ledger).toHaveLength(MAX_PRACTICE_LEDGER_ENTRIES);
    expect(saved.ledger.some((entry) => entry.id === "fresh-local-run")).toBe(
      true,
    );
    expect(
      saved.ledger.filter((entry) => entry.id.startsWith("future-")),
    ).toHaveLength(MAX_PRACTICE_LEDGER_ENTRIES - 1);
    expect(loadStoredPracticeArchiveData(storage)).toEqual({
      runs: saved.runs,
      ledger: saved.ledger,
    });
  });

  it("rolls back both layers when a completed-run canonical write is rejected", () => {
    const current = { runs: [run("old")], ledger: [ledger("old")] };
    const { storage: base } = memoryStorage();
    persistPracticeArchiveAtomically(current, base);
    const previous = base.getItem(PRACTICE_ARCHIVE_STORAGE_KEY);
    const storage = {
      ...base,
      setItem: (key: string, value: string) => {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY) throw new Error("quota");
        base.setItem(key, value);
      },
    };

    expect(() =>
      recordCompletedPracticeRunAtomically(
        completedRunInput("quota-run"),
        storage,
      ),
    ).toThrow(/Existing practice history was kept/i);
    expect(storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(previous);
    expect(loadStoredPracticeArchiveData(storage)).toEqual(current);
  });

  it("refuses to overwrite a malformed canonical archive from stale legacy data", () => {
    const legacy = { runs: [run("legacy")], ledger: [ledger("legacy")] };
    const { storage } = memoryStorage({
      [PRACTICE_ARCHIVE_STORAGE_KEY]: "{damaged-json",
      [RUN_HISTORY_STORAGE_KEY]: JSON.stringify(legacy.runs),
      [PRACTICE_LEDGER_STORAGE_KEY]: legacyLedger(legacy.ledger),
    });

    expect(() =>
      recordCompletedPracticeRunAtomically(
        completedRunInput("must-not-write"),
        storage,
      ),
    ).toThrow(/damaged or unreadable/i);
    expect(storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
      "{damaged-json",
    );
    expect(storage.getItem(RUN_HISTORY_STORAGE_KEY)).toBe(
      JSON.stringify(legacy.runs),
    );
    expect(storage.getItem(PRACTICE_LEDGER_STORAGE_KEY)).toBe(
      legacyLedger(legacy.ledger),
    );
  });

  it("exports damage state and explicitly removes canonical plus stale legacy layers", () => {
    const damaged = "{damaged-json";
    const { storage } = memoryStorage({
      [PRACTICE_ARCHIVE_STORAGE_KEY]: damaged,
      [RUN_HISTORY_STORAGE_KEY]: JSON.stringify([run("stale-run")]),
      [PRACTICE_LEDGER_STORAGE_KEY]: legacyLedger([ledger("stale-run")]),
    });

    expect(inspectStoredPracticeArchiveDamage(storage)).toEqual({
      damaged: true,
      serialized: damaged,
    });
    expect(discardDamagedPracticeArchiveAtomically(storage)).toEqual({
      runs: [],
      ledger: [],
    });
    expect(storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(RUN_HISTORY_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(PRACTICE_LEDGER_STORAGE_KEY)).toBeNull();
    expect(inspectStoredPracticeArchiveDamage(storage)).toEqual({
      damaged: false,
    });
    expect(
      recordCompletedPracticeRunAtomically(
        completedRunInput("after-recovery"),
        storage,
      ).run.id,
    ).toBe("after-recovery");
  });

  it("restores every archive layer when damaged-history removal is interrupted", () => {
    const initial = {
      [PRACTICE_ARCHIVE_STORAGE_KEY]: "{damaged-json",
      [RUN_HISTORY_STORAGE_KEY]: JSON.stringify([run("stale-run")]),
      [PRACTICE_LEDGER_STORAGE_KEY]: legacyLedger([ledger("stale-run")]),
    };
    const { storage: base } = memoryStorage(initial);
    let rejected = false;
    const storage = {
      ...base,
      removeItem: (key: string) => {
        if (key === RUN_HISTORY_STORAGE_KEY && !rejected) {
          rejected = true;
          throw new Error("blocked removal");
        }
        base.removeItem(key);
      },
    };

    expect(() => discardDamagedPracticeArchiveAtomically(storage)).toThrow(
      /existing bytes were kept/i,
    );
    for (const [key, value] of Object.entries(initial)) {
      expect(storage.getItem(key)).toBe(value);
    }
  });

  it("does not roll damaged-history recovery back over a newer canonical commit", () => {
    const initial = {
      [PRACTICE_ARCHIVE_STORAGE_KEY]: "{damaged-json",
      [RUN_HISTORY_STORAGE_KEY]: JSON.stringify([run("stale-run")]),
      [PRACTICE_LEDGER_STORAGE_KEY]: legacyLedger([ledger("stale-run")]),
    };
    const { storage: base } = memoryStorage(initial);
    let injected = false;
    const storage = {
      ...base,
      removeItem: (key: string) => {
        base.removeItem(key);
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY && !injected) {
          injected = true;
          recordCompletedPracticeRunAtomically(
            completedRunInput("newer-tab-run"),
            base,
          );
        }
      },
    };

    expect(() => discardDamagedPracticeArchiveAtomically(storage)).toThrow(
      /another browser tab.*not removed/i,
    );
    const retained = loadStoredPracticeArchiveData(base);
    expect(retained.runs.some((entry) => entry.id === "newer-tab-run")).toBe(
      true,
    );
    expect(inspectStoredPracticeArchiveDamage(base)).toEqual({
      damaged: false,
    });
  });

  it.each([
    ["malformed JSON", "{damaged-json"],
    [
      "invalid domain data",
      serializePracticeArchiveEnvelope({
        runs: [{ id: "invalid-run" }],
        ledger: [],
      }),
    ],
  ])(
    "refuses a replacement write over canonical %s",
    (_label, damagedCanonical) => {
      const { storage } = memoryStorage({
        [PRACTICE_ARCHIVE_STORAGE_KEY]: damagedCanonical,
      });

      expect(() =>
        persistPracticeArchiveAtomically(
          { runs: [run("replacement")], ledger: [ledger("replacement")] },
          storage,
        ),
      ).toThrow(/stored practice archive is damaged and was left unchanged/i);
      expect(storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
        damagedCanonical,
      );
    },
  );

  it("keeps the previous canonical snapshot when a quota write is rejected", () => {
    const previous = {
      runs: [run("old")],
      ledger: [ledger("old")],
    };
    const previousSerialized = serializePracticeArchiveEnvelope(previous);
    const { storage: base } = memoryStorage({
      [PRACTICE_ARCHIVE_STORAGE_KEY]: previousSerialized,
    });
    const storage = {
      ...base,
      setItem: (key: string, value: string) => {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY) throw new Error("quota");
        base.setItem(key, value);
      },
    };

    expect(() =>
      persistPracticeArchiveAtomically(
        { runs: [run("new")], ledger: [ledger("new")] },
        storage,
      ),
    ).toThrow(/No archive changes were kept/i);
    expect(storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
      previousSerialized,
    );
    expect(loadStoredPracticeArchiveData(storage)).toEqual(previous);
  });

  it("fails a semantically invalid canonical envelope closed as one snapshot", () => {
    const legacy = { runs: [run("legacy")], ledger: [ledger("legacy")] };
    const { storage } = memoryStorage({
      [PRACTICE_ARCHIVE_STORAGE_KEY]: serializePracticeArchiveEnvelope({
        runs: [{ id: "malformed-run" }],
        ledger: [ledger("canonical-ledger")],
      }),
      [RUN_HISTORY_STORAGE_KEY]: JSON.stringify(legacy.runs),
      [PRACTICE_LEDGER_STORAGE_KEY]: legacyLedger(legacy.ledger),
    });

    expect(loadStoredPracticeArchiveData(storage)).toEqual({
      runs: [],
      ledger: [],
    });
  });

  it("fails a cross-layer identity collision closed and preserves its raw bytes", () => {
    const fullRun = {
      ...run("canonical-run"),
      runInstanceId: "canonical-instance",
    };
    const foreignLedger = {
      ...ledger("foreign-ledger"),
      id: "canonical-instance",
    };
    const damagedCanonical = serializePracticeArchiveEnvelope({
      runs: [fullRun],
      ledger: [foreignLedger],
    });
    const { storage } = memoryStorage({
      [PRACTICE_ARCHIVE_STORAGE_KEY]: damagedCanonical,
    });

    expect(loadStoredPracticeArchiveData(storage)).toEqual({
      runs: [],
      ledger: [],
    });
    expect(() =>
      persistPracticeArchiveAtomically(
        { runs: [run("replacement")], ledger: [] },
        storage,
      ),
    ).toThrow(/stored practice archive is damaged and was left unchanged/i);
    expect(storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
      damagedCanonical,
    );
  });

  it("does not resurrect stale legacy layers when the canonical envelope is malformed", () => {
    const legacy = { runs: [run("legacy")], ledger: [ledger("legacy")] };
    const { storage } = memoryStorage({
      [PRACTICE_ARCHIVE_STORAGE_KEY]: "{damaged-json",
      [RUN_HISTORY_STORAGE_KEY]: JSON.stringify(legacy.runs),
      [PRACTICE_LEDGER_STORAGE_KEY]: legacyLedger(legacy.ledger),
    });

    expect(loadStoredPracticeArchiveData(storage)).toEqual({
      runs: [],
      ledger: [],
    });
  });

  it("rejects and removes a first canonical write whose exact readback differs", () => {
    const { storage: base, values } = memoryStorage();
    const storage = {
      ...base,
      setItem: (key: string, value: string) => {
        values.set(key, key === PRACTICE_ARCHIVE_STORAGE_KEY ? `${value} ` : value);
      },
    };

    expect(() =>
      persistPracticeArchiveAtomically(
        { runs: [run("new")], ledger: [ledger("new")] },
        storage,
      ),
    ).toThrow(/No archive changes were kept/i);
    expect(storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBeNull();
  });

  it("rolls back storage implementations that mutate before throwing", () => {
    const previous = {
      runs: [run("old")],
      ledger: [ledger("old")],
    };
    const previousSerialized = serializePracticeArchiveEnvelope(previous);
    const { storage: base, values } = memoryStorage({
      [PRACTICE_ARCHIVE_STORAGE_KEY]: previousSerialized,
    });
    let firstCanonicalWrite = true;
    const storage = {
      ...base,
      setItem: (key: string, value: string) => {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY && firstCanonicalWrite) {
          firstCanonicalWrite = false;
          values.set(key, value);
          throw new Error("quota after mutation");
        }
        base.setItem(key, value);
      },
    };

    expect(() =>
      persistPracticeArchiveAtomically(
        { runs: [run("new")], ledger: [ledger("new")] },
        storage,
      ),
    ).toThrow(/No archive changes were kept/i);
    expect(storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
      previousSerialized,
    );
  });

  it("keeps a verified canonical commit when legacy removeItem cleanup fails", () => {
    const old = { runs: [run("old")], ledger: [ledger("old")] };
    const next = { runs: [run("new")], ledger: [ledger("new")] };
    const { storage: base } = memoryStorage({
      [RUN_HISTORY_STORAGE_KEY]: JSON.stringify(old.runs),
      [PRACTICE_LEDGER_STORAGE_KEY]: legacyLedger(old.ledger),
    });
    const storage = {
      ...base,
      removeItem: () => {
        throw new Error("privacy mode remove failure");
      },
    };

    expect(persistPracticeArchiveAtomically(next, storage)).toEqual(next);
    expect(loadStoredPracticeArchiveData(storage)).toEqual(next);
    expect(storage.getItem(RUN_HISTORY_STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(PRACTICE_LEDGER_STORAGE_KEY)).not.toBeNull();
  });

  it("rebases an import onto a canonical record committed by another tab", () => {
    const seed = { runs: [run("seed")], ledger: [ledger("seed")] };
    const imported = {
      runs: [run("imported"), ...seed.runs],
      ledger: [ledger("imported"), ...seed.ledger],
    };
    const { storage: base } = memoryStorage();
    persistPracticeArchiveAtomically(seed, base);
    let canonicalReads = 0;
    let injected = false;
    const storage = {
      ...base,
      getItem: (key: string) => {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY) {
          canonicalReads += 1;
          if (canonicalReads === 2 && !injected) {
            injected = true;
            recordCompletedPracticeRunAtomically(
              completedRunInput("concurrent-record"),
              base,
            );
          }
        }
        return base.getItem(key);
      },
    };

    const saved = persistPracticeArchiveAtomically(imported, storage);

    expect(saved.runs.map((entry) => entry.id).sort()).toEqual([
      "concurrent-record",
      "imported",
      "seed",
    ]);
    expect(saved.ledger.map((entry) => entry.id).sort()).toEqual([
      "concurrent-record",
      "imported",
      "seed",
    ]);
  });

  it("reports an unverifiable rollback when removing a partial first write fails", () => {
    const { storage: base, values } = memoryStorage();
    let failWrite = true;
    const storage = {
      ...base,
      setItem: (key: string, value: string) => {
        values.set(key, value);
        if (failWrite) {
          failWrite = false;
          throw new Error("quota after mutation");
        }
      },
      removeItem: () => {
        throw new Error("remove denied");
      },
    };

    expect(() =>
      persistPracticeArchiveAtomically(
        { runs: [run("new")], ledger: [ledger("new")] },
        storage,
      ),
    ).toThrow(/could not be fully restored/i);
  });

  it("removes a full report and every matching compact identity in one commit", () => {
    const targetRun = {
      ...run("stored-run-id"),
      runInstanceId: "target-instance-id",
    };
    const targetLedger = {
      ...ledger("target-instance-id"),
      runId: "stored-run-id",
      runInstanceId: "target-instance-id",
    };
    const retained = { runs: [run("keep")], ledger: [ledger("keep")] };
    const { storage } = memoryStorage();
    persistPracticeArchiveAtomically(
      {
        runs: [targetRun, ...retained.runs],
        ledger: [targetLedger, ...retained.ledger],
      },
      storage,
    );

    expect(
      removePracticeArchiveRunAtomically("target-instance-id", storage),
    ).toEqual({
      ...retained,
      removedRunCount: 1,
      removedLedgerCount: 1,
    });
    expect(loadStoredPracticeArchiveData(storage)).toEqual(retained);
  });

  it("rebases a targeted removal without losing an interleaved record", () => {
    const current = {
      runs: [run("target"), run("keep")],
      ledger: [ledger("target"), ledger("keep")],
    };
    const { storage: base } = memoryStorage();
    persistPracticeArchiveAtomically(current, base);
    let canonicalReads = 0;
    let injected = false;
    const storage = {
      ...base,
      getItem: (key: string) => {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY) {
          canonicalReads += 1;
          if (canonicalReads === 2 && !injected) {
            injected = true;
            recordCompletedPracticeRunAtomically(
              completedRunInput("concurrent-record"),
              base,
            );
          }
        }
        return base.getItem(key);
      },
    };

    const saved = removePracticeArchiveRunAtomically("target", storage);

    expect(saved.removedRunCount).toBe(1);
    expect(saved.removedLedgerCount).toBe(1);
    expect(saved.runs.map((entry) => entry.id).sort()).toEqual([
      "concurrent-record",
      "keep",
    ]);
    expect(saved.ledger.map((entry) => entry.id).sort()).toEqual([
      "concurrent-record",
      "keep",
    ]);
  });

  it("keeps both layers unchanged when an atomic run removal is rejected", () => {
    const current = { runs: [run("target")], ledger: [ledger("target")] };
    const { storage: base } = memoryStorage();
    persistPracticeArchiveAtomically(current, base);
    const previous = base.getItem(PRACTICE_ARCHIVE_STORAGE_KEY);
    const storage = {
      ...base,
      setItem: (key: string, value: string) => {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY) throw new Error("quota");
        base.setItem(key, value);
      },
    };

    expect(() =>
      removePracticeArchiveRunAtomically("target", storage),
    ).toThrow(/Existing practice history was kept/i);
    expect(storage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(previous);
    expect(loadStoredPracticeArchiveData(storage)).toEqual(current);
  });

  it("clears both layers with one verified canonical write", () => {
    const { storage } = memoryStorage();
    persistPracticeArchiveAtomically(
      { runs: [run("old")], ledger: [ledger("old")] },
      storage,
    );

    expect(clearPracticeArchiveAtomically(storage)).toEqual({
      runs: [],
      ledger: [],
    });
    expect(loadStoredPracticeArchiveData(storage)).toEqual({
      runs: [],
      ledger: [],
    });
  });

  it("refuses a stale clear and preserves the record committed during it", () => {
    const current = { runs: [run("old")], ledger: [ledger("old")] };
    const { storage: base } = memoryStorage();
    persistPracticeArchiveAtomically(current, base);
    let canonicalReads = 0;
    let injected = false;
    const storage = {
      ...base,
      getItem: (key: string) => {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY) {
          canonicalReads += 1;
          if (canonicalReads === 2 && !injected) {
            injected = true;
            recordCompletedPracticeRunAtomically(
              completedRunInput("concurrent-record"),
              base,
            );
          }
        }
        return base.getItem(key);
      },
    };

    expect(() => clearPracticeArchiveAtomically(storage)).toThrow(
      /another browser tab.*not cleared/i,
    );
    expect(loadStoredPracticeArchiveData(base).runs.map((entry) => entry.id).sort()).toEqual([
      "concurrent-record",
      "old",
    ]);
  });
});
