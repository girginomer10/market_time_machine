import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { listScenarios } from "../../data/scenarios";
import {
  eventDisciplineQqqV1,
  listBuiltInDrills,
} from "../../data/practice/drills";
import {
  decisionFoundationsTrack,
  volatilityDisciplineTrack,
} from "../../data/practice/tracks";
import { buildPracticeCoachPlan } from "../../domain/coaching/practiceCoach";
import type { PracticeTrackProgress } from "../../domain/practice/tracks";
import type { ScenarioPackage } from "../../types";
import ScenarioLibrary from "./ScenarioLibrary";

function scenarios(): ScenarioPackage[] {
  return listScenarios().filter((scenario) =>
    [
      "btc-2020-2021",
      "eurgbp-brexit-2016",
      "qqq-rate-hike-2022",
    ].includes(scenario.meta.id),
  );
}

function renderLibrary(
  overrides: Partial<ComponentProps<typeof ScenarioLibrary>> = {},
) {
  const available = scenarios();
  const activeScenario = available.find(
    (scenario) => scenario.meta.id === "eurgbp-brexit-2016",
  )!;
  const props: ComponentProps<typeof ScenarioLibrary> = {
    scenarios: available,
    activeScenario,
    activeMode: "explorer",
    activeStatus: "idle",
    activeProgressPct: 0,
    hasActiveSession: false,
    onContinue: vi.fn(),
    onStart: vi.fn(),
    onStartSurprise: vi.fn(),
    onExport: vi.fn(),
    onRestore: vi.fn(),
    onImportScenario: vi.fn(),
    userScenarioIds: [],
    onRemoveScenario: vi.fn(),
    onClearSavedSession: vi.fn(),
    ...overrides,
  };
  const view = render(<ScenarioLibrary {...props} />);
  return { ...view, props };
}

describe("ScenarioLibrary", () => {
  it("shows the evidence dashboard and prepares a validated track briefing before start", () => {
    const onStart = vi.fn();
    const unit = decisionFoundationsTrack.units[0];
    const trackProgress: PracticeTrackProgress = {
      trackId: decisionFoundationsTrack.id,
      trackVersion: decisionFoundationsTrack.version,
      status: "not_started",
      completedUnitCount: 0,
      creditableUnitCount: 1,
      units: [
        {
          unitId: unit.id,
          unitVersion: unit.version,
          status: "incomplete",
        },
      ],
    };
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    renderLibrary({
      drills: listBuiltInDrills(),
      evidenceProfile: {
        ledgerEntryCount: 0,
        assessedEntryCount: 0,
        claims: [],
      },
      practiceTracks: [decisionFoundationsTrack],
      practiceTrackProgress: [trackProgress],
      onStart,
    });

    expect(screen.getByRole("heading", { name: "Evidence profile" })).toBeInTheDocument();
    expect(screen.getByText("No process evidence yet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Practice tracks" })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: `Prepare ${unit.title}` }),
    );

    expect(onStart).not.toHaveBeenCalled();
    expect(document.getElementById("briefing-title")).toHaveFocus();
    expect(
      screen.getByText("EUR/GBP Brexit — Event Discipline").closest("button"),
    ).toHaveAttribute("aria-pressed", "true");
    const start = screen.getByRole("button", { name: "Start guided drill" });
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledWith(
      unit.scenario.id,
      unit.drill.mode,
      unit.drill.id,
      {
        scenarioDataVersion: unit.scenario.dataVersion,
        brokerMode: unit.broker.mode,
        brokerFingerprint: unit.broker.fingerprint,
      },
    );
    raf.mockRestore();
  });

  it("keeps preview track preparation non-creditable and waits for Start", () => {
    const onStart = vi.fn();
    const unit = volatilityDisciplineTrack.units[0];
    const previewProgress: PracticeTrackProgress = {
      trackId: volatilityDisciplineTrack.id,
      trackVersion: volatilityDisciplineTrack.version,
      status: "preview",
      completedUnitCount: 0,
      creditableUnitCount: 0,
      units: volatilityDisciplineTrack.units.map((candidate) => ({
        unitId: candidate.id,
        unitVersion: candidate.version,
        status: "preview" as const,
      })),
    };
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    renderLibrary({
      drills: listBuiltInDrills(),
      practiceTracks: [volatilityDisciplineTrack],
      practiceTrackProgress: [previewProgress],
      onStart,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: `Preview ${unit.title} — no credit`,
      }),
    );

    expect(onStart).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Nasdaq 2022 Rate Shock",
      }),
    ).toHaveFocus();
    expect(
      screen.getByText("Preview practice · No completion credit"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start guided drill" }));
    expect(onStart).toHaveBeenCalledWith(
      unit.scenario.id,
      unit.drill.mode,
      unit.drill.id,
      {
        scenarioDataVersion: unit.scenario.dataVersion,
        brokerMode: unit.broker.mode,
        brokerFingerprint: unit.broker.fingerprint,
      },
    );
    raf.mockRestore();
  });

  it("shows the same no-credit disclosure when a preview drill is selected directly", () => {
    renderLibrary({
      drills: listBuiltInDrills(),
      practiceTracks: [decisionFoundationsTrack, volatilityDisciplineTrack],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Choose Nasdaq 2022 Rate Shock" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(eventDisciplineQqqV1.title),
      }),
    );

    expect(
      screen.getByText("Preview practice · No completion credit"),
    ).toBeInTheDocument();
  });

  it("briefs a fresh user on product boundaries and scenario rules", () => {
    renderLibrary();

    expect(
      screen.getByRole("heading", {
        name: "Enter the market before you know the ending.",
      }),
    ).toHaveFocus();
    expect(screen.getByText("Local and private")).toBeInTheDocument();
    expect(screen.getByText("Education only")).toBeInTheDocument();
    expect(screen.getByText("Data fidelity is explicit")).toBeInTheDocument();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Brexit Referendum: EUR/GBP 2016",
      }),
    ).toBeInTheDocument();

    const brexitCard = screen
      .getByRole("heading", {
        level: 3,
        name: "Brexit Referendum: EUR/GBP 2016",
      })
      .closest("article")!;
    expect(within(brexitCard).getByText("Beginner")).toBeInTheDocument();
    expect(within(brexitCard).getByText(/about 8 min/)).toBeInTheDocument();
    expect(
      within(brexitCard).getAllByText("Observed + derived data").length,
    ).toBeGreaterThan(0);
    expect(
      within(brexitCard).getByText(/Protect a GBP-denominated portfolio/),
    ).toBeInTheDocument();
    expect(screen.getByText("Observed from source")).toBeInTheDocument();
    expect(screen.getByText("Derived or unavailable")).toBeInTheDocument();

    const btcCard = screen
      .getByRole("heading", { level: 3, name: "Bitcoin 2020–2021" })
      .closest("article")!;
    expect(within(btcCard).getByText("Intermediate")).toBeInTheDocument();
    expect(within(btcCard).getByText(/steps · about \d+ min/)).toBeInTheDocument();
    expect(within(btcCard).getByText("$10,000.00")).toBeInTheDocument();
    expect(
      within(btcCard).getAllByText("Synthetic sample prices").length,
    ).toBeGreaterThan(0);
    expect(within(btcCard).getByText(/10.0 bps commission/)).toBeInTheDocument();
    expect(within(btcCard).getByText("Explorer")).toBeInTheDocument();
    expect(within(btcCard).getByText("Realistic practice")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose Bitcoin 2020–2021" }),
    );
    expect(
      screen.getByText(/Prices are deterministic synthetic samples/),
    ).toBeInTheDocument();
  });

  it("requires an explicit scenario and mode choice before starting", () => {
    const onStart = vi.fn();
    renderLibrary({ onStart });

    fireEvent.click(
      screen.getByRole("button", { name: "Choose Nasdaq 2022 Rate Shock" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Local challenge/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Start Local challenge replay" }),
    );

    expect(onStart).toHaveBeenCalledWith("qqq-rate-hike-2022", "challenge");
  });

  it("starts a concealed surprise self-test without selecting a visible scenario", () => {
    const onStartSurprise = vi.fn();
    renderLibrary({ onStartSurprise });

    expect(
      screen.getByRole("heading", { name: "Start without choosing the lab" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/local self-test—not secure anti-cheat/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Scenario identity and the ending are masked/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Identity and progress are masked/i)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Start surprise Blind replay" }),
    );
    expect(onStartSurprise).toHaveBeenCalledWith("blind");
  });

  it("supports roving focus and standard radiogroup keyboard navigation", () => {
    renderLibrary();

    const explorer = screen.getByRole("radio", { name: /Explorer/ });
    const professional = screen.getByRole("radio", {
      name: /Realistic practice/,
    });
    const blind = screen.getByRole("radio", { name: /Blind replay/ });
    const challenge = screen.getByRole("radio", { name: /Local challenge/ });

    expect(explorer).toHaveAttribute("tabindex", "0");
    expect(professional).toHaveAttribute("tabindex", "-1");
    expect(blind).toHaveAttribute("tabindex", "-1");
    expect(challenge).toHaveAttribute("tabindex", "-1");

    explorer.focus();
    fireEvent.keyDown(explorer, { key: "ArrowRight" });
    expect(professional).toBeChecked();
    expect(professional).toHaveFocus();
    expect(explorer).toHaveAttribute("tabindex", "-1");
    expect(professional).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(professional, { key: "ArrowDown" });
    expect(blind).toBeChecked();
    expect(blind).toHaveFocus();

    fireEvent.keyDown(blind, { key: "End" });
    expect(challenge).toBeChecked();
    expect(challenge).toHaveFocus();

    fireEvent.keyDown(challenge, { key: "ArrowRight" });
    expect(explorer).toBeChecked();
    expect(explorer).toHaveFocus();

    fireEvent.keyDown(explorer, { key: "ArrowLeft" });
    expect(challenge).toBeChecked();
    expect(challenge).toHaveFocus();

    fireEvent.keyDown(challenge, { key: "Home" });
    expect(explorer).toBeChecked();
    expect(explorer).toHaveFocus();

    fireEvent.keyDown(explorer, { key: "ArrowUp" });
    expect(challenge).toBeChecked();
    expect(challenge).toHaveFocus();
  });

  it("keeps guided-drill keyboard navigation inside its single visible mode", () => {
    renderLibrary({ drills: listBuiltInDrills() });
    fireEvent.click(
      screen.getByRole("button", {
        name: /EUR\/GBP Brexit — Event Discipline/,
      }),
    );
    const guidedMode = screen.getByRole("radio", {
      name: /Explorer/,
    });

    guidedMode.focus();
    fireEvent.keyDown(guidedMode, { key: "ArrowRight" });

    expect(screen.getAllByRole("radio")).toEqual([guidedMode]);
    expect(guidedMode).toBeChecked();
    expect(guidedMode).toHaveFocus();
  });

  it("prepares the coach assignment in the existing briefing before start", () => {
    const available = scenarios();
    const practicePlan = buildPracticeCoachPlan([], available)!;
    const onStart = vi.fn();
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    renderLibrary({
      practicePlan,
      drills: listBuiltInDrills(),
      onStart,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Review first practice" }),
    );

    expect(document.getElementById("briefing-title")).toHaveFocus();
    expect(screen.getByRole("radio", { name: /Explorer/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Start guided drill" }));
    expect(onStart).toHaveBeenCalledWith(
      practicePlan.scenarioId,
      practicePlan.mode,
      practicePlan.drillId,
      {
        scenarioDataVersion: practicePlan.scenarioDataVersion,
        brokerMode: practicePlan.brokerMode,
        brokerFingerprint: practicePlan.brokerFingerprint,
      },
    );
    raf.mockRestore();
  });

  it("does not start with a prepared coach context after the current plan changes", () => {
    const available = scenarios();
    const practicePlan = buildPracticeCoachPlan([], available)!;
    const replacementPlan = {
      ...practicePlan,
      brokerFingerprint: `${practicePlan.brokerFingerprint}-replacement`,
      title: "Updated coaching assignment",
    };
    const onStart = vi.fn();
    const props = renderLibrary({
      practicePlan,
      drills: listBuiltInDrills(),
      onStart,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Review first practice" }),
    );

    const { rerender } = props;
    rerender(
      <ScenarioLibrary
        {...props.props}
        practicePlan={replacementPlan}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start guided drill" }));

    expect(onStart).toHaveBeenCalledWith(
      practicePlan.scenarioId,
      practicePlan.mode,
      practicePlan.drillId,
    );
    expect(onStart).not.toHaveBeenCalledWith(
      practicePlan.scenarioId,
      practicePlan.mode,
      practicePlan.drillId,
      expect.objectContaining({
        brokerFingerprint: practicePlan.brokerFingerprint,
      }),
    );
  });

  it("keeps an active replay intact while the coach only prepares a briefing", () => {
    const available = scenarios();
    const practicePlan = buildPracticeCoachPlan([], available)!;
    const onStart = vi.fn();
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    renderLibrary({
      practicePlan,
      activeStatus: "paused",
      activeProgressPct: 37,
      hasActiveSession: true,
      onStart,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Review first practice" }),
    );

    expect(onStart).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Continue active replay" }),
    ).toBeInTheDocument();
    expect(document.getElementById("briefing-title")).toHaveFocus();
    raf.mockRestore();
  });

  it("surfaces a saved replay and local scenario import", () => {
    const onContinue = vi.fn();
    const onImportScenario = vi.fn();
    renderLibrary({
      activeStatus: "paused",
      activeProgressPct: 37,
      hasActiveSession: true,
      onContinue,
      onImportScenario,
    });

    expect(screen.getByText("Active in this browser")).toBeInTheDocument();
    expect(screen.getByText(/37% complete/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue active replay" }),
    );
    expect(onContinue).toHaveBeenCalledTimes(1);

    const file = new File(["{}"], "scenario.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByLabelText("Import scenario package JSON"), {
      target: { files: [file] },
    });
    expect(onImportScenario).toHaveBeenCalledTimes(1);
  });

  it("announces scenario validation failures separately from session restore", () => {
    renderLibrary({
      scenarioMessage: "Scenario package is not valid JSON.",
      scenarioMessageKind: "error",
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Scenario package is not valid JSON.",
    );
    expect(
      screen.getByLabelText("Import scenario package JSON"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Restore Market Time Machine session backup"),
    ).toBeInTheDocument();
  });

  it("lets the owner remove an imported scenario without marking bundled labs removable", () => {
    const available = scenarios();
    const custom: ScenarioPackage = {
      ...available[0],
      meta: {
        ...available[0].meta,
        id: "my-local-lab",
        title: "My Local Lab",
      },
    };
    const onRemoveScenario = vi.fn();
    renderLibrary({
      scenarios: [...available, custom],
      userScenarioIds: [custom.meta.id],
      onRemoveScenario,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove imported scenario My Local Lab",
      }),
    );
    expect(onRemoveScenario).toHaveBeenCalledWith(
      custom.meta.id,
      custom.meta.title,
    );
    expect(
      screen.queryByRole("button", {
        name: /Remove imported scenario Brexit Referendum/,
      }),
    ).not.toBeInTheDocument();
  });
});
