import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  PracticeEvidenceClaim,
  PracticeEvidenceProfile,
} from "../../domain/practice/evidenceProfile";
import { rubricContentReference } from "../../domain/practice/evidenceProfile";
import EvidenceProfile from "./EvidenceProfile";

function claim(
  overrides: Partial<PracticeEvidenceClaim> = {},
): PracticeEvidenceClaim {
  return {
    id: "event-discipline:event-discipline-process-v1",
    competencyId: "event-discipline",
    rubricVersion: "event-discipline-process-v1",
    rubricFingerprint: "drill-rubric-v1:test-fixture",
    drillDefinitions: [
      { drillId: "event-discipline-eurgbp-v1", definitionVersion: 1 },
      { drillId: "event-discipline-eurusd-v1", definitionVersion: 1 },
    ],
    status: "assessed",
    attemptCount: 6,
    evidenceCount: 5,
    latestRunId: "run-current",
    latestScore: 88,
    scenarioIds: ["eurgbp-brexit-2016", "eurusd-covid-liquidity-2020"],
    scenarioCoverage: 2,
    validatedSourceScenarioIds: [
      "eurgbp-brexit-2016",
      "eurusd-covid-liquidity-2020",
    ],
    validatedSourceScenarioCoverage: 2,
    sampleEvidenceCount: 1,
    dataFidelities: ["mixed", "synthetic"],
    confidence: "established",
    trend: {
      status: "improving",
      currentRunId: "run-current",
      previousRunId: "run-previous",
      currentScore: 88,
      previousScore: 74,
      delta: 14,
    },
    ...overrides,
  };
}

function profile(
  claims: PracticeEvidenceClaim[],
  overrides: Partial<PracticeEvidenceProfile> = {},
): PracticeEvidenceProfile {
  return {
    ledgerEntryCount: 6,
    assessedEntryCount: 5,
    claims,
    ...overrides,
  };
}

describe("EvidenceProfile", () => {
  it("shows versioned process evidence, breadth confidence, and comparable runs", () => {
    render(<EvidenceProfile profile={profile([claim()])} />);

    expect(screen.getByRole("heading", { name: "Evidence profile" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "event-discipline" })).toBeInTheDocument();
    const identity = screen.getByLabelText("Assessment identity");
    expect(within(identity).getByText("event-discipline")).toBeInTheDocument();
    expect(screen.getByText("event-discipline-process-v1")).toBeInTheDocument();
    expect(
      screen.getByText(
        "event-discipline-eurgbp-v1 · definition v1, event-discipline-eurusd-v1 · definition v1",
      ),
    ).toBeInTheDocument();

    const score = screen.getByText("Latest process score").closest("div");
    expect(score).not.toBeNull();
    expect(within(score!).getByText("88/100")).toBeInTheDocument();
    expect(screen.getByText("5 runs")).toBeInTheDocument();
    expect(screen.getByText("2 scenarios")).toBeInTheDocument();
    expect(screen.getByText("2 source-reviewed scenarios")).toBeInTheDocument();
    expect(screen.getByText("Established evidence breadth")).toBeInTheDocument();
    expect(screen.getByText(/Confidence describes evidence breadth/)).toBeInTheDocument();

    expect(screen.getByText("Improving")).toBeInTheDocument();
    expect(screen.getByText("+14 points")).toBeInTheDocument();
    const compared = screen.getByLabelText("Compared process runs");
    expect(within(compared).getByText("run-current · 88/100")).toBeInTheDocument();
    expect(within(compared).getByText("run-previous · 74/100")).toBeInTheDocument();
    expect(screen.queryByText(/P\/L|profit|loss|report score/i)).not.toBeInTheDocument();
  });

  it("shows distinct content references for claims that share a rubric version", () => {
    const firstFingerprint = "drill-rubric-v1:first-content";
    const secondFingerprint = "drill-rubric-v1:second-content";
    render(
      <EvidenceProfile
        profile={profile([
          claim({
            id: "event-discipline:event-discipline-process-v1:first",
            rubricFingerprint: firstFingerprint,
          }),
          claim({
            id: "event-discipline:event-discipline-process-v1:second",
            rubricFingerprint: secondFingerprint,
          }),
        ])}
      />,
    );

    expect(
      screen.getAllByText("event-discipline-process-v1"),
    ).toHaveLength(2);
    const references = screen
      .getAllByText(/^content-[0-9a-f]{8}$/)
      .map((element) => element.textContent);
    expect(references).toEqual([
      rubricContentReference(firstFingerprint),
      rubricContentReference(secondFingerprint),
    ]);
    expect(new Set(references).size).toBe(2);
  });

  it("labels missing process evidence and explains why trend is unavailable", () => {
    render(
      <EvidenceProfile
        profile={profile([
          claim({
            status: "unassessed",
            evidenceCount: 0,
            latestRunId: undefined,
            latestScore: undefined,
            scenarioIds: [],
            scenarioCoverage: 0,
            validatedSourceScenarioIds: [],
            validatedSourceScenarioCoverage: 0,
            sampleEvidenceCount: 0,
            dataFidelities: [],
            confidence: "insufficient_evidence",
            trend: { status: "insufficient_evidence" },
          }),
        ])}
      />,
    );

    expect(screen.getAllByText("Not assessed")).toHaveLength(2);
    expect(screen.getByText("Insufficient evidence breadth")).toBeInTheDocument();
    expect(screen.getByText("Not enough comparable runs")).toBeInTheDocument();
    expect(screen.getByText(/Two assessed runs with the same scenario and data version/)).toBeInTheDocument();
    expect(screen.getByText(/exact broker settings/)).toBeInTheDocument();
  });

  it("has an explicit empty state without manufacturing a score", () => {
    render(
      <EvidenceProfile
        profile={profile([], { ledgerEntryCount: 0, assessedEntryCount: 0 })}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("No process evidence yet");
    expect(screen.getByText(/Free replays and unassessed records/)).toBeInTheDocument();
    expect(screen.queryByText(/\/100/)).not.toBeInTheDocument();
  });
});
