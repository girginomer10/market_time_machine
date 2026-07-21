import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  decisionFoundationsTrack,
  volatilityDisciplineTrack,
} from "../../data/practice/tracks";
import type { PracticeTrackProgress } from "../../domain/practice/tracks";
import PracticeTracks from "./PracticeTracks";

const foundationProgress: PracticeTrackProgress = {
  trackId: decisionFoundationsTrack.id,
  trackVersion: decisionFoundationsTrack.version,
  status: "not_started",
  completedUnitCount: 0,
  creditableUnitCount: 1,
  units: [
    {
      unitId: decisionFoundationsTrack.units[0].id,
      unitVersion: decisionFoundationsTrack.units[0].version,
      status: "incomplete",
    },
  ],
};

const previewProgress: PracticeTrackProgress = {
  trackId: volatilityDisciplineTrack.id,
  trackVersion: volatilityDisciplineTrack.version,
  status: "preview",
  completedUnitCount: 0,
  creditableUnitCount: 0,
  units: volatilityDisciplineTrack.units.map((unit) => ({
    unitId: unit.id,
    unitVersion: unit.version,
    status: "preview" as const,
  })),
};

describe("PracticeTracks", () => {
  it("discloses exact evidence, limitations, criteria, and incomplete-unit action", () => {
    const onPrepareUnit = vi.fn();
    const unit = decisionFoundationsTrack.units[0];
    render(
      <PracticeTracks
        tracks={[decisionFoundationsTrack]}
        progress={[foundationProgress]}
        onPrepareUnit={onPrepareUnit}
      />,
    );

    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Not started")).toBeInTheDocument();
    expect(screen.getByText("0/1")).toBeInTheDocument();
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
    expect(screen.getByText(unit.scenario.dataVersion!)).toBeInTheDocument();
    expect(
      screen.getByText("Scenario rules · exact pinned settings"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Config v1 · display checksum [0-9a-f]{16}/),
    ).toBeInTheDocument();
    expect(screen.queryByText(unit.broker.fingerprint)).not.toBeInTheDocument();
    expect(screen.getByText("Source-observed market evidence")).toBeInTheDocument();
    expect(screen.getByText("Official-source publications")).toBeInTheDocument();
    expect(screen.getByText("Source reviewed")).toBeInTheDocument();
    expect(screen.getByText(unit.evidenceScope.limitations)).toBeInTheDocument();
    expect(screen.getByText("Overall process score ≥ 80/100")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint coverage ≥ 100/100")).toBeInTheDocument();
    expect(screen.getByText("Answered checkpoints ≥ 100%")).toBeInTheDocument();
    expect(screen.getByText(/Every criterion below must be met in the same completed assessment/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: `Prepare ${unit.title}` }),
    );
    expect(onPrepareUnit).toHaveBeenCalledOnce();
    expect(onPrepareUnit).toHaveBeenCalledWith(unit);
  });

  it("marks preview tracks and units as explicitly non-creditable", () => {
    const onPrepareUnit = vi.fn();
    const firstUnit = volatilityDisciplineTrack.units[0];
    render(
      <PracticeTracks
        tracks={[volatilityDisciplineTrack]}
        progress={[previewProgress]}
        onPrepareUnit={onPrepareUnit}
      />,
    );

    expect(screen.getByText("Preview", { selector: ".practice-track-availability" })).toBeInTheDocument();
    expect(screen.getByText("Preview only")).toBeInTheDocument();
    expect(screen.getByText("0/0")).toBeInTheDocument();
    expect(screen.getAllByText("Preview · No credit")).toHaveLength(2);
    expect(
      screen.getByText("This preview track cannot award completion credit."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Preview units do not award unit or track completion credit/),
    ).toHaveLength(2);
    expect(screen.getAllByText("Synthetic sample market evidence")).toHaveLength(2);

    const previewButton = screen.getByRole("button", {
      name: `Preview ${firstUnit.title} — no credit`,
    });
    fireEvent.click(previewButton);
    expect(onPrepareUnit).toHaveBeenCalledWith(firstUnit);
  });

  it("shows credited attempts and a repeat action for completed units", () => {
    const onPrepareUnit = vi.fn();
    const unit = decisionFoundationsTrack.units[0];
    const completed: PracticeTrackProgress = {
      ...foundationProgress,
      status: "completed",
      completedUnitCount: 1,
      units: [
        {
          ...foundationProgress.units[0],
          status: "completed",
          creditedAttemptId: "ledger-attempt-7",
        },
      ],
    };
    render(
      <PracticeTracks
        tracks={[decisionFoundationsTrack]}
        progress={[completed]}
        onPrepareUnit={onPrepareUnit}
      />,
    );

    const track = screen.getByRole("heading", { name: "Decision Foundations" }).closest("article");
    expect(track).not.toBeNull();
    expect(within(track!).getAllByText("Completed")).toHaveLength(2);
    expect(within(track!).getByText("1/1")).toBeInTheDocument();
    expect(within(track!).getByText("Credited attempt: ledger-attempt-7")).toBeInTheDocument();

    fireEvent.click(
      within(track!).getByRole("button", {
        name: `Practice ${unit.title} again`,
      }),
    );
    expect(onPrepareUnit).toHaveBeenCalledWith(unit);
  });

  it("renders an accessible empty catalog state", () => {
    render(<PracticeTracks tracks={[]} progress={[]} onPrepareUnit={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No practice tracks are available",
    );
  });
});
