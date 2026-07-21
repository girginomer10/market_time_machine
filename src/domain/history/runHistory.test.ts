import { beforeEach, describe, expect, it } from "vitest";
import type {
  DrillAssessment,
  DrillDefinition,
  Fill,
  ReportPayload,
} from "../../types";
import {
  PRACTICE_LEDGER_FORMAT,
  PRACTICE_LEDGER_STORAGE_KEY,
  PRACTICE_LEDGER_VERSION,
  loadPracticeLedger,
  persistPracticeLedger,
  type PracticeLedgerEntry,
} from "./practiceLedger";
import {
  buildCompletedRun,
  clearRunHistory,
  compareRunWithPrevious,
  isCompletedRun,
  loadRunHistory,
  persistRunHistory,
  recordCompletedRun as recordCompletedRunWithoutDefaults,
  removeCompletedRun,
  RUN_HISTORY_STORAGE_KEY,
  runHistoryStats,
  type CompletedRun,
  type CompletedRunInput,
} from "./runHistory";
import {
  brokerConfigFingerprint,
  HARSH_BROKER_CONFIG,
  IDEAL_BROKER_CONFIG,
} from "../broker/executionModels";
import { assessDrill } from "../practice/drills";
import {
  PRACTICE_ARCHIVE_STORAGE_KEY,
  serializePracticeArchiveEnvelope,
} from "./practiceArchiveEnvelope";
import {
  LEGACY_RUN_HISTORY_FORMAT,
  LEGACY_RUN_HISTORY_VERSION,
  parsePracticeArchive,
} from "./practiceArchive";

const TEST_BROKER_FINGERPRINT = brokerConfigFingerprint(IDEAL_BROKER_CONFIG);
const OTHER_BROKER_FINGERPRINT = brokerConfigFingerprint(HARSH_BROKER_CONFIG);

function recordCompletedRun(
  input: Omit<CompletedRunInput, "brokerFingerprint"> & {
    brokerFingerprint?: string;
  },
) {
  return recordCompletedRunWithoutDefaults({
    ...input,
    brokerFingerprint: input.brokerFingerprint ?? TEST_BROKER_FINGERPRINT,
  });
}

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

function ledgerEntry(id: string): PracticeLedgerEntry {
  return {
    id,
    runId: id,
    completedAt: "2026-07-13T10:00:00.000Z",
    scenarioId: "scenario-a",
    scenarioTitle: "Scenario A",
    sampleData: false,
    mode: "explorer",
    brokerMode: "scenario",
    facts: {
      executionCount: 1,
      closedTradeCount: 0,
      journalEntryCount: 0,
      executedDecisionCount: 1,
      linkedDecisionCount: 0,
      behavioralFlagCount: 0,
      forcedLiquidationCount: 0,
    },
  };
}

function completedAssessment(): DrillAssessment {
  return {
    drillId: "event-discipline-v1",
    competencyId: "event-discipline",
    definitionVersion: 1,
    rubricVersion: "event-discipline-rubric-v1",
    status: "completed",
    overallScore: 100,
    methodology: "Fixture",
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
      score: 100,
      evidence: "Measured.",
    })),
    eligibleCheckpointCount: 1,
    answeredCheckpointCount: 1,
    skippedCheckpointCount: 0,
    eligibleEventCount: 1,
    linkedEventCount: 1,
    violationCount: 0,
  };
}

const PRACTICE_DEFINITION: DrillDefinition = {
  id: "fixture-practice-v1",
  competencyId: "fixture-practice",
  definitionVersion: 1,
  rubricVersion: "fixture-practice-rubric-v1",
  title: "Fixture practice",
  description: "A deterministic archive-validation fixture.",
  scenarioId: "scenario-a",
  primarySymbol: "TEST",
  mode: "explorer",
  initialPlanRule: {
    requiredBeforeFirstOrder: true,
    requiredFields: ["thesis", "invalidation", "exitPlan", "acceptedRisk"],
  },
  checkpointRule: {
    minimumImportance: 3,
    mapping: "next_primary_candle_close",
    groupSameReplayIndex: true,
    requireReflection: true,
    actions: ["hold", "reduce", "exit", "wait"],
  },
  rubric: {
    weights: {
      plan_coverage: 0.25,
      checkpoint_coverage: 0.25,
      event_linkage: 0.25,
      rule_adherence: 0.25,
    },
    violationPenalty: 10,
  },
};

const PRACTICE_PLAN = {
  thesis: "The visible event supports the thesis.",
  invalidation: "Exit if the thesis is invalidated.",
  exitPlan: "Exit at the documented threshold.",
  acceptedRisk: "One percent of equity.",
  linkedEventIds: ["event-1"],
};

function practiceFill(index = 0, reason: Fill["reason"] = "user_order"): Fill {
  return {
    id: `practice-fill-${index}`,
    orderId: `practice-order-${index}`,
    time: "2026-07-13T10:00:00.000Z",
    symbol: "TEST",
    side: "buy",
    quantity: 1,
    price: 100,
    referencePrice: 100,
    commission: 0,
    spreadCost: 0,
    slippage: 0,
    totalCost: 100,
    reason,
    executionPriceSource: reason === "borrow_cost" ? "financing" : "market",
  };
}

function modernPracticeReport(): ReportPayload {
  const checkpoint = {
    id: "checkpoint-1",
    drillId: PRACTICE_DEFINITION.id,
    definitionVersion: PRACTICE_DEFINITION.definitionVersion,
    replayIndex: 1,
    replayTime: "2026-07-13T10:00:00.000Z",
    eventIds: ["event-1"],
  };
  const response = {
    id: "response-1",
    drillId: PRACTICE_DEFINITION.id,
    definitionVersion: PRACTICE_DEFINITION.definitionVersion,
    checkpointId: checkpoint.id,
    replayTime: checkpoint.replayTime,
    eventIds: [...checkpoint.eventIds],
    linkedEventIds: [...checkpoint.eventIds],
    status: "answered" as const,
    action: "hold" as const,
    reflection: "The visible event does not invalidate the documented plan.",
  };
  const assessment = assessDrill({
    definition: PRACTICE_DEFINITION,
    checkpoints: [checkpoint],
    initialPlan: PRACTICE_PLAN,
    responses: [response],
    violations: [],
    positionOpened: true,
    replayCompleted: true,
  });
  return report({
    totalTrades: 0,
    fills: [practiceFill()],
    executionQuality: {
      totalFills: 1,
      partialFillCount: 0,
      rejectedOrderCount: 0,
      expiredOrderCount: 0,
      forcedLiquidationCount: 0,
      marginEventCount: 0,
      borrowCostPaid: 0,
    },
    provenance: {
      license: "CC0",
      dataSources: ["Fixture"],
      dataVersion: "scenario-a-data-v1",
      isSampleData: false,
      dataFidelity: "observed",
    },
    practiceAssessment: assessment,
    practiceDrill: {
      definition: PRACTICE_DEFINITION,
      initialPlan: PRACTICE_PLAN,
      checkpoints: [
        {
          checkpoint,
          response,
          events: [
            {
              id: "event-1",
              publishedAt: "2026-07-13T09:00:00.000Z",
              title: "A visible fixture event",
              type: "macro",
              importance: 4,
              source: "Fixture",
            },
          ],
        },
      ],
      violations: [],
    },
  });
}

function buildPracticeRun(id = "modern-practice-run"): CompletedRun {
  return buildCompletedRun({
    report: modernPracticeReport(),
    runInstanceId: id,
    mode: "explorer",
    brokerMode: "scenario",
    brokerFingerprint: TEST_BROKER_FINGERPRINT,
    completedAt: "2026-07-13T10:00:00.000Z",
  });
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

  it("rejects divergent evidence that reuses a retained replay identity", () => {
    const original = buildCompletedRun({
      report: report(),
      runInstanceId: "identity-owner",
      mode: "explorer",
      brokerMode: "scenario",
      brokerFingerprint: TEST_BROKER_FINGERPRINT,
      completedAt: "2026-07-13T10:00:00.000Z",
    });
    const retainedUnderLegacyId = {
      ...original,
      id: "legacy-storage-id",
    };
    expect(persistRunHistory([retainedUnderLegacyId])).toEqual([
      retainedUnderLegacyId,
    ]);
    const archiveBefore = window.localStorage.getItem(
      PRACTICE_ARCHIVE_STORAGE_KEY,
    );

    expect(() =>
      recordCompletedRun({
        report: report({
          metrics: {
            ...report().metrics,
            totalReturn: 0.2,
            excessReturn: 0.15,
          },
        }),
        runInstanceId: "identity-owner",
        mode: "explorer",
        brokerMode: "scenario",
        completedAt: "2026-07-13T11:00:00.000Z",
      }),
    ).toThrow(/conflicts with different retained evidence/i);
    expect(loadRunHistory()).toEqual([retainedUnderLegacyId]);
    expect(window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
      archiveBefore,
    );
  });

  it("builds and atomically records a bounded run from 251 journal entries", () => {
    const journal = Array.from({ length: 251 }, (_entry, index) => ({
      id: `journal-${index}`,
      time: "2026-07-13T10:00:00.000Z",
      note: `Decision note ${index}`,
    }));
    const input = {
      report: report({ journal }),
      runInstanceId: "long-journal-run",
      mode: "explorer" as const,
      brokerMode: "scenario" as const,
      completedAt: "2026-07-13T10:00:00.000Z",
    };

    const built = buildCompletedRun({
      ...input,
      brokerFingerprint: TEST_BROKER_FINGERPRINT,
    });

    expect(built.report.journal).toHaveLength(250);
    expect(built.report.journal?.[0]?.id).toBe("journal-1");
    expect(built.journalEntryCount).toBe(250);
    expect(isCompletedRun(built)).toBe(true);

    const recorded = recordCompletedRun(input);
    expect(recorded).toMatchObject({ added: true, run: built });
    expect(recorded.history).toHaveLength(1);
    expect(loadRunHistory()).toEqual([built]);
    expect(
      window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY),
    ).not.toBeNull();
  });

  it("accepts only the documented V1 journal-count truncation shape", () => {
    const journal = Array.from({ length: 251 }, (_entry, index) => ({
      id: `legacy-journal-${index}`,
      time: "2026-07-13T10:00:00.000Z",
      note: `Legacy decision note ${index}`,
    }));
    const modern = buildCompletedRun({
      report: report({ journal }),
      runInstanceId: "legacy-long-journal",
      mode: "explorer",
      brokerMode: "scenario",
      brokerFingerprint: TEST_BROKER_FINGERPRINT,
      completedAt: "2026-07-13T10:00:00.000Z",
    });
    const {
      brokerFingerprint: _modernBrokerFingerprint,
      ...withoutBrokerFingerprint
    } = modern;
    const legacy: CompletedRun = {
      ...withoutBrokerFingerprint,
      journalEntryCount: 251,
    };

    expect(legacy.report.journal).toHaveLength(250);
    expect(isCompletedRun(legacy)).toBe(true);
    expect(isCompletedRun({ ...legacy, journalEntryCount: 249 })).toBe(false);
    expect(isCompletedRun({ ...modern, journalEntryCount: 251 })).toBe(false);

    const shortLegacy: CompletedRun = {
      ...legacy,
      journalEntryCount: 249,
      report: { ...legacy.report, journal: legacy.report.journal?.slice(0, 249) },
    };
    expect(isCompletedRun(shortLegacy)).toBe(true);
    expect(isCompletedRun({ ...shortLegacy, journalEntryCount: 250 })).toBe(
      false,
    );
    expect(
      isCompletedRun({
        ...legacy,
        journalEntryCount: 0,
        report: { ...legacy.report, journal: undefined },
      }),
    ).toBe(true);
    expect(
      isCompletedRun({
        ...legacy,
        journalEntryCount: 1,
        report: { ...legacy.report, journal: undefined },
      }),
    ).toBe(false);

    window.localStorage.setItem(
      RUN_HISTORY_STORAGE_KEY,
      JSON.stringify([legacy]),
    );
    expect(loadRunHistory()).toEqual([legacy]);

    const migrated = parsePracticeArchive(
      JSON.stringify({
        format: LEGACY_RUN_HISTORY_FORMAT,
        version: LEGACY_RUN_HISTORY_VERSION,
        exportedAt: "2026-07-13T11:00:00.000Z",
        runs: [legacy],
      }),
    );
    expect(migrated.runs).toEqual([legacy]);
    expect(migrated.ledger[0]?.facts.journalEntryCount).toBe(251);
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

  it("compares progress only across the exact canonical replay context", () => {
    const contextualRun = (
      id: string,
      options: {
        dataVersion?: string;
        dataFidelity?: "observed" | "derived";
        sampleData?: boolean;
        mode?: "explorer" | "professional";
        brokerMode?: "scenario" | "harsh";
        brokerFingerprint?: string;
      } = {},
    ) =>
      buildCompletedRun({
        report: report({
          provenance: {
            license: "CC0",
            dataSources: ["Fixture"],
            dataVersion: options.dataVersion ?? "scenario-a-data-v1",
            dataFidelity: options.dataFidelity ?? "observed",
            isSampleData: options.sampleData ?? false,
          },
        }),
        runInstanceId: id,
        mode: options.mode ?? "explorer",
        brokerMode: options.brokerMode ?? "scenario",
        brokerFingerprint:
          options.brokerFingerprint ?? TEST_BROKER_FINGERPRINT,
        completedAt: "2026-07-13T10:00:00.000Z",
      });

    const current = contextualRun("context-current");
    const compatible = contextualRun("context-compatible");
    expect(
      compareRunWithPrevious(current, [current, compatible]).previous?.id,
    ).toBe(compatible.id);

    const otherVersion = contextualRun("other-version", {
      dataVersion: "scenario-a-data-v2",
    });
    const otherFidelity = contextualRun("other-fidelity", {
      dataFidelity: "derived",
    });
    const sample = contextualRun("sample", { sampleData: true });
    const otherMode = contextualRun("other-mode", { mode: "professional" });
    const otherBrokerMode = contextualRun("other-broker-mode", {
      brokerMode: "harsh",
    });
    const otherBroker = contextualRun("other-broker", {
      brokerFingerprint: OTHER_BROKER_FINGERPRINT,
    });
    const {
      brokerFingerprint: _legacyFingerprint,
      ...legacyWithoutBrokerIdentity
    } = contextualRun("legacy-without-broker");

    for (const incompatible of [
      otherVersion,
      otherFidelity,
      sample,
      otherMode,
      otherBrokerMode,
      otherBroker,
      legacyWithoutBrokerIdentity as CompletedRun,
    ]) {
      expect(compareRunWithPrevious(current, [current, incompatible])).toEqual(
        {},
      );
    }
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
    window.localStorage.clear();
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

  it("rejects wrapper facts that contradict the report source fields", () => {
    const saved = recordCompletedRun({
      report: report(),
      runInstanceId: "consistent-run",
      mode: "explorer",
      brokerMode: "scenario",
    }).run;

    expect(isCompletedRun(saved)).toBe(true);
    expect(isCompletedRun({ ...saved, executionCount: 0 })).toBe(false);
    expect(isCompletedRun({ ...saved, executionCount: 2 })).toBe(false);
    expect(isCompletedRun({ ...saved, closedTradeCount: 1 })).toBe(false);
    expect(isCompletedRun({ ...saved, journalEntryCount: 1 })).toBe(false);
    expect(isCompletedRun({ ...saved, scoreStatus: "unavailable" })).toBe(
      false,
    );
    expect(isCompletedRun({ ...saved, score: 71 })).toBe(false);
    expect(isCompletedRun({ ...saved, journalCoverage: undefined })).toBe(
      false,
    );
    expect(isCompletedRun({ ...saved, journalCoverage: 0.5 })).toBe(false);

    const savedWithClosedSource = recordCompletedRun({
      report: report({ closedTradeCount: 1 }),
      runInstanceId: "closed-source-run",
      mode: "explorer",
      brokerMode: "scenario",
    }).run;
    expect(
      isCompletedRun({ ...savedWithClosedSource, closedTradeCount: 0 }),
    ).toBe(false);
  });

  it("requires absent report score and journal coverage sources to stay unavailable", () => {
    const saved = buildCompletedRun({
      report: report({ score: undefined, journalQuality: undefined }),
      runInstanceId: "unscored-run",
      mode: "explorer",
      brokerMode: "scenario",
      brokerFingerprint: TEST_BROKER_FINGERPRINT,
    });

    expect(saved).toMatchObject({ scoreStatus: "unavailable" });
    expect(saved.score).toBeUndefined();
    expect(saved.journalCoverage).toBeUndefined();
    expect(isCompletedRun(saved)).toBe(true);
    expect(isCompletedRun({ ...saved, scoreStatus: "scored" })).toBe(false);
    expect(isCompletedRun({ ...saved, score: 0 })).toBe(false);
    expect(isCompletedRun({ ...saved, journalCoverage: 0 })).toBe(false);
  });

  it("recomputes modern practice assessments from retained process evidence", () => {
    const valid = buildPracticeRun();
    expect(valid.report.practiceAssessment?.status).toBe("completed");
    expect(isCompletedRun(valid)).toBe(true);

    const assessment = valid.report.practiceAssessment!;
    const forgedComponents = assessment.components.map((component) =>
      component.id === "plan_coverage"
        ? { ...component, score: 50, evidence: "Forged score evidence." }
        : component,
    );
    expect(
      isCompletedRun({
        ...valid,
        report: {
          ...valid.report,
          practiceAssessment: {
            ...assessment,
            overallScore: 87.5,
            components: forgedComponents,
          },
        },
      }),
    ).toBe(false);

    expect(
      isCompletedRun({
        ...valid,
        report: {
          ...valid.report,
          practiceDrill: {
            ...valid.report.practiceDrill!,
            initialPlan: {
              thesis: PRACTICE_PLAN.thesis,
              invalidation: PRACTICE_PLAN.invalidation,
              exitPlan: PRACTICE_PLAN.exitPlan,
              linkedEventIds: PRACTICE_PLAN.linkedEventIds,
            },
          },
        },
      }),
    ).toBe(false);
  });

  it("reconstructs an explicitly skipped checkpoint from retained violation evidence", () => {
    const source = modernPracticeReport();
    const checkpoint = source.practiceDrill!.checkpoints[0]!.checkpoint;
    const violation = {
      id: "skip-violation-1",
      drillId: PRACTICE_DEFINITION.id,
      definitionVersion: PRACTICE_DEFINITION.definitionVersion,
      code: "checkpoint_skipped" as const,
      replayTime: checkpoint.replayTime,
      checkpointId: checkpoint.id,
      evidence: "The checkpoint was explicitly skipped.",
    };
    const assessment = assessDrill({
      definition: PRACTICE_DEFINITION,
      checkpoints: [{ ...checkpoint, eventIds: [...checkpoint.eventIds] }],
      initialPlan: PRACTICE_PLAN,
      responses: [
        {
          id: "skipped-response-1",
          drillId: PRACTICE_DEFINITION.id,
          definitionVersion: PRACTICE_DEFINITION.definitionVersion,
          checkpointId: checkpoint.id,
          replayTime: checkpoint.replayTime,
          eventIds: [...checkpoint.eventIds],
          status: "skipped",
        },
      ],
      violations: [violation],
      positionOpened: true,
      replayCompleted: true,
    });
    const skipped = buildCompletedRun({
      report: {
        ...source,
        practiceAssessment: assessment,
        practiceDrill: {
          ...source.practiceDrill!,
          checkpoints: source.practiceDrill!.checkpoints.map((entry) => ({
            ...entry,
            response: undefined,
          })),
          violations: [violation],
        },
      },
      runInstanceId: "skipped-checkpoint-run",
      mode: "explorer",
      brokerMode: "scenario",
      brokerFingerprint: TEST_BROKER_FINGERPRINT,
    });

    expect(skipped.report.practiceAssessment?.status).toBe("incomplete");
    expect(skipped.report.practiceAssessment?.skippedCheckpointCount).toBe(1);
    expect(isCompletedRun(skipped)).toBe(true);
  });

  it("requires cap-aware fill parity and retained user execution for modern practice", () => {
    const valid = buildPracticeRun();
    expect(
      isCompletedRun({
        ...valid,
        report: {
          ...valid.report,
          fills: [],
          executionQuality: {
            ...valid.report.executionQuality!,
            totalFills: 1,
          },
        },
      }),
    ).toBe(false);

    const inputReport = modernPracticeReport();
    const fills = [
      practiceFill(0, "user_order"),
      ...Array.from({ length: 250 }, (_entry, index) =>
        practiceFill(index + 1, "borrow_cost"),
      ),
    ];
    const bounded = buildCompletedRun({
      report: {
        ...inputReport,
        fills,
        executionQuality: {
          ...inputReport.executionQuality!,
          totalFills: fills.length,
        },
      },
      runInstanceId: "bounded-modern-practice",
      mode: "explorer",
      brokerMode: "scenario",
      brokerFingerprint: TEST_BROKER_FINGERPRINT,
    });

    expect(bounded.report.fills).toHaveLength(250);
    expect(bounded.report.fills?.[0]?.reason).toBe("user_order");
    expect(bounded.executionCount).toBe(251);
    expect(isCompletedRun(bounded)).toBe(true);
  });

  it("rejects a completed drill report with no executed decision", () => {
    const saved = recordCompletedRun({
      report: report(),
      runInstanceId: "no-decision-run",
      mode: "explorer",
      brokerMode: "scenario",
    }).run;
    const candidate = {
      ...saved,
      executionCount: 0,
      report: {
        ...saved.report,
        totalTrades: 0,
        practiceAssessment: completedAssessment(),
      },
    };

    expect(isCompletedRun(candidate)).toBe(false);
  });

  it("preserves canonical compact evidence while writing or clearing runs", () => {
    persistPracticeLedger([ledgerEntry("ledger-only")]);
    const saved = recordCompletedRun({
      report: report(),
      runInstanceId: "new-run",
      mode: "explorer",
      brokerMode: "scenario",
    }).run;

    expect(loadPracticeLedger().map((entry) => entry.id)).toEqual([
      "ledger-only",
    ]);
    expect(removeCompletedRun(saved.id)).toEqual([]);
    expect(loadPracticeLedger().map((entry) => entry.id)).toEqual([
      "ledger-only",
    ]);
    clearRunHistory();
    expect(loadPracticeLedger().map((entry) => entry.id)).toEqual([
      "ledger-only",
    ]);
  });

  it("sanitizes and migrates legacy compact evidence during a normal run write", () => {
    window.localStorage.setItem(
      PRACTICE_LEDGER_STORAGE_KEY,
      JSON.stringify({
        format: PRACTICE_LEDGER_FORMAT,
        version: PRACTICE_LEDGER_VERSION,
        entries: [ledgerEntry("legacy-ledger"), { id: "malformed" }],
      }),
    );

    recordCompletedRun({
      report: report(),
      runInstanceId: "new-run",
      mode: "explorer",
      brokerMode: "scenario",
    });

    expect(loadPracticeLedger().map((entry) => entry.id)).toEqual([
      "legacy-ledger",
    ]);
    expect(window.localStorage.getItem(PRACTICE_LEDGER_STORAGE_KEY)).toBeNull();
  });

  it("fails closed and refuses writes when canonical history is malformed", () => {
    const legacyRun = recordCompletedRun({
      report: report(),
      runInstanceId: "stale-legacy-run",
      mode: "explorer",
      brokerMode: "scenario",
    }).run;
    window.localStorage.clear();
    window.localStorage.setItem(
      PRACTICE_ARCHIVE_STORAGE_KEY,
      "{damaged-canonical",
    );
    window.localStorage.setItem(
      RUN_HISTORY_STORAGE_KEY,
      JSON.stringify([legacyRun]),
    );

    expect(loadRunHistory()).toEqual([]);
    expect(
      recordCompletedRun({
        report: report(),
        runInstanceId: "must-not-write",
        mode: "explorer",
        brokerMode: "scenario",
      }),
    ).toMatchObject({ history: [], added: false });
    expect(window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
      "{damaged-canonical",
    );
    expect(window.localStorage.getItem(RUN_HISTORY_STORAGE_KEY)).toContain(
      "stale-legacy-run",
    );
  });

  it("fails the run reader and writer closed when canonical evidence is invalid", () => {
    const validRun = recordCompletedRun({
      report: report(),
      runInstanceId: "canonical-valid-run",
      mode: "explorer",
      brokerMode: "scenario",
    }).run;
    window.localStorage.clear();
    const malformedCanonical = serializePracticeArchiveEnvelope({
      runs: [validRun],
      ledger: [{ id: "malformed-ledger" }],
    });
    window.localStorage.setItem(
      PRACTICE_ARCHIVE_STORAGE_KEY,
      malformedCanonical,
    );
    window.localStorage.setItem(
      RUN_HISTORY_STORAGE_KEY,
      JSON.stringify([validRun]),
    );

    expect(loadRunHistory()).toEqual([]);
    expect(
      recordCompletedRun({
        report: report(),
        runInstanceId: "must-not-repair-half",
        mode: "explorer",
        brokerMode: "scenario",
      }),
    ).toMatchObject({ history: [], added: false });
    expect(window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
      malformedCanonical,
    );
  });

  it("fails the run reader and writer closed on canonical identity collisions", () => {
    const owner = recordCompletedRun({
      report: report(),
      runInstanceId: "shared-replay-identity",
      mode: "explorer",
      brokerMode: "scenario",
    }).run;
    window.localStorage.clear();
    const foreignLedger = {
      ...ledgerEntry("foreign-ledger"),
      runId: owner.id,
    };
    const damagedCanonical = serializePracticeArchiveEnvelope({
      runs: [owner],
      ledger: [foreignLedger],
    });
    window.localStorage.setItem(
      PRACTICE_ARCHIVE_STORAGE_KEY,
      damagedCanonical,
    );

    expect(loadRunHistory()).toEqual([]);
    expect(
      recordCompletedRun({
        report: report(),
        runInstanceId: "must-not-repair-collision",
        mode: "explorer",
        brokerMode: "scenario",
      }),
    ).toMatchObject({ history: [], added: false });
    expect(window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
      damagedCanonical,
    );
  });

  it("fails closed when two canonical runs share a replay alias", () => {
    const first = recordCompletedRun({
      report: report(),
      runInstanceId: "first-run-owner",
      mode: "explorer",
      brokerMode: "scenario",
    }).run;
    const second = recordCompletedRun({
      report: report(),
      runInstanceId: "second-run-owner",
      mode: "explorer",
      brokerMode: "scenario",
    }).run;
    const collidingSecond = { ...second, runInstanceId: first.id };
    expect(isCompletedRun(collidingSecond)).toBe(true);
    window.localStorage.clear();
    const damagedCanonical = serializePracticeArchiveEnvelope({
      runs: [first, collidingSecond],
      ledger: [],
    });
    window.localStorage.setItem(
      PRACTICE_ARCHIVE_STORAGE_KEY,
      damagedCanonical,
    );

    expect(loadRunHistory()).toEqual([]);
    expect(
      recordCompletedRun({
        report: report(),
        runInstanceId: "must-not-repair-aliases",
        mode: "explorer",
        brokerMode: "scenario",
      }),
    ).toMatchObject({ history: [], added: false });
    expect(window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
      damagedCanonical,
    );
  });

  it("refuses malformed or duplicate full-run candidates without corrupting canonical data", () => {
    const current = recordCompletedRun({
      report: report(),
      runInstanceId: "valid-current-run",
      mode: "explorer",
      brokerMode: "scenario",
    }).history;
    const canonicalBefore = window.localStorage.getItem(
      PRACTICE_ARCHIVE_STORAGE_KEY,
    );
    const malformed = {
      ...current[0],
      totalReturn: current[0].totalReturn + 0.25,
    };

    expect(isCompletedRun(malformed)).toBe(false);
    expect(persistRunHistory([malformed])).toEqual(current);
    expect(window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
      canonicalBefore,
    );

    expect(persistRunHistory([current[0], current[0]])).toEqual(current);
    expect(window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
      canonicalBefore,
    );
  });
});
