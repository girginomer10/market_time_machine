import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "./sessionStore";

describe("sessionStore finish", () => {
  beforeEach(() => {
    useSessionStore.getState().resetScenario();
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
    expect(finished.fills[1].price).toBe(futureStop);
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
    expect(finished.fills[1].price).toBe(futureStop);
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
    expect(finished.fills[1].price).toBe(futureStop);
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
