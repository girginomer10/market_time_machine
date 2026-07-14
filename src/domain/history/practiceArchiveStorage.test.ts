import { describe, expect, it } from "vitest";
import type { CompletedRun } from "./runHistory";
import type { PracticeLedgerEntry } from "./practiceLedger";
import {
  PRACTICE_LEDGER_STORAGE_KEY,
} from "./practiceLedger";
import { RUN_HISTORY_STORAGE_KEY } from "./runHistory";
import { persistPracticeArchiveAtomically } from "./practiceArchiveStorage";

function run(id: string): CompletedRun {
  return {
    id,
    runInstanceId: id,
    completedAt: "2026-07-14T12:00:00.000Z",
    scenarioId: "scenario-a",
    scenarioTitle: "Scenario A",
    mode: "explorer",
    brokerMode: "scenario",
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

function memoryStorage(
  initial: Record<string, string> = {},
  rejectKey?: string,
): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (key === rejectKey) throw new Error("quota");
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("atomic practice archive storage", () => {
  it("persists both full reports and compact ledger entries", () => {
    const storage = memoryStorage();
    const data = { runs: [run("new")], ledger: [ledger("new")] };

    expect(persistPracticeArchiveAtomically(data, storage)).toEqual(data);
    expect(storage.getItem(RUN_HISTORY_STORAGE_KEY)).toContain('"id":"new"');
    expect(storage.getItem(PRACTICE_LEDGER_STORAGE_KEY)).toContain(
      '"id":"new"',
    );
  });

  it("restores both previous layers when either complete write cannot be retained", () => {
    const oldRuns = JSON.stringify([run("old")]);
    const oldLedger = JSON.stringify({
      format: "market-time-machine-practice-ledger",
      version: 1,
      entries: [ledger("old")],
    });
    const storage = memoryStorage(
      {
        [RUN_HISTORY_STORAGE_KEY]: oldRuns,
        [PRACTICE_LEDGER_STORAGE_KEY]: oldLedger,
      },
      PRACTICE_LEDGER_STORAGE_KEY,
    );

    expect(() =>
      persistPracticeArchiveAtomically(
        { runs: [run("new")], ledger: [ledger("new")] },
        storage,
      ),
    ).toThrow(/No archive changes were kept/i);
    expect(storage.getItem(RUN_HISTORY_STORAGE_KEY)).toBe(oldRuns);
    expect(storage.getItem(PRACTICE_LEDGER_STORAGE_KEY)).toBe(oldLedger);
  });
});
