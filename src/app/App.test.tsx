import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DrillAssessment,
  Fill,
  Order,
  ScenarioPackage,
} from "../types";
import {
  SESSION_STORAGE_KEY,
  loadInitialSessionState,
  useSessionStore,
  type SessionState,
} from "../store/sessionStore";
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
  PRACTICE_LEDGER_FORMAT,
  PRACTICE_LEDGER_VERSION,
  persistPracticeLedger,
  recordPracticeLedgerEntry,
  type PracticeLedgerEntry,
} from "../domain/history/practiceLedger";
import {
  exportPracticeArchive,
  parsePracticeArchive,
} from "../domain/history/practiceArchive";
import { recordCompletedRun } from "../domain/history/runHistory";
import { PRACTICE_ARCHIVE_STORAGE_KEY } from "../domain/history/practiceArchiveEnvelope";
import {
  loadStoredPracticeArchiveData,
  persistPracticeArchiveAtomically,
} from "../domain/history/practiceArchiveStorage";
import {
  previousComparablePracticeScore,
} from "../domain/practice/evidenceProfile";
import {
  buildDrillCheckpointSchedule,
  drillCheckpointScheduleFingerprint,
  drillRubricFingerprint,
} from "../domain/practice/drills";
import {
  brokerConfigFingerprint,
  getBrokerPreset,
} from "../domain/broker/executionModels";
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

function comparableAssessment(
  score: number,
  violationPenalty: number,
): DrillAssessment {
  const scenario = getScenario(eventDisciplineEurGbpV1.scenarioId)!;
  const schedule = buildDrillCheckpointSchedule(
    eventDisciplineEurGbpV1,
    scenario,
  );
  const eligibleEventCount = new Set(
    schedule.flatMap((checkpoint) => checkpoint.eventIds),
  ).size;
  const weights = {
    plan_coverage: 0.3,
    checkpoint_coverage: 0.3,
    event_linkage: 0.2,
    rule_adherence: 0.2,
  } as const;
  const roundedScore = (value: number) =>
    Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
  let matchingEvidence:
    | {
        linkedEventCount: number;
        violationCount: number;
        eventScore: number;
        ruleScore: number;
      }
    | undefined;
  const maximumViolationCount =
    violationPenalty > 0 ? Math.ceil(100 / violationPenalty) : 0;
  for (
    let linkedEventCount = 0;
    linkedEventCount <= eligibleEventCount && !matchingEvidence;
    linkedEventCount += 1
  ) {
    for (
      let violationCount = 0;
      violationCount <= maximumViolationCount;
      violationCount += 1
    ) {
      const eventScore = roundedScore(
        (linkedEventCount / eligibleEventCount) * 100,
      );
      const ruleScore = roundedScore(
        100 - violationCount * violationPenalty,
      );
      const overallScore = roundedScore(
        100 * weights.plan_coverage +
          100 * weights.checkpoint_coverage +
          eventScore * weights.event_linkage +
          ruleScore * weights.rule_adherence,
      );
      if (overallScore === score) {
        matchingEvidence = {
          linkedEventCount,
          violationCount,
          eventScore,
          ruleScore,
        };
        break;
      }
    }
  }
  if (!matchingEvidence) {
    throw new Error(`No aggregate evidence produces fixture score ${score}.`);
  }
  const componentScores: Record<
    DrillAssessment["components"][number]["id"],
    number
  > = {
    plan_coverage: 100,
    checkpoint_coverage: 100,
    event_linkage: matchingEvidence.eventScore,
    rule_adherence: matchingEvidence.ruleScore,
  };
  return {
    drillId: eventDisciplineEurGbpV1.id,
    competencyId: eventDisciplineEurGbpV1.competencyId,
    definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
    rubricVersion: eventDisciplineEurGbpV1.rubricVersion,
    rubricFingerprint: drillRubricFingerprint({
      weights,
      violationPenalty,
    }),
    checkpointScheduleFingerprint:
      drillCheckpointScheduleFingerprint(schedule),
    eventLinkageEvidenceVersion: 1,
    status: "completed",
    overallScore: score,
    methodology: "Comparable process-only fixture.",
    components: Object.entries(weights).map(([id, weight]) => {
      const componentId = id as DrillAssessment["components"][number]["id"];
      return {
        id: componentId,
        label: id,
        weight,
        status: "assessed" as const,
        score: componentScores[componentId],
        evidence: "Comparable fixture evidence.",
      };
    }),
    eligibleCheckpointCount: schedule.length,
    answeredCheckpointCount: schedule.length,
    skippedCheckpointCount: 0,
    eligibleEventCount,
    linkedEventCount: matchingEvidence.linkedEventCount,
    violationCount: matchingEvidence.violationCount,
  };
}

function archiveCurrentReport(runInstanceId: string) {
  useSessionStore.getState().finish();
  const report = useSessionStore.getState().report!;
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  };
  return recordCompletedRun(
    {
      report,
      runInstanceId,
      mode: "explorer",
      brokerMode: "scenario",
      brokerFingerprint: brokerConfigFingerprint(useSessionStore.getState().broker),
      completedAt: "2026-07-14T12:00:00.000Z",
    },
    storage,
  ).run;
}

function persistIdealArchivedRun(runInstanceId: string) {
  const scenario = getScenario("eurgbp-brexit-2016")!;
  useSessionStore.getState().selectScenario(scenario.meta.id);
  const broker = {
    ...getBrokerPreset("ideal"),
    baseCurrency: scenario.meta.baseCurrency,
  };
  const brokerFingerprint = brokerConfigFingerprint(broker);
  expect(
    useSessionStore.getState().startReplay(scenario.meta.id, "explorer", {
      scenarioDataVersion: scenario.meta.dataVersion ?? null,
      brokerMode: "ideal",
      brokerFingerprint,
    }),
  ).toEqual({ ok: true });
  useSessionStore.getState().finish();
  const report = useSessionStore.getState().report!;
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  };
  const run = recordCompletedRun(
    {
      report,
      runInstanceId,
      mode: "explorer",
      brokerMode: "ideal",
      brokerFingerprint,
      completedAt: "2026-07-15T12:00:00.000Z",
    },
    storage,
  ).run;
  persistPracticeArchiveAtomically({
    runs: [run],
    ledger: [derivePracticeLedgerEntry(run)],
  });
  useSessionStore.getState().selectScenario(scenario.meta.id);
  return { run, brokerFingerprint };
}

function persistPracticeArchivedRun(runInstanceId: string) {
  const scenario = getScenario(eventDisciplineEurGbpV1.scenarioId)!;
  useSessionStore.getState().selectScenario(scenario.meta.id);
  expect(
    useSessionStore
      .getState()
      .startPractice(scenario.meta.id, eventDisciplineEurGbpV1.id),
  ).toEqual({ ok: true });
  const started = useSessionStore.getState();
  expect(
    started.submitMarketOrder({
      symbol: started.primarySymbol,
      side: "buy",
      type: "market",
      quantity: 100,
      decisionPlan: {
        thesis: "Visible policy uncertainty may move the currency cross.",
        invalidation: "Published policy contradicts the thesis.",
        exitPlan: "Exit at a checkpoint if the thesis is invalidated.",
        acceptedRisk: "No more than one percent of equity.",
      },
    }).ok,
  ).toBe(true);
  let guard = 0;
  while (useSessionStore.getState().status !== "finished" && guard < 500) {
    const current = useSessionStore.getState();
    if (current.pendingDrillCheckpoint) {
      expect(
        current.submitDrillCheckpoint(
          "wait",
          "I will wait for the next visible confirmation.",
          [...current.pendingDrillCheckpoint.eventIds],
        ).ok,
      ).toBe(true);
    } else {
      current.play();
      useSessionStore.getState().stepForward();
    }
    guard += 1;
  }
  expect(guard).toBeLessThan(500);
  const state = useSessionStore.getState();
  expect(state.report?.practiceDrill?.definition.id).toBe(
    eventDisciplineEurGbpV1.id,
  );
  expect(
    state.report?.practiceAssessment?.checkpointScheduleFingerprint,
  ).toBeTruthy();
  const memory = new Map<string, string>();
  const run = recordCompletedRun(
    {
      report: state.report!,
      runInstanceId,
      mode: "explorer",
      brokerMode: state.brokerMode,
      brokerFingerprint: brokerConfigFingerprint(state.broker),
      completedAt: "2026-07-15T13:00:00.000Z",
    },
    {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  ).run;
  persistPracticeArchiveAtomically({
    runs: [run],
    ledger: [derivePracticeLedgerEntry(run)],
  });
  useSessionStore.getState().selectScenario(scenario.meta.id);
  return run;
}

function legacyPracticeLedger(entries: readonly PracticeLedgerEntry[]) {
  return JSON.stringify({
    format: PRACTICE_LEDGER_FORMAT,
    version: PRACTICE_LEDGER_VERSION,
    entries,
  });
}

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Unable to read blob fixture.")),
    );
    reader.readAsText(blob);
  });
}

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
    vi.restoreAllMocks();
    useSessionStore.getState().selectScenario("eurgbp-brexit-2016");
  });

  it("masks scenario and primary-asset identity until the challenge finishes", () => {
    render(<App />);

    expect(screen.getByText("Local challenge")).toBeInTheDocument();
    expect(screen.getByText("Asset label hidden until completion")).toBeInTheDocument();
    expect(
      screen.getByText(/Local self-test; bundled future data is not technically protected/),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Local anti-cheat mode");
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
    vi.restoreAllMocks();
    useSessionStore.getState().resetScenario();
    useSessionStore.setState({ persistenceHealth: undefined });
    removeUserScenario("app-authored-primary-symbol-scenario");
    removeUserScenario("imported-surprise-identity-leak");
    window.localStorage.clear();
  });

  it("builds the local evidence dashboard and only prepares a track briefing", () => {
    const unit = decisionFoundationsTrack.units[0];
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
        name: `Prepare ${unit.title}`,
      }),
    );

    expect(useSessionStore.getState().activeDrillId).toBeUndefined();
    expect(document.getElementById("briefing-title")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Start guided drill" }));
    expect(useSessionStore.getState().activeDrillId).toBe(
      eventDisciplineEurGbpV1.id,
    );
    expect(useSessionStore.getState().brokerMode).toBe(unit.broker.mode);
    expect(
      brokerConfigFingerprint(useSessionStore.getState().broker),
    ).toBe(unit.broker.fingerprint);
    expect(screen.getByText("Active drill")).toBeInTheDocument();
    raf.mockRestore();
  });

  it("starts a coach repeat with the measured data and broker context intact", () => {
    const scenario = getScenario("eurgbp-brexit-2016")!;
    const ledgerEntry: PracticeLedgerEntry = {
      id: "coach-exact-context-run",
      runId: "coach-exact-context-run",
      runInstanceId: "coach-exact-context-run",
      completedAt: "2026-07-15T12:00:00.000Z",
      scenarioId: scenario.meta.id,
      scenarioTitle: scenario.meta.title,
      scenarioDataVersion: scenario.meta.dataVersion,
      scenarioDataFidelity: "mixed",
      sampleData: scenario.meta.isSampleData ?? true,
      mode: "explorer",
      brokerMode: "ideal",
      brokerFingerprint: brokerConfigFingerprint({
        ...getBrokerPreset("ideal"),
        baseCurrency: scenario.meta.baseCurrency,
      }),
      facts: {
        executionCount: 1,
        closedTradeCount: 1,
        journalEntryCount: 1,
        executedDecisionCount: 1,
        linkedDecisionCount: 1,
        behavioralFlagCount: 0,
        forcedLiquidationCount: 0,
      },
      assessment: comparableAssessment(90, 20),
    };
    persistPracticeArchiveAtomically({ runs: [], ledger: [ledgerEntry] });
    useSessionStore.setState({ status: "paused", currentIndex: 1 });
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "Review measured practice" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start guided drill" }));
    const confirmation = screen.getByRole("alertdialog", {
      name: `Start ${scenario.meta.title}?`,
    });
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Start new replay" }),
    );

    expect(useSessionStore.getState()).toMatchObject({
      scenario: { meta: { id: scenario.meta.id } },
      activeDrillId: eventDisciplineEurGbpV1.id,
      brokerMode: "ideal",
      activeDrillIdentity: {
        scenarioDataVersion: scenario.meta.dataVersion,
      },
      broker: {
        commissionRateBps: 0,
        spreadBps: 0,
        slippageModel: "none",
      },
    });
    raf.mockRestore();
  });

  it("compares process scores only within the full rubric-content identity", () => {
    useSessionStore.getState().finish();
    const baseReport = useSessionStore.getState().report!;
    const dataVersion = baseReport.provenance?.dataVersion;
    expect(dataVersion).toBeTruthy();
    if (!dataVersion) return;
    const currentAssessment = comparableAssessment(80, 20);
    const report = {
      ...baseReport,
      practiceAssessment: currentAssessment,
    };
    const entry = (
      id: string,
      completedAt: string,
      assessment: DrillAssessment,
    ): PracticeLedgerEntry => ({
      id,
      runId: id,
      runInstanceId: id,
      completedAt,
      scenarioId: report.scenarioId,
      scenarioTitle: report.scenarioTitle,
      scenarioDataVersion: dataVersion,
      scenarioDataFidelity: report.provenance?.dataFidelity ?? "mixed",
      sampleData: report.provenance?.isSampleData ?? false,
      mode: "explorer",
      brokerMode: "scenario",
      brokerFingerprint: brokerConfigFingerprint(
        getScenario(report.scenarioId)!.broker,
      ),
      facts: {
        executionCount: 1,
        closedTradeCount: 1,
        journalEntryCount: 0,
        executedDecisionCount: 1,
        linkedDecisionCount: 1,
        behavioralFlagCount: 0,
        forcedLiquidationCount: 0,
      },
      assessment,
    });
    const current = entry(
      "current-rubric-run",
      "2026-07-16T12:00:00.000Z",
      currentAssessment,
    );
    const differentContent = entry(
      "different-rubric-run",
      "2026-07-15T12:00:00.000Z",
      comparableAssessment(98, 10),
    );
    const comparable = entry(
      "comparable-rubric-run",
      "2026-07-14T12:00:00.000Z",
      comparableAssessment(70, 20),
    );

    expect(
      previousComparablePracticeScore(
        current.id,
        report,
        "explorer",
        "scenario",
        current.brokerFingerprint,
        [current, differentContent, comparable],
      ),
    ).toBe(70);
    expect(
      previousComparablePracticeScore(
        current.id,
        report,
        "explorer",
        "scenario",
        current.brokerFingerprint,
        [current, differentContent],
      ),
    ).toBeUndefined();
  });

  it("derives evidence claims, track credit, and archive actions from compact ledger data", () => {
    const scenario = getScenario(eventDisciplineEurGbpV1.scenarioId)!;
    const schedule = buildDrillCheckpointSchedule(
      eventDisciplineEurGbpV1,
      scenario,
    );
    const eligibleEventCount = new Set(
      schedule.flatMap((checkpoint) => checkpoint.eventIds),
    ).size;
    const completeAssessment: DrillAssessment = {
      drillId: eventDisciplineEurGbpV1.id,
      definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
      rubricVersion: eventDisciplineEurGbpV1.rubricVersion,
      rubricFingerprint: drillRubricFingerprint(
        eventDisciplineEurGbpV1.rubric,
      ),
      checkpointScheduleFingerprint:
        drillCheckpointScheduleFingerprint(schedule),
      eventLinkageEvidenceVersion: 1,
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
      eligibleCheckpointCount: schedule.length,
      answeredCheckpointCount: schedule.length,
      skippedCheckpointCount: 0,
      eligibleEventCount,
      linkedEventCount: eligibleEventCount,
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
      brokerFingerprint: decisionFoundationsTrack.units[0].broker.fingerprint,
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

  it("preserves unsent trade and journal drafts while visiting the library", () => {
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "Start Explorer replay" }),
    );
    fireEvent.change(screen.getByLabelText("Decision thesis"), {
      target: { value: "Wait for confirmation." },
    });
    fireEvent.change(screen.getByLabelText("Observation or decision note"), {
      target: { value: "Watch the next event." },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Open scenario library" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to lab" }));

    expect(screen.getByLabelText("Decision thesis")).toHaveValue(
      "Wait for confirmation.",
    );
    expect(screen.getByLabelText("Observation or decision note")).toHaveValue(
      "Watch the next event.",
    );
  });

  it("offers an explicit Continue action for an active saved replay", () => {
    useSessionStore.setState({ status: "paused", currentIndex: 2 });
    render(<App />);

    expect(screen.getByText("Active in this browser")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue active replay" }),
    );

    expect(
      screen.getByText(/Step 3 of \d+ · future hidden/),
    ).toBeInTheDocument();
    expect(screen.getByText("Portfolio")).toBeInTheDocument();
  });

  it("does not claim a browser save was cleared when storage rejects deletion", () => {
    render(<App />);
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
    const originalRemoveItem = window.localStorage.removeItem.bind(
      window.localStorage,
    );
    const removeItem = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(function (key: string) {
        if (key === SESSION_STORAGE_KEY) throw new Error("storage denied");
        originalRemoveItem(key);
      });

    try {
      fireEvent.click(
        screen.getByRole("button", { name: "Clear browser save" }),
      );
      expect(
        screen.getByText(/browser save could not be cleared: storage denied/i),
      ).toHaveTextContent(
        /browser save could not be cleared: storage denied/i,
      );
      expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
      expect(useSessionStore.getState().persistenceHealth).toMatchObject({
        kind: "error",
        operation: "delete",
      });
    } finally {
      removeItem.mockRestore();
    }
  });

  it.each(["unreadable", "invalid"] as const)(
    "shows %s startup save health in the initial library",
    (failureKind) => {
      const invalidStartup: SessionState = loadInitialSessionState(
        failureKind === "unreadable"
          ? {
              getItem: () => {
                throw new Error("privacy denied");
              },
            }
          : {
              getItem: (key: string) =>
                key === SESSION_STORAGE_KEY ? "{damaged session" : null,
            },
      );
      useSessionStore.setState({
        persistenceHealth: invalidStartup.persistenceHealth,
      });

      render(<App />);

      if (failureKind === "unreadable") {
        expect(
          screen.getByText(/browser save health:.*could not be read/i),
        ).toBeInTheDocument();
        expect(document.body).toHaveTextContent(
          /export the active session or restore a backup/i,
        );
      } else {
        expect(
          screen.getByText(
            /browser save recovery needed:.*could not be restored/i,
          ),
        ).toBeInTheDocument();
        expect(document.body).toHaveTextContent(
          /restore a known-good backup or clear the damaged browser save/i,
        );
      }
    },
  );

  it("shows browser write failure and subsequent recovery in the library", () => {
    render(<App />);
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    );
    let storageUnavailable = true;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (key: string, value: string) {
        if (key === SESSION_STORAGE_KEY && storageUnavailable) {
          throw new Error("quota denied");
        }
        originalSetItem(key, value);
      });

    try {
      act(() => {
        useSessionStore.getState().addJournalNote("Unsaved while quota failed.");
      });
      expect(
        screen.getByText(/changes are not being saved \(quota denied\)/i),
      ).toBeInTheDocument();
      expect(document.body).toHaveTextContent(
        /keep this tab open and export the active session/i,
      );

      storageUnavailable = false;
      act(() => {
        useSessionStore.getState().addJournalNote("Saved after recovery.");
      });
      expect(
        screen.getByText(/browser save health recovered/i),
      ).toBeInTheDocument();
    } finally {
      setItem.mockRestore();
    }
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

  it.each([
    "initial drill plan",
    "checkpoint response",
    "drill rule violation",
  ] as const)(
    "protects index-zero %s before another replay replaces it",
    (progressKind) => {
      if (progressKind === "initial drill plan") {
        useSessionStore.setState({
          initialDrillPlan: {
            thesis: "Index-zero thesis.",
            invalidation: "Invalidate on contrary evidence.",
            exitPlan: "Exit at the next checkpoint.",
            acceptedRisk: "Risk no more than one percent.",
          },
        });
      } else if (progressKind === "checkpoint response") {
        useSessionStore.setState({
          drillCheckpointResponses: [
            {
              id: "index-zero-response",
              drillId: eventDisciplineEurGbpV1.id,
              definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
              checkpointId: "index-zero-checkpoint",
              replayTime: "2016-06-20T00:00:00.000Z",
              eventIds: ["index-zero-event"],
              linkedEventIds: ["index-zero-event"],
              status: "answered",
              action: "wait",
              reflection: "Wait for visible confirmation.",
            },
          ],
        });
      } else {
        useSessionStore.setState({
          drillRuleViolations: [
            {
              id: "index-zero-violation",
              drillId: eventDisciplineEurGbpV1.id,
              definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
              code: "order_before_plan",
              replayTime: "2016-06-20T00:00:00.000Z",
              evidence: "An authored rule was triggered at index zero.",
            },
          ],
        });
      }
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
    },
  );

  it("requires confirmation before a session backup replaces active progress", async () => {
    useSessionStore.getState().addJournalNote("Backup decision note.");
    const serialized = useSessionStore.getState().exportSession();
    useSessionStore.getState().resetScenario();
    useSessionStore.getState().addJournalNote("Active decision note.");
    render(<App />);

    const restore = async () => {
      const file = {
        name: "decision-session.json",
        size: serialized.length,
        text: vi.fn().mockResolvedValue(serialized),
      } as unknown as File;
      fireEvent.change(
        screen.getByLabelText("Restore Market Time Machine session backup"),
        { target: { files: [file] } },
      );
      return screen.findByRole("alertdialog", {
        name: "Restore this session backup?",
      });
    };

    let dialog = await restore();
    expect(dialog).toHaveTextContent(/orders, fills, journal, and unsaved progress/i);
    expect(useSessionStore.getState().journal[0]?.note).toBe(
      "Active decision note.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep session" }));
    expect(useSessionStore.getState().journal[0]?.note).toBe(
      "Active decision note.",
    );

    dialog = await restore();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Restore session" }),
    );
    await waitFor(() =>
      expect(useSessionStore.getState().journal[0]?.note).toBe(
        "Backup decision note.",
      ),
    );
    expect(screen.getByText("Saved session restored.")).toBeInTheDocument();
  });

  it("rechecks current progress after a slow session file finishes reading", async () => {
    const serialized = useSessionStore.getState().exportSession();
    let resolveText!: (value: string) => void;
    const file = {
      name: "slow-session.json",
      size: serialized.length,
      text: vi.fn().mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            resolveText = resolve;
          }),
      ),
    } as unknown as File;
    render(<App />);

    fireEvent.change(
      screen.getByLabelText("Restore Market Time Machine session backup"),
      { target: { files: [file] } },
    );
    act(() => {
      useSessionStore.getState().addJournalNote("Created while backup was reading.");
      resolveText(serialized);
    });

    const dialog = await screen.findByRole("alertdialog", {
      name: "Restore this session backup?",
    });
    expect(dialog).toHaveTextContent(/unsaved progress/i);
    expect(useSessionStore.getState().journal[0]?.note).toBe(
      "Created while backup was reading.",
    );
  });

  it("keeps a surprise self-test identity out of the replacement confirmation and replay UI", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    useSessionStore.setState({ status: "paused", currentIndex: 2 });
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Start surprise Local challenge",
      }),
    );

    const confirmation = screen.getByRole("alertdialog", {
      name: "Start surprise Local challenge?",
    });
    expect(confirmation).not.toHaveTextContent(
      useSessionStore.getState().scenario.meta.title,
    );
    expect(useSessionStore.getState().currentIndex).toBe(2);

    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Start new replay" }),
    );
    const selectedTitle = useSessionStore.getState().scenario.meta.title;
    expect(useSessionStore.getState()).toMatchObject({
      mode: "challenge",
      status: "idle",
      currentIndex: 0,
    });
    expect(screen.getByText("Local challenge")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(selectedTitle);
  });

  it("never admits unreviewed imported packages into surprise selection", () => {
    const source = getScenario("btc-2020-2021")!;
    const imported: ScenarioPackage = {
      ...source,
      meta: {
        ...source.meta,
        id: "imported-surprise-identity-leak",
        title: "Imported identity leak fixture",
        dataVersion: "imported-surprise-identity-leak-v1",
        supportedModes: ["challenge"],
      },
      drills: undefined,
    };
    expect(registerUserScenario(imported)).toMatchObject({ ok: true });
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Start surprise Local challenge",
      }),
    );

    expect(useSessionStore.getState().scenario.meta.id).not.toBe(
      imported.meta.id,
    );
    expect(document.body).not.toHaveTextContent(imported.meta.title);
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
        brokerFingerprint: brokerConfigFingerprint(
          useSessionStore.getState().broker,
        ),
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
    expect(window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toContain(
      "archive-app-run",
    );
    expect(window.localStorage.getItem("market-time-machine.run-history.v1"))
      .toBeNull();
    expect(window.localStorage.getItem("market-time-machine.practice-ledger.v1"))
      .toBeNull();
    expect(
      screen.getByRole("button", { name: "Export practice archive" }),
    ).toBeInTheDocument();
  });

  it("fails closed on malformed canonical history instead of reviving stale legacy data", async () => {
    const legacyRun = archiveCurrentReport("stale-legacy-app-run");
    const legacyLedger = derivePracticeLedgerEntry(legacyRun);
    useSessionStore.getState().resetScenario();
    window.localStorage.clear();
    window.localStorage.setItem(
      PRACTICE_ARCHIVE_STORAGE_KEY,
      "{damaged-canonical-json",
    );
    window.localStorage.setItem(
      "market-time-machine.run-history.v1",
      JSON.stringify([legacyRun]),
    );
    window.localStorage.setItem(
      "market-time-machine.practice-ledger.v1",
      legacyPracticeLedger([legacyLedger]),
    );

    render(<App />);

    expect(
      screen.queryByRole("button", { name: "Export practice archive" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^View report for / }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /local practice history needs recovery/i,
    );
    expect(
      screen.getByRole("button", { name: "Download damaged data" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove damaged history" }),
    );
    const recoveryDialog = screen.getByRole("alertdialog", {
      name: "Remove damaged local history?",
    });
    fireEvent.click(
      within(recoveryDialog).getByRole("button", {
        name: "Remove damaged history",
      }),
    );
    expect(
      await screen.findByText(
        /new replays and archive imports can now be saved/i,
      ),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBeNull();
    expect(
      window.localStorage.getItem("market-time-machine.run-history.v1"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("market-time-machine.practice-ledger.v1"),
    ).toBeNull();
  });

  it("refuses to import over a damaged canonical archive", async () => {
    const archived = archiveCurrentReport("must-not-overwrite-damage");
    const serialized = exportPracticeArchive(
      [archived],
      [derivePracticeLedgerEntry(archived)],
      "2026-07-16T00:00:00.000Z",
    );
    const damagedCanonical = "{damaged-canonical-json";
    useSessionStore.getState().resetScenario();
    window.localStorage.clear();
    window.localStorage.setItem(
      PRACTICE_ARCHIVE_STORAGE_KEY,
      damagedCanonical,
    );
    render(<App />);

    const file = {
      name: "valid-practice-archive.json",
      size: serialized.length,
      text: vi.fn().mockResolvedValue(serialized),
    } as unknown as File;
    fireEvent.change(screen.getByLabelText("Import practice archive JSON"), {
      target: { files: [file] },
    });

    expect(
      await screen.findByText(
        "The stored practice archive is damaged and was left unchanged.",
      ),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
      damagedCanonical,
    );
  });

  it("initializes both archive layers from one legacy snapshot and migrates it", async () => {
    const legacyRun = archiveCurrentReport("legacy-app-migration");
    const legacyLedger = derivePracticeLedgerEntry(legacyRun);
    useSessionStore.getState().resetScenario();
    window.localStorage.clear();
    window.localStorage.setItem(
      "market-time-machine.run-history.v1",
      JSON.stringify([legacyRun]),
    );
    window.localStorage.setItem(
      "market-time-machine.practice-ledger.v1",
      legacyPracticeLedger([legacyLedger]),
    );

    render(<App />);

    expect(
      screen.getByRole("button", { name: "Export practice archive" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^View report for / }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY),
      ).toContain("legacy-app-migration");
      expect(
        window.localStorage.getItem("market-time-machine.run-history.v1"),
      ).toBeNull();
      expect(
        window.localStorage.getItem("market-time-machine.practice-ledger.v1"),
      ).toBeNull();
    });
  });

  it("keeps stored and visible history unchanged when completed-run archiving is rejected", async () => {
    const existingRun = archiveCurrentReport("existing-app-run");
    const existingLedger = derivePracticeLedgerEntry(existingRun);
    persistPracticeArchiveAtomically({
      runs: [existingRun],
      ledger: [existingLedger],
    });
    useSessionStore.getState().resetScenario();
    useSessionStore.getState().finish();
    const rejectedRunId = useSessionStore.getState().runInstanceId;
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    );
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (key: string, value: string) {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY) {
          throw new Error("quota");
        }
        originalSetItem(key, value);
      });

    try {
      render(<App />);
      expect(
        await screen.findByText(
          "Completed replay could not be saved. Existing practice history was kept.",
        ),
      ).toBeInTheDocument();
    } finally {
      setItem.mockRestore();
    }

    expect(
      screen.getAllByRole("button", { name: /^View report for / }),
    ).toHaveLength(1);
    const stored = loadStoredPracticeArchiveData();
    expect(stored.runs.map((run) => run.id)).toEqual(["existing-app-run"]);
    expect(stored.ledger.map((entry) => entry.id)).toEqual([
      "existing-app-run",
    ]);
    expect(window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).not.toContain(
      rejectedRunId,
    );
  });

  it("downloads an importable recovery archive after a failed save", async () => {
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "Start Explorer replay" }),
    );
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    );
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (key: string, value: string) {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY) {
          throw new Error("quota");
        }
        originalSetItem(key, value);
      });

    let recoveryBlob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
      recoveryBlob = value as Blob;
      return "blob:practice-recovery";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );

    let reportDialog: HTMLElement;
    try {
      act(() => useSessionStore.getState().finish());
      reportDialog = await screen.findByRole("dialog", {
        name: "Brexit Referendum: EUR/GBP 2016",
      });
      expect(within(reportDialog).getByRole("alert")).toHaveTextContent(
        /completed replay was not saved to local history/i,
      );
      expect(within(reportDialog).getByRole("alert")).toHaveTextContent(
        /download an importable recovery archive/i,
      );
      fireEvent.click(
        within(reportDialog).getByRole("button", {
          name: "Download recovery archive",
        }),
      );
      expect(recoveryBlob).toBeDefined();
      const recovered = parsePracticeArchive(
        await readBlobAsText(recoveryBlob!),
      );
      expect(recovered.runs).toHaveLength(1);
      expect(recovered.ledger).toHaveLength(1);
      expect(recovered.runs[0].id).toBe(useSessionStore.getState().runInstanceId);
    } finally {
      setItem.mockRestore();
    }

    expect(
      within(reportDialog!).queryByRole("button", { name: "Retry saving" }),
    ).not.toBeInTheDocument();
    expect(within(reportDialog!).queryByRole("alert")).not.toBeInTheDocument();
    expect(
      within(reportDialog!).getByRole("button", { name: "Replay scenario" }),
    ).toBeEnabled();
    expect(loadStoredPracticeArchiveData().runs).toHaveLength(0);
  });

  it("retries a completed-report save after browser storage recovers", async () => {
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "Start Explorer replay" }),
    );
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    );
    let storageUnavailable = true;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (key: string, value: string) {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY && storageUnavailable) {
          throw new Error("quota");
        }
        originalSetItem(key, value);
      });

    try {
      act(() => useSessionStore.getState().finish());
      const reportDialog = await screen.findByRole("dialog", {
        name: "Brexit Referendum: EUR/GBP 2016",
      });
      expect(within(reportDialog).getByRole("alert")).toBeInTheDocument();

      storageUnavailable = false;
      fireEvent.click(
        within(reportDialog).getByRole("button", { name: "Retry saving" }),
      );
      await waitFor(() =>
        expect(within(reportDialog).queryByRole("alert")).not.toBeInTheDocument(),
      );
      expect(loadStoredPracticeArchiveData().runs).toHaveLength(1);
    } finally {
      setItem.mockRestore();
    }
  });

  it.each(["history action", "report action"])(
    "replays a modern archived run with its exact broker via the %s",
    async (entryPoint) => {
      const { brokerFingerprint } = persistIdealArchivedRun(
        `exact-history-${entryPoint}`,
      );
      render(<App />);

      if (entryPoint === "report action") {
        fireEvent.click(
          await screen.findByRole("button", { name: /^View report for / }),
        );
        fireEvent.click(
          screen.getByRole("button", { name: "Replay scenario" }),
        );
      } else {
        fireEvent.click(
          await screen.findByRole("button", { name: /^Replay / }),
        );
      }

      expect(useSessionStore.getState()).toMatchObject({
        mode: "explorer",
        brokerMode: "ideal",
      });
      expect(
        brokerConfigFingerprint(useSessionStore.getState().broker),
      ).toBe(brokerFingerprint);
    },
  );

  it("replays a modern archived practice with its retained exact drill identity", async () => {
    const run = persistPracticeArchivedRun("exact-practice-history");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /^Replay / }));

    expect(useSessionStore.getState()).toMatchObject({
      activeDrillId: eventDisciplineEurGbpV1.id,
      activeDrillIdentity: {
        scenarioDataVersion: run.report.provenance?.dataVersion,
        drillId: run.report.practiceDrill?.definition.id,
        competencyId: run.report.practiceDrill?.definition.competencyId,
        definitionVersion:
          run.report.practiceDrill?.definition.definitionVersion,
        rubricVersion: run.report.practiceDrill?.definition.rubricVersion,
      },
    });
  });

  it("falls back to a clearly labeled unassessed replay when an archived drill has drifted", async () => {
    const run = persistPracticeArchivedRun("drifted-practice-history");
    const clonedRun = structuredClone(run);
    if (!clonedRun.report.practiceDrill) {
      throw new Error("Practice fixture did not retain its drill definition.");
    }
    const driftedRun = {
      ...clonedRun,
      report: {
        ...clonedRun.report,
        practiceDrill: {
          ...clonedRun.report.practiceDrill,
          definition: {
            ...clonedRun.report.practiceDrill.definition,
            description:
              "An archived same-version definition that no longer matches the app.",
          },
        },
      },
    };
    persistPracticeArchiveAtomically({
      runs: [driftedRun],
      ledger: [derivePracticeLedgerEntry(driftedRun)],
    });
    useSessionStore.getState().selectScenario(run.scenarioId);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /^Replay / }));

    expect(useSessionStore.getState().activeDrillId).toBeUndefined();
    expect(useSessionStore.getState()).toMatchObject({
      scenario: { meta: { id: run.scenarioId } },
      brokerMode: run.brokerMode,
    });
    expect(
      screen.getByText(/archived drill definition or checkpoint schedule has changed/i),
    ).toBeInTheDocument();
    expect(document.body).toHaveTextContent(
      /fresh unassessed replay started.*will not count as an exact drill repeat/i,
    );
  });

  it("merges an imported archive against browser data created while the file is read", async () => {
    useSessionStore.getState().finish();
    const report = useSessionStore.getState().report!;
    const isolatedMemory = new Map<string, string>();
    const isolatedStorage = {
      getItem: (key: string) => isolatedMemory.get(key) ?? null,
      setItem: (key: string, value: string) => isolatedMemory.set(key, value),
      removeItem: (key: string) => isolatedMemory.delete(key),
    };
    const incomingRun = recordCompletedRun(
      {
        report,
        runInstanceId: "slow-import-run",
        mode: "explorer",
        brokerMode: "scenario",
        brokerFingerprint: brokerConfigFingerprint(
          useSessionStore.getState().broker,
        ),
        completedAt: "2026-07-14T12:00:00.000Z",
      },
      isolatedStorage,
    ).run;
    const serialized = exportPracticeArchive(
      [incomingRun],
      [derivePracticeLedgerEntry(incomingRun)],
      "2026-07-14T12:30:00.000Z",
    );
    useSessionStore.getState().resetScenario();
    window.localStorage.clear();
    render(<App />);

    let resolveText!: (value: string) => void;
    const file = {
      name: "slow-practice-archive.json",
      size: serialized.length,
      text: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveText = resolve;
          }),
      ),
    } as unknown as File;
    fireEvent.change(screen.getByLabelText("Import practice archive JSON"), {
      target: { files: [file] },
    });
    await waitFor(() => expect(file.text).toHaveBeenCalledOnce());

    const concurrentRun = recordCompletedRun({
      report,
      runInstanceId: "concurrent-browser-run",
      mode: "explorer",
      brokerMode: "scenario",
      brokerFingerprint: brokerConfigFingerprint(useSessionStore.getState().broker),
      completedAt: "2026-07-14T12:15:00.000Z",
    }).run;
    recordPracticeLedgerEntry(concurrentRun);
    await act(async () => resolveText(serialized));

    expect(
      await screen.findByText(
        "Imported 1 report and 1 compact evidence entry.",
      ),
    ).toBeInTheDocument();
    const saved = loadStoredPracticeArchiveData();
    expect(saved.runs.map((run) => run.id)).toEqual([
      "concurrent-browser-run",
      "slow-import-run",
    ]);
    expect(saved.ledger.map((entry) => entry.id)).toEqual([
      "concurrent-browser-run",
      "slow-import-run",
    ]);
  });

  it("imports an authored drill, discovers it in the library, and starts it", async () => {
    const source = getScenario("qqq-rate-hike-2022")!;
    const authoredScenario = {
      ...source,
      meta: {
        ...source.meta,
        id: "app-authored-drill-scenario",
        title: "App Authored Drill Scenario",
        dataVersion: "app-authored-drill-data-v1",
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

  it("renders and prices the authored drill primary asset in a multi-symbol scenario", () => {
    const source = getScenario("qqq-rate-hike-2022")!;
    const scenarioId = "app-authored-primary-symbol-scenario";
    const primarySymbol = "ALT";
    const authoredScenario: ScenarioPackage = {
      ...source,
      meta: {
        ...source.meta,
        id: scenarioId,
        title: "App Authored Primary Symbol Scenario",
        symbols: [...source.meta.symbols, primarySymbol],
        dataVersion: "app-authored-primary-symbol-data-v1",
      },
      instruments: [
        ...source.instruments,
        {
          ...source.instruments[0],
          symbol: primarySymbol,
          name: "Alternate asset",
        },
      ],
      candles: [
        ...source.candles,
        ...source.candles.map((candle) => ({
          ...candle,
          symbol: primarySymbol,
          open: 999,
          high: 999,
          low: 999,
          close: 999,
          adjustedClose: 999,
        })),
      ],
      events: source.events.map((event) => ({
        ...event,
        affectedSymbols: [primarySymbol],
      })),
      drills: [
        {
          ...eventDisciplineQqqV1,
          id: "app-authored-primary-symbol-v1",
          competencyId: "app-authored-primary-symbol",
          title: "App Authored Primary Symbol",
          scenarioId,
          primarySymbol,
        },
      ],
    };
    expect(registerUserScenario(authoredScenario)).toMatchObject({ ok: true });
    expect(
      useSessionStore
        .getState()
        .startPractice(scenarioId, "app-authored-primary-symbol-v1"),
    ).toEqual({ ok: true });
    useSessionStore.setState({ status: "paused", currentIndex: 1 });

    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue active replay" }),
    );

    expect(useSessionStore.getState().primarySymbol).toBe(primarySymbol);
    expect(screen.getByText(primarySymbol)).toBeInTheDocument();
    expect(screen.getByText("Alternate asset")).toBeInTheDocument();
    expect(screen.getByText("$999.00 mark")).toBeInTheDocument();
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
      await screen.findByRole("button", { name: "Review first practice" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Export practice archive" }),
    ).not.toBeInTheDocument();
    expect(
      window.localStorage.getItem("market-time-machine.run-history.v1"),
    ).toBeNull();
    await waitFor(() =>
      expect(loadStoredPracticeArchiveData()).toEqual({ runs: [], ledger: [] }),
    );
  });

  it("keeps a committed destructive confirmation non-cancelable while its archive lock is pending", async () => {
    useSessionStore.getState().finish();
    render(<App />);
    await screen.findByRole("button", { name: "Export practice archive" });

    const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    let releaseLock!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const request = vi.fn(
      async <T,>(
        _name: string,
        _options: { mode: "exclusive" },
        callback: () => T | PromiseLike<T>,
      ): Promise<T> => {
        await gate;
        return callback();
      },
    );
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });

    try {
      fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
      const dialog = screen.getByRole("alertdialog", {
        name: "Clear completed replay history?",
      });
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Clear history" }),
      );

      await waitFor(() => expect(request).toHaveBeenCalledOnce());
      expect(within(dialog).getByRole("button", { name: "Working…" })).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "Keep session" })).toBeDisabled();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(dialog).toBeInTheDocument();

      releaseLock();
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      expect(loadStoredPracticeArchiveData()).toEqual({ runs: [], ledger: [] });
    } finally {
      if (originalLocks) {
        Object.defineProperty(navigator, "locks", originalLocks);
      } else {
        delete (navigator as unknown as { locks?: unknown }).locks;
      }
    }
  });

  it("atomically removes a completed report and its compact evidence", async () => {
    useSessionStore.getState().finish();
    render(<App />);
    const removeButton = await screen.findByRole("button", { name: /^Remove / });
    const storedBefore = loadStoredPracticeArchiveData();
    expect(storedBefore.runs).toHaveLength(1);
    expect(storedBefore.ledger).toHaveLength(1);

    fireEvent.click(removeButton);

    const dialog = screen.getByRole("alertdialog", {
      name: "Remove Brexit Referendum: EUR/GBP 2016?",
    });
    expect(dialog).toHaveTextContent(
      /completed report and its compact practice evidence/i,
    );
    expect(loadStoredPracticeArchiveData().runs).toHaveLength(1);
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Remove completed replay",
      }),
    );

    await waitFor(() =>
      expect(loadStoredPracticeArchiveData()).toEqual({ runs: [], ledger: [] }),
    );
    expect(
      screen.queryByRole("button", { name: "Export practice archive" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Brexit Referendum: EUR/GBP 2016 was removed from practice history.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the report, compact evidence, and UI when atomic removal fails", async () => {
    useSessionStore.getState().finish();
    render(<App />);
    expect(
      await screen.findByRole("button", { name: /^Remove / }),
    ).toBeInTheDocument();
    const previousCanonical = window.localStorage.getItem(
      PRACTICE_ARCHIVE_STORAGE_KEY,
    );
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    );
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (key: string, value: string) {
        if (key === PRACTICE_ARCHIVE_STORAGE_KEY) {
          throw new Error("storage denied");
        }
        originalSetItem(key, value);
      });

    fireEvent.click(screen.getByRole("button", { name: /^Remove / }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Remove Brexit Referendum: EUR/GBP 2016?",
    });
    try {
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "Remove completed replay",
        }),
      );
      expect(
        await screen.findByText(
          "Completed replay could not be removed. Existing practice history was kept.",
        ),
      ).toBeInTheDocument();
    } finally {
      setItem.mockRestore();
    }
    expect(screen.getByRole("button", { name: /^Remove / })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export practice archive" }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
      previousCanonical,
    );
    expect(loadStoredPracticeArchiveData().runs).toHaveLength(1);
    expect(loadStoredPracticeArchiveData().ledger).toHaveLength(1);
  });

  it("keeps visible and stored history when the atomic clear write fails", async () => {
    useSessionStore.getState().finish();
    render(<App />);
    expect(
      await screen.findByRole("button", { name: "Export practice archive" }),
    ).toBeInTheDocument();
    const previousCanonical = window.localStorage.getItem(
      PRACTICE_ARCHIVE_STORAGE_KEY,
    );
    expect(previousCanonical).not.toBeNull();
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    );
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (key: string, value: string) {
        if (
          key === PRACTICE_ARCHIVE_STORAGE_KEY &&
          value.includes('"runs":[],"ledger":[]')
        ) {
          throw new Error("storage denied");
        }
        originalSetItem(key, value);
      });

    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Clear completed replay history?",
    });
    try {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Clear history" }),
      );
      expect(
        await screen.findByText(
          "Practice history could not be cleared. Existing browser data was kept.",
        ),
      ).toBeInTheDocument();
    } finally {
      setItem.mockRestore();
    }
    expect(
      screen.getByRole("button", { name: "Export practice archive" }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(PRACTICE_ARCHIVE_STORAGE_KEY)).toBe(
      previousCanonical,
    );
    expect(loadStoredPracticeArchiveData().runs).toHaveLength(1);
  });

  it("keeps next-practice coaching tied to the latest report", async () => {
    useSessionStore.getState().finish();
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", { name: /^View report for / }),
    );

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
