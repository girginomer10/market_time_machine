import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrillAssessment, Fill, Order } from "../types";
import { useSessionStore } from "../store/sessionStore";
import {
  getScenario,
  isUserScenario,
  registerUserScenario,
  removeUserScenario,
} from "../data/scenarios";
import {
  eventDisciplineEurGbpV1,
  eventDisciplineQqqV1,
} from "../data/practice/drills";
import {
  decisionFoundationsTrack,
  EURGBP_BREXIT_2016_DATA_VERSION,
} from "../data/practice/tracks";
import {
  derivePracticeLedgerEntry,
  persistPracticeLedger,
  type PracticeLedgerEntry,
} from "../domain/history/practiceLedger";
import { exportPracticeArchive } from "../domain/history/practiceArchive";
import { recordCompletedRun } from "../domain/history/runHistory";
import App from "./App";

vi.mock("../components/chart/ReplayChart", () => ({
  default: ({ fills, orders }: { fills: Fill[]; orders: Order[] }) => (
    <div data-testid="replay-chart-display-data">
      <span>{fills.map((fill) => fill.symbol).join(",")}</span>
      <span>{orders.map((order) => order.symbol).join(",")}</span>
    </div>
  ),
}));

const fill: Fill = {
  id: "fill-mask-test",
  orderId: "order-mask-test",
  time: "2020-01-02T23:59:59.999Z",
  symbol: "BTCUSD",
  side: "buy",
  quantity: 0.1,
  price: 7_200,
  referencePrice: 7_200,
  commission: 1,
  spreadCost: 0,
  slippage: 0,
  totalCost: 721,
};

const order: Order = {
  id: "order-mask-test",
  createdAt: "2020-01-02T23:59:59.999Z",
  symbol: "BTCUSD",
  side: "buy",
  type: "market",
  quantity: 0.1,
  status: "filled",
};

describe("App restricted replay identity", () => {
  beforeEach(() => {
    useSessionStore.getState().selectScenario("btc-2020-2021");
    useSessionStore.setState({
      mode: "challenge",
      status: "paused",
      currentIndex: 1,
      fills: [fill],
      orders: [order],
      journal: [
        {
          id: "journal-mask-test",
          time: fill.time,
          fillId: fill.id,
          symbol: "BTCUSD",
          note: "BTCUSD thesis remains valid.",
        },
      ],
      auditEvents: [
        {
          id: "audit-mask-test",
          time: fill.time,
          type: "fill",
          symbol: "BTCUSD",
          fillId: fill.id,
          orderId: order.id,
          message: "BTCUSD order filled.",
        },
      ],
      report: undefined,
    });
  });

  afterEach(() => {
    cleanup();
    useSessionStore.getState().resetScenario();
  });

  it("masks scenario and primary-asset identity until the challenge finishes", () => {
    render(<App />);

    expect(screen.getByText("Local challenge")).toBeInTheDocument();
    expect(screen.getByText("Asset label hidden until completion")).toBeInTheDocument();
    expect(screen.getByText("primary asset order filled.")).toBeInTheDocument();
    expect(screen.getByTestId("replay-chart-display-data")).toHaveTextContent(
      "Primary asset",
    );
    expect(document.body).not.toHaveTextContent("Bitcoin 2020–2021");
    expect(document.body).not.toHaveTextContent("Bitcoin / US Dollar");
    expect(document.body).not.toHaveTextContent("BTCUSD");
    expect(
      screen.getByRole("button", {
        name: "Scenario switch locked during local challenge",
      }),
    ).toBeDisabled();

    act(() => {
      useSessionStore.setState({ status: "finished" });
    });

    expect(screen.getByText("Bitcoin 2020–2021")).toBeInTheDocument();
    expect(screen.getByText("Bitcoin / US Dollar")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("BTCUSD");
  });
});

describe("App scenario library journey", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSessionStore.getState().selectScenario("eurgbp-brexit-2016");
    useSessionStore.getState().resetScenario();
  });

  afterEach(() => {
    cleanup();
    useSessionStore.getState().resetScenario();
    window.localStorage.clear();
  });

  it("builds the local evidence dashboard and only prepares a track briefing", () => {
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    render(<App />);

    expect(screen.getByRole("heading", { name: "Evidence profile" })).toBeInTheDocument();
    expect(screen.getByText("No process evidence yet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Practice tracks" })).toBeInTheDocument();
    expect(screen.getAllByText("0/1").length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", {
        name: `Prepare ${decisionFoundationsTrack.units[0].title}`,
      }),
    );

    expect(useSessionStore.getState().activeDrillId).toBeUndefined();
    expect(document.getElementById("briefing-title")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Start guided drill" }));
    expect(useSessionStore.getState().activeDrillId).toBe(
      eventDisciplineEurGbpV1.id,
    );
    expect(screen.getByText("Active drill")).toBeInTheDocument();
    raf.mockRestore();
  });

  it("derives evidence claims, track credit, and archive actions from compact ledger data", () => {
    const completeAssessment: DrillAssessment = {
      drillId: eventDisciplineEurGbpV1.id,
      definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
      rubricVersion: eventDisciplineEurGbpV1.rubricVersion,
      status: "completed",
      overallScore: 100,
      methodology: "Process-only integration fixture.",
      components: [
        {
          id: "plan_coverage",
          label: "Initial plan coverage",
          weight: 0.3,
          status: "assessed",
          score: 100,
          evidence: "Complete plan.",
        },
        {
          id: "checkpoint_coverage",
          label: "Checkpoint coverage",
          weight: 0.3,
          status: "assessed",
          score: 100,
          evidence: "All checkpoints answered.",
        },
        {
          id: "event_linkage",
          label: "Event linkage",
          weight: 0.2,
          status: "assessed",
          score: 100,
          evidence: "All visible events linked.",
        },
        {
          id: "rule_adherence",
          label: "Rule adherence",
          weight: 0.2,
          status: "assessed",
          score: 100,
          evidence: "No violations.",
        },
      ],
      eligibleCheckpointCount: 1,
      answeredCheckpointCount: 1,
      skippedCheckpointCount: 0,
      eligibleEventCount: 1,
      linkedEventCount: 1,
      violationCount: 0,
    };
    const ledgerEntry: PracticeLedgerEntry = {
      id: "compact-ledger-run",
      runId: "compact-ledger-run",
      runInstanceId: "compact-ledger-run",
      completedAt: "2026-07-14T12:00:00.000Z",
      scenarioId: "eurgbp-brexit-2016",
      scenarioTitle: "Brexit Referendum: EUR/GBP 2016",
      scenarioDataVersion: EURGBP_BREXIT_2016_DATA_VERSION,
      scenarioDataFidelity: "mixed",
      sampleData: false,
      mode: "explorer",
      brokerMode: "scenario",
      facts: {
        executionCount: 1,
        closedTradeCount: 1,
        journalEntryCount: 1,
        executedDecisionCount: 1,
        linkedDecisionCount: 1,
        behavioralFlagCount: 0,
        forcedLiquidationCount: 0,
      },
      assessment: completeAssessment,
    };
    persistPracticeLedger([ledgerEntry]);

    render(<App />);

    const evidenceClaim = screen
      .getByRole("heading", { name: eventDisciplineEurGbpV1.id })
      .closest("article");
    expect(evidenceClaim).not.toBeNull();
    expect(within(evidenceClaim!).getByText("100/100")).toBeInTheDocument();
    expect(within(evidenceClaim!).getByText("1 source-reviewed scenario")).toBeInTheDocument();

    const foundationTrack = screen
      .getByRole("heading", { name: "Decision Foundations" })
      .closest("article");
    expect(foundationTrack).not.toBeNull();
    expect(within(foundationTrack!).getByText("1/1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export practice archive" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear history" })).toBeInTheDocument();
    expect(screen.getByText("No full replay reports are stored.")).toBeInTheDocument();
  });

  it("keeps a fresh user in the library until a replay is deliberately started", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: "Enter the market before you know the ending.",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Portfolio")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Brexit Referendum: EUR/GBP 2016",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Start Explorer replay" }),
    );
    expect(useSessionStore.getState().scenario.meta.id).toBe(
      "eurgbp-brexit-2016",
    );
    expect(screen.getByText("0.77800")).toBeInTheDocument();
    expect(screen.getByText("Portfolio")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start replay" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Open scenario library" }),
    );
    expect(screen.getByRole("button", { name: "Back to lab" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to lab" }));
    expect(screen.getByText("Portfolio")).toBeInTheDocument();
  });

  it("offers an explicit Continue action for an active saved replay", () => {
    useSessionStore.setState({ status: "paused", currentIndex: 2 });
    render(<App />);

    expect(screen.getByText("Saved on this device")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue active replay" }),
    );

    expect(
      screen.getByText(/Step 3 of \d+ · future hidden/),
    ).toBeInTheDocument();
    expect(screen.getByText("Portfolio")).toBeInTheDocument();
  });

  it("protects active progress before a new briefing replaces it", () => {
    useSessionStore.setState({ status: "paused", currentIndex: 2 });
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", { name: "Choose Nasdaq 2022 Rate Shock" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start Explorer replay" }),
    );

    expect(
      screen.getByRole("alertdialog", {
        name: "Start Nasdaq 2022 Rate Shock?",
      }),
    ).toBeInTheDocument();
    expect(useSessionStore.getState().scenario.meta.id).toBe(
      "eurgbp-brexit-2016",
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep session" }));
    expect(useSessionStore.getState().scenario.meta.id).toBe(
      "eurgbp-brexit-2016",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Start Explorer replay" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start new replay" }),
    );
    expect(useSessionStore.getState().scenario.meta.id).toBe(
      "qqq-rate-hike-2022",
    );
    expect(useSessionStore.getState().mode).toBe("explorer");
  });

  it("rejects an oversized local scenario package before parsing it", async () => {
    render(<App />);
    const file = new File(["{}"], "oversized-scenario.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "size", { value: 25 * 1024 * 1024 + 1 });

    fireEvent.change(screen.getByLabelText("Import scenario package JSON"), {
      target: { files: [file] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "larger than the 25 MB local import limit",
    );
  });

  it("rejects oversized practice archives and session backups before reading them", async () => {
    render(<App />);
    const oversizedArchive = {
      name: "oversized-practice-archive.json",
      size: 25 * 1024 * 1024 + 1,
      text: vi.fn(),
    } as unknown as File;
    const oversizedSession = {
      name: "oversized-session.json",
      size: 25 * 1024 * 1024 + 1,
      text: vi.fn(),
    } as unknown as File;

    fireEvent.change(screen.getByLabelText("Import practice archive JSON"), {
      target: { files: [oversizedArchive] },
    });
    expect(
      await screen.findByText("Practice archive is larger than the 25 MB import limit."),
    ).toBeInTheDocument();
    expect(oversizedArchive.text).not.toHaveBeenCalled();

    fireEvent.change(
      screen.getByLabelText("Restore Market Time Machine session backup"),
      { target: { files: [oversizedSession] } },
    );
    expect(
      await screen.findByText("Session file is larger than the 25 MB restore limit."),
    ).toBeInTheDocument();
    expect(oversizedSession.text).not.toHaveBeenCalled();
  });

  it("imports a valid practice archive through the library as one operation", async () => {
    useSessionStore.getState().finish();
    const report = useSessionStore.getState().report!;
    const memory = new Map<string, string>();
    const isolatedStorage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    };
    const archived = recordCompletedRun(
      {
        report,
        runInstanceId: "archive-app-run",
        mode: "explorer",
        brokerMode: "scenario",
        completedAt: "2026-07-14T12:00:00.000Z",
      },
      isolatedStorage,
    ).run;
    const serialized = exportPracticeArchive(
      [archived],
      [derivePracticeLedgerEntry(archived)],
      "2026-07-14T12:30:00.000Z",
    );
    useSessionStore.getState().resetScenario();
    window.localStorage.clear();
    render(<App />);

    const file = {
      name: "practice-archive.json",
      size: serialized.length,
      text: vi.fn().mockResolvedValue(serialized),
    } as unknown as File;
    fireEvent.change(screen.getByLabelText("Import practice archive JSON"), {
      target: { files: [file] },
    });

    expect(
      await screen.findByText(
        "Imported 1 report and 1 compact evidence entry.",
      ),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("market-time-machine.run-history.v1"))
      .toContain("archive-app-run");
    expect(window.localStorage.getItem("market-time-machine.practice-ledger.v1"))
      .toContain("archive-app-run");
    expect(
      screen.getByRole("button", { name: "Export practice archive" }),
    ).toBeInTheDocument();
  });

  it("imports an authored drill, discovers it in the library, and starts it", async () => {
    const source = getScenario("qqq-rate-hike-2022")!;
    const authoredScenario = {
      ...source,
      meta: {
        ...source.meta,
        id: "app-authored-drill-scenario",
        title: "App Authored Drill Scenario",
      },
      drills: [
        {
          ...eventDisciplineQqqV1,
          id: "app-authored-event-discipline-v1",
          competencyId: "app-authored-event-discipline",
          title: "App Authored Event Discipline",
          scenarioId: "app-authored-drill-scenario",
        },
      ],
    };
    const serialized = JSON.stringify(authoredScenario);
    render(<App />);

    fireEvent.change(screen.getByLabelText("Import scenario package JSON"), {
      target: {
        files: [
          {
            name: "authored-scenario.json",
            size: serialized.length,
            text: vi.fn().mockResolvedValue(serialized),
          } as unknown as File,
        ],
      },
    });

    await screen.findByRole("button", {
      name: "Choose App Authored Drill Scenario",
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Choose App Authored Drill Scenario",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /App Authored Event Discipline/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start guided drill" }));

    expect(useSessionStore.getState()).toMatchObject({
      activeDrillId: "app-authored-event-discipline-v1",
      scenario: { meta: { id: "app-authored-drill-scenario" } },
    });
    expect(screen.getByText("Active drill")).toBeInTheDocument();
    expect(screen.getByText("App Authored Event Discipline")).toBeInTheDocument();
    useSessionStore.getState().selectScenario("eurgbp-brexit-2016");
    removeUserScenario("app-authored-drill-scenario");
  });

  it("explains malformed and incomplete scenario packages", async () => {
    render(<App />);
    const input = screen.getByLabelText("Import scenario package JSON");
    const malformed = {
      name: "malformed.json",
      size: 12,
      text: vi.fn().mockResolvedValue("{broken"),
    } as unknown as File;

    fireEvent.change(input, { target: { files: [malformed] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Scenario package is not valid JSON",
    );

    const incomplete = {
      name: "incomplete.json",
      size: 2,
      text: vi.fn().mockResolvedValue("{}"),
    } as unknown as File;
    fireEvent.change(input, { target: { files: [incomplete] } });
    expect(
      await screen.findByText(
        /not a complete Market Time Machine scenario package/,
      ),
    ).toHaveAttribute(
      "role",
      "alert",
    );
  });

  it("exports or safely clears completed-run history from the library", async () => {
    useSessionStore.getState().finish();
    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Export practice archive" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Clear completed replay history?",
    });
    expect(dialog).toHaveTextContent("Export first if you want a copy");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear history" }));

    expect(
      screen.getByRole("button", { name: "Review first practice" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Export practice archive" }),
    ).not.toBeInTheDocument();
    expect(
      window.localStorage.getItem("market-time-machine.run-history.v1"),
    ).toBeNull();
  });

  it("keeps next-practice coaching tied to the latest report", async () => {
    useSessionStore.getState().finish();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "View report" }));

    expect(
      screen.getByRole("dialog", {
        name: "Brexit Referendum: EUR/GBP 2016",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Choose next practice" }),
    ).not.toBeInTheDocument();
  });

  it("removes an imported lab after explicit confirmation", () => {
    const source = getScenario("qqq-rate-hike-2022")!;
    const imported = {
      ...source,
      meta: {
        ...source.meta,
        id: "app-test-imported-lab",
        title: "App Test Imported Lab",
      },
    };
    expect(registerUserScenario(imported).ok).toBe(true);
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove imported scenario App Test Imported Lab",
      }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Remove App Test Imported Lab?",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove imported lab" }),
    );

    expect(isUserScenario(imported.meta.id)).toBe(false);
    expect(screen.queryByText("App Test Imported Lab")).not.toBeInTheDocument();
    removeUserScenario(imported.meta.id);
  });
});
