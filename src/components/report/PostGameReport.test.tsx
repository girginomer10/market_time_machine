import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PostGameReport from "./PostGameReport";
import type { ReportPayload } from "../../types";

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
        report={neutralReport}
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
          "Market Time Machine · Decision-quality report",
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
});
