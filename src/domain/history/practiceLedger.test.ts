import { beforeEach, describe, expect, it } from "vitest";
import type { CompletedRun } from "./runHistory";
import type { DrillAssessment, ReportPayload } from "../../types";
import {
  MAX_PRACTICE_LEDGER_ENTRIES,
  PRACTICE_LEDGER_FORMAT,
  PRACTICE_LEDGER_STORAGE_KEY,
  PRACTICE_LEDGER_VERSION,
  clearPracticeLedger,
  derivePracticeLedgerEntry,
  loadPracticeLedger,
  parseDrillAssessment,
  persistPracticeLedger,
  reconcilePracticeLedger,
  recordPracticeLedgerEntry,
  removePracticeLedgerEntry,
} from "./practiceLedger";

function assessment(score = 80): DrillAssessment {
  return {
    drillId: "event-discipline-v1",
    definitionVersion: 1,
    rubricVersion: "event-process-v1",
    status: "completed",
    overallScore: score,
    methodology: "Process-only fixture rubric.",
    components: [
      "plan_coverage",
      "checkpoint_coverage",
      "event_linkage",
      "rule_adherence",
    ].map((id) => ({
      id: id as DrillAssessment["components"][number]["id"],
      label: id,
      weight: 0.25,
      status: "assessed" as const,
      score,
      evidence: "Fixture counts only.",
    })),
    eligibleCheckpointCount: 5,
    answeredCheckpointCount: 5,
    skippedCheckpointCount: 0,
    eligibleEventCount: 6,
    linkedEventCount: 6,
    violationCount: 0,
  };
}

function report(): ReportPayload {
  return {
    scenarioId: "scenario-a",
    scenarioTitle: "Scenario A",
    metrics: {
      totalReturn: 0.1,
      benchmarkReturn: 0.05,
      excessReturn: 0.05,
      maxDrawdown: 0.08,
      volatility: 0.2,
      winRate: 0.5,
      exposureTime: 0.4,
      turnover: 1,
      feesPaid: 2,
      slippagePaid: 1,
      initialEquity: 10_000,
      finalEquity: 11_000,
      benchmarkInitial: 10_000,
      benchmarkFinal: 10_500,
    },
    equityCurve: [],
    totalTrades: 1,
    behavioralFlags: [
      {
        id: "flag-1",
        type: "overtrading",
        severity: 2,
        tradeIds: [],
        evidence: "System-generated evidence.",
      },
    ],
    journal: [
      {
        id: "journal-1",
        time: "2026-07-13T09:00:00.000Z",
        note: "PRIVATE JOURNAL TEXT MUST NOT ENTER THE LEDGER",
      },
    ],
    journalQuality: {
      status: "assessed",
      score: 80,
      executedDecisionCount: 4,
      linkedEntryCount: 3,
      coverageRate: 0.75,
      reasonRate: 2 / 3,
      riskPlanRate: 0.5,
      structuredPlanRate: 0.5,
      eventLinkRate: 0.25,
      evidence: [],
    },
    executionQuality: {
      totalFills: 5,
      partialFillCount: 0,
      rejectedOrderCount: 0,
      expiredOrderCount: 0,
      forcedLiquidationCount: 1,
      marginEventCount: 1,
      borrowCostPaid: 0,
    },
    provenance: {
      license: "Fixture",
      dataSources: ["Fixture source"],
      dataVersion: "scenario-a-data-v1",
      isSampleData: false,
      dataFidelity: "observed",
    },
  };
}

function completedRun(
  id = "run-1",
  completedAt = "2026-07-13T10:00:00.000Z",
  overrides: Partial<CompletedRun> = {},
): CompletedRun {
  return {
    id,
    runInstanceId: id,
    completedAt,
    scenarioId: "scenario-a",
    scenarioTitle: "Scenario A",
    mode: "explorer",
    brokerMode: "scenario",
    sampleData: false,
    totalReturn: 0.1,
    benchmarkReturn: 0.05,
    excessReturn: 0.05,
    maxDrawdown: 0.08,
    scoreStatus: "scored",
    score: 99,
    executionCount: 5,
    closedTradeCount: 1,
    journalEntryCount: 1,
    journalCoverage: 0.75,
    report: report(),
    ...overrides,
  };
}

describe("practice ledger", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("derives compact factual evidence without copying private replay text", () => {
    const entry = derivePracticeLedgerEntry(completedRun(), assessment());

    expect(entry).toMatchObject({
      id: "run-1",
      runId: "run-1",
      runInstanceId: "run-1",
      scenarioDataVersion: "scenario-a-data-v1",
      scenarioDataFidelity: "observed",
      sampleData: false,
      mode: "explorer",
      brokerMode: "scenario",
      facts: {
        executionCount: 5,
        closedTradeCount: 1,
        journalEntryCount: 1,
        executedDecisionCount: 4,
        linkedDecisionCount: 3,
        behavioralFlagCount: 1,
        forcedLiquidationCount: 1,
        journalCoverage: 0.75,
        structuredPlanRate: 0.5,
        eventLinkRate: 0.25,
      },
      assessment: { overallScore: 80 },
    });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("PRIVATE JOURNAL TEXT");
    expect(serialized).not.toContain("reflection");
    expect(serialized).not.toContain("checkpointResponses");
    expect(serialized).not.toContain('"score":99');
  });

  it("preserves a valid competency id while accepting legacy assessments without one", () => {
    const current = {
      ...assessment(),
      competencyId: "event-discipline",
    } satisfies DrillAssessment;

    expect(parseDrillAssessment(current)).toMatchObject({
      drillId: "event-discipline-v1",
      competencyId: "event-discipline",
      overallScore: 80,
    });
    expect(parseDrillAssessment(assessment())).not.toHaveProperty(
      "competencyId",
    );
    expect(
      parseDrillAssessment({ ...current, competencyId: "   " }),
    ).toBeUndefined();

    const invalidWeights = {
      ...current,
      components: current.components.map((component, index) =>
        index === 0 ? { ...component, weight: 0.5 } : component,
      ),
    };
    expect(parseDrillAssessment(invalidWeights)).toBeUndefined();

    persistPracticeLedger([
      derivePracticeLedgerEntry(completedRun(), current),
    ]);
    expect(loadPracticeLedger()[0].assessment?.competencyId).toBe(
      "event-discipline",
    );
  });

  it("reconciles legacy history without inventing a drill assessment", () => {
    const legacy = completedRun("legacy-id", undefined, {
      runInstanceId: undefined,
    });
    const reconciled = reconcilePracticeLedger([], [legacy]);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      id: "legacy-id",
      runId: "legacy-id",
      runInstanceId: undefined,
      assessment: undefined,
    });

    const assessed = derivePracticeLedgerEntry(legacy, assessment(70));
    const repeated = reconcilePracticeLedger([assessed], [legacy, legacy]);
    expect(repeated).toHaveLength(1);
    expect(repeated[0].assessment?.overallScore).toBe(70);

    const migratedIdentity = {
      ...assessed,
      id: "new-run-instance",
      runInstanceId: "new-run-instance",
    };
    expect(reconcilePracticeLedger([migratedIdentity], [legacy])).toEqual([
      migratedIdentity,
    ]);
  });

  it("upserts idempotently and can enrich an existing factual entry", () => {
    const run = completedRun();
    recordPracticeLedgerEntry(run);
    recordPracticeLedgerEntry(run);
    expect(loadPracticeLedger()).toHaveLength(1);
    expect(loadPracticeLedger()[0].assessment).toBeUndefined();

    recordPracticeLedgerEntry(run, assessment(88));
    recordPracticeLedgerEntry(run);
    expect(loadPracticeLedger()).toHaveLength(1);
    expect(loadPracticeLedger()[0].assessment?.overallScore).toBe(88);
  });

  it("captures an assessment already attached to a completed report", () => {
    const run = completedRun("report-assessment", undefined, {
      report: { ...report(), practiceAssessment: assessment(76) },
    });

    expect(derivePracticeLedgerEntry(run).assessment?.overallScore).toBe(76);
    expect(reconcilePracticeLedger([], [run])[0].assessment?.overallScore).toBe(
      76,
    );
  });

  it("sanitizes stored entries and drops malformed documents safely", () => {
    const entry = derivePracticeLedgerEntry(completedRun(), assessment());
    window.localStorage.setItem(
      PRACTICE_LEDGER_STORAGE_KEY,
      JSON.stringify({
        format: PRACTICE_LEDGER_FORMAT,
        version: PRACTICE_LEDGER_VERSION,
        entries: [
          {
            ...entry,
            rawJournal: "SHOULD BE STRIPPED",
            assessment: {
              ...entry.assessment,
              reflection: "SHOULD ALSO BE STRIPPED",
            },
          },
          { id: "malformed" },
        ],
      }),
    );

    const loaded = loadPracticeLedger();
    expect(loaded).toHaveLength(1);
    expect(JSON.stringify(loaded)).not.toContain("SHOULD BE STRIPPED");

    window.localStorage.setItem(
      PRACTICE_LEDGER_STORAGE_KEY,
      JSON.stringify({ format: PRACTICE_LEDGER_FORMAT, version: 99, entries: [] }),
    );
    expect(loadPracticeLedger()).toEqual([]);
    window.localStorage.setItem(PRACTICE_LEDGER_STORAGE_KEY, "not json");
    expect(loadPracticeLedger()).toEqual([]);
  });

  it("keeps the newest 250 entries and supports removal and clearing", () => {
    const entries = Array.from(
      { length: MAX_PRACTICE_LEDGER_ENTRIES + 3 },
      (_, index) =>
        derivePracticeLedgerEntry(
          completedRun(
            `run-${index}`,
            new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
          ),
        ),
    );
    const retained = persistPracticeLedger(entries);

    expect(retained).toHaveLength(MAX_PRACTICE_LEDGER_ENTRIES);
    expect(retained[0].id).toBe("run-252");
    expect(retained.at(-1)?.id).toBe("run-3");

    const afterRemoval = removePracticeLedgerEntry("run-252");
    expect(afterRemoval.some((entry) => entry.id === "run-252")).toBe(false);
    expect(afterRemoval).toHaveLength(MAX_PRACTICE_LEDGER_ENTRIES - 1);

    clearPracticeLedger();
    expect(loadPracticeLedger()).toEqual([]);
    expect(
      window.localStorage.getItem(PRACTICE_LEDGER_STORAGE_KEY),
    ).toBeNull();
  });
});
