import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fill, Order } from "../types";
import { useSessionStore } from "../store/sessionStore";
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
