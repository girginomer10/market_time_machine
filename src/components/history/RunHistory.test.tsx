import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CompletedRun } from "../../domain/history/runHistory";
import RunHistory from "./RunHistory";

const run = {
  id: "run-a",
  completedAt: "2026-07-13T10:00:00.000Z",
  scenarioId: "scenario-a",
  scenarioTitle: "Scenario A",
  mode: "explorer",
  brokerMode: "scenario",
  sampleData: true,
  totalReturn: 0.1,
  benchmarkReturn: 0.05,
  excessReturn: 0.05,
  maxDrawdown: 0.08,
  scoreStatus: "scored",
  score: 72,
  executionCount: 2,
  closedTradeCount: 1,
  journalEntryCount: 1,
  journalCoverage: 1,
  report: {
    scenarioId: "scenario-a",
    scenarioTitle: "Scenario A",
    metrics: {
      totalReturn: 0.1,
      benchmarkReturn: 0.05,
      excessReturn: 0.05,
      maxDrawdown: 0.08,
      volatility: 0.2,
      winRate: 1,
      exposureTime: 0.5,
      turnover: 1,
      feesPaid: 0,
      slippagePaid: 0,
      initialEquity: 10_000,
      finalEquity: 11_000,
      benchmarkInitial: 10_000,
      benchmarkFinal: 10_500,
    },
    equityCurve: [],
    totalTrades: 1,
    behavioralFlags: [],
  },
} as CompletedRun;

describe("RunHistory", () => {
  it("explains the empty state", () => {
    render(
      <RunHistory
        runs={[]}
        onViewReport={vi.fn()}
        onReplay={vi.fn()}
        onRemove={vi.fn()}
        onExport={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText("Your first completed replay will appear here.")).toBeInTheDocument();
  });

  it("renders progress and exposes report, replay, and removal actions", () => {
    const onViewReport = vi.fn();
    const onReplay = vi.fn();
    const onRemove = vi.fn();
    const onExport = vi.fn();
    const onClear = vi.fn();
    render(
      <RunHistory
        runs={[run]}
        onViewReport={onViewReport}
        onReplay={onReplay}
        onRemove={onRemove}
        onExport={onExport}
        onClear={onClear}
      />,
    );

    expect(screen.getByText("Scenario A")).toBeInTheDocument();
    expect(screen.getByText("72 / 100")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View report" }));
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Export history" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(onViewReport).toHaveBeenCalledWith(run);
    expect(onReplay).toHaveBeenCalledWith(run);
    expect(onRemove).toHaveBeenCalledWith(run);
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
