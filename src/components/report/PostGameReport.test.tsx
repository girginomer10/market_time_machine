import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
});
