import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("calls back when a pending order is cancelled", () => {
    const onCancelOrder = vi.fn();

    render(
      <TradeHistory
        fills={[]}
        orders={[pendingOrder]}
        journal={[]}
        onCancelOrder={onCancelOrder}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Cancel order order-pending" }),
    );

    expect(onCancelOrder).toHaveBeenCalledWith("order-pending");
  });

  it("calls back when a pending limit order is edited", () => {
    const onUpdateOrder = vi.fn(() => ({ ok: true }));

    render(
      <TradeHistory
        fills={[]}
        orders={[pendingOrder]}
        journal={[]}
        onUpdateOrder={onUpdateOrder}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Edit order order-pending" }),
    );
    fireEvent.change(screen.getByLabelText("Limit price"), {
      target: { value: "4800" },
    });
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "0.25" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save order order-pending" }),
    );

    expect(onUpdateOrder).toHaveBeenCalledWith("order-pending", {
      limitPrice: 4800,
      quantity: 0.25,
    });
  });
});
