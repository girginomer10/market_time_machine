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
});
