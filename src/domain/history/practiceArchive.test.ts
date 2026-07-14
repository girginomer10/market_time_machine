import { describe, expect, it } from "vitest";
import { eventDisciplineEurGbpV1 } from "../../data/practice/drills";
import type { DrillAssessment, ReportPayload } from "../../types";
import {
  MAX_PRACTICE_LEDGER_ENTRIES,
  derivePracticeLedgerEntry,
  type PracticeLedgerEntry,
} from "./practiceLedger";
import {
  LEGACY_RUN_HISTORY_FORMAT,
  LEGACY_RUN_HISTORY_VERSION,
  PRACTICE_ARCHIVE_FORMAT,
  PRACTICE_ARCHIVE_VERSION,
  exportPracticeArchive,
  mergePracticeArchive,
  parsePracticeArchive,
} from "./practiceArchive";
import {
  MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
  MAX_ARCHIVED_REPORT_EQUITY_POINTS,
  MAX_ARCHIVED_REPORT_TEXT_LENGTH,
  MAX_SAVED_RUNS,
  type CompletedRun,
} from "./runHistory";

function assessment(score = 80): DrillAssessment {
  return {
    drillId: "event-discipline-v1",
    competencyId: "event-discipline",
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
    journal: [
      {
        id: "private-journal",
        time: "2026-07-13T09:00:00.000Z",
        note: "PRIVATE REFLECTION MUST STAY IN THE FULL REPORT",
      },
    ],
    provenance: {
      license: "Fixture",
      dataSources: ["Fixture source"],
      dataVersion: "scenario-a-data-v1",
      isSampleData: false,
      dataFidelity: "observed",
    },
    practiceAssessment: assessment(),
    ...overrides,
  };
}

function fullyPopulatedReport(): ReportPayload {
  const decisionPlan = {
    thesis: "A documented fixture thesis.",
    invalidation: "The official release contradicts the thesis.",
    exitPlan: "Exit after a confirmed invalidation.",
    acceptedRisk: "One percent of equity.",
    linkedEventIds: ["event-1"],
  };
  const order = {
    id: "order-1",
    createdAt: "2026-07-13T09:00:00.000Z",
    symbol: "TEST",
    side: "buy" as const,
    type: "market" as const,
    quantity: 1,
    status: "filled" as const,
    decisionPlan,
  };
  const fill = {
    id: "fill-1",
    orderId: order.id,
    time: "2026-07-13T09:01:00.000Z",
    symbol: "TEST",
    side: "buy" as const,
    quantity: 1,
    price: 100,
    referencePrice: 100,
    commission: 1,
    spreadCost: 0.25,
    slippage: 0,
    totalCost: 101.25,
    reason: "user_order" as const,
    executionPriceSource: "market" as const,
    decisionPlan,
  };
  const journalEntry = {
    id: "journal-1",
    time: fill.time,
    fillId: fill.id,
    symbol: fill.symbol,
    note: "A bounded private decision note.",
    decisionPlan,
  };
  const auditEvent = {
    id: "audit-1",
    time: fill.time,
    type: "fill" as const,
    message: "Fixture fill recorded.",
    orderId: order.id,
    fillId: fill.id,
    symbol: fill.symbol,
  };
  const marketEvent = {
    id: "event-1",
    happenedAt: "2026-07-13T08:55:00.000Z",
    publishedAt: "2026-07-13T08:56:00.000Z",
    title: "Official fixture release",
    type: "macro" as const,
    summary: "A bounded fixture summary.",
    affectedSymbols: ["TEST"],
    importance: 5 as const,
    sentiment: "mixed" as const,
    source: "Fixture authority",
    sourceUrl: "https://example.com/fixture",
  };
  const tradeOutcome = {
    fill,
    realizedPnl: 100,
    contributionPct: 0.01,
    matchedQuantity: 1,
    entryTime: fill.time,
    positionSide: "long" as const,
  };

  return report({
    equityCurve: [
      {
        time: "2026-07-13T09:00:00.000Z",
        portfolioValue: 10_000,
        benchmarkValue: 10_000,
        isInitial: true,
      },
      {
        time: "2026-07-13T10:00:00.000Z",
        portfolioValue: 11_000,
        benchmarkValue: 10_500,
        financingCost: 0,
        equityAdjustment: 0,
      },
    ],
    bestTrade: tradeOutcome,
    worstTrade: tradeOutcome,
    closedTradeCount: 1,
    tradeOutcomes: [tradeOutcome],
    fills: [fill],
    behavioralFlags: [
      {
        id: "flag-1",
        type: "overtrading",
        severity: 2,
        tradeIds: [fill.id],
        evidence: "Fixture behavioral evidence.",
        estimatedImpact: -5,
      },
    ],
    journal: [journalEntry],
    decisionReplay: [
      {
        fill,
        fills: [fill],
        order,
        decisionTime: order.createdAt,
        journalEntry,
        decisionPlan,
        visibleEvents: [marketEvent],
        linkedEvents: [marketEvent],
        auditEvents: [auditEvent],
        tradeOutcome,
        tradeOutcomes: [tradeOutcome],
        actual: {
          firstFillTime: fill.time,
          lastFillTime: fill.time,
          fillCount: 1,
          executedQuantity: 1,
          averageFillPrice: 100,
          realizedPnl: 100,
          result: "realized_gain",
        },
        equityBefore: 10_000,
        equityAfter: 11_000,
      },
    ],
    attribution: {
      realizedTradePnl: 100,
      unrealizedAndResidualPnl: 900,
      feesPaid: 2,
      slippagePaid: 1,
      financingPaid: 0,
      benchmarkPnl: 500,
      activePnl: 500,
    },
    provenance: {
      license: "Fixture",
      dataSources: ["Fixture source"],
      sourceManifest: ["fixtures/manifest.json"],
      dataVersion: "fixture-v1",
      generatedAt: "2026-07-13T08:00:00.000Z",
      priceAdjustment: "raw",
      marketCalendarId: "FIXTURE",
      isSampleData: false,
      dataFidelity: "observed",
      observedFields: ["close"],
      derivedFields: ["benchmark return"],
    },
    score: {
      status: "scored",
      overall: 72,
      methodology: "Bounded fixture methodology.",
      components: [
        {
          id: "risk_adjusted_return",
          label: "Risk-adjusted return",
          weight: 0.35,
          score: 72,
          status: "scored",
          evidence: "Bounded fixture score evidence.",
        },
      ],
    },
    journalQuality: {
      status: "assessed",
      score: 80,
      executedDecisionCount: 1,
      linkedEntryCount: 1,
      coverageRate: 1,
      reasonRate: 1,
      riskPlanRate: 1,
      structuredPlanRate: 1,
      eventLinkRate: 1,
      evidence: ["Bounded journal evidence."],
    },
    decisionConsistency: {
      status: "assessed",
      score: 75,
      assessedDecisionCount: 1,
      behavioralFlagCount: 1,
      severeBehavioralFlagCount: 0,
      forcedLiquidationCount: 0,
      evidence: ["Bounded consistency evidence."],
    },
    recommendations: [
      {
        id: "recommendation-1",
        priority: 1,
        title: "Repeat the documented process",
        rationale: "The fixture needs another comparable observation.",
        evidence: "One bounded report is available.",
        suggestedPractice: "Replay with the same plan rubric.",
      },
    ],
    executionQuality: {
      totalFills: 1,
      partialFillCount: 0,
      rejectedOrderCount: 0,
      expiredOrderCount: 0,
      forcedLiquidationCount: 0,
      marginEventCount: 0,
      borrowCostPaid: 0,
      averageLiquidityParticipation: 0.1,
    },
    auditSummary: {
      totalEvents: 1,
      orderEvents: 0,
      fillEvents: 1,
      riskEvents: 0,
    },
    orders: [order],
    auditEvents: [auditEvent],
  });
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
    score: 72,
    executionCount: 5,
    closedTradeCount: 1,
    journalEntryCount: 1,
    journalCoverage: 0.75,
    report: report(),
    ...overrides,
  };
}

function ledgerEntry(run: CompletedRun, score = 80): PracticeLedgerEntry {
  return derivePracticeLedgerEntry(run, assessment(score));
}

function document(
  runs: unknown[],
  ledger: unknown[],
): Record<string, unknown> {
  return {
    format: PRACTICE_ARCHIVE_FORMAT,
    version: PRACTICE_ARCHIVE_VERSION,
    exportedAt: "2026-07-14T08:00:00.000Z",
    runs,
    ledger,
  };
}

function completedPracticeRun(
  id = "practice-run",
  completedAt = "2026-07-13T11:00:00.000Z",
): CompletedRun {
  const drillAssessment = assessment();
  drillAssessment.drillId = eventDisciplineEurGbpV1.id;
  drillAssessment.competencyId = eventDisciplineEurGbpV1.competencyId;
  drillAssessment.definitionVersion =
    eventDisciplineEurGbpV1.definitionVersion;
  drillAssessment.rubricVersion = eventDisciplineEurGbpV1.rubricVersion;
  drillAssessment.components = drillAssessment.components.map((component) => ({
    ...component,
    weight: eventDisciplineEurGbpV1.rubric.weights[component.id],
  }));
  drillAssessment.eligibleCheckpointCount = 1;
  drillAssessment.answeredCheckpointCount = 1;
  drillAssessment.skippedCheckpointCount = 0;
  drillAssessment.eligibleEventCount = 1;
  drillAssessment.linkedEventCount = 1;
  drillAssessment.violationCount = 0;

  return completedRun(id, completedAt, {
    scenarioId: eventDisciplineEurGbpV1.scenarioId,
    scenarioTitle: "EUR/GBP Brexit 2016",
    report: report({
      scenarioId: eventDisciplineEurGbpV1.scenarioId,
      scenarioTitle: "EUR/GBP Brexit 2016",
      practiceAssessment: drillAssessment,
      practiceDrill: {
        definition: eventDisciplineEurGbpV1,
        initialPlan: {
          thesis: "PRIVATE PLAN THESIS",
          invalidation: "PRIVATE PLAN INVALIDATION",
          exitPlan: "PRIVATE EXIT PLAN",
          acceptedRisk: "PRIVATE ACCEPTED RISK",
          linkedEventIds: [],
        },
        checkpoints: [
          {
            checkpoint: {
              id: "checkpoint-1",
              drillId: eventDisciplineEurGbpV1.id,
              definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
              replayIndex: 2,
              replayTime: "2016-06-24T16:00:00.000Z",
              eventIds: ["event-1"],
            },
            response: {
              id: "response-1",
              drillId: eventDisciplineEurGbpV1.id,
              definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
              checkpointId: "checkpoint-1",
              replayTime: "2016-06-24T16:00:00.000Z",
              eventIds: ["event-1"],
              status: "answered",
              action: "wait",
              reflection: "PRIVATE CHECKPOINT REFLECTION",
            },
            events: [
              {
                id: "event-1",
                publishedAt: "2016-06-24T08:00:00.000Z",
                title: "Result becomes visible",
                type: "geopolitical",
                importance: 5,
                source: "Fixture source",
              },
            ],
          },
        ],
        violations: [],
      },
    }),
  });
}

describe("practice archive", () => {
  it("exports and parses a bounded V2 archive with compact sanitized evidence", () => {
    const older = completedRun("older", "2026-07-13T09:00:00.000Z");
    const newer = completedPracticeRun("newer");
    const unsafeLedger = {
      ...ledgerEntry(newer),
      checkpointResponses: [{ reflection: "RAW CHECKPOINT TEXT" }],
      assessment: {
        ...newer.report.practiceAssessment,
        reflection: "RAW ASSESSMENT TEXT",
      },
    } as PracticeLedgerEntry;

    const serialized = exportPracticeArchive(
      [older, newer],
      [derivePracticeLedgerEntry(older), unsafeLedger],
      "2026-07-14T08:00:00.000Z",
    );
    const exported = JSON.parse(serialized) as Record<string, unknown>;

    expect(exported).toMatchObject({
      format: PRACTICE_ARCHIVE_FORMAT,
      version: PRACTICE_ARCHIVE_VERSION,
      exportedAt: "2026-07-14T08:00:00.000Z",
    });
    expect(parsePracticeArchive(serialized).runs.map((run) => run.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(JSON.stringify(exported.ledger)).not.toContain("RAW");
    expect(serialized).toContain("PRIVATE REFLECTION MUST STAY IN THE FULL REPORT");
    expect(serialized).toContain("PRIVATE PLAN THESIS");
    expect(serialized).toContain("PRIVATE CHECKPOINT REFLECTION");
    expect(JSON.stringify(exported.ledger)).not.toContain(
      "PRIVATE REFLECTION MUST STAY IN THE FULL REPORT",
    );
    expect(JSON.stringify(exported.ledger)).not.toContain("PRIVATE PLAN THESIS");
    expect(JSON.stringify(exported.ledger)).not.toContain(
      "PRIVATE CHECKPOINT REFLECTION",
    );
  });

  it("round-trips a fully populated report that is safe for every PostGame surface", () => {
    const fullReport = fullyPopulatedReport();
    const fullRun = completedRun("full-report", undefined, {
      closedTradeCount: 1,
      report: fullReport,
    });
    const serialized = JSON.stringify(document([fullRun], []));

    const parsed = parsePracticeArchive(serialized);

    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0].report).toEqual(fullReport);
    expect(parsed.runs[0].report.decisionReplay?.[0]).toMatchObject({
      fill: { id: "fill-1" },
      order: { id: "order-1" },
      visibleEvents: [{ id: "event-1" }],
      auditEvents: [{ id: "audit-1" }],
    });
  });

  it.each([
    [
      "equity curve entry",
      (candidate: ReportPayload) => ({ ...candidate, equityCurve: [null] }),
    ],
    [
      "behavioral flag entry",
      (candidate: ReportPayload) => ({ ...candidate, behavioralFlags: [null] }),
    ],
    [
      "trade outcome entry",
      (candidate: ReportPayload) => ({ ...candidate, tradeOutcomes: [null] }),
    ],
    ["fill entry", (candidate: ReportPayload) => ({ ...candidate, fills: [null] })],
    [
      "journal entry",
      (candidate: ReportPayload) => ({ ...candidate, journal: [null] }),
    ],
    [
      "decision replay entry",
      (candidate: ReportPayload) => ({ ...candidate, decisionReplay: [null] }),
    ],
    [
      "recommendation entry",
      (candidate: ReportPayload) => ({ ...candidate, recommendations: [null] }),
    ],
    ["order entry", (candidate: ReportPayload) => ({ ...candidate, orders: [null] })],
    [
      "audit event entry",
      (candidate: ReportPayload) => ({ ...candidate, auditEvents: [null] }),
    ],
    [
      "nested replay audit event",
      (candidate: ReportPayload) => ({
        ...candidate,
        decisionReplay: [
          {
            ...candidate.decisionReplay?.[0],
            auditEvents: [null],
          },
        ],
      }),
    ],
    [
      "nested replay visible event",
      (candidate: ReportPayload) => ({
        ...candidate,
        decisionReplay: [
          {
            ...candidate.decisionReplay?.[0],
            visibleEvents: [null],
          },
        ],
      }),
    ],
    [
      "score component",
      (candidate: ReportPayload) => ({
        ...candidate,
        score: { ...candidate.score, components: [null] },
      }),
    ],
    [
      "performance attribution",
      (candidate: ReportPayload) => ({
        ...candidate,
        attribution: { ...candidate.attribution, activePnl: null },
      }),
    ],
    [
      "execution quality",
      (candidate: ReportPayload) => ({
        ...candidate,
        executionQuality: {
          ...candidate.executionQuality,
          totalFills: null,
        },
      }),
    ],
    [
      "audit summary",
      (candidate: ReportPayload) => ({
        ...candidate,
        auditSummary: { ...candidate.auditSummary, totalEvents: null },
      }),
    ],
    [
      "journal evidence",
      (candidate: ReportPayload) => ({
        ...candidate,
        journalQuality: { ...candidate.journalQuality, evidence: [null] },
      }),
    ],
    [
      "consistency evidence",
      (candidate: ReportPayload) => ({
        ...candidate,
        decisionConsistency: {
          ...candidate.decisionConsistency,
          evidence: [null],
        },
      }),
    ],
    [
      "provenance source",
      (candidate: ReportPayload) => ({
        ...candidate,
        provenance: { ...candidate.provenance, dataSources: [null] },
      }),
    ],
    [
      "best-trade fill",
      (candidate: ReportPayload) => ({
        ...candidate,
        bestTrade: { ...candidate.bestTrade, fill: null },
      }),
    ],
  ])("rejects a malformed nested %s before it can reach PostGame", (_label, mutate) => {
    const validRun = completedRun("malformed-nested", undefined, {
      closedTradeCount: 1,
      report: fullyPopulatedReport(),
    });
    const malformedRun = {
      ...validRun,
      report: mutate(validRun.report),
    };

    expect(() =>
      parsePracticeArchive(JSON.stringify(document([malformedRun], []))),
    ).toThrow(/malformed run/i);
  });

  it("rejects oversized report text and top-level or nested collections", () => {
    const baseRun = completedRun("oversized", undefined, {
      closedTradeCount: 1,
      report: fullyPopulatedReport(),
    });
    const equityPoint = baseRun.report.equityCurve[0];
    const auditEvent = baseRun.report.auditEvents?.[0];
    expect(equityPoint).toBeDefined();
    expect(auditEvent).toBeDefined();

    const oversizedEquity = {
      ...baseRun,
      report: {
        ...baseRun.report,
        equityCurve: Array.from(
          { length: MAX_ARCHIVED_REPORT_EQUITY_POINTS + 1 },
          () => equityPoint,
        ),
      },
    };
    const oversizedAudit = {
      ...baseRun,
      report: {
        ...baseRun.report,
        auditEvents: Array.from(
          { length: MAX_ARCHIVED_REPORT_COLLECTION_ITEMS + 1 },
          () => auditEvent,
        ),
      },
    };
    const oversizedText = {
      ...baseRun,
      scenarioTitle: "x".repeat(MAX_ARCHIVED_REPORT_TEXT_LENGTH + 1),
      report: {
        ...baseRun.report,
        scenarioTitle: "x".repeat(MAX_ARCHIVED_REPORT_TEXT_LENGTH + 1),
      },
    };

    for (const malformed of [oversizedEquity, oversizedAudit, oversizedText]) {
      expect(() =>
        parsePracticeArchive(JSON.stringify(document([malformed], []))),
      ).toThrow(/malformed run/i);
    }
  });

  it("accepts V1 run-history exports and derives factual unassessed ledger entries", () => {
    const legacy = completedRun("legacy-run", "2026-07-12T10:00:00.000Z", {
      runInstanceId: undefined,
    });
    const parsed = parsePracticeArchive(
      JSON.stringify({
        format: LEGACY_RUN_HISTORY_FORMAT,
        version: LEGACY_RUN_HISTORY_VERSION,
        exportedAt: "2026-07-14T08:00:00.000Z",
        runs: [legacy],
      }),
    );

    expect(parsed).toMatchObject({
      format: PRACTICE_ARCHIVE_FORMAT,
      version: PRACTICE_ARCHIVE_VERSION,
      runs: [{ id: "legacy-run" }],
      ledger: [
        {
          id: "legacy-run",
          runId: "legacy-run",
          assessment: undefined,
          facts: { executionCount: 5, journalEntryCount: 1 },
        },
      ],
    });
    expect(JSON.stringify(parsed.ledger)).not.toContain("PRIVATE REFLECTION");
  });

  it("rejects the whole V2 import when any run or ledger entry is malformed", () => {
    const validRun = completedRun();
    const validLedger = ledgerEntry(validRun);
    const malformedRun = {
      ...completedRun("bad-run"),
      report: {
        ...report(),
        metrics: { ...report().metrics, totalReturn: "not-a-number" },
      },
    };
    const malformedLedger = {
      ...validLedger,
      facts: {
        ...validLedger.facts,
        executedDecisionCount: 1,
        linkedDecisionCount: 2,
      },
    };

    expect(() =>
      parsePracticeArchive(
        JSON.stringify(document([validRun, malformedRun], [validLedger])),
      ),
    ).toThrow(/malformed run/i);
    expect(() =>
      parsePracticeArchive(
        JSON.stringify(document([validRun], [validLedger, malformedLedger])),
      ),
    ).toThrow(/malformed ledger entry/i);
    expect(() =>
      parsePracticeArchive(
        JSON.stringify(
          document([validRun], [
            {
              ...validLedger,
              assessment: { ...assessment(), overallScore: 101 },
            },
          ]),
        ),
      ),
    ).toThrow(/malformed ledger entry/i);
    expect(() =>
      parsePracticeArchive(
        JSON.stringify(
          document(
            [
              completedRun("bad-assessment", undefined, {
                report: report({
                  practiceAssessment: {
                    ...assessment(),
                    components: [],
                  },
                }),
              }),
            ],
            [validLedger],
          ),
        ),
      ),
    ).toThrow(/malformed run/i);
    expect(() =>
      parsePracticeArchive(
        JSON.stringify(
          document(
            [
              completedRun("bad-drill-snapshot", undefined, {
                report: report({
                  practiceDrill: {
                    definition: {},
                    checkpoints: [],
                    violations: [],
                  } as unknown as ReportPayload["practiceDrill"],
                }),
              }),
            ],
            [validLedger],
          ),
        ),
      ),
    ).toThrow(/malformed run/i);
  });

  it("rejects internally inconsistent full drill evidence and matching-ledger conflicts", () => {
    const validRun = completedPracticeRun();
    const snapshot = validRun.report.practiceDrill!;
    const assessment = validRun.report.practiceAssessment!;
    const ledger = derivePracticeLedgerEntry(validRun);

    const mismatchedCounts: CompletedRun = {
      ...validRun,
      id: "mismatched-counts",
      runInstanceId: "mismatched-counts",
      report: {
        ...validRun.report,
        practiceAssessment: {
          ...assessment,
          eligibleEventCount: 2,
          linkedEventCount: 2,
        },
      },
    };
    expect(() =>
      parsePracticeArchive(
        JSON.stringify(document([mismatchedCounts], [])),
      ),
    ).toThrow(/malformed run/i);

    const oversizedReflection: CompletedRun = {
      ...validRun,
      id: "oversized-reflection",
      runInstanceId: "oversized-reflection",
      report: {
        ...validRun.report,
        practiceDrill: {
          ...snapshot,
          checkpoints: snapshot.checkpoints.map((entry, index) =>
            index === 0 && entry.response
              ? {
                  ...entry,
                  response: {
                    ...entry.response,
                    reflection: "x".repeat(2_001),
                  },
                }
              : entry,
          ),
        },
      },
    };
    expect(() =>
      parsePracticeArchive(
        JSON.stringify(document([oversizedReflection], [])),
      ),
    ).toThrow(/malformed run/i);

    expect(() =>
      parsePracticeArchive(
        JSON.stringify(
          document(
            [validRun],
            [{ ...ledger, scenarioTitle: "Conflicting scenario title" }],
          ),
        ),
      ),
    ).toThrow(/conflicts with its full run/i);
  });

  it("rejects invalid JSON, metadata, array shapes, and conflicting duplicate ids", () => {
    const run = completedRun();
    const ledger = ledgerEntry(run);

    expect(() => parsePracticeArchive("not json")).toThrow(/valid JSON/i);
    expect(() =>
      parsePracticeArchive(
        JSON.stringify({ ...document([run], [ledger]), exportedAt: "never" }),
      ),
    ).toThrow(/timestamp/i);
    expect(() =>
      parsePracticeArchive(
        JSON.stringify({ ...document([run], [ledger]), ledger: {} }),
      ),
    ).toThrow(/ledger must be an array/i);
    expect(() =>
      parsePracticeArchive(
        JSON.stringify({ ...document([run], [ledger]), version: 99 }),
      ),
    ).toThrow(/unsupported/i);
    expect(() =>
      parsePracticeArchive(
        JSON.stringify(
          document(
            [
              run,
              {
                ...run,
                totalReturn: run.totalReturn + 0.1,
                report: {
                  ...run.report,
                  metrics: {
                    ...run.report.metrics,
                    totalReturn: run.totalReturn + 0.1,
                  },
                },
              },
            ],
            [ledger],
          ),
        ),
      ),
    ).toThrow(/conflicting runs/i);
  });

  it("retains at most 12 full reports and 250 compact entries in newest-first order", () => {
    const runs = Array.from({ length: MAX_SAVED_RUNS + 1 }, (_, index) =>
      completedRun(
        `run-${index}`,
        new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      ),
    );
    const ledger = Array.from(
      { length: MAX_PRACTICE_LEDGER_ENTRIES + 1 },
      (_, index) =>
        ledgerEntry(
          completedRun(
            `ledger-${index}`,
            new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
          ),
        ),
    );
    const parsed = parsePracticeArchive(
      JSON.stringify(document(runs, ledger)),
    );

    expect(parsed.runs).toHaveLength(MAX_SAVED_RUNS);
    expect(parsed.runs[0].id).toBe("run-12");
    expect(parsed.runs.at(-1)?.id).toBe("run-1");
    expect(parsed.ledger).toHaveLength(MAX_PRACTICE_LEDGER_ENTRIES);
    expect(parsed.ledger[0].id).toBe("ledger-250");
    expect(parsed.ledger.at(-1)?.id).toBe("ledger-1");
  });

  it("merges idempotently, keeps current data on conflicts, and orders deterministically", () => {
    const same = completedRun("same", "2026-07-13T08:00:00.000Z");
    const conflict = completedRun(
      "conflict",
      "2026-07-13T09:00:00.000Z",
    );
    const added = completedRun("added", "2026-07-13T10:00:00.000Z");
    const sameLedger = ledgerEntry(same);
    const conflictLedger = ledgerEntry(conflict);
    const addedLedger = ledgerEntry(added);
    const { report: sameReport, ...sameRest } = same;
    const reorderedSame = { report: sameReport, ...sameRest } as CompletedRun;
    const conflictingRun = {
      ...conflict,
      totalReturn: conflict.totalReturn + 0.25,
      report: {
        ...conflict.report,
        metrics: {
          ...conflict.report.metrics,
          totalReturn: conflict.totalReturn + 0.25,
        },
      },
    };
    const conflictingLedger = {
      ...conflictLedger,
      facts: {
        ...conflictLedger.facts,
        executionCount: conflictLedger.facts.executionCount + 1,
      },
    };
    const current = {
      runs: [same, conflict],
      ledger: [sameLedger, conflictLedger],
    };
    const incoming = {
      runs: [reorderedSame, conflictingRun, added],
      ledger: [sameLedger, conflictingLedger, addedLedger],
    };

    const merged = mergePracticeArchive(current, incoming);
    expect(merged.runs.map((run) => run.id)).toEqual([
      "added",
      "conflict",
      "same",
    ]);
    expect(merged.ledger.map((entry) => entry.id)).toEqual([
      "added",
      "conflict",
      "same",
    ]);
    expect(merged.runs.find((run) => run.id === "conflict")?.totalReturn).toBe(
      conflict.totalReturn,
    );
    expect(
      merged.ledger.find((entry) => entry.id === "conflict")?.facts
        .executionCount,
    ).toBe(conflictLedger.facts.executionCount);
    expect(merged.addedRunIds).toEqual(["added"]);
    expect(merged.addedLedgerIds).toEqual(["added"]);
    expect(merged.conflicts).toEqual([
      { collection: "ledger", id: "conflict" },
      { collection: "runs", id: "conflict" },
    ]);
    expect(merged.conflictCount).toBe(2);

    const repeated = mergePracticeArchive(
      { runs: merged.runs, ledger: merged.ledger },
      incoming,
    );
    expect(repeated.runs).toEqual(merged.runs);
    expect(repeated.ledger).toEqual(merged.ledger);
    expect(repeated.addedRunIds).toEqual([]);
    expect(repeated.addedLedgerIds).toEqual([]);
    expect(repeated.conflicts).toEqual(merged.conflicts);
  });

  it("uses ids as the deterministic tie-breaker for equal timestamps", () => {
    const timestamp = "2026-07-13T10:00:00.000Z";
    const alpha = completedRun("alpha", timestamp);
    const beta = completedRun("beta", timestamp);
    const merged = mergePracticeArchive(
      { runs: [], ledger: [] },
      {
        runs: [beta, alpha],
        ledger: [ledgerEntry(beta), ledgerEntry(alpha)],
      },
    );

    expect(merged.runs.map((run) => run.id)).toEqual(["alpha", "beta"]);
    expect(merged.ledger.map((entry) => entry.id)).toEqual([
      "alpha",
      "beta",
    ]);
  });
});
