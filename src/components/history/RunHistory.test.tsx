import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CompletedRun } from "../../domain/history/runHistory";
import { eventDisciplineEurGbpV1 } from "../../data/practice/drills";
import { getScenario } from "../../data/scenarios";
import {
  buildDrillCheckpointSchedule,
  drillCheckpointScheduleFingerprint,
  drillRubricFingerprint,
} from "../../domain/practice/drills";
import type { DrillAssessment } from "../../types";
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

const completedScenario = getScenario(eventDisciplineEurGbpV1.scenarioId)!;
const completedSchedule = buildDrillCheckpointSchedule(
  eventDisciplineEurGbpV1,
  completedScenario,
);
const completedEventCount = new Set(
  completedSchedule.flatMap((checkpoint) => checkpoint.eventIds),
).size;
const completedRubric = eventDisciplineEurGbpV1.rubric;

const completedAssessment: DrillAssessment = {
  drillId: eventDisciplineEurGbpV1.id,
  competencyId: eventDisciplineEurGbpV1.competencyId,
  definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
  rubricVersion: eventDisciplineEurGbpV1.rubricVersion,
  rubricFingerprint: drillRubricFingerprint(completedRubric),
  checkpointScheduleFingerprint:
    drillCheckpointScheduleFingerprint(completedSchedule),
  eventLinkageEvidenceVersion: 1,
  status: "completed",
  overallScore: 90,
  methodology: "Process-only fixture",
  components: Object.entries(completedRubric.weights).map(
    ([id, weight]) => ({
      id: id as DrillAssessment["components"][number]["id"],
      label: id,
      weight,
      status: "assessed",
      score:
        id === "event_linkage"
          ? 50
          : 100,
      evidence: "Fixture evidence",
    }),
  ),
  eligibleCheckpointCount: completedSchedule.length,
  answeredCheckpointCount: completedSchedule.length,
  skippedCheckpointCount: 0,
  eligibleEventCount: completedEventCount,
  linkedEventCount: completedEventCount / 2,
  violationCount: 0,
};

describe("RunHistory", () => {
  it("explains the empty state", () => {
    render(
      <RunHistory
        runs={[]}
        onViewReport={vi.fn()}
        onReplay={vi.fn()}
        onRemove={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText("Your first completed replay will appear here.")).toBeInTheDocument();
  });

  it("keeps archive controls when only compact practice evidence remains", () => {
    const onExport = vi.fn();
    const onClear = vi.fn();
    render(
      <RunHistory
        runs={[]}
        hasArchiveData
        onViewReport={vi.fn()}
        onReplay={vi.fn()}
        onRemove={vi.fn()}
        onExport={onExport}
        onImport={vi.fn()}
        onClear={onClear}
      />,
    );

    expect(screen.getByText("No full replay reports are stored.")).toBeInTheDocument();
    expect(screen.getByText(/Compact practice evidence remains available/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Export practice archive" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(onExport).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("shows an explicit damaged-archive recovery path and blocks import", () => {
    const onExportDamaged = vi.fn();
    const onDiscardDamaged = vi.fn();
    render(
      <RunHistory
        runs={[]}
        archiveDamaged
        onViewReport={vi.fn()}
        onReplay={vi.fn()}
        onRemove={vi.fn()}
        onExport={vi.fn()}
        onExportDamaged={onExportDamaged}
        onImport={vi.fn()}
        onClear={vi.fn()}
        onDiscardDamaged={onDiscardDamaged}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /new replay saves and archive imports are blocked/i,
    );
    expect(
      screen.getByRole("button", { name: "Import practice archive" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Download damaged data" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove damaged history" }),
    );
    expect(onExportDamaged).toHaveBeenCalledOnce();
    expect(onDiscardDamaged).toHaveBeenCalledOnce();
  });

  it("renders progress and exposes report, replay, and removal actions", () => {
    const onViewReport = vi.fn();
    const onReplay = vi.fn();
    const onRemove = vi.fn();
    const onExport = vi.fn();
    const onClear = vi.fn();
    const onImport = vi.fn();
    render(
      <RunHistory
        runs={[run]}
        onViewReport={onViewReport}
        onReplay={onReplay}
        onRemove={onRemove}
        onExport={onExport}
        onImport={onImport}
        onClear={onClear}
      />,
    );

    expect(screen.getByText("Scenario A")).toBeInTheDocument();
    expect(screen.getByText("Not assessed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^View report for / }));
    fireEvent.click(screen.getByRole("button", { name: /^Replay / }));
    fireEvent.click(screen.getByRole("button", { name: /^Remove / }));
    fireEvent.click(
      screen.getByRole("button", { name: "Export practice archive" }),
    );
    fireEvent.change(screen.getByLabelText("Import practice archive JSON"), {
      target: { files: [new File(["{}"], "archive.json")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(onViewReport).toHaveBeenCalledWith(run);
    expect(onReplay).toHaveBeenCalledWith(run);
    expect(onRemove).toHaveBeenCalledWith(run);
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("blocks stale archive actions while the latest report is being saved", () => {
    const onViewReport = vi.fn();
    const onReplay = vi.fn();
    const onRemove = vi.fn();
    const onExport = vi.fn();
    const onImport = vi.fn();
    const onClear = vi.fn();
    const { container } = render(
      <RunHistory
        runs={[run]}
        archiveBusy
        onViewReport={onViewReport}
        onReplay={onReplay}
        onRemove={onRemove}
        onExport={onExport}
        onImport={onImport}
        onClear={onClear}
      />,
    );

    expect(container.querySelector(".run-history")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /finishing the latest replay save/i,
    );

    const exportButton = screen.getByRole("button", {
      name: "Export practice archive",
    });
    const importButton = screen.getByRole("button", {
      name: "Import practice archive",
    });
    const clearButton = screen.getByRole("button", { name: "Clear history" });
    const removeButton = screen.getByRole("button", { name: /^Remove / });
    const importInput = screen.getByLabelText("Import practice archive JSON");

    [exportButton, importButton, clearButton, removeButton, importInput].forEach(
      (control) => expect(control).toBeDisabled(),
    );
    fireEvent.click(exportButton);
    fireEvent.click(importButton);
    fireEvent.click(clearButton);
    fireEvent.click(removeButton);

    expect(onExport).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();

    const viewButton = screen.getByRole("button", { name: /^View report for / });
    expect(viewButton).toBeEnabled();
    fireEvent.click(viewButton);
    expect(onViewReport).toHaveBeenCalledWith(run);

    const replayButton = screen.getByRole("button", { name: /^Replay / });
    expect(replayButton).toBeEnabled();
    fireEvent.click(replayButton);
    expect(onReplay).toHaveBeenCalledWith(run);
  });

  it("also pauses damaged-archive recovery actions while an archive save is pending", () => {
    const onExportDamaged = vi.fn();
    const onDiscardDamaged = vi.fn();
    render(
      <RunHistory
        runs={[]}
        archiveDamaged
        archiveBusy
        onViewReport={vi.fn()}
        onReplay={vi.fn()}
        onRemove={vi.fn()}
        onExport={vi.fn()}
        onExportDamaged={onExportDamaged}
        onImport={vi.fn()}
        onClear={vi.fn()}
        onDiscardDamaged={onDiscardDamaged}
      />,
    );

    const downloadButton = screen.getByRole("button", {
      name: "Download damaged data",
    });
    const discardButton = screen.getByRole("button", {
      name: "Remove damaged history",
    });
    expect(downloadButton).toBeDisabled();
    expect(discardButton).toBeDisabled();
    fireEvent.click(downloadButton);
    fireEvent.click(discardButton);
    expect(onExportDamaged).not.toHaveBeenCalled();
    expect(onDiscardDamaged).not.toHaveBeenCalled();
  });

  it("counts and displays only completed explicitly linked practice evidence", () => {
    const assessedReport = {
      ...run.report,
      scenarioId: completedScenario.meta.id,
      scenarioTitle: completedScenario.meta.title,
      provenance: {
        license: completedScenario.meta.license,
        dataSources: [...completedScenario.meta.dataSources],
        dataVersion: completedScenario.meta.dataVersion,
        isSampleData: completedScenario.meta.isSampleData ?? true,
      },
    };
    const assessed = {
      ...run,
      id: "run-assessed",
      scenarioId: completedScenario.meta.id,
      scenarioTitle: completedScenario.meta.title,
      executionCount: 1,
      report: { ...assessedReport, practiceAssessment: completedAssessment },
    } as CompletedRun;
    const legacy = {
      ...run,
      id: "run-legacy",
      executionCount: 1,
      report: {
        ...assessedReport,
        practiceAssessment: {
          ...completedAssessment,
          eventLinkageEvidenceVersion: undefined,
        },
      },
    } as CompletedRun;
    const provisional = {
      ...run,
      id: "run-provisional",
      executionCount: 1,
      report: {
        ...assessedReport,
        practiceAssessment: {
          ...completedAssessment,
          status: "incomplete",
        },
      },
    } as CompletedRun;
    const partialSchedule = completedSchedule.slice(0, 1);
    const partialEventCount = new Set(
      partialSchedule.flatMap((checkpoint) => checkpoint.eventIds),
    ).size;
    const partial = {
      ...assessed,
      id: "run-partial",
      report: {
        ...assessedReport,
        practiceAssessment: {
          ...completedAssessment,
          checkpointScheduleFingerprint:
            drillCheckpointScheduleFingerprint(partialSchedule),
          eligibleCheckpointCount: partialSchedule.length,
          answeredCheckpointCount: partialSchedule.length,
          eligibleEventCount: partialEventCount,
          linkedEventCount: partialEventCount,
        },
      },
    } as CompletedRun;

    render(
      <RunHistory
        runs={[assessed, legacy, provisional, partial]}
        onViewReport={vi.fn()}
        onReplay={vi.fn()}
        onRemove={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText("90 / 100")).toBeInTheDocument();
    expect(screen.getAllByText("Not assessed")).toHaveLength(3);
    expect(screen.getByText("drill assessed")).toHaveTextContent(
      /1\s*drill assessed/,
    );
  });

  it("gives every run action a target-specific accessible name", () => {
    const second = {
      ...run,
      id: "run-b",
      scenarioTitle: "Scenario B",
      completedAt: "2026-07-14T10:00:00.000Z",
    } as CompletedRun;
    render(
      <RunHistory
        runs={[run, second]}
        onViewReport={vi.fn()}
        onReplay={vi.fn()}
        onRemove={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    const expectedActionNames = [
      "View report for Scenario A, Jul 13, 2026",
      "Replay Scenario A, Jul 13, 2026",
      "Remove Scenario A, Jul 13, 2026",
      "View report for Scenario B, Jul 14, 2026",
      "Replay Scenario B, Jul 14, 2026",
      "Remove Scenario B, Jul 14, 2026",
    ];
    expectedActionNames.forEach((name) => {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    });
    expect(new Set(expectedActionNames).size).toBe(expectedActionNames.length);
  });
});
