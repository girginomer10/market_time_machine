import { fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(useSessionStore.getState().orders[0].timeInForce).toBe("gtc");
  });

  it("records a structured decision plan and links only visible events", () => {
    useSessionStore.getState().selectScenario("btc-2020-2021");
    useSessionStore.setState({ currentIndex: 90, status: "paused" });
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

    fireEvent.change(screen.getByLabelText("Decision thesis"), {
      target: { value: "Volatility is stabilizing after the policy response." },
    });
    fireEvent.change(screen.getByLabelText("Invalidation"), {
      target: { value: "Close below the panic low." },
    });
    fireEvent.change(screen.getByLabelText("Exit plan"), {
      target: { value: "Scale out after a 15% recovery." },
    });
    fireEvent.change(screen.getByLabelText("Accepted risk"), {
      target: { value: "1% of equity" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Link WHO declares COVID-19 a pandemic/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /place market buy/i }));

    const next = useSessionStore.getState();
    expect(next.orders.at(-1)?.decisionPlan).toEqual({
      thesis: "Volatility is stabilizing after the policy response.",
      invalidation: "Close below the panic low.",
      exitPlan: "Scale out after a 15% recovery.",
      acceptedRisk: "1% of equity",
      linkedEventIds: ["evt-2020-03-11-who"],
    });
    expect(next.fills.at(-1)?.decisionPlan).toEqual(
      next.orders.at(-1)?.decisionPlan,
    );
    expect(next.journal.at(-1)?.decisionPlan).toEqual(
      next.orders.at(-1)?.decisionPlan,
    );
  });

  it("requires a thesis and one risk control in professional mode", () => {
    useSessionStore.getState().setScenarioMode("professional");
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
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This mode requires a concise decision thesis.",
    );

    fireEvent.change(screen.getByLabelText("Decision thesis"), {
      target: { value: "A defined professional thesis." },
    });
    fireEvent.click(screen.getByRole("button", { name: /place market buy/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Add an invalidation, exit plan, or accepted-risk statement",
    );

    fireEvent.change(screen.getByLabelText("Accepted risk"), {
      target: { value: "$100 maximum loss" },
    });
    fireEvent.click(screen.getByRole("button", { name: /place market buy/i }));
    expect(useSessionStore.getState().fills).toHaveLength(1);
  });

  it("passes the selected GTC time in force to a working order", () => {
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

    fireEvent.click(screen.getByRole("radio", { name: "Limit" }));
    fireEvent.change(screen.getByLabelText("Time in force"), {
      target: { value: "gtc" },
    });
    fireEvent.click(screen.getByRole("button", { name: /place limit buy/i }));

    expect(useSessionStore.getState().orders[0].timeInForce).toBe("gtc");
  });

  it("shows a local validation error for an invalid quantity", () => {
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

    fireEvent.change(screen.getByLabelText("Qty"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: /place market buy/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a positive quantity.",
    );
    expect(useSessionStore.getState().fills).toHaveLength(0);
  });

  it("defaults a long-position bracket to a stop below and target above the mark", () => {
    const initial = useSessionStore.getState();
    const initialSnapshot = selectSnapshot(initial);
    const result = initial.submitMarketOrder({
      symbol: initial.primarySymbol,
      side: "buy",
      type: "market",
      quantity: 1,
    });
    expect(result.ok).toBe(true);

    const state = useSessionStore.getState();
    const snapshot = selectSnapshot(state);
    const mark = snapshot.tradablePrices[0].price;
    render(
      <TradePanel
        tradablePrice={snapshot.tradablePrices[0] ?? initialSnapshot.tradablePrices[0]}
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

    fireEvent.click(screen.getByRole("radio", { name: "Bracket" }));

    expect(Number((screen.getByLabelText("Stop") as HTMLInputElement).value)).toBeLessThan(mark);
    expect(Number((screen.getByLabelText("Target") as HTMLInputElement).value)).toBeGreaterThan(mark);
  });

  it("preserves FX tick precision in the quote and pending-order defaults", () => {
    const state = useSessionStore.getState();
    const snapshot = selectSnapshot(state);
    render(
      <TradePanel
        tradablePrice={{
          symbol: "EURGBP",
          time: snapshot.currentTime,
          price: 0.78123,
          bid: 0.78122,
          ask: 0.78124,
        }}
        tickSize={0.00001}
        currency="GBP"
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

    expect(screen.getByText("£0.78123 mark")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Limit" }));
    const limit = screen.getByLabelText("Limit") as HTMLInputElement;
    expect(limit.value).toBe("0.78123");
    expect(limit).toHaveAttribute("step", "0.00001");
  });

  it("locks broker selection as soon as an order is working", () => {
    const state = useSessionStore.getState();
    const snapshot = selectSnapshot(state);
    const quote = snapshot.tradablePrices[0];
    const result = state.submitLimitOrder({
      symbol: state.primarySymbol,
      side: "buy",
      type: "limit",
      quantity: 0.05,
      limitPrice: quote.price * 0.5,
    });
    expect(result.ok).toBe(true);

    const next = useSessionStore.getState();
    const nextSnapshot = selectSnapshot(next);
    render(
      <TradePanel
        tradablePrice={nextSnapshot.tradablePrices[0]}
        cash={nextSnapshot.portfolio.cash}
        positionsValue={nextSnapshot.portfolio.positionsValue}
        totalValue={nextSnapshot.portfolio.totalValue}
        realizedPnl={nextSnapshot.portfolio.realizedPnl}
        unrealizedPnl={nextSnapshot.portfolio.unrealizedPnl}
        initialCash={next.scenario.meta.initialCash}
        margin={nextSnapshot.margin}
        risk={nextSnapshot.risk}
      />,
    );

    expect(
      screen.getByRole("radio", { name: /Scenario Curated assumptions/i }),
    ).toBeDisabled();
    expect(screen.getByText(/1 working/i)).toBeInTheDocument();
  });

  it("uses gross exposure for short positions", () => {
    const state = useSessionStore.getState();
    const snapshot = selectSnapshot(state);
    render(
      <TradePanel
        tradablePrice={snapshot.tradablePrices[0]}
        cash={6_000}
        positionsValue={-4_000}
        totalValue={10_000}
        realizedPnl={0}
        unrealizedPnl={0}
        initialCash={10_000}
        margin={snapshot.margin}
        risk={{
          buyingPower: 6_000,
          leverage: 0.4,
          exposurePct: 0.4,
          liquidationWarning: false,
        }}
      />,
    );

    expect(screen.getByRole("meter", { name: /gross portfolio exposure/i })).toHaveAttribute(
      "aria-valuenow",
      "0.4",
    );
    expect(screen.getByText("Gross exposure 40.00%")).toBeInTheDocument();
  });

  it("renders every open portfolio position while the ticket keeps its primary symbol", () => {
    useSessionStore.setState((state) => ({
      portfolio: {
        ...state.portfolio,
        positions: {
          BTCUSD: {
            symbol: "BTCUSD",
            quantity: 1,
            averagePrice: 7_000,
            marketPrice: 7_200,
            marketValue: 7_200,
            unrealizedPnl: 200,
            realizedPnl: 0,
          },
          ETHUSD: {
            symbol: "ETHUSD",
            quantity: -2,
            averagePrice: 400,
            marketPrice: 350,
            marketValue: -700,
            unrealizedPnl: 100,
            realizedPnl: 0,
          },
        },
      },
    }));
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

    const positions = within(screen.getByLabelText("Open positions"));
    expect(positions.getByText("BTCUSD")).toBeInTheDocument();
    expect(positions.getByText("ETHUSD")).toBeInTheDocument();
    expect(positions.getByText("Long")).toBeInTheDocument();
    expect(positions.getByText("Short")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /place market buy/i }));
    expect(useSessionStore.getState().fills.at(-1)?.symbol).toBe(
      state.primarySymbol,
    );
  });
});
