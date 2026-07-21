import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Candle,
  DrillDefinition,
  Order,
  ScenarioPackage,
} from "../types";
import { SESSION_TEXT_MAX_LENGTH } from "../types";
import {
  defaultScenarioId,
  registerUserScenario,
  removeUserScenario,
} from "../data/scenarios";
import {
  EVENT_DISCIPLINE_EURGBP_V1_ID,
  eventDisciplineEurGbpV1,
} from "../data/practice/drills";
import { emptyPortfolio } from "../domain/portfolio/portfolio";
import { replayTimeline } from "../domain/replay/engine";
import { assembleScenario } from "../domain/scenario/loader";
import { makeBroker, makeScenario } from "../test/fixtures";
import {
  LEGACY_SESSION_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  loadInitialSessionState,
  useSessionStore,
  type ActiveDrillSessionIdentity,
} from "./sessionStore";
import {
  EURGBP_BREXIT_2016_DATA_VERSION,
  LEGACY_EURGBP_BREXIT_2016_DATA_VERSION,
} from "../data/scenarios/dataVersions";
import {
  buildDrillCheckpointSchedule,
  drillCheckpointScheduleFingerprint,
} from "../domain/practice/drills";
import {
  brokerConfigFingerprint,
  getBrokerPreset,
} from "../domain/broker/executionModels";

function idealPracticeBrokerFingerprint(): string {
  return brokerConfigFingerprint({
    ...getBrokerPreset("ideal"),
    baseCurrency: useSessionStore.getState().scenario.meta.baseCurrency,
  });
}

const AUTHORED_PRACTICE_SCENARIO_ID = "authored-practice-runtime-test";
const AUTHORED_PRACTICE_DRILL_ID = "authored-macro-discipline-v1";
const COLLISION_PRACTICE_SCENARIO_ID = "authored-built-in-collision-test";
const MULTI_SYMBOL_PRACTICE_SCENARIO_ID =
  "authored-multi-symbol-practice-test";
const UNVERSIONED_RESTORE_SCENARIO_ID = "unversioned-restore-test";

afterEach(() => {
  removeUserScenario(AUTHORED_PRACTICE_SCENARIO_ID);
  removeUserScenario(COLLISION_PRACTICE_SCENARIO_ID);
  removeUserScenario(MULTI_SYMBOL_PRACTICE_SCENARIO_ID);
  removeUserScenario(UNVERSIONED_RESTORE_SCENARIO_ID);
});

function authoredPracticeScenario(input: {
  scenarioId?: string;
  drillId?: string;
  primarySymbol?: string;
  baseScenario?: ScenarioPackage;
} = {}): ScenarioPackage {
  const base = input.baseScenario ?? makeScenario();
  const scenarioId = input.scenarioId ?? AUTHORED_PRACTICE_SCENARIO_ID;
  const drill: DrillDefinition = {
    id: input.drillId ?? AUTHORED_PRACTICE_DRILL_ID,
    competencyId: "authored-macro-discipline",
    definitionVersion: 1,
    rubricVersion: "authored-event-process-v1",
    title: "Custom Macro Discipline",
    description: "A scenario-authored runtime practice drill.",
    scenarioId,
    primarySymbol: input.primarySymbol ?? "TEST",
    mode: "explorer",
    initialPlanRule: {
      requiredBeforeFirstOrder: true,
      requiredFields: [
        "thesis",
        "invalidation",
        "exitPlan",
        "acceptedRisk",
      ],
    },
    checkpointRule: {
      minimumImportance: 4,
      mapping: "next_primary_candle_close",
      groupSameReplayIndex: true,
      requireReflection: true,
      actions: ["hold", "reduce", "exit", "wait"],
    },
    rubric: {
      weights: {
        plan_coverage: 0.3,
        checkpoint_coverage: 0.3,
        event_linkage: 0.2,
        rule_adherence: 0.2,
      },
      violationPenalty: 20,
    },
  };
  return assembleScenario({
    scenario: {
      ...base.meta,
      id: scenarioId,
      title: "Authored practice runtime fixture",
      dataVersion: "authored-practice-data-v1",
      supportedModes: ["explorer"],
    },
    instruments: base.instruments,
    candles: base.candles,
    events: base.events,
    indicators: base.indicators,
    benchmarks: base.benchmarks,
    broker: base.broker,
    drills: [drill],
  });
}

function candle(
  symbol: string,
  openTime: string,
  closeTime: string,
  price: number,
  overrides: Partial<Candle> = {},
): Candle {
  return {
    symbol,
    openTime,
    closeTime,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 10,
    ...overrides,
  };
}

function installScenario(scenario: ScenarioPackage): void {
  const primarySymbol = scenario.meta.symbols[0];
  const mode = scenario.meta.supportedModes[0] ?? "explorer";
  useSessionStore.setState({
    scenario,
    mode,
    broker: { ...scenario.broker },
    brokerMode: "scenario",
    status: "idle",
    currentIndex: 0,
    portfolio: emptyPortfolio(scenario.meta.initialCash),
    fills: [],
    orders: [],
    journal: [],
    auditEvents: [],
    report: undefined,
    rejectionMessage: undefined,
    primarySymbol,
    primaryCandlesLength: replayTimeline(scenario).length,
    appliedCorporateActions: [],
    marginCallActive: false,
    liquidityConsumed: {},
    financingCosts: [],
    pauseOnMajorEvents: mode === "explorer",
    majorEventPauseNotice: undefined,
  });
}

function scenarioWithCandles(
  candles: Candle[],
  overrides: Omit<Partial<ScenarioPackage>, "meta"> & {
    meta?: Partial<ScenarioPackage["meta"]>;
  } = {},
): ScenarioPackage {
  const base = makeScenario(
    makeBroker({
      commissionRateBps: 0,
      allowFractional: true,
      allowShort: true,
      maxLeverage: 4,
    }),
  );
  const symbols = [...new Set(candles.map((entry) => entry.symbol))];
  const first = candles[0];
  const last = candles[candles.length - 1];
  return {
    ...base,
    ...overrides,
    meta: {
      ...base.meta,
      id: "session-store-test",
      symbols,
      startTime: first.openTime,
      endTime: last.closeTime,
      supportedModes: ["explorer", "professional", "blind", "challenge"],
      priceAdjustment: "raw",
      ...overrides.meta,
    },
    instruments:
      overrides.instruments ??
      symbols.map((symbol) => ({
        ...base.instruments[0],
        symbol,
        name: symbol,
      })),
    candles,
    events: overrides.events ?? [],
    indicators: overrides.indicators ?? [],
    benchmarks:
      overrides.benchmarks ??
      candles
        .filter((entry) => entry.symbol === symbols[0])
        .map((entry) => ({
          symbol: symbols[0],
          time: entry.closeTime,
          value: entry.close,
        })),
    broker: overrides.broker ?? base.broker,
  };
}

function multiSymbolAuthoredPracticeScenario(): ScenarioPackage {
  const base = makeScenario();
  const drillSymbol = "ALT";
  const multiSymbolBase = assembleScenario({
    scenario: {
      ...base.meta,
      id: "multi-symbol-authored-base",
      symbols: ["TEST", drillSymbol],
      dataVersion: "multi-symbol-authored-data-v1",
    },
    instruments: [
      ...base.instruments,
      { ...base.instruments[0], symbol: drillSymbol, name: "Alternate asset" },
    ],
    candles: [
      ...base.candles,
      ...base.candles.map((entry) => ({ ...entry, symbol: drillSymbol })),
    ],
    events: base.events.map((event) => ({
      ...event,
      affectedSymbols: [drillSymbol],
    })),
    indicators: [],
    benchmarks: base.benchmarks,
    broker: base.broker,
  });
  return authoredPracticeScenario({
    scenarioId: MULTI_SYMBOL_PRACTICE_SCENARIO_ID,
    primarySymbol: drillSymbol,
    baseScenario: multiSymbolBase,
  });
}

function multiSymbolTailScenario(): ScenarioPackage {
  return scenarioWithCandles(
    [
      candle(
        "X",
        "2024-01-01T09:00:00.000Z",
        "2024-01-01T10:00:00.000Z",
        100,
      ),
      candle(
        "Y",
        "2024-01-01T09:00:00.000Z",
        "2024-01-01T10:00:00.000Z",
        100,
      ),
      candle(
        "Y",
        "2024-01-01T10:00:00.000Z",
        "2024-01-01T11:00:00.000Z",
        100,
      ),
      candle(
        "X",
        "2024-01-01T10:00:00.000Z",
        "2024-01-01T12:00:00.000Z",
        101,
      ),
      candle(
        "Y",
        "2024-01-01T11:00:00.000Z",
        "2024-01-01T13:00:00.000Z",
        90,
        { high: 100, low: 80 },
      ),
    ],
    { meta: { endTime: "2024-01-01T14:00:00.000Z" } },
  );
}

describe("sessionStore finish", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSessionStore.getState().selectScenario(defaultScenarioId);
  });

  it("processes pending limit orders across the skipped interval", () => {
    const state = useSessionStore.getState();
    const symbol = state.primarySymbol;
    const primaryCandles = state.scenario.candles.filter(
      (candle) => candle.symbol === symbol,
    );
    const futureLimit = Math.min(
      ...primaryCandles
        .slice(state.currentIndex + 1)
        .map((candle) => candle.low),
    );

    const placement = state.submitLimitOrder({
      symbol,
      side: "buy",
      type: "limit",
      quantity: 0.01,
      limitPrice: futureLimit,
      note: "Finish should still process this limit.",
    });
    expect(placement.ok).toBe(true);

    useSessionStore.getState().finish();

    const finished = useSessionStore.getState();
    expect(finished.status).toBe("finished");
    expect(finished.orders).toHaveLength(1);
    expect(finished.orders[0].status).toBe("filled");
    expect(finished.fills).toHaveLength(1);
    expect(finished.journal[0]?.note).toBe("Finish should still process this limit.");
  });

  it("keeps cancelled limit orders from filling later", () => {
    const state = useSessionStore.getState();
    const symbol = state.primarySymbol;
    const primaryCandles = state.scenario.candles.filter(
      (candle) => candle.symbol === symbol,
    );
    const futureLimit = Math.min(
      ...primaryCandles
        .slice(state.currentIndex + 1)
        .map((candle) => candle.low),
    );

    const placement = state.submitLimitOrder({
      symbol,
      side: "buy",
      type: "limit",
      quantity: 0.01,
      limitPrice: futureLimit,
      note: "Cancelled orders should stay out of fills.",
    });
    expect(placement.ok).toBe(true);

    const orderId = useSessionStore.getState().orders[0].id;
    const cancellation = useSessionStore.getState().cancelOrder(orderId);
    expect(cancellation.ok).toBe(true);

    useSessionStore.getState().finish();

    const finished = useSessionStore.getState();
    expect(finished.status).toBe("finished");
    expect(finished.orders).toHaveLength(1);
    expect(finished.orders[0].status).toBe("cancelled");
    expect(finished.fills).toHaveLength(0);
    expect(finished.journal).toHaveLength(0);
  });

  it("updates a pending limit order before replay processing", () => {
    const state = useSessionStore.getState();
    const symbol = state.primarySymbol;
    const primaryCandles = state.scenario.candles.filter(
      (candle) => candle.symbol === symbol,
    );
    const futureLimit = Math.min(
      ...primaryCandles
        .slice(state.currentIndex + 1)
        .map((candle) => candle.low),
    );

    const placement = state.submitLimitOrder({
      symbol,
      side: "buy",
      type: "limit",
      quantity: 0.01,
      limitPrice: futureLimit * 0.5,
      note: "Edited order should fill at the replacement limit.",
    });
    expect(placement.ok).toBe(true);

    const orderId = useSessionStore.getState().orders[0].id;
    const update = useSessionStore.getState().updateLimitOrder(orderId, {
      quantity: 0.02,
      limitPrice: futureLimit,
    });
    expect(update.ok).toBe(true);

    const working = useSessionStore.getState();
    expect(working.orders[0].id).toBe(orderId);
    expect(working.orders[0].status).toBe("pending");
    expect(working.orders[0].quantity).toBe(0.02);
    expect(working.orders[0].limitPrice).toBe(futureLimit);

    useSessionStore.getState().finish();

    const finished = useSessionStore.getState();
    expect(finished.orders[0].status).toBe("filled");
    expect(finished.fills).toHaveLength(1);
    expect(finished.fills[0].quantity).toBe(0.02);
    expect(finished.fills[0].price).toBe(futureLimit);
  });

  it("triggers stop-loss orders during replay processing", () => {
    const state = useSessionStore.getState();
    const symbol = state.primarySymbol;
    const primaryCandles = state.scenario.candles.filter(
      (candle) => candle.symbol === symbol,
    );
    const futureStop = Math.min(
      ...primaryCandles
        .slice(state.currentIndex + 1)
        .map((candle) => candle.low),
    );

    const entry = state.submitMarketOrder({
      symbol,
      side: "buy",
      type: "market",
      quantity: 0.01,
    });
    expect(entry.ok).toBe(true);

    const placement = useSessionStore.getState().submitPendingOrder({
      symbol,
      side: "sell",
      type: "stop_loss",
      quantity: 0.01,
      triggerPrice: futureStop,
      note: "Protect the opened position.",
    });
    expect(placement.ok).toBe(true);

    useSessionStore.getState().finish();

    const finished = useSessionStore.getState();
    expect(finished.orders).toHaveLength(2);
    expect(finished.orders[1].status).toBe("filled");
    expect(finished.fills).toHaveLength(2);
    expect(finished.fills[1].side).toBe("sell");
    expect(finished.fills[1].price).toBeLessThanOrEqual(futureStop);
    expect(["stop_trigger", "gap_open"]).toContain(
      finished.fills[1].executionPriceSource,
    );
  });

  it("updates stop-loss trigger prices before replay processing", () => {
    const state = useSessionStore.getState();
    const symbol = state.primarySymbol;
    const primaryCandles = state.scenario.candles.filter(
      (candle) => candle.symbol === symbol,
    );
    const futureStop = Math.min(
      ...primaryCandles
        .slice(state.currentIndex + 1)
        .map((candle) => candle.low),
    );

    const entry = state.submitMarketOrder({
      symbol,
      side: "buy",
      type: "market",
      quantity: 0.02,
    });
    expect(entry.ok).toBe(true);

    const placement = useSessionStore.getState().submitPendingOrder({
      symbol,
      side: "sell",
      type: "stop_loss",
      quantity: 0.01,
      triggerPrice: futureStop * 0.5,
      note: "Edited stop should use the replacement trigger.",
    });
    expect(placement.ok).toBe(true);

    const orderId = useSessionStore.getState().orders[1].id;
    const update = useSessionStore.getState().updatePendingOrder(orderId, {
      quantity: 0.02,
      price: futureStop,
    });
    expect(update.ok).toBe(true);

    const working = useSessionStore.getState();
    expect(working.orders[1].id).toBe(orderId);
    expect(working.orders[1].status).toBe("pending");
    expect(working.orders[1].quantity).toBe(0.02);
    expect(working.orders[1].triggerPrice).toBe(futureStop);

    useSessionStore.getState().finish();

    const finished = useSessionStore.getState();
    expect(finished.orders[1].status).toBe("filled");
    expect(finished.fills).toHaveLength(2);
    expect(finished.fills[1].quantity).toBe(0.02);
    expect(finished.fills[1].price).toBeLessThanOrEqual(futureStop);
    expect(["stop_trigger", "gap_open"]).toContain(
      finished.fills[1].executionPriceSource,
    );
  });

  it("cancels the sibling order when a bracket exit fills", () => {
    const state = useSessionStore.getState();
    const symbol = state.primarySymbol;
    const primaryCandles = state.scenario.candles.filter(
      (candle) => candle.symbol === symbol,
    );
    const futureStop = Math.min(
      ...primaryCandles
        .slice(state.currentIndex + 1)
        .map((candle) => candle.low),
    );
    const unreachableTarget =
      Math.max(
        ...primaryCandles
          .slice(state.currentIndex + 1)
          .map((candle) => candle.high),
      ) * 10;

    const entry = state.submitMarketOrder({
      symbol,
      side: "buy",
      type: "market",
      quantity: 0.02,
    });
    expect(entry.ok).toBe(true);

    const placement = useSessionStore.getState().submitBracketOrder({
      symbol,
      side: "sell",
      quantity: 0.02,
      stopPrice: futureStop,
      targetPrice: unreachableTarget,
      note: "Bracket should cancel the unfilled target.",
    });
    expect(placement.ok).toBe(true);

    const working = useSessionStore.getState();
    expect(working.orders).toHaveLength(3);
    expect(working.orders[1].ocoGroupId).toBeTruthy();
    expect(working.orders[1].ocoGroupId).toBe(working.orders[2].ocoGroupId);

    useSessionStore.getState().finish();

    const finished = useSessionStore.getState();
    expect(finished.fills).toHaveLength(2);
    expect(finished.orders[1].status).toBe("filled");
    expect(finished.orders[2].status).toBe("cancelled");
    expect(finished.fills[1].price).toBeLessThanOrEqual(futureStop);
    expect(["stop_trigger", "gap_open"]).toContain(
      finished.fills[1].executionPriceSource,
    );
  });

  it("records audit and liquidates positions when margin threshold is breached", () => {
    const state = useSessionStore.getState();
    const symbol = state.primarySymbol;
    const candle = state.scenario.candles.find((c) => c.symbol === symbol);
    expect(candle).toBeTruthy();
    if (!candle) return;

    useSessionStore.setState({
      broker: {
        ...state.broker,
        allowShort: true,
        maxLeverage: 4,
        marginCallPolicy: "liquidate_on_threshold",
        spreadBps: 0,
        slippageModel: "none",
      },
      portfolio: {
        cash: -candle.close * 0.98,
        realizedPnl: 0,
        feesPaid: 0,
        slippagePaid: 0,
        financingPaid: 0,
        positions: {
          [symbol]: {
            symbol,
            quantity: 1,
            averagePrice: candle.close,
            marketPrice: candle.close,
            marketValue: candle.close,
            unrealizedPnl: 0,
            realizedPnl: 0,
          },
        },
      },
    });

    useSessionStore.getState().stepForward();

    const next = useSessionStore.getState();
    expect(next.fills.some((fill) => fill.forcedLiquidation)).toBe(true);
    expect(
      next.auditEvents.some((event) => event.type === "forced_liquidation"),
    ).toBe(true);
    expect(next.portfolio.positions[symbol].quantity).toBe(0);
  });
});

describe("sessionStore Event Discipline practice", () => {
  const drillId = "event-discipline-eurgbp-v1";

  beforeEach(() => {
    window.localStorage.clear();
    useSessionStore.getState().selectScenario(defaultScenarioId);
  });

  function startPractice(): void {
    expect(
      useSessionStore.getState().startPractice(defaultScenarioId, drillId),
    ).toEqual({ ok: true });
    useSessionStore.getState().setSpeed("60x");
  }

  function advanceUntilCheckpointOrFinish(): void {
    let guard = 0;
    while (
      !useSessionStore.getState().pendingDrillCheckpoint &&
      useSessionStore.getState().status !== "finished" &&
      guard < 500
    ) {
      useSessionStore.getState().play();
      useSessionStore.getState().stepForward();
      guard += 1;
    }
    expect(guard).toBeLessThan(500);
  }

  it("atomically starts the versioned drill and enforces a complete first plan", () => {
    startPractice();
    const state = useSessionStore.getState();
    expect(state).toMatchObject({
      scenario: { meta: { id: defaultScenarioId } },
      mode: "explorer",
      activeDrillId: drillId,
      activeDrillDefinitionVersion: 1,
      activeDrillIdentity: {
        scenarioDataVersion: state.scenario.meta.dataVersion,
        drillId,
        competencyId: "event-discipline",
        definitionVersion: 1,
        rubricVersion: "event-discipline-process-v1",
        definitionSnapshot: {
          id: drillId,
          competencyId: "event-discipline",
          definitionVersion: 1,
          rubricVersion: "event-discipline-process-v1",
        },
      },
    });
    expect(
      JSON.parse(
        window.localStorage.getItem("market-time-machine.session.v2") ?? "{}",
      ),
    ).toMatchObject({
      version: 4,
      scenarioId: defaultScenarioId,
      scenarioDataVersion: state.scenario.meta.dataVersion,
      brokerFingerprint: brokerConfigFingerprint(state.broker),
      activeDrillIdentity: {
        scenarioDataVersion: state.scenario.meta.dataVersion,
        drillId,
        competencyId: "event-discipline",
        rubricVersion: "event-discipline-process-v1",
        definitionSnapshot: {
          id: drillId,
          title: eventDisciplineEurGbpV1.title,
        },
      },
    });

    const incomplete = state.submitMarketOrder({
      symbol: state.primarySymbol,
      side: "buy",
      type: "market",
      quantity: 100,
      decisionPlan: { thesis: "Policy uncertainty may move the cross." },
    });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.message).toMatch(/invalidation, exitPlan, acceptedRisk/);
    expect(useSessionStore.getState().drillRuleViolations).toHaveLength(1);
    expect(useSessionStore.getState().fills).toHaveLength(0);

    const completePlan = {
      thesis: "Policy uncertainty may move the cross.",
      invalidation: "Published policy contradicts the thesis.",
      exitPlan: "Exit at the next checkpoint if invalidated.",
      acceptedRisk: "No more than one percent of equity.",
    };
    expect(
      useSessionStore.getState().submitMarketOrder({
        symbol: state.primarySymbol,
        side: "buy",
        type: "market",
        quantity: 100,
        decisionPlan: completePlan,
      }).ok,
    ).toBe(true);
    expect(useSessionStore.getState().initialDrillPlan).toEqual(completePlan);
  });

  it("starts a prepared coach assignment only with its exact data and broker context", () => {
    const scenarioDataVersion =
      useSessionStore.getState().scenario.meta.dataVersion ?? null;

    expect(
      useSessionStore.getState().startPractice(defaultScenarioId, drillId, {
        scenarioDataVersion,
        brokerMode: "ideal",
        brokerFingerprint: idealPracticeBrokerFingerprint(),
      }),
    ).toEqual({ ok: true });
    expect(useSessionStore.getState()).toMatchObject({
      activeDrillId: drillId,
      brokerMode: "ideal",
      broker: {
        commissionRateBps: 0,
        spreadBps: 0,
        slippageModel: "none",
      },
    });

    useSessionStore.getState().resetScenario();
    expect(useSessionStore.getState()).toMatchObject({
      activeDrillId: drillId,
      brokerMode: "ideal",
      activeDrillIdentity: { scenarioDataVersion },
      broker: {
        commissionRateBps: 0,
        spreadBps: 0,
        slippageModel: "none",
      },
    });

    const stale = useSessionStore
      .getState()
      .startPractice(defaultScenarioId, drillId, {
        scenarioDataVersion: "unreviewed-different-data",
        brokerMode: "ideal",
        brokerFingerprint: idealPracticeBrokerFingerprint(),
      });
    expect(stale.ok).toBe(false);
    expect(stale.message).toMatch(/different scenario data version/i);
  });

  it("replays an archived practice only with its exact drill definition and checkpoint schedule", () => {
    startPractice();
    const started = useSessionStore.getState();
    const drillIdentity = started.activeDrillIdentity!;
    const checkpointScheduleFingerprint =
      drillCheckpointScheduleFingerprint(
        buildDrillCheckpointSchedule(
          drillIdentity.definitionSnapshot,
          started.scenario,
        ),
      );
    const exactContext = {
      scenarioDataVersion: started.scenario.meta.dataVersion ?? null,
      brokerMode: started.brokerMode,
      brokerFingerprint: brokerConfigFingerprint(started.broker),
      drillIdentity,
      checkpointScheduleFingerprint,
    } as const;

    expect(
      useSessionStore
        .getState()
        .startPractice(defaultScenarioId, drillId, exactContext),
    ).toEqual({ ok: true });

    const reorderedWeights = Object.fromEntries(
      Object.entries(drillIdentity.definitionSnapshot.rubric.weights).reverse(),
    ) as typeof drillIdentity.definitionSnapshot.rubric.weights;
    expect(
      useSessionStore.getState().startPractice(defaultScenarioId, drillId, {
        ...exactContext,
        drillIdentity: {
          ...drillIdentity,
          definitionSnapshot: {
            ...drillIdentity.definitionSnapshot,
            rubric: {
              ...drillIdentity.definitionSnapshot.rubric,
              weights: reorderedWeights,
            },
          },
        },
      }),
    ).toEqual({ ok: true });

    const changedIdentity: ActiveDrillSessionIdentity = {
      ...drillIdentity,
      definitionSnapshot: {
        ...drillIdentity.definitionSnapshot,
        description: "A changed same-ID drill definition.",
      },
    };
    const changedDefinition = useSessionStore
      .getState()
      .startPractice(defaultScenarioId, drillId, {
        ...exactContext,
        drillIdentity: changedIdentity,
      });
    expect(changedDefinition.ok).toBe(false);
    expect(changedDefinition.message).toMatch(/changed drill definition/i);

    const changedSchedule = useSessionStore
      .getState()
      .startPractice(defaultScenarioId, drillId, {
        ...exactContext,
        checkpointScheduleFingerprint: "drill-checkpoints-v1:forged",
      });
    expect(changedSchedule.ok).toBe(false);
    expect(changedSchedule.message).toMatch(/changed checkpoint schedule/i);
  });

  it("starts and resets a free replay without changing its exact broker context", () => {
    const scenarioDataVersion =
      useSessionStore.getState().scenario.meta.dataVersion ?? null;
    const brokerFingerprint = idealPracticeBrokerFingerprint();

    expect(
      useSessionStore.getState().startReplay(defaultScenarioId, "explorer", {
        scenarioDataVersion,
        brokerMode: "ideal",
        brokerFingerprint,
      }),
    ).toEqual({ ok: true });
    expect(useSessionStore.getState()).toMatchObject({
      mode: "explorer",
      brokerMode: "ideal",
      broker: {
        commissionRateBps: 0,
        spreadBps: 0,
        slippageModel: "none",
      },
    });

    useSessionStore.setState({ currentIndex: 3, status: "paused" });
    useSessionStore.getState().resetScenario();
    expect(useSessionStore.getState()).toMatchObject({
      mode: "explorer",
      brokerMode: "ideal",
      currentIndex: 0,
      status: "idle",
    });
    expect(
      brokerConfigFingerprint(useSessionStore.getState().broker),
    ).toBe(brokerFingerprint);

    const stale = useSessionStore
      .getState()
      .startReplay(defaultScenarioId, "explorer", {
        scenarioDataVersion: "different-replay-data",
        brokerMode: "ideal",
        brokerFingerprint,
      });
    expect(stale.ok).toBe(false);
    expect(stale.message).toMatch(/different scenario data version/i);
  });

  it("keeps Surprise mode and scenario execution settings when resetting", () => {
    const current = useSessionStore.getState();
    const scenarioDataVersion = current.scenario.meta.dataVersion ?? null;
    const brokerFingerprint = brokerConfigFingerprint(current.scenario.broker);

    expect(
      current.startReplay(defaultScenarioId, "challenge", {
        scenarioDataVersion,
        brokerMode: "scenario",
        brokerFingerprint,
      }),
    ).toEqual({ ok: true });
    useSessionStore.setState({ currentIndex: 4, status: "paused" });
    useSessionStore.getState().resetScenario();

    expect(useSessionStore.getState()).toMatchObject({
      mode: "challenge",
      brokerMode: "scenario",
      currentIndex: 0,
      status: "idle",
    });
    expect(
      brokerConfigFingerprint(useSessionStore.getState().broker),
    ).toBe(brokerFingerprint);
  });

  it("cannot skip or advance past a mandatory checkpoint and restores it safely", () => {
    startPractice();
    useSessionStore.getState().finish();
    expect(useSessionStore.getState().status).not.toBe("finished");
    expect(useSessionStore.getState().rejectionMessage).toMatch(/disabled/i);

    advanceUntilCheckpointOrFinish();
    const pending = useSessionStore.getState().pendingDrillCheckpoint;
    expect(pending).toBeDefined();
    const checkpointIndex = useSessionStore.getState().currentIndex;

    useSessionStore.getState().play();
    expect(useSessionStore.getState().currentIndex).toBe(checkpointIndex);
    expect(useSessionStore.getState().status).toBe("paused");
    expect(
      useSessionStore
        .getState()
        .drillRuleViolations.some(
          (violation) => violation.code === "advance_while_checkpoint_open",
        ),
    ).toBe(true);

    const serialized = useSessionStore.getState().exportSession();
    expect(JSON.parse(serialized)).toMatchObject({
      version: 4,
      scenarioDataVersion: useSessionStore.getState().scenario.meta.dataVersion,
      brokerFingerprint: brokerConfigFingerprint(
        useSessionStore.getState().broker,
      ),
      activeDrillId: drillId,
      activeDrillDefinitionVersion: 1,
      activeDrillIdentity: {
        scenarioDataVersion: useSessionStore.getState().scenario.meta.dataVersion,
        drillId,
        competencyId: "event-discipline",
        definitionVersion: 1,
        rubricVersion: "event-discipline-process-v1",
        definitionSnapshot: eventDisciplineEurGbpV1,
      },
    });
    useSessionStore.getState().selectScenario(defaultScenarioId);
    expect(useSessionStore.getState().importSession(serialized)).toEqual({
      ok: true,
    });
    expect(useSessionStore.getState().pendingDrillCheckpoint?.id).toBe(
      pending?.id,
    );

    const tampered = JSON.parse(serialized) as Record<string, unknown>;
    tampered.pendingDrillCheckpointId = "future-or-unknown";
    expect(
      useSessionStore.getState().importSession(JSON.stringify(tampered)).ok,
    ).toBe(false);

    const changedDefinition = JSON.parse(serialized) as Record<string, unknown>;
    const changedIdentity = changedDefinition.activeDrillIdentity as Record<
      string,
      unknown
    >;
    const changedSnapshot = changedIdentity.definitionSnapshot as Record<
      string,
      unknown
    >;
    changedSnapshot.title = "Changed after this session began";
    const changedResult = useSessionStore
      .getState()
      .importSession(JSON.stringify(changedDefinition));
    expect(changedResult.ok).toBe(false);
    expect(changedResult.message).toMatch(/changed practice drill definition/i);

    const changedScenarioVersion = JSON.parse(serialized) as Record<
      string,
      unknown
    >;
    changedScenarioVersion.scenarioDataVersion = "different-data-version";
    const versionResult = useSessionStore
      .getState()
      .importSession(JSON.stringify(changedScenarioVersion));
    expect(versionResult.ok).toBe(false);
    expect(versionResult.message).toMatch(/different scenario data version/i);

    const changedBroker = JSON.parse(serialized) as Record<string, unknown>;
    const changedBrokerConfig = {
      ...(changedBroker.broker as Record<string, unknown>),
      spreadBps: 999,
    };
    changedBroker.broker = changedBrokerConfig;
    changedBroker.brokerFingerprint = brokerConfigFingerprint(
      changedBrokerConfig as ReturnType<typeof getBrokerPreset>,
    );
    const brokerResult = useSessionStore
      .getState()
      .importSession(JSON.stringify(changedBroker));
    expect(brokerResult.ok).toBe(false);
    expect(brokerResult.message).toMatch(/changed broker execution settings/i);

    for (const version of [1, 2, 3]) {
      const legacyDrill = JSON.parse(serialized) as Record<string, unknown>;
      legacyDrill.version = version;
      delete legacyDrill.scenarioDataVersion;
      delete legacyDrill.activeDrillIdentity;
      if (version === 1) delete legacyDrill.runInstanceId;
      const legacyResult = useSessionStore
        .getState()
        .importSession(JSON.stringify(legacyDrill));
      expect(legacyResult.ok).toBe(false);
      expect(legacyResult.message).toMatch(/legacy practice sessions/i);
    }
  });

  it("restores a current practice session across the reviewed EUR/GBP version migration", () => {
    startPractice();
    const legacy = JSON.parse(
      useSessionStore.getState().exportSession(),
    ) as Record<string, unknown>;
    legacy.scenarioDataVersion = LEGACY_EURGBP_BREXIT_2016_DATA_VERSION;
    const legacyIdentity = legacy.activeDrillIdentity as Record<string, unknown>;
    legacyIdentity.scenarioDataVersion =
      LEGACY_EURGBP_BREXIT_2016_DATA_VERSION;

    useSessionStore.getState().resetScenario();
    expect(
      useSessionStore.getState().importSession(JSON.stringify(legacy)),
    ).toEqual({ ok: true });
    expect(useSessionStore.getState().activeDrillIdentity).toMatchObject({
      scenarioDataVersion: EURGBP_BREXIT_2016_DATA_VERSION,
      drillId,
    });
  });

  it("records each visible checkpoint and emits a process-only final assessment", () => {
    startPractice();
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
    let answered = 0;
    let guard = 0;
    while (useSessionStore.getState().status !== "finished" && guard < 500) {
      advanceUntilCheckpointOrFinish();
      const pending = useSessionStore.getState().pendingDrillCheckpoint;
      if (pending) {
        const response = useSessionStore
          .getState()
          .submitDrillCheckpoint(
            "wait",
            "The new public information changes the risk balance; I will wait for confirmation.",
            [...pending.eventIds],
          );
        expect(response.ok).toBe(true);
        answered += 1;
      } else if (useSessionStore.getState().status !== "finished") {
        useSessionStore.getState().play();
      }
      guard += 1;
    }

    expect(guard).toBeLessThan(500);
    expect(answered).toBe(5);
    expect(useSessionStore.getState().report?.practiceAssessment).toMatchObject({
      drillId,
      competencyId: "event-discipline",
      status: "completed",
      answeredCheckpointCount: 5,
      eligibleCheckpointCount: 5,
      eligibleEventCount: 6,
    });
    expect(
      useSessionStore.getState().report?.practiceAssessment?.methodology,
    ).toMatch(/process-only/i);
    const detailedEvidence = useSessionStore.getState().report?.practiceDrill;
    expect(detailedEvidence).toMatchObject({
      definition: { id: drillId, definitionVersion: 1 },
      checkpoints: expect.arrayContaining([
        expect.objectContaining({
          response: expect.objectContaining({
            status: "answered",
            action: "wait",
            linkedEventIds: expect.any(Array),
            reflection:
              "The new public information changes the risk balance; I will wait for confirmation.",
          }),
        }),
      ]),
    });
    expect(detailedEvidence?.checkpoints).toHaveLength(5);
    expect(detailedEvidence?.checkpoints[0].events[0]).not.toHaveProperty(
      "summary",
    );
    expect(detailedEvidence?.checkpoints[0].events[0]).not.toHaveProperty(
      "sourceUrl",
    );
  });
});

describe("sessionStore scenario-authored practice runtime", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSessionStore.getState().selectScenario(defaultScenarioId);
  });

  it("restores a mandatory replay-index-zero checkpoint on every reset", () => {
    const base = makeScenario();
    const indexZeroBase: ScenarioPackage = {
      ...base,
      events: base.events.map((event) =>
        event.id === "evt-2"
          ? {
              ...event,
              happenedAt: "2024-01-01T12:00:00.000Z",
              publishedAt: "2024-01-01T12:00:00.000Z",
            }
          : event,
      ),
    };
    const scenario = authoredPracticeScenario({ baseScenario: indexZeroBase });
    expect(registerUserScenario(scenario)).toMatchObject({ ok: true });

    expect(
      useSessionStore
        .getState()
        .startPractice(AUTHORED_PRACTICE_SCENARIO_ID, AUTHORED_PRACTICE_DRILL_ID),
    ).toEqual({ ok: true });
    const initialCheckpoint = useSessionStore.getState().pendingDrillCheckpoint;
    expect(initialCheckpoint).toMatchObject({ replayIndex: 0 });
    expect(useSessionStore.getState().status).toBe("paused");

    expect(
      useSessionStore
        .getState()
        .submitDrillCheckpoint(
          "wait",
          "The first visible release must be assessed before replay advances.",
          [...initialCheckpoint!.eventIds],
        ),
    ).toEqual({ ok: true });
    expect(useSessionStore.getState().pendingDrillCheckpoint).toBeUndefined();

    useSessionStore.getState().resetScenario();
    expect(useSessionStore.getState()).toMatchObject({
      status: "paused",
      currentIndex: 0,
      pendingDrillCheckpoint: {
        id: initialCheckpoint!.id,
        replayIndex: 0,
      },
      drillCheckpointResponses: [],
    });

    const resetSession = useSessionStore.getState().exportSession();
    useSessionStore.getState().selectScenario(defaultScenarioId);
    expect(useSessionStore.getState().importSession(resetSession)).toEqual({
      ok: true,
    });
    expect(useSessionStore.getState().pendingDrillCheckpoint?.id).toBe(
      initialCheckpoint!.id,
    );
  });

  it("runs, restores, assesses, and resets an authored drill end to end", () => {
    const scenario = authoredPracticeScenario();
    expect(registerUserScenario(scenario)).toMatchObject({ ok: true });
    expect(
      useSessionStore
        .getState()
        .startPractice(AUTHORED_PRACTICE_SCENARIO_ID, AUTHORED_PRACTICE_DRILL_ID),
    ).toEqual({ ok: true });
    expect(useSessionStore.getState()).toMatchObject({
      scenario: { meta: { id: AUTHORED_PRACTICE_SCENARIO_ID } },
      activeDrillId: AUTHORED_PRACTICE_DRILL_ID,
      activeDrillDefinitionVersion: 1,
      mode: "explorer",
    });

    const incomplete = useSessionStore.getState().submitMarketOrder({
      symbol: "TEST",
      side: "buy",
      type: "market",
      quantity: 1,
      decisionPlan: { thesis: "A testable event thesis." },
    });
    expect(incomplete).toMatchObject({ ok: false });
    expect(incomplete.message).toContain("Custom Macro Discipline");
    expect(incomplete.message).not.toContain("Event Discipline");

    const completePlan = {
      thesis: "A testable event thesis.",
      invalidation: "The next public release contradicts the thesis.",
      exitPlan: "Exit at the checkpoint if invalidated.",
      acceptedRisk: "At most one percent of equity.",
    };
    expect(
      useSessionStore.getState().submitMarketOrder({
        symbol: "TEST",
        side: "buy",
        type: "market",
        quantity: 1,
        decisionPlan: completePlan,
      }).ok,
    ).toBe(true);
    useSessionStore.getState().setSpeed("60x");
    let guard = 0;
    while (!useSessionStore.getState().pendingDrillCheckpoint && guard < 20) {
      useSessionStore.getState().play();
      useSessionStore.getState().stepForward();
      guard += 1;
    }
    expect(guard).toBeLessThan(20);
    const pending = useSessionStore.getState().pendingDrillCheckpoint;
    expect(pending).toBeDefined();
    const pendingId = pending!.id;
    const pendingEventIds = [...pending!.eventIds];
    const scenarioDataVersion =
      useSessionStore.getState().scenario.meta.dataVersion;
    expect(scenarioDataVersion).toMatch(/^sha256:[a-f0-9]{64}$/);

    const serialized = useSessionStore.getState().exportSession();
    expect(JSON.parse(serialized)).toMatchObject({
      version: 4,
      scenarioId: AUTHORED_PRACTICE_SCENARIO_ID,
      scenarioDataVersion,
      activeDrillId: AUTHORED_PRACTICE_DRILL_ID,
      activeDrillDefinitionVersion: 1,
      activeDrillIdentity: {
        scenarioDataVersion,
        drillId: AUTHORED_PRACTICE_DRILL_ID,
        competencyId: "authored-macro-discipline",
        definitionVersion: 1,
        rubricVersion: "authored-event-process-v1",
        definitionSnapshot: {
          id: AUTHORED_PRACTICE_DRILL_ID,
          title: "Custom Macro Discipline",
          scenarioId: AUTHORED_PRACTICE_SCENARIO_ID,
        },
      },
      pendingDrillCheckpointId: pendingId,
      initialDrillPlan: completePlan,
    });
    useSessionStore.getState().selectScenario(defaultScenarioId);
    expect(useSessionStore.getState().importSession(serialized)).toEqual({
      ok: true,
    });
    expect(useSessionStore.getState()).toMatchObject({
      activeDrillId: AUTHORED_PRACTICE_DRILL_ID,
      initialDrillPlan: completePlan,
      pendingDrillCheckpoint: { id: pendingId },
    });

    useSessionStore.getState().play();
    expect(useSessionStore.getState().rejectionMessage).toContain(
      "Custom Macro Discipline",
    );
    expect(
      useSessionStore
        .getState()
        .submitDrillCheckpoint(
          "hold",
          "The visible release does not invalidate the documented plan.",
          pendingEventIds,
        ),
    ).toEqual({ ok: true });
    const answeredSerialized = useSessionStore.getState().exportSession();
    expect(
      JSON.parse(answeredSerialized).drillCheckpointResponses[0].linkedEventIds,
    ).toEqual(pendingEventIds);
    useSessionStore.getState().selectScenario(defaultScenarioId);
    const forgedLinkage = JSON.parse(answeredSerialized) as Record<
      string,
      unknown
    >;
    const forgedResponses = forgedLinkage.drillCheckpointResponses as Array<
      Record<string, unknown>
    >;
    forgedResponses[0].linkedEventIds = ["future-or-unrelated-event"];
    const forgedResult = useSessionStore
      .getState()
      .importSession(JSON.stringify(forgedLinkage));
    expect(forgedResult.ok).toBe(false);
    expect(forgedResult.message).toMatch(/inconsistent practice evidence/i);

    expect(
      useSessionStore.getState().importSession(answeredSerialized),
    ).toEqual({ ok: true });
    expect(useSessionStore.getState()).toMatchObject({
      activeDrillId: AUTHORED_PRACTICE_DRILL_ID,
      pendingDrillCheckpoint: undefined,
      drillCheckpointResponses: [
        {
          checkpointId: pendingId,
          drillId: AUTHORED_PRACTICE_DRILL_ID,
          definitionVersion: 1,
          status: "answered",
        },
      ],
    });

    guard = 0;
    while (useSessionStore.getState().status !== "finished" && guard < 20) {
      useSessionStore.getState().play();
      useSessionStore.getState().stepForward();
      guard += 1;
    }
    expect(guard).toBeLessThan(20);
    expect(useSessionStore.getState().report?.practiceAssessment).toMatchObject({
      drillId: AUTHORED_PRACTICE_DRILL_ID,
      competencyId: "authored-macro-discipline",
      definitionVersion: 1,
      rubricVersion: "authored-event-process-v1",
      status: "completed",
      eligibleCheckpointCount: 1,
      answeredCheckpointCount: 1,
      eligibleEventCount: 1,
      linkedEventCount: 1,
    });
    expect(useSessionStore.getState().report?.practiceDrill).toMatchObject({
      definition: {
        id: AUTHORED_PRACTICE_DRILL_ID,
        title: "Custom Macro Discipline",
        rubricVersion: "authored-event-process-v1",
      },
      initialPlan: completePlan,
      checkpoints: [
        {
          checkpoint: { id: pendingId, eventIds: pendingEventIds },
          response: {
            action: "hold",
            linkedEventIds: pendingEventIds,
            reflection:
              "The visible release does not invalidate the documented plan.",
          },
          events: pendingEventIds.map((id) => expect.objectContaining({ id })),
        },
      ],
    });
    expect(
      useSessionStore.getState().report?.practiceDrill?.violations.length,
    ).toBeGreaterThan(0);

    useSessionStore.getState().resetScenario();
    expect(useSessionStore.getState()).toMatchObject({
      scenario: { meta: { id: AUTHORED_PRACTICE_SCENARIO_ID } },
      activeDrillId: AUTHORED_PRACTICE_DRILL_ID,
      activeDrillDefinitionVersion: 1,
      status: "idle",
      drillCheckpointResponses: [],
      drillRuleViolations: [],
    });
    expect(useSessionStore.getState().initialDrillPlan).toBeUndefined();
    expect(useSessionStore.getState().report).toBeUndefined();
  });

  it("enforces an authored drill primary symbol across orders, restore, and assessment", () => {
    const scenario = multiSymbolAuthoredPracticeScenario();
    expect(registerUserScenario(scenario)).toMatchObject({ ok: true });
    expect(
      useSessionStore
        .getState()
        .startPractice(
          MULTI_SYMBOL_PRACTICE_SCENARIO_ID,
          AUTHORED_PRACTICE_DRILL_ID,
        ),
    ).toEqual({ ok: true });
    expect(useSessionStore.getState().primarySymbol).toBe("ALT");
    expect(
      useSessionStore
        .getState()
        .getSnapshot()
        .visibleCandles.every((entry) => entry.symbol === "ALT"),
    ).toBe(true);

    const serialized = useSessionStore.getState().exportSession();
    useSessionStore.getState().selectScenario(defaultScenarioId);
    expect(useSessionStore.getState().importSession(serialized)).toEqual({
      ok: true,
    });
    expect(useSessionStore.getState().primarySymbol).toBe("ALT");

    const completePlan = {
      thesis: "The alternate asset is exposed to the event path.",
      invalidation: "The public release contradicts the thesis.",
      exitPlan: "Exit at the next checkpoint if invalidated.",
      acceptedRisk: "At most one percent of equity.",
    };
    const wrongMarket = useSessionStore.getState().submitMarketOrder({
      symbol: "TEST",
      side: "buy",
      type: "market",
      quantity: 1,
      decisionPlan: completePlan,
    });
    const wrongLimit = useSessionStore.getState().submitLimitOrder({
      symbol: "TEST",
      side: "buy",
      type: "limit",
      quantity: 1,
      limitPrice: 90,
      timeInForce: "gtc",
      decisionPlan: completePlan,
    });
    const wrongPending = useSessionStore.getState().submitPendingOrder({
      symbol: "TEST",
      side: "sell",
      type: "stop_loss",
      quantity: 1,
      triggerPrice: 90,
      decisionPlan: completePlan,
    });
    const wrongBracket = useSessionStore.getState().submitBracketOrder({
      symbol: "TEST",
      side: "sell",
      quantity: 1,
      stopPrice: 90,
      targetPrice: 110,
    });
    for (const result of [
      wrongMarket,
      wrongLimit,
      wrongPending,
      wrongBracket,
    ]) {
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/primary asset \(ALT\)/i);
    }
    expect(useSessionStore.getState()).toMatchObject({
      fills: [],
      orders: [],
      initialDrillPlan: undefined,
    });

    expect(
      useSessionStore.getState().submitMarketOrder({
        symbol: "ALT",
        side: "buy",
        type: "market",
        quantity: 1,
        decisionPlan: completePlan,
      }).ok,
    ).toBe(true);
    let guard = 0;
    while (useSessionStore.getState().status !== "finished" && guard < 30) {
      let stepGuard = 0;
      while (
        !useSessionStore.getState().pendingDrillCheckpoint &&
        useSessionStore.getState().status !== "finished" &&
        stepGuard < 500
      ) {
        useSessionStore.getState().play();
        useSessionStore.getState().stepForward();
        stepGuard += 1;
      }
      expect(stepGuard).toBeLessThan(500);
      if (useSessionStore.getState().pendingDrillCheckpoint) {
        const pendingEventIds = [
          ...useSessionStore.getState().pendingDrillCheckpoint!.eventIds,
        ];
        expect(
          useSessionStore
            .getState()
            .submitDrillCheckpoint(
              "hold",
              "The visible release leaves the alternate-asset plan intact.",
              pendingEventIds,
            ).ok,
        ).toBe(true);
      }
      guard += 1;
    }
    expect(guard).toBeLessThan(30);
    expect(useSessionStore.getState().fills.every((fill) => fill.symbol === "ALT"))
      .toBe(true);
    expect(useSessionStore.getState().report?.practiceAssessment).toMatchObject({
      status: "completed",
      drillId: AUTHORED_PRACTICE_DRILL_ID,
    });
  });

  it("rejects authored practice restore after scenario data or drill content changes", () => {
    const original = authoredPracticeScenario();
    expect(registerUserScenario(original)).toMatchObject({ ok: true });
    expect(
      useSessionStore
        .getState()
        .startPractice(AUTHORED_PRACTICE_SCENARIO_ID, AUTHORED_PRACTICE_DRILL_ID),
    ).toEqual({ ok: true });
    const serialized = useSessionStore.getState().exportSession();

    removeUserScenario(AUTHORED_PRACTICE_SCENARIO_ID);
    const changedData = authoredPracticeScenario();
    changedData.events[0] = {
      ...changedData.events[0],
      summary: `${changedData.events[0].summary} Revised replay evidence.`,
    };
    expect(registerUserScenario(changedData)).toMatchObject({ ok: true });
    const changedDataResult = useSessionStore
      .getState()
      .importSession(serialized);
    expect(changedDataResult.ok).toBe(false);
    expect(changedDataResult.message).toMatch(/different scenario data version/i);

    removeUserScenario(AUTHORED_PRACTICE_SCENARIO_ID);
    const changedDrill = authoredPracticeScenario();
    changedDrill.drills![0] = {
      ...changedDrill.drills![0],
      title: "Custom Macro Discipline — changed without a version bump",
    };
    expect(registerUserScenario(changedDrill)).toMatchObject({ ok: true });
    const changedDrillResult = useSessionStore
      .getState()
      .importSession(serialized);
    expect(changedDrillResult.ok).toBe(false);
    expect(changedDrillResult.message).toMatch(
      /different scenario data version|changed practice drill definition/i,
    );
  });

  it("does not let an authored definition with a built-in id start at runtime", () => {
    const collision = authoredPracticeScenario({
      scenarioId: COLLISION_PRACTICE_SCENARIO_ID,
      drillId: EVENT_DISCIPLINE_EURGBP_V1_ID,
    });
    expect(registerUserScenario(collision)).toMatchObject({ ok: true });

    const result = useSessionStore
      .getState()
      .startPractice(
        COLLISION_PRACTICE_SCENARIO_ID,
        EVENT_DISCIPLINE_EURGBP_V1_ID,
      );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("not available for scenario");
    expect(useSessionStore.getState().activeDrillId).toBeUndefined();
  });
});

describe("sessionStore professional lifecycle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSessionStore.getState().selectScenario(defaultScenarioId);
  });

  it("shares candle liquidity and retries queued market orders on the next candle", () => {
    const scenario = scenarioWithCandles(
      [
        candle(
          "TEST",
          "2024-01-02T14:29:00.000Z",
          "2024-01-02T14:30:00.000Z",
          100,
        ),
        candle(
          "TEST",
          "2024-01-02T14:30:00.000Z",
          "2024-01-02T14:35:00.000Z",
          100,
        ),
      ],
      {
        meta: { initialCash: 10_000, defaultGranularity: "5m" },
        broker: makeBroker({
          commissionRateBps: 0,
          allowFractional: false,
          allowShort: true,
          maxLeverage: 10,
          partialFillPolicy: "volume_limited",
          maxParticipationRate: 0.5,
        }),
      },
    );
    installScenario(scenario);

    expect(
      useSessionStore.getState().submitMarketOrder({
        symbol: "TEST",
        side: "buy",
        type: "market",
        quantity: 8,
        timeInForce: "gtc",
      }).ok,
    ).toBe(true);
    expect(useSessionStore.getState().fills[0].quantity).toBe(5);
    expect(useSessionStore.getState().orders[0].status).toBe("partially_filled");

    const second = useSessionStore.getState().submitMarketOrder({
      symbol: "TEST",
      side: "buy",
      type: "market",
      quantity: 2,
    });
    expect(second.ok).toBe(true);
    expect(useSessionStore.getState().orders[1].status).toBe("pending");
    expect(useSessionStore.getState().rejectionMessage).toBeUndefined();
    expect(
      useSessionStore
        .getState()
        .auditEvents.some((event) => event.type === "order_rejected"),
    ).toBe(false);
    expect(
      useSessionStore.getState().fills.reduce((sum, fill) => sum + fill.quantity, 0),
    ).toBe(5);

    useSessionStore.getState().stepForward();
    const completed = useSessionStore.getState();
    expect(completed.orders[0].status).toBe("filled");
    expect(completed.orders[0].filledQuantity).toBe(8);
    expect(completed.orders[1].status).toBe("filled");
    expect(
      completed.fills.reduce((sum, fill) => sum + fill.quantity, 0),
    ).toBe(10);
  });

  it("keeps a zero-liquidity GTC market order working until a later candle", () => {
    const scenario = scenarioWithCandles(
      [
        candle(
          "TEST",
          "2024-01-02T14:00:00.000Z",
          "2024-01-02T14:30:00.000Z",
          100,
          { volume: 0 },
        ),
        candle(
          "TEST",
          "2024-01-02T14:30:00.000Z",
          "2024-01-02T15:00:00.000Z",
          100,
          { volume: 10 },
        ),
      ],
      {
        broker: makeBroker({
          commissionRateBps: 0,
          allowFractional: false,
          partialFillPolicy: "volume_limited",
          maxParticipationRate: 1,
        }),
      },
    );
    installScenario(scenario);

    const submitted = useSessionStore.getState().submitMarketOrder({
      symbol: "TEST",
      side: "buy",
      type: "market",
      quantity: 1,
      timeInForce: "gtc",
    });
    const queued = useSessionStore.getState();
    expect(submitted.ok).toBe(true);
    expect(queued.orders[0].status).toBe("pending");
    expect(queued.fills).toHaveLength(0);
    expect(queued.rejectionMessage).toBeUndefined();
    expect(
      queued.auditEvents.some((event) => event.type === "order_rejected"),
    ).toBe(false);

    useSessionStore.getState().stepForward();
    const completed = useSessionStore.getState();
    expect(completed.orders[0].status).toBe("filled");
    expect(completed.fills[0].time).toBe("2024-01-02T15:00:00.000Z");
  });

  it("rejects volume-limited orders when the replay has no usable volume", () => {
    const scenario = scenarioWithCandles(
      [
        candle(
          "TEST",
          "2024-01-02T14:00:00.000Z",
          "2024-01-02T14:30:00.000Z",
          100,
          { volume: 0 },
        ),
        candle(
          "TEST",
          "2024-01-02T14:30:00.000Z",
          "2024-01-02T15:00:00.000Z",
          100,
          { volume: 0 },
        ),
      ],
      {
        broker: makeBroker({
          partialFillPolicy: "volume_limited",
          maxParticipationRate: 1,
        }),
      },
    );
    installScenario(scenario);

    const result = useSessionStore.getState().submitMarketOrder({
      symbol: "TEST",
      side: "buy",
      type: "market",
      quantity: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no volume data/i);
    expect(useSessionStore.getState().orders).toHaveLength(0);
  });

  it("keeps a triggered GTC stop working through a zero-volume candle", () => {
    const scenario = scenarioWithCandles(
      [
        candle(
          "TEST",
          "2024-01-02T14:00:00.000Z",
          "2024-01-02T14:30:00.000Z",
          100,
          { volume: 10 },
        ),
        candle(
          "TEST",
          "2024-01-02T14:30:00.000Z",
          "2024-01-02T15:00:00.000Z",
          95,
          { high: 101, low: 94, volume: 0 },
        ),
        candle(
          "TEST",
          "2024-01-02T15:00:00.000Z",
          "2024-01-02T15:30:00.000Z",
          105,
          { high: 106, low: 100, volume: 10 },
        ),
      ],
      {
        broker: makeBroker({
          commissionRateBps: 0,
          allowFractional: false,
          partialFillPolicy: "volume_limited",
          maxParticipationRate: 1,
        }),
      },
    );
    installScenario(scenario);
    expect(
      useSessionStore.getState().submitMarketOrder({
        symbol: "TEST",
        side: "buy",
        type: "market",
        quantity: 1,
      }).ok,
    ).toBe(true);
    expect(
      useSessionStore.getState().submitPendingOrder({
        symbol: "TEST",
        side: "sell",
        type: "stop_loss",
        quantity: 1,
        triggerPrice: 95,
        timeInForce: "gtc",
      }).ok,
    ).toBe(true);

    useSessionStore.getState().stepForward();
    const deferred = useSessionStore.getState();
    expect(deferred.orders[1].status).toBe("pending");
    expect(deferred.orders[1].triggeredAt).toBe(
      "2024-01-02T15:00:00.000Z",
    );
    expect(deferred.rejectionMessage).toBeUndefined();
    expect(
      deferred.auditEvents.some((event) => event.type === "order_rejected"),
    ).toBe(false);

    useSessionStore.getState().stepForward();
    const completed = useSessionStore.getState();
    expect(completed.orders[1].status).toBe("filled");
    expect(completed.fills[1].time).toBe("2024-01-02T15:30:00.000Z");
  });

  it("continues past the primary tail on the all-symbol replay timeline", () => {
    installScenario(multiSymbolTailScenario());
    expect(useSessionStore.getState().primaryCandlesLength).toBe(5);
    expect(
      useSessionStore.getState().submitLimitOrder({
        symbol: "Y",
        side: "buy",
        type: "limit",
        quantity: 1,
        limitPrice: 85,
        timeInForce: "gtc",
      }).ok,
    ).toBe(true);

    useSessionStore.getState().stepForward();
    let state = useSessionStore.getState();
    expect(state.getSnapshot().currentTime).toBe("2024-01-01T11:00:00.000Z");
    expect(state.getSnapshot().visibleCandles.map((entry) => entry.symbol)).toEqual([
      "X",
    ]);

    useSessionStore.getState().stepForward();
    state = useSessionStore.getState();
    expect(state.getSnapshot().currentTime).toBe("2024-01-01T12:00:00.000Z");
    expect(state.status).not.toBe("finished");
    expect(state.currentIndex).toBe(2);

    useSessionStore.getState().stepForward();
    state = useSessionStore.getState();
    expect(state.fills).toHaveLength(1);
    expect(state.fills[0].symbol).toBe("Y");
    expect(state.fills[0].time).toBe("2024-01-01T13:00:00.000Z");

    useSessionStore.getState().stepForward();
    state = useSessionStore.getState();
    expect(state.status).toBe("finished");
    expect(state.currentIndex).toBe(4);
    expect(state.getSnapshot().currentTime).toBe("2024-01-01T14:00:00.000Z");
    expect(
      state.getSnapshot().visibleCandles.every((entry) => entry.symbol === "X"),
    ).toBe(true);
  });

  it("finish processes secondary tail candles through the declared end", () => {
    installScenario(multiSymbolTailScenario());
    expect(
      useSessionStore.getState().submitLimitOrder({
        symbol: "Y",
        side: "buy",
        type: "limit",
        quantity: 1,
        limitPrice: 85,
        timeInForce: "gtc",
      }).ok,
    ).toBe(true);

    useSessionStore.getState().finish();
    const state = useSessionStore.getState();
    expect(state.status).toBe("finished");
    expect(state.currentIndex).toBe(4);
    expect(state.getSnapshot().currentTime).toBe("2024-01-01T14:00:00.000Z");
    expect(state.fills).toHaveLength(1);
    expect(state.fills[0].time).toBe("2024-01-01T13:00:00.000Z");
  });

  it("executes secondary-symbol orders at their own candle timestamps", () => {
    const scenario = scenarioWithCandles([
      candle(
        "X",
        "2024-01-01T09:00:00.000Z",
        "2024-01-01T10:00:00.000Z",
        100,
      ),
      candle(
        "Y",
        "2024-01-01T09:00:00.000Z",
        "2024-01-01T10:00:00.000Z",
        100,
      ),
      candle(
        "Y",
        "2024-01-01T10:00:00.000Z",
        "2024-01-01T11:00:00.000Z",
        96,
        { low: 94, high: 101 },
      ),
      candle(
        "X",
        "2024-01-01T10:00:00.000Z",
        "2024-01-01T12:00:00.000Z",
        101,
      ),
    ]);
    installScenario(scenario);

    expect(
      useSessionStore.getState().submitLimitOrder({
        symbol: "Y",
        side: "buy",
        type: "limit",
        quantity: 1,
        limitPrice: 95,
        timeInForce: "gtc",
      }).ok,
    ).toBe(true);
    useSessionStore.getState().stepForward();

    const state = useSessionStore.getState();
    expect(state.fills).toHaveLength(1);
    expect(state.fills[0].symbol).toBe("Y");
    expect(state.fills[0].time).toBe("2024-01-01T11:00:00.000Z");
  });

  it("charges a triggered short only for time held after its fill", () => {
    const scenario = scenarioWithCandles(
      [
        candle(
          "TEST",
          "2024-01-01T00:00:00.000Z",
          "2024-01-01T23:59:59.000Z",
          100,
        ),
        candle(
          "TEST",
          "2024-01-02T00:00:00.000Z",
          "2024-01-02T23:59:59.000Z",
          100,
        ),
        candle(
          "TEST",
          "2024-01-03T00:00:00.000Z",
          "2024-01-03T23:59:59.000Z",
          100,
        ),
      ],
      {
        broker: makeBroker({
          commissionRateBps: 0,
          allowShort: true,
          maxLeverage: 2,
          borrowRateBps: 10_000,
        }),
      },
    );
    installScenario(scenario);
    useSessionStore.getState().setSpeed("20x");
    expect(
      useSessionStore.getState().submitLimitOrder({
        symbol: "TEST",
        side: "sell",
        type: "limit",
        quantity: 1,
        limitPrice: 100,
        timeInForce: "gtc",
      }).ok,
    ).toBe(true);

    useSessionStore.getState().stepForward();
    const state = useSessionStore.getState();
    expect(state.financingCosts).toHaveLength(1);
    expect(state.financingCosts[0].time).toBe("2024-01-03T23:59:59.000Z");
    expect(state.financingCosts[0].amount).toBeCloseTo(100 / 365, 5);
  });

  it("stops high-speed Explorer playback at the first major published event", () => {
    const scenario = makeScenario();
    installScenario(scenario);
    useSessionStore.getState().setSpeed("60x");
    useSessionStore.getState().play();

    useSessionStore.getState().stepForward();

    const state = useSessionStore.getState();
    expect(state.currentIndex).toBe(4);
    expect(state.status).toBe("paused");
    expect(state.majorEventPauseNotice).toMatchObject({
      eventId: "evt-2",
      title: "Future event",
    });
    expect(
      state.getSnapshot().visibleEvents.map((event) => event.id),
    ).toContain("evt-2");

    state.finish();
    expect(useSessionStore.getState()).toMatchObject({
      status: "finished",
      majorEventPauseNotice: undefined,
    });
  });

  it("keeps high-speed playback moving when major-event pause is disabled", () => {
    const scenario = makeScenario();
    installScenario(scenario);
    useSessionStore.getState().setPauseOnMajorEvents(false);
    useSessionStore.getState().setSpeed("60x");
    useSessionStore.getState().play();

    useSessionStore.getState().stepForward();

    expect(useSessionStore.getState()).toMatchObject({
      currentIndex: 5,
      status: "playing",
      majorEventPauseNotice: undefined,
    });
  });

  it("applies raw splits and dividends to positions and working orders", () => {
    const scenario = scenarioWithCandles(
      [
        candle(
          "TEST",
          "2024-01-02T14:00:00.000Z",
          "2024-01-02T14:30:00.000Z",
          100,
        ),
        candle(
          "TEST",
          "2024-01-02T14:30:00.000Z",
          "2024-01-02T15:00:00.000Z",
          50,
          { high: 55, low: 48 },
        ),
      ],
      {
        corporateActions: [
          {
            symbol: "TEST",
            type: "split",
            effectiveAt: "2024-01-02T15:00:00.000Z",
            ratio: 2,
          },
          {
            symbol: "TEST",
            type: "dividend",
            effectiveAt: "2024-01-02T15:00:00.000Z",
            amount: 1,
            currency: "USD",
          },
        ],
      },
    );
    installScenario(scenario);
    expect(
      useSessionStore.getState().submitMarketOrder({
        symbol: "TEST",
        side: "buy",
        type: "market",
        quantity: 1,
      }).ok,
    ).toBe(true);
    expect(
      useSessionStore.getState().submitLimitOrder({
        symbol: "TEST",
        side: "sell",
        type: "limit",
        quantity: 1,
        limitPrice: 120,
        timeInForce: "gtc",
      }).ok,
    ).toBe(true);

    useSessionStore.getState().stepForward();
    const state = useSessionStore.getState();
    expect(state.portfolio.positions.TEST.quantity).toBe(2);
    expect(state.portfolio.positions.TEST.averagePrice).toBe(50);
    expect(state.portfolio.cash).toBe(902);
    expect(state.orders[1].quantity).toBe(2);
    expect(state.orders[1].limitPrice).toBe(60);
    expect(state.auditEvents.some((event) => event.type === "corporate_action")).toBe(true);
  });

  it("enforces market hours in the calendar timezone", () => {
    const calendar = {
      id: "nyse-test",
      timezone: "America/New_York",
      sessions: [
        { dayOfWeek: 1 as const, open: "09:30", close: "16:00" },
      ],
    };
    const openScenario = scenarioWithCandles(
      [
        candle(
          "TEST",
          "2024-07-01T13:29:00.000Z",
          "2024-07-01T13:30:00.000Z",
          100,
        ),
      ],
      {
        broker: makeBroker({ marketHoursEnforced: true }),
        marketCalendar: calendar,
      },
    );
    installScenario(openScenario);
    expect(
      useSessionStore.getState().submitMarketOrder({
        symbol: "TEST",
        side: "buy",
        type: "market",
        quantity: 1,
      }).ok,
    ).toBe(true);

    const closedScenario = scenarioWithCandles(
      [
        candle(
          "TEST",
          "2024-07-01T20:29:00.000Z",
          "2024-07-01T20:30:00.000Z",
          100,
        ),
      ],
      {
        broker: makeBroker({ marketHoursEnforced: true }),
        marketCalendar: calendar,
      },
    );
    installScenario(closedScenario);
    const closed = useSessionStore.getState().submitMarketOrder({
      symbol: "TEST",
      side: "buy",
      type: "market",
      quantity: 1,
    });
    expect(closed.ok).toBe(false);
    expect(closed.message).toBe("Market closed");
  });

  it("blocks only risk-increasing orders under reject-new-orders policy", () => {
    const scenario = scenarioWithCandles([
      candle(
        "TEST",
        "2024-01-02T14:00:00.000Z",
        "2024-01-02T14:30:00.000Z",
        100,
      ),
      candle(
        "TEST",
        "2024-01-02T14:30:00.000Z",
        "2024-01-02T15:00:00.000Z",
        100,
      ),
    ], {
      broker: makeBroker({
        allowShort: true,
        maxLeverage: 4,
        marginCallPolicy: "reject_new_orders",
      }),
    });
    installScenario(scenario);
    useSessionStore.setState({
      portfolio: {
        cash: -88.5,
        realizedPnl: 0,
        feesPaid: 0,
        slippagePaid: 0,
        financingPaid: 0,
        positions: {
          TEST: {
            symbol: "TEST",
            quantity: 1,
            averagePrice: 100,
            marketPrice: 100,
            marketValue: 100,
            unrealizedPnl: 0,
            realizedPnl: 0,
          },
        },
      },
    });

    const increase = useSessionStore.getState().submitMarketOrder({
      symbol: "TEST",
      side: "buy",
      type: "market",
      quantity: 0.1,
    });
    expect(increase.ok).toBe(false);
    expect(increase.message).toContain("only risk-reducing");

    const reduce = useSessionStore.getState().submitMarketOrder({
      symbol: "TEST",
      side: "sell",
      type: "market",
      quantity: 1,
    });
    expect(reduce.ok).toBe(true);
    expect(useSessionStore.getState().portfolio.positions.TEST.quantity).toBe(0);
  });

  it("cancels working orders before forced liquidation", () => {
    const scenario = scenarioWithCandles([
      candle(
        "TEST",
        "2024-01-02T14:00:00.000Z",
        "2024-01-02T14:30:00.000Z",
        100,
      ),
      candle(
        "TEST",
        "2024-01-02T14:30:00.000Z",
        "2024-01-02T15:00:00.000Z",
        100,
      ),
    ], {
      broker: makeBroker({
        allowShort: true,
        maxLeverage: 4,
        marginCallPolicy: "liquidate_on_threshold",
      }),
    });
    installScenario(scenario);
    const pending: Order = {
      id: "pending-after-margin",
      createdAt: scenario.meta.startTime,
      symbol: "TEST",
      side: "sell",
      type: "stop_loss",
      quantity: 1,
      triggerPrice: 10,
      remainingQuantity: 1,
      status: "pending",
      timeInForce: "gtc",
    };
    useSessionStore.setState({
      orders: [pending],
      portfolio: {
        cash: -98,
        realizedPnl: 0,
        feesPaid: 0,
        slippagePaid: 0,
        financingPaid: 0,
        positions: {
          TEST: {
            symbol: "TEST",
            quantity: 1,
            averagePrice: 100,
            marketPrice: 100,
            marketValue: 100,
            unrealizedPnl: 0,
            realizedPnl: 0,
          },
        },
      },
    });

    useSessionStore.getState().stepForward();
    const state = useSessionStore.getState();
    expect(state.orders.find((order) => order.id === pending.id)?.status).toBe(
      "cancelled",
    );
    expect(state.portfolio.positions.TEST.quantity).toBe(0);
  });

  it("expires unresolved GTC orders when the scenario finishes", () => {
    const state = useSessionStore.getState();
    const symbol = state.primarySymbol;
    expect(
      state.submitLimitOrder({
        symbol,
        side: "buy",
        type: "limit",
        quantity: 0.01,
        limitPrice: 0.000001,
        timeInForce: "gtc",
      }).ok,
    ).toBe(true);
    useSessionStore.getState().finish();
    const order = useSessionStore.getState().orders[0];
    expect(order.status).toBe("expired");
    expect(order.closedAt).toBeTruthy();
  });

  it("exports, restores, and automatically persists a versioned session", () => {
    const originalRunInstanceId = useSessionStore.getState().runInstanceId;
    useSessionStore.getState().addJournalNote("Preserve this decision.");
    const serialized = useSessionStore.getState().exportSession();
    expect(JSON.parse(serialized)).toMatchObject({
      version: 4,
      scenarioDataVersion: useSessionStore.getState().scenario.meta.dataVersion,
      brokerFingerprint: brokerConfigFingerprint(
        useSessionStore.getState().broker,
      ),
    });
    expect(JSON.parse(serialized).runInstanceId).toBe(originalRunInstanceId);
    expect(window.localStorage.getItem("market-time-machine.session.v2")).toBeTruthy();

    useSessionStore.getState().resetScenario();
    expect(useSessionStore.getState().journal).toHaveLength(0);
    expect(useSessionStore.getState().runInstanceId).not.toBe(
      originalRunInstanceId,
    );
    const restored = useSessionStore.getState().importSession(serialized);
    expect(restored.ok).toBe(true);
    expect(useSessionStore.getState().runInstanceId).toBe(originalRunInstanceId);
    expect(useSessionStore.getState().journal[0].note).toBe(
      "Preserve this decision.",
    );
    expect(
      useSessionStore.getState().auditEvents.at(-1)?.type,
    ).toBe("session_restored");
  });

  it("bounds journal text consistently with the persisted session contract", () => {
    useSessionStore
      .getState()
      .addJournalNote(` ${"x".repeat(SESSION_TEXT_MAX_LENGTH + 50)} `);
    expect(useSessionStore.getState().journal[0].note).toHaveLength(
      SESSION_TEXT_MAX_LENGTH,
    );
    expect(useSessionStore.getState().importSession(
      useSessionStore.getState().exportSession(),
    ).ok).toBe(true);
  });

  it("rejects a forged finished session before the final replay candle", () => {
    const payload = JSON.parse(useSessionStore.getState().exportSession()) as {
      status: string;
      currentIndex: number;
    };
    payload.status = "finished";
    payload.currentIndex = 0;

    const restored = useSessionStore
      .getState()
      .importSession(JSON.stringify(payload));
    expect(restored.ok).toBe(false);
    expect(restored.message).toMatch(/final replay candle/i);
  });

  it("stops autosave when another tab changed the same replay", () => {
    const before = window.localStorage.getItem(SESSION_STORAGE_KEY);
    expect(before).not.toBeNull();
    const external = JSON.parse(before!) as Record<string, unknown>;
    external.pauseOnMajorEvents = !external.pauseOnMajorEvents;
    const externalBytes = JSON.stringify(external);
    window.localStorage.setItem(SESSION_STORAGE_KEY, externalBytes);

    useSessionStore.getState().addJournalNote("Keep this tab's version.");

    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBe(externalBytes);
    expect(useSessionStore.getState().persistenceHealth).toMatchObject({
      kind: "error",
      operation: "conflict",
    });
  });

  it("normalizes percent volatility indicators before execution slippage", () => {
    const scenario = scenarioWithCandles(
      [
        candle(
          "TEST",
          "2024-01-02T14:00:00.000Z",
          "2024-01-02T14:30:00.000Z",
          100,
        ),
      ],
      {
        broker: makeBroker({
          commissionRateBps: 0,
          spreadBps: 0,
          slippageModel: "volatility_based",
          slippageBps: 1,
        }),
      },
    );
    scenario.indicators = [
      {
        symbol: "TEST",
        name: "Realized volatility",
        time: scenario.meta.startTime,
        availableAt: scenario.meta.startTime,
        value: 20,
        parameters: { unit: "percent" },
      },
    ];
    installScenario(scenario);

    expect(
      useSessionStore.getState().submitMarketOrder({
        symbol: "TEST",
        side: "buy",
        type: "market",
        quantity: 1,
      }).ok,
    ).toBe(true);
    expect(useSessionStore.getState().fills[0].slippage).toBeCloseTo(0.21, 8);
  });

  it("reports whether browser session deletion was actually confirmed", () => {
    window.localStorage.setItem(LEGACY_SESSION_STORAGE_KEY, "legacy");
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();

    expect(useSessionStore.getState().clearSavedSession()).toEqual({ ok: true });
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_SESSION_STORAGE_KEY)).toBeNull();

    window.localStorage.setItem(SESSION_STORAGE_KEY, "still-present");
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
      const failed = useSessionStore.getState().clearSavedSession();
      expect(failed.ok).toBe(false);
      expect(failed.message).toMatch(/could not be cleared: storage denied/i);
      expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBe(
        "still-present",
      );
    } finally {
      removeItem.mockRestore();
    }
  });

  it("returns actionable save health when startup storage is unreadable or invalid", () => {
    const unreadable = loadInitialSessionState({
      getItem: () => {
        throw new Error("privacy denied");
      },
    });
    expect(unreadable.persistenceHealth).toMatchObject({
      kind: "error",
      operation: "read",
    });
    expect(unreadable.persistenceHealth?.message).toMatch(
      /could not be read.*export the active session or restore a backup/i,
    );

    const invalid = loadInitialSessionState({
      getItem: (key: string) =>
        key === SESSION_STORAGE_KEY ? "{not valid JSON" : null,
    });
    expect(invalid.persistenceHealth).toMatchObject({
      kind: "error",
      operation: "restore",
    });
    expect(invalid.persistenceHealth?.message).toMatch(
      /could not be restored.*restore a known-good backup or clear the damaged browser save/i,
    );
    expect(invalid.rejectionMessage).toMatch(/saved session was not restored/i);
  });

  it("preserves a damaged startup save until the user explicitly clears or restores it", () => {
    const damaged = "{damaged session";
    window.localStorage.setItem(SESSION_STORAGE_KEY, damaged);
    useSessionStore.setState({
      persistenceHealth: {
        kind: "error",
        operation: "restore",
        message: "Damaged startup save requires recovery.",
      },
    });

    useSessionStore.getState().addJournalNote("Keep this only in memory.");
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBe(damaged);

    expect(useSessionStore.getState().clearSavedSession()).toEqual({ ok: true });
    useSessionStore.getState().addJournalNote("Persistence is safe again.");
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBe(damaged);
    expect(useSessionStore.getState().persistenceHealth).toBeUndefined();
  });

  it("rejects a former unversioned BTC session after a replay-visible event correction", () => {
    useSessionStore.getState().selectScenario("btc-2020-2021");
    const legacy = JSON.parse(
      useSessionStore.getState().exportSession(),
    ) as Record<string, unknown>;
    legacy.version = 3;
    delete legacy.brokerFingerprint;
    legacy.scenarioDataVersion = null;

    useSessionStore.getState().selectScenario(defaultScenarioId);
    const result = useSessionStore
      .getState()
      .importSession(JSON.stringify(legacy));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/missing or different scenario data version/i);
    expect(useSessionStore.getState().scenario.meta.id).toBe(defaultScenarioId);
  });

  it("restores an ordinary v3 session across a reviewed data-version migration", () => {
    const legacy = JSON.parse(
      useSessionStore.getState().exportSession(),
    ) as Record<string, unknown>;
    legacy.version = 3;
    legacy.scenarioDataVersion = LEGACY_EURGBP_BREXIT_2016_DATA_VERSION;
    delete legacy.brokerFingerprint;

    useSessionStore.getState().selectScenario("btc-2020-2021");
    expect(
      useSessionStore.getState().importSession(JSON.stringify(legacy)),
    ).toEqual({ ok: true });
    expect(useSessionStore.getState().scenario.meta).toMatchObject({
      id: defaultScenarioId,
      dataVersion: EURGBP_BREXIT_2016_DATA_VERSION,
    });
  });

  it("rejects an ordinary v3 session whose serialized broker has drifted", () => {
    const legacy = JSON.parse(
      useSessionStore.getState().exportSession(),
    ) as Record<string, unknown>;
    legacy.version = 3;
    delete legacy.brokerFingerprint;
    legacy.broker = {
      ...(legacy.broker as Record<string, unknown>),
      spreadBps: Number(
        (legacy.broker as Record<string, unknown>).spreadBps,
      ) + 1,
    };

    const restored = useSessionStore
      .getState()
      .importSession(JSON.stringify(legacy));

    expect(restored.ok).toBe(false);
    expect(restored.message).toMatch(/changed broker execution settings/i);
  });

  it.each(["professional", "blind", "challenge"] as const)(
    "rejects a v4 %s session whose scenario broker is mislabeled as a preset",
    (mode) => {
      const mislabeled = JSON.parse(
        useSessionStore.getState().exportSession(),
      ) as Record<string, unknown>;
      mislabeled.mode = mode;
      mislabeled.brokerMode = "ideal";

      const restored = useSessionStore
        .getState()
        .importSession(JSON.stringify(mislabeled));

      expect(restored.ok).toBe(false);
      expect(restored.message).toMatch(/changed broker execution settings/i);
    },
  );

  it("migrates version-1 sessions to a stable legacy run identity", () => {
    const legacy = JSON.parse(useSessionStore.getState().exportSession()) as Record<
      string,
      unknown
    >;
    legacy.version = 1;
    delete legacy.runInstanceId;
    const serialized = JSON.stringify(legacy);

    expect(useSessionStore.getState().importSession(serialized).ok).toBe(true);
    const firstIdentity = useSessionStore.getState().runInstanceId;
    expect(firstIdentity).toMatch(/^legacy_/);
    expect(JSON.parse(useSessionStore.getState().exportSession()).version).toBe(4);

    useSessionStore.getState().resetScenario();
    expect(useSessionStore.getState().importSession(serialized).ok).toBe(true);
    expect(useSessionStore.getState().runInstanceId).toBe(firstIdentity);
  });

  it.each([1, 2])(
    "only migrates an ordinary version-%s session when versioned scenario data matches",
    (version) => {
      useSessionStore
        .getState()
        .addJournalNote(`Version ${version} ordinary replay.`);
      const matching = JSON.parse(
        useSessionStore.getState().exportSession(),
      ) as Record<string, unknown>;
      matching.version = version;
      delete matching.activeDrillIdentity;
      if (version === 1) delete matching.runInstanceId;

      useSessionStore.getState().resetScenario();
      expect(
        useSessionStore.getState().importSession(JSON.stringify(matching)).ok,
      ).toBe(true);
      expect(useSessionStore.getState().journal).toEqual([
        expect.objectContaining({ note: `Version ${version} ordinary replay.` }),
      ]);

      const missing = { ...matching };
      delete missing.scenarioDataVersion;
      const missingResult = useSessionStore
        .getState()
        .importSession(JSON.stringify(missing));
      expect(missingResult.ok).toBe(false);
      expect(missingResult.message).toMatch(/missing or different scenario data version/i);

      const mismatched = {
        ...matching,
        scenarioDataVersion: "different-data-version",
      };
      const mismatchedResult = useSessionStore
        .getState()
        .importSession(JSON.stringify(mismatched));
      expect(mismatchedResult.ok).toBe(false);
      expect(mismatchedResult.message).toMatch(
        /missing or different scenario data version/i,
      );
    },
  );

  it("rejects an unversioned imported scenario before it can produce an ambiguous legacy session", () => {
    const base = makeScenario();
    const unversionedScenario: ScenarioPackage = {
      ...base,
      meta: {
        ...base.meta,
        id: UNVERSIONED_RESTORE_SCENARIO_ID,
        title: "Unversioned restore test",
        dataVersion: undefined,
      },
    };
    const result = registerUserScenario(unversionedScenario);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/dataVersion/i);
    expect(() =>
      useSessionStore.getState().selectScenario(UNVERSIONED_RESTORE_SCENARIO_ID),
    ).toThrow(/scenario not found/i);
  });

  it("persists major-event pause and defaults legacy Explorer sessions on", () => {
    useSessionStore.getState().setPauseOnMajorEvents(false);
    const serialized = useSessionStore.getState().exportSession();
    expect(JSON.parse(serialized).pauseOnMajorEvents).toBe(false);

    useSessionStore.getState().resetScenario();
    expect(useSessionStore.getState().importSession(serialized).ok).toBe(true);
    expect(useSessionStore.getState().pauseOnMajorEvents).toBe(false);

    const legacy = JSON.parse(serialized) as Record<string, unknown>;
    delete legacy.pauseOnMajorEvents;
    expect(
      useSessionStore.getState().importSession(JSON.stringify(legacy)).ok,
    ).toBe(true);
    expect(useSessionStore.getState().pauseOnMajorEvents).toBe(true);
  });

  it("round-trips structured decision plans while keeping legacy note sessions valid", () => {
    const state = useSessionStore.getState();
    const decisionPlan = {
      thesis: "A testable recovery thesis.",
      invalidation: "A close below the visible low.",
      exitPlan: "Exit after the target or invalidation.",
      acceptedRisk: "1% of equity",
      linkedEventIds: [] as string[],
    };
    expect(
      state.submitMarketOrder({
        symbol: state.primarySymbol,
        side: "buy",
        type: "market",
        quantity: 0.05,
        note: decisionPlan.thesis,
        decisionPlan,
      }).ok,
    ).toBe(true);
    const serialized = useSessionStore.getState().exportSession();

    useSessionStore.getState().resetScenario();
    expect(useSessionStore.getState().importSession(serialized).ok).toBe(true);
    expect(useSessionStore.getState().orders[0].decisionPlan).toEqual(decisionPlan);
    expect(useSessionStore.getState().fills[0].decisionPlan).toEqual(decisionPlan);
    expect(useSessionStore.getState().journal[0].decisionPlan).toEqual({
      ...decisionPlan,
      linkedEventIds: undefined,
    });
  });

  it("rejects malformed records instead of installing unsafe session data", () => {
    const payload = JSON.parse(useSessionStore.getState().exportSession()) as {
      fills: unknown[];
    };
    payload.fills = [null];

    const restored = useSessionStore
      .getState()
      .importSession(JSON.stringify(payload));

    expect(restored.ok).toBe(false);
    expect(restored.message).toContain("malformed history records");
    expect(useSessionStore.getState().fills).toHaveLength(0);
  });

  it("recomputes finished reports and portfolios instead of trusting exported snapshots", () => {
    const state = useSessionStore.getState();
    expect(
      state.submitMarketOrder({
        symbol: state.primarySymbol,
        side: "buy",
        type: "market",
        quantity: 0.01,
      }).ok,
    ).toBe(true);
    useSessionStore.getState().finish();
    const expectedEquity = useSessionStore
      .getState()
      .getSnapshot().portfolio.totalValue;
    const payload = JSON.parse(useSessionStore.getState().exportSession()) as {
      portfolio: { cash: number };
      report: unknown;
    };
    payload.portfolio.cash = 9_999_999_999;
    payload.report = {};

    useSessionStore.getState().resetScenario();
    const restored = useSessionStore
      .getState()
      .importSession(JSON.stringify(payload));

    expect(restored.ok).toBe(true);
    const restoredState = useSessionStore.getState();
    expect(restoredState.getSnapshot().portfolio.totalValue).toBeCloseTo(
      expectedEquity,
      8,
    );
    expect(restoredState.report?.metrics.finalEquity).toBeCloseTo(
      expectedEquity,
      8,
    );
  });

  it("locks skip-to-end and broker changes in challenge mode", () => {
    const scenario = scenarioWithCandles([
      candle(
        "TEST",
        "2024-01-02T14:00:00.000Z",
        "2024-01-02T14:30:00.000Z",
        100,
      ),
      candle(
        "TEST",
        "2024-01-02T14:30:00.000Z",
        "2024-01-02T15:00:00.000Z",
        101,
      ),
    ]);
    installScenario(scenario);
    useSessionStore.getState().setScenarioMode("challenge");
    useSessionStore.getState().setBrokerMode("ideal");
    expect(useSessionStore.getState().brokerMode).toBe("scenario");
    useSessionStore.getState().finish();
    expect(useSessionStore.getState().status).not.toBe("finished");
    expect(useSessionStore.getState().rejectionMessage).toContain(
      "Skip to end is disabled",
    );
  });

  it("allows a partially filled order remainder to be cancelled", () => {
    const state = useSessionStore.getState();
    const now = state.getSnapshot().currentTime;
    const partial: Order = {
      id: "partial-market",
      createdAt: now,
      symbol: state.primarySymbol,
      side: "buy",
      type: "market",
      quantity: 2,
      filledQuantity: 1,
      remainingQuantity: 1,
      averageFillPrice: 100,
      timeInForce: "gtc",
      status: "partially_filled",
    };
    useSessionStore.setState({ orders: [partial] });
    expect(useSessionStore.getState().cancelOrder(partial.id).ok).toBe(true);
    expect(useSessionStore.getState().orders[0].status).toBe("cancelled");
    expect(useSessionStore.getState().orders[0].closedAt).toBe(now);
  });

  it("locks broker configuration as soon as an order is accepted", () => {
    const state = useSessionStore.getState();
    expect(
      state.submitLimitOrder({
        symbol: state.primarySymbol,
        side: "buy",
        type: "limit",
        quantity: 0.01,
        limitPrice: 0.000001,
        timeInForce: "gtc",
      }).ok,
    ).toBe(true);
    useSessionStore.getState().setBrokerMode("ideal");
    expect(useSessionStore.getState().brokerMode).toBe("scenario");
    expect(useSessionStore.getState().rejectionMessage).toContain(
      "first accepted order",
    );
  });

  it("records one margin-call transition rather than one event per candle", () => {
    const scenario = scenarioWithCandles(
      [
        candle(
          "TEST",
          "2024-01-01T00:00:00.000Z",
          "2024-01-01T23:59:59.000Z",
          100,
        ),
        candle(
          "TEST",
          "2024-01-02T00:00:00.000Z",
          "2024-01-02T23:59:59.000Z",
          100,
        ),
        candle(
          "TEST",
          "2024-01-03T00:00:00.000Z",
          "2024-01-03T23:59:59.000Z",
          100,
        ),
      ],
      {
        broker: makeBroker({
          allowShort: true,
          maxLeverage: 4,
          marginCallPolicy: "reject_new_orders",
        }),
      },
    );
    installScenario(scenario);
    useSessionStore.setState({
      portfolio: {
        cash: -88.5,
        realizedPnl: 0,
        feesPaid: 0,
        slippagePaid: 0,
        financingPaid: 0,
        positions: {
          TEST: {
            symbol: "TEST",
            quantity: 1,
            averagePrice: 100,
            marketPrice: 100,
            marketValue: 100,
            unrealizedPnl: 0,
            realizedPnl: 0,
          },
        },
      },
    });
    useSessionStore.getState().stepForward();
    useSessionStore.getState().stepForward();
    expect(
      useSessionStore
        .getState()
        .auditEvents.filter((event) => event.type === "margin_call"),
    ).toHaveLength(1);
  });

  it("rejects inverted brackets before creating either OCO leg", () => {
    const state = useSessionStore.getState();
    const symbol = state.primarySymbol;
    expect(
      state.submitMarketOrder({
        symbol,
        side: "buy",
        type: "market",
        quantity: 0.01,
      }).ok,
    ).toBe(true);
    const price = useSessionStore
      .getState()
      .getSnapshot()
      .tradablePrices.find((quote) => quote.symbol === symbol)?.price;
    expect(price).toBeTruthy();
    if (!price) return;
    const inverted = useSessionStore.getState().submitBracketOrder({
      symbol,
      side: "sell",
      quantity: 0.01,
      stopPrice: price * 1.05,
      targetPrice: price * 0.95,
    });
    expect(inverted.ok).toBe(false);
    expect(useSessionStore.getState().orders).toHaveLength(1);
  });

  it("honors a scenario instrument's non-tradable flag", () => {
    const scenario = scenarioWithCandles(
      [
        candle(
          "TEST",
          "2024-01-02T14:00:00.000Z",
          "2024-01-02T14:30:00.000Z",
          100,
        ),
      ],
      {
        instruments: [
          {
            ...makeScenario().instruments[0],
            tradable: false,
          },
        ],
      },
    );
    installScenario(scenario);
    const result = useSessionStore.getState().submitMarketOrder({
      symbol: "TEST",
      side: "buy",
      type: "market",
      quantity: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Instrument not tradable");
  });
});
