import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventDisciplineEurGbpV1 } from "../../data/practice/drills";
import { listScenarios } from "../../data/scenarios";
import {
  buildDrillCheckpointSchedule,
  drillCheckpointScheduleFingerprint,
  drillRubricFingerprint,
} from "../../domain/practice/drills";
import PostGameReport from "./PostGameReport";
import type {
  DrillAssessment,
  DrillDefinition,
  ReportPayload,
} from "../../types";

const neutralReport: ReportPayload = {
  scenarioId: "neutral",
  scenarioTitle: "Neutral report scenario",
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
  equityCurve: [
    {
      time: "2020-01-01T00:00:00.000Z",
      portfolioValue: 10_000,
      benchmarkValue: 10_000,
    },
    {
      time: "2020-01-02T00:00:00.000Z",
      portfolioValue: 10_000,
      benchmarkValue: 10_000,
    },
  ],
  totalTrades: 0,
  behavioralFlags: [],
};

const practiceScenario = listScenarios().find(
  (scenario) => scenario.meta.id === eventDisciplineEurGbpV1.scenarioId,
)!;
const practiceSchedule = buildDrillCheckpointSchedule(
  eventDisciplineEurGbpV1,
  practiceScenario,
);
const practiceEventCount = new Set(
  practiceSchedule.flatMap((checkpoint) => checkpoint.eventIds),
).size;
const practiceProvenance = {
  license: practiceScenario.meta.license,
  dataSources: [...practiceScenario.meta.dataSources],
  dataVersion: practiceScenario.meta.dataVersion,
  isSampleData: practiceScenario.meta.isSampleData ?? true,
};

function practiceAssessment(
  overrides: Partial<DrillAssessment> = {},
): DrillAssessment {
  return {
    drillId: eventDisciplineEurGbpV1.id,
    competencyId: eventDisciplineEurGbpV1.competencyId,
    definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
    rubricVersion: eventDisciplineEurGbpV1.rubricVersion,
    rubricFingerprint: drillRubricFingerprint(eventDisciplineEurGbpV1.rubric),
    checkpointScheduleFingerprint:
      drillCheckpointScheduleFingerprint(practiceSchedule),
    eventLinkageEvidenceVersion: 1,
    status: "completed",
    overallScore: 80,
    methodology: "Process-only score based on recorded plan and checkpoint evidence.",
    components: Object.entries(eventDisciplineEurGbpV1.rubric.weights).map(
      ([id, weight]) => ({
        id: id as DrillAssessment["components"][number]["id"],
        label: id,
        weight,
        status: "assessed" as const,
        score: 80,
        evidence: "Fixture evidence.",
      }),
    ),
    eligibleCheckpointCount: practiceSchedule.length,
    answeredCheckpointCount: practiceSchedule.length,
    skippedCheckpointCount: 0,
    eligibleEventCount: practiceEventCount,
    linkedEventCount: practiceEventCount,
    violationCount: 0,
    ...overrides,
  };
}

const staleAssessmentCases: Array<[string, Partial<DrillAssessment>]> = [
  ["missing competency", { competencyId: undefined }],
  ["changed competency", { competencyId: "risk-discipline" }],
  [
    "changed definition version",
    { definitionVersion: eventDisciplineEurGbpV1.definitionVersion - 1 },
  ],
  [
    "changed rubric version",
    { rubricVersion: "event-discipline-process-v0" },
  ],
  ["missing rubric fingerprint", { rubricFingerprint: undefined }],
  [
    "changed rubric fingerprint",
    {
      rubricFingerprint: drillRubricFingerprint({
        ...eventDisciplineEurGbpV1.rubric,
        violationPenalty: eventDisciplineEurGbpV1.rubric.violationPenalty + 1,
      }),
    },
  ],
  [
    "rubric fingerprint conflicts with recorded component weights",
    {
      components: practiceAssessment().components.map((component) =>
        component.id === "plan_coverage"
          ? { ...component, weight: component.weight + 0.01 }
          : component,
      ),
    },
  ],
  [
    "self-consistent partial checkpoint schedule",
    {
      checkpointScheduleFingerprint: drillCheckpointScheduleFingerprint(
        practiceSchedule.slice(0, 1),
      ),
      eligibleCheckpointCount: 1,
      answeredCheckpointCount: 1,
      eligibleEventCount: new Set(practiceSchedule[0]?.eventIds ?? []).size,
      linkedEventCount: new Set(practiceSchedule[0]?.eventIds ?? []).size,
    },
  ],
];

describe("PostGameReport", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "share");
    Reflect.deleteProperty(navigator, "clipboard");
    vi.restoreAllMocks();
  });

  it("renders zero-return and zero-drawdown values as neutral", () => {
    const { container } = render(
      <PostGameReport
        report={neutralReport}
        onClose={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByText("Decision-quality review")).toBeInTheDocument();
    expect(screen.getByText("Neutral report scenario")).toBeInTheDocument();

    const maxDrawdownCard = [...container.querySelectorAll(".report-stat")]
      .find((card) => card.textContent?.includes("Max drawdown"));
    expect(maxDrawdownCard).toBeTruthy();
    expect(maxDrawdownCard?.querySelector("strong")).toHaveClass("neutral");

    const zeroReturns = [...container.querySelectorAll(".report-stat strong")]
      .filter((node) => node.textContent === "0.00%");
    expect(zeroReturns.every((node) => node.classList.contains("neutral"))).toBe(
      true,
    );
  });

  it("does not credit active decisions when no trade was completed", () => {
    render(
      <PostGameReport
        report={{
          ...neutralReport,
          metrics: {
            ...neutralReport.metrics,
            totalReturn: 0.2,
            benchmarkReturn: 0.1,
            excessReturn: 0.1,
          },
        }}
        onClose={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByText("Spectator")).toBeInTheDocument();
    expect(screen.queryByText(/Active decisions added/i)).not.toBeInTheDocument();
  });

  it("describes benchmark underperformance as a positive gap magnitude", () => {
    render(
      <PostGameReport
        report={{
          ...neutralReport,
          metrics: {
            ...neutralReport.metrics,
            totalReturn: -0.1,
            benchmarkReturn: 0,
            excessReturn: -0.1,
          },
          totalTrades: 1,
          closedTradeCount: 1,
        }}
        onClose={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Trading trailed the benchmark by 10.00%."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/trailed the benchmark by -/i)).not.toBeInTheDocument();
  });

  it("provides a named modal, focuses Close, and closes with Escape", () => {
    const onClose = vi.fn();
    render(
      <PostGameReport
        report={neutralReport}
        onClose={onClose}
        onReset={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Neutral report scenario" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close report" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers retry and an importable recovery archive after a save failure", () => {
    const onRetryArchive = vi.fn();
    const onDownloadRecoveryArchive = vi.fn();
    const onClose = vi.fn();
    const onReset = vi.fn();
    const onChooseNextPractice = vi.fn();

    render(
      <PostGameReport
        report={neutralReport}
        archiveWarning="Browser storage rejected the archive update."
        onRetryArchive={onRetryArchive}
        onDownloadRecoveryArchive={onDownloadRecoveryArchive}
        onClose={onClose}
        onReset={onReset}
        onChooseNextPractice={onChooseNextPractice}
      />,
    );

    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent(
      /this completed replay was not saved to local history/i,
    );
    fireEvent.click(within(warning).getByRole("button", { name: "Retry saving" }));
    fireEvent.click(
      within(warning).getByRole("button", {
        name: "Download recovery archive",
      }),
    );

    expect(onRetryArchive).toHaveBeenCalledOnce();
    expect(onDownloadRecoveryArchive).toHaveBeenCalledOnce();
    expect(warning).toHaveTextContent(/export json.*report-only copy/i);
    expect(screen.getByRole("button", { name: "Close report" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Return to lab" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Secure recovery first" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Choose next practice" }),
    ).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
    expect(onChooseNextPractice).not.toHaveBeenCalled();
  });

  it("prevents replacing a completed replay while its archive write is pending", () => {
    const onClose = vi.fn();
    const onReset = vi.fn();
    render(
      <PostGameReport
        report={neutralReport}
        archiveSaving
        onClose={onClose}
        onReset={onReset}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /saving the completed replay and compact evidence/i,
    );
    expect(
      screen.getByRole("button", { name: "Saving replay…" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close report" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Return to lab" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
  });

  it("hands the finished report into the next-practice loop", () => {
    const onChooseNextPractice = vi.fn();
    render(
      <PostGameReport
        report={neutralReport}
        onClose={vi.fn()}
        onReset={vi.fn()}
        onChooseNextPractice={onChooseNextPractice}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Choose next practice" }),
    );
    expect(onChooseNextPractice).toHaveBeenCalledTimes(1);
  });

  it("reports closed trades separately from executions", () => {
    render(
      <PostGameReport
        report={{
          ...neutralReport,
          totalTrades: 3,
          closedTradeCount: 1,
          executionQuality: {
            totalFills: 3,
            partialFillCount: 0,
            rejectedOrderCount: 0,
            expiredOrderCount: 0,
            forcedLiquidationCount: 0,
            marginEventCount: 0,
            borrowCostPaid: 0,
          },
        }}
        onClose={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    const numberCells = [...document.querySelectorAll(".number-cell")];
    const closed = numberCells.find((cell) =>
      cell.textContent?.includes("Closed trades"),
    );
    const executions = numberCells.find((cell) =>
      cell.textContent?.includes("Executions"),
    );
    expect(closed).toHaveTextContent("1");
    expect(executions).toHaveTextContent("3");
  });

  it("renders canonical scoring, quality, recommendations, and provenance", () => {
    render(
      <PostGameReport
        report={{
          ...neutralReport,
          score: {
            status: "scored",
            overall: 72,
            methodology: "Weighted canonical decision-quality score.",
            components: [
              {
                id: "risk_adjusted_return",
                label: "Risk-adjusted return",
                weight: 0.35,
                score: 80,
                status: "scored",
                evidence: "Sharpe and total return supported this score.",
              },
            ],
          },
          journalQuality: {
            status: "assessed",
            score: 60,
            executedDecisionCount: 2,
            linkedEntryCount: 1,
            coverageRate: 0.5,
            reasonRate: 1,
            riskPlanRate: 0.5,
            evidence: ["One of two decisions had a linked note."],
          },
          decisionConsistency: {
            status: "assessed",
            score: 85,
            assessedDecisionCount: 2,
            behavioralFlagCount: 1,
            severeBehavioralFlagCount: 0,
            forcedLiquidationCount: 0,
            evidence: ["No severe behavior or liquidation was detected."],
          },
          recommendations: [
            {
              id: "trade-budget",
              priority: 1,
              title: "Use a trade budget",
              rationale: "Decision count exceeded the planned cadence.",
              evidence: "Eight fills occurred in a short window.",
              suggestedPractice: "Set a maximum of three decisions next run.",
            },
          ],
          provenance: {
            license: "CC-BY-4.0",
            dataSources: ["Fixture market source"],
            sourceManifest: ["fixtures/manifest.json"],
            dataVersion: "2026.07",
            generatedAt: "2026-07-13T12:00:00.000Z",
            priceAdjustment: "split_adjusted",
            marketCalendarId: "XNYS",
            isSampleData: true,
            dataFidelity: "mixed",
            observedFields: ["Observed daily close"],
            derivedFields: ["Intraday range reconstructed from the close"],
          },
        }}
        onClose={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Decision quality score" }),
    ).toBeInTheDocument();
    expect(screen.getByText("72/100")).toBeInTheDocument();
    expect(screen.getByText("Risk-adjusted return")).toBeInTheDocument();
    expect(screen.getByText(/35.00% weight/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Journal quality" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Decision consistency" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Use a trade budget")).toBeInTheDocument();
    expect(
      screen.getByText("Set a maximum of three decisions next run."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Write a falsifiable thesis/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data provenance" })).toBeInTheDocument();
    expect(screen.getByText("CC-BY-4.0")).toBeInTheDocument();
    expect(screen.getByText("Fixture market source")).toBeInTheDocument();
    expect(screen.getByText("fixtures/manifest.json")).toBeInTheDocument();
    expect(screen.getByText("Sample data")).toBeInTheDocument();
    expect(screen.getByText("Mixed observed and derived fields")).toBeInTheDocument();
    expect(screen.getByText("Observed daily close")).toBeInTheDocument();
    expect(
      screen.getByText("Intraday range reconstructed from the close"),
    ).toBeInTheDocument();
  });

  it("uses the archived drill definition and evidence when an authored drill is no longer installed", () => {
    const archivedDefinition: DrillDefinition = {
      ...eventDisciplineEurGbpV1,
      id: "authored-drill-removed-from-scenario",
      definitionVersion: 7,
      rubricVersion: "authored-process-v7",
      title: "Archived authored policy drill",
    };

    render(
      <PostGameReport
        report={{
          ...neutralReport,
          practiceAssessment: practiceAssessment({
            drillId: archivedDefinition.id,
            definitionVersion: archivedDefinition.definitionVersion,
            rubricVersion: archivedDefinition.rubricVersion,
          }),
          practiceDrill: {
            definition: archivedDefinition,
            initialPlan: {
              thesis: "The official release may alter the policy path.",
              invalidation: "The release leaves the policy path unchanged.",
              exitPlan: "Exit after a confirmed invalidation.",
              acceptedRisk: "A predefined small position.",
            },
            checkpoints: [
              {
                checkpoint: {
                  id: "authored-checkpoint",
                  drillId: archivedDefinition.id,
                  definitionVersion: archivedDefinition.definitionVersion,
                  replayIndex: 3,
                  replayTime: "2020-01-01T12:00:00.000Z",
                  eventIds: ["archived-event"],
                },
                response: {
                  id: "authored-response",
                  drillId: archivedDefinition.id,
                  definitionVersion: archivedDefinition.definitionVersion,
                  checkpointId: "authored-checkpoint",
                  replayTime: "2020-01-01T12:00:00.000Z",
                  eventIds: ["archived-event"],
                  status: "answered",
                  action: "wait",
                  reflection: "Wait for confirmation because the plan is not invalidated.",
                },
                events: [
                  {
                    id: "archived-event",
                    publishedAt: "2020-01-01T11:55:00.000Z",
                    title: "Archived official release title",
                    type: "central_bank",
                    importance: 5,
                    source: "Official archive",
                  },
                ],
              },
            ],
            violations: [],
          },
        }}
        onClose={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Archived authored policy drill" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Archived official release title")).toBeInTheDocument();
    expect(
      screen.getByText("Wait for confirmation because the plan is not invalidated."),
    ).toBeInTheDocument();
    expect(screen.queryByText(eventDisciplineEurGbpV1.title)).not.toBeInTheDocument();
  });

  it("uses a built-in definition only for an exactly matched assessment-only report", () => {
    render(
      <PostGameReport
        report={{
          ...neutralReport,
          scenarioId: eventDisciplineEurGbpV1.scenarioId,
          provenance: practiceProvenance,
          practiceAssessment: practiceAssessment(),
        }}
        onClose={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: eventDisciplineEurGbpV1.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/legacy report retains its versioned process assessment/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Checkpoint decision record" }),
    ).not.toBeInTheDocument();
  });

  it.each(staleAssessmentCases)(
    "does not relabel stale assessment-only evidence with the current drill: %s",
    (_caseName, overrides) => {
      render(
        <PostGameReport
          report={{
            ...neutralReport,
            scenarioId: eventDisciplineEurGbpV1.scenarioId,
            provenance: practiceProvenance,
            practiceAssessment: practiceAssessment(overrides),
          }}
          onClose={vi.fn()}
          onReset={vi.fn()}
        />,
      );

      expect(
        screen.getByRole("heading", {
          name: "Archived drill definition unavailable",
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", {
          name: eventDisciplineEurGbpV1.title,
        }),
      ).not.toBeInTheDocument();
    },
  );

  it("does not apply a built-in drill definition to another scenario's assessment", () => {
    render(
      <PostGameReport
        report={{
          ...neutralReport,
          practiceAssessment: practiceAssessment(),
        }}
        onClose={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Archived drill definition unavailable",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: eventDisciplineEurGbpV1.title }),
    ).not.toBeInTheDocument();
  });

  it("renders every structured decision with planned, actual, and visible-event context", () => {
    const firstFill = {
      id: "fill-1",
      orderId: "order-1",
      time: "2020-01-02T00:00:00.000Z",
      symbol: "TEST",
      side: "buy" as const,
      quantity: 1,
      price: 100,
      referencePrice: 100,
      commission: 0,
      spreadCost: 0,
      slippage: 0,
      totalCost: 100,
    };
    const secondFill = {
      ...firstFill,
      id: "fill-2",
      orderId: "order-2",
      time: "2020-01-03T00:00:00.000Z",
      side: "sell" as const,
      price: 112,
      referencePrice: 112,
      totalCost: 112,
    };
    const visibleEvent = {
      id: "event-1",
      happenedAt: "2020-01-02T00:00:00.000Z",
      publishedAt: "2020-01-02T00:00:00.000Z",
      title: "Published policy event",
      type: "macro" as const,
      summary: "Policy information available at the decision.",
      affectedSymbols: ["TEST"],
      importance: 4 as const,
      sentiment: "mixed" as const,
    };

    render(
      <PostGameReport
        report={{
          ...neutralReport,
          totalTrades: 2,
          decisionReplay: [
            {
              fill: firstFill,
              fills: [firstFill],
              auditEvents: [],
              decisionPlan: {
                thesis: "Policy support should improve risk appetite.",
                invalidation: "A close below 95.",
                exitPlan: "Take profit near 115.",
                acceptedRisk: "$50 maximum loss",
                linkedEventIds: [visibleEvent.id],
              },
              visibleEvents: [visibleEvent],
              linkedEvents: [visibleEvent],
              actual: {
                firstFillTime: firstFill.time,
                lastFillTime: firstFill.time,
                fillCount: 1,
                executedQuantity: 1,
                averageFillPrice: 100,
                result: "not_realized",
              },
            },
            {
              fill: secondFill,
              fills: [secondFill],
              auditEvents: [],
              decisionPlan: {
                thesis: "The planned target has been reached.",
                exitPlan: "Close the position.",
              },
              visibleEvents: [visibleEvent],
              linkedEvents: [],
              actual: {
                firstFillTime: secondFill.time,
                lastFillTime: secondFill.time,
                fillCount: 1,
                executedQuantity: 1,
                averageFillPrice: 112,
                realizedPnl: 12,
                result: "realized_gain",
              },
            },
          ],
        }}
        pricePrecision={5}
        onClose={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Decision replay" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "BUY 1.00 TEST" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "SELL 1.00 TEST" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Policy support should improve risk appetite/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Published policy event/)).toHaveLength(2);
    expect(screen.getByText(/\$100\.00000 average/)).toBeInTheDocument();
    expect(screen.getByText(/\$12\.00 realized \(gain\)/)).toBeInTheDocument();
  });

  it("uses native sharing with a branded summary and opens the print dialog", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(
      <PostGameReport
        report={{
          ...neutralReport,
          scenarioId: eventDisciplineEurGbpV1.scenarioId,
          provenance: practiceProvenance,
          practiceAssessment: practiceAssessment(),
        }}
        onClose={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share summary" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Market Time Machine — Neutral report scenario",
        text: expect.stringContaining(
          "Practice process score: 80/100 · rubric event-discipline-process-v1",
        ),
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Print / Save PDF" }),
    );
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("falls back to copying the branded summary when native sharing is absent", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <PostGameReport
        report={neutralReport}
        onClose={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Market Time Machine · Decision-quality report"),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Report summary copied.",
    );
  });

  it("labels an incomplete practice assessment without sharing its provisional score", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <PostGameReport
        report={{
          ...neutralReport,
          practiceAssessment: practiceAssessment({
            status: "incomplete",
            overallScore: 65,
          }),
        }}
        onClose={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const summary = String(writeText.mock.calls[0]?.[0]);
    expect(summary).toContain("Practice process: incomplete · no assessed score");
    expect(summary).not.toContain("Practice process score: 65/100");
  });

  it("does not share a completed partial-schedule assessment as measured", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const partialSchedule = practiceSchedule.slice(0, 1);
    const partialEventCount = new Set(
      partialSchedule.flatMap((checkpoint) => checkpoint.eventIds),
    ).size;
    render(
      <PostGameReport
        report={{
          ...neutralReport,
          scenarioId: eventDisciplineEurGbpV1.scenarioId,
          provenance: practiceProvenance,
          practiceAssessment: practiceAssessment({
            checkpointScheduleFingerprint:
              drillCheckpointScheduleFingerprint(partialSchedule),
            eligibleCheckpointCount: partialSchedule.length,
            answeredCheckpointCount: partialSchedule.length,
            eligibleEventCount: partialEventCount,
            linkedEventCount: partialEventCount,
          }),
        }}
        onClose={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const summary = String(writeText.mock.calls[0]?.[0]);
    expect(summary).toContain(
      "Practice process: retained facts only · exact drill schedule unavailable",
    );
    expect(summary).not.toContain("Practice process score: 80/100");
  });

  it("does not share a legacy automatic-link score as assessed", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <PostGameReport
        report={{
          ...neutralReport,
          practiceAssessment: practiceAssessment({
            eventLinkageEvidenceVersion: undefined,
          }),
        }}
        onClose={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const summary = String(writeText.mock.calls[0]?.[0]);
    expect(summary).toContain(
      "Practice process: unassessed legacy attempt · explicit event links were not recorded",
    );
    expect(summary).not.toContain("Practice process score: 80/100");
  });
});
