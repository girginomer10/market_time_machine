import { beforeEach, describe, expect, it } from "vitest";
import type { ReportPayload } from "../../types";
import {
  clearRunHistory,
  compareRunWithPrevious,
  loadRunHistory,
  recordCompletedRun,
  removeCompletedRun,
  runHistoryStats,
} from "./runHistory";

function report(overrides: Partial<ReportPayload> = {}): ReportPayload {
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
    behavioralFlags: [],
    provenance: {
      license: "CC0",
      dataSources: ["Fixture"],
      isSampleData: false,
    },
    score: {
      status: "scored",
      overall: 72,
      methodology: "Fixture",
      components: [],
    },
    journalQuality: {
      status: "assessed",
      score: 80,
      executedDecisionCount: 1,
      linkedEntryCount: 1,
      coverageRate: 1,
      reasonRate: 1,
      riskPlanRate: 1,
      evidence: [],
    },
    ...overrides,
  };
}

describe("run history", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("archives a completed report and deduplicates the same replay", () => {
    const first = recordCompletedRun({
      report: report(),
      runInstanceId: "run-one",
      mode: "explorer",
      brokerMode: "scenario",
      currency: "EUR",
      pricePrecision: 5,
      completedAt: "2026-07-13T10:00:00.000Z",
    });
    const duplicate = recordCompletedRun({
      report: report(),
      runInstanceId: "run-one",
      mode: "explorer",
      brokerMode: "scenario",
      completedAt: "2026-07-13T11:00:00.000Z",
    });

    expect(first.added).toBe(true);
    expect(duplicate.added).toBe(false);
    expect(loadRunHistory()).toHaveLength(1);
    expect(loadRunHistory()[0]).toMatchObject({
      scenarioTitle: "Scenario A",
      id: "run-one",
      runInstanceId: "run-one",
      currency: "EUR",
      pricePrecision: 5,
      score: 72,
      sampleData: false,
      journalCoverage: 1,
    });
  });

  it("keeps identical results from distinct replay sessions as separate evidence", () => {
    recordCompletedRun({
      report: report(),
      runInstanceId: "run-one",
      mode: "explorer",
      brokerMode: "scenario",
      completedAt: "2026-07-13T10:00:00.000Z",
    });
    recordCompletedRun({
      report: report(),
      runInstanceId: "run-two",
      mode: "explorer",
      brokerMode: "scenario",
      completedAt: "2026-07-13T11:00:00.000Z",
    });

    expect(loadRunHistory().map((run) => run.id)).toEqual([
      "run-two",
      "run-one",
    ]);
  });

  it("compares repeated runs and summarizes learner progress", () => {
    const older = recordCompletedRun({
      report: report({
        metrics: { ...report().metrics, totalReturn: 0.04, excessReturn: -0.01 },
      }),
      mode: "professional",
      brokerMode: "realistic",
      completedAt: "2026-07-12T10:00:00.000Z",
    }).run;
    const newer = recordCompletedRun({
      report: report({
        metrics: { ...report().metrics, totalReturn: 0.12, excessReturn: 0.07 },
        score: {
          status: "scored",
          overall: 84,
          methodology: "Fixture",
          components: [],
        },
      }),
      mode: "professional",
      brokerMode: "realistic",
      completedAt: "2026-07-13T10:00:00.000Z",
    }).run;
    const history = loadRunHistory();

    expect(history.map((run) => run.id)).toEqual([newer.id, older.id]);
    const comparison = compareRunWithPrevious(newer, history);
    expect(comparison.previous?.id).toBe(older.id);
    expect(comparison.returnDelta).toBeCloseTo(0.08);
    expect(comparison.excessReturnDelta).toBeCloseTo(0.08);
    expect(runHistoryStats(history)).toMatchObject({
      completedRuns: 2,
      scenariosCompleted: 1,
      journaledRuns: 0,
      bestScore: 84,
      averageScore: 78,
    });
  });

  it("drops malformed storage entries and supports removal and clearing", () => {
    window.localStorage.setItem(
      "market-time-machine.run-history.v1",
      JSON.stringify([{ id: "unsafe" }]),
    );
    expect(loadRunHistory()).toEqual([]);

    const saved = recordCompletedRun({
      report: report(),
      mode: "explorer",
      brokerMode: "scenario",
    }).run;
    expect(removeCompletedRun(saved.id)).toEqual([]);

    recordCompletedRun({
      report: report(),
      mode: "explorer",
      brokerMode: "scenario",
    });
    clearRunHistory();
    expect(loadRunHistory()).toEqual([]);
  });

  it("drops a stored report with malformed nested render data", () => {
    const saved = recordCompletedRun({
      report: report(),
      runInstanceId: "nested-malformed-run",
      mode: "explorer",
      brokerMode: "scenario",
      completedAt: "2026-07-13T10:00:00.000Z",
    }).run;
    window.localStorage.setItem(
      "market-time-machine.run-history.v1",
      JSON.stringify([
        {
          ...saved,
          report: {
            ...saved.report,
            behavioralFlags: [null],
          },
        },
      ]),
    );

    expect(loadRunHistory()).toEqual([]);
  });
});
