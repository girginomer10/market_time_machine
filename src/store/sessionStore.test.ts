import { beforeEach, describe, expect, it } from "vitest";
import type { Candle, Order, ScenarioPackage } from "../types";
import { defaultScenarioId } from "../data/scenarios";
import { emptyPortfolio } from "../domain/portfolio/portfolio";
import { replayTimeline } from "../domain/replay/engine";
import { makeBroker, makeScenario } from "../test/fixtures";
import { useSessionStore } from "./sessionStore";

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
    useSessionStore.getState().addJournalNote("Preserve this decision.");
    const serialized = useSessionStore.getState().exportSession();
    expect(JSON.parse(serialized).version).toBe(1);
    expect(window.localStorage.getItem("market-time-machine.session.v1")).toBeTruthy();

    useSessionStore.getState().resetScenario();
    expect(useSessionStore.getState().journal).toHaveLength(0);
    const restored = useSessionStore.getState().importSession(serialized);
    expect(restored.ok).toBe(true);
    expect(useSessionStore.getState().journal[0].note).toBe(
      "Preserve this decision.",
    );
    expect(
      useSessionStore.getState().auditEvents.at(-1)?.type,
    ).toBe("session_restored");
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
