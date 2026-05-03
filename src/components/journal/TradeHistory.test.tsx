import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TradeHistory from "./TradeHistory";
import type { Fill, Order } from "../../types";

const pendingOrder: Order = {
  id: "order-pending",
  createdAt: "2020-03-12T00:00:00.000Z",
  symbol: "BTCUSD",
  side: "buy",
  type: "limit",
  quantity: 0.5,
  limitPrice: 4900,
  status: "pending",
};

const filledLimitOrder: Order = {
  id: "order-filled",
  createdAt: "2020-03-12T00:00:00.000Z",
  symbol: "BTCUSD",
  side: "buy",
  type: "limit",
  quantity: 0.1,
  limitPrice: 5100,
  status: "filled",
};

const fill: Fill = {
  id: "fill-1",
  orderId: "order-filled",
  time: "2020-03-13T00:00:00.000Z",
  symbol: "BTCUSD",
  side: "buy",
  quantity: 0.1,
  price: 5100,
  referencePrice: 5100,
  commission: 1,
  spreadCost: 0,
  slippage: 0,
  totalCost: 511,
};

describe("TradeHistory", () => {
  it("keeps pending limit orders visible before fills", () => {
    render(
      <TradeHistory
        fills={[fill]}
        orders={[pendingOrder, filledLimitOrder]}
        journal={[]}
      />,
    );

    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Filled")).toBeInTheDocument();
    expect(screen.getByText("limit @ $4,900.00")).toBeInTheDocument();
    expect(screen.getByText("limit @ $5,100.00")).toBeInTheDocument();
  });
});
