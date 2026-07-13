import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { listScenarios } from "../../data/scenarios";
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
    onExport: vi.fn(),
    onRestore: vi.fn(),
    onImportScenario: vi.fn(),
    userScenarioIds: [],
    onRemoveScenario: vi.fn(),
    onClearSavedSession: vi.fn(),
    ...overrides,
  };
  render(<ScenarioLibrary {...props} />);
  return props;
}

describe("ScenarioLibrary", () => {
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

    expect(screen.getByText("Saved on this device")).toBeInTheDocument();
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
