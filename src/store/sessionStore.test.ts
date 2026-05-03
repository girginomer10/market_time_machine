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
});
