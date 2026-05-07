import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { estimateOneWaySpreadCost } from "./costEstimates";
import TradePanel from "./TradePanel";
import { selectSnapshot, useSessionStore } from "../../store/sessionStore";

describe("estimateOneWaySpreadCost", () => {
  it("matches the broker's half-spread-per-side execution model", () => {
    expect(estimateOneWaySpreadCost(10_000, 8)).toBeCloseTo(4, 6);
  });
});

describe("TradePanel order entry", () => {
  beforeEach(() => {
    useSessionStore.getState().resetScenario();
  });

  it("places a market order from the ticket", () => {
    const state = useSessionStore.getState();
    const snapshot = selectSnapshot(state);

    render(
      <TradePanel
        tradablePrice={snapshot.tradablePrices[0]}
        cash={snapshot.portfolio.cash}
        positionsValue={snapshot.portfolio.positionsValue}
        totalValue={snapshot.portfolio.totalValue}
        realizedPnl={snapshot.portfolio.realizedPnl}
        unrealizedPnl={snapshot.portfolio.unrealizedPnl}
        initialCash={state.scenario.meta.initialCash}
        margin={snapshot.margin}
        risk={snapshot.risk}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /place market buy/i }));

    expect(useSessionStore.getState().fills).toHaveLength(1);
  });
});
