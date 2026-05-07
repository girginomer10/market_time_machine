import { fireEvent, render, screen, within } from "@testing-library/react";
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

const stopLossOrder: Order = {
  id: "order-stop",
  createdAt: "2020-03-12T00:00:00.000Z",
  symbol: "BTCUSD",
  side: "sell",
  type: "stop_loss",
  quantity: 0.5,
  triggerPrice: 4600,
  status: "pending",
};

const bracketStopOrder: Order = {
  ...stopLossOrder,
  id: "order-bracket-stop",
  status: "filled",
  ocoGroupId: "oco-demo",
};

const bracketTargetOrder: Order = {
  id: "order-bracket-target",
  createdAt: "2020-03-12T00:00:00.000Z",
  symbol: "BTCUSD",
  side: "sell",
  type: "take_profit",
  quantity: 0.5,
  triggerPrice: 5800,
  status: "cancelled",
  ocoGroupId: "oco-demo",
};

const cancelledOrder: Order = {
  id: "order-cancelled",
  createdAt: "2020-03-11T00:00:00.000Z",
  symbol: "BTCUSD",
  side: "sell",
  type: "limit",
  quantity: 0.2,
  limitPrice: 5200,
  status: "cancelled",
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

const bracketFill: Fill = {
  ...fill,
  id: "fill-bracket",
  orderId: "order-bracket-stop",
  side: "sell",
  price: 4600,
  totalCost: 2299,
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

    const table = within(screen.getByLabelText("Trade history"));
    expect(table.getByText("Working")).toBeInTheDocument();
    expect(table.getByText("Filled")).toBeInTheDocument();
    expect(table.getByText("limit @ $4,900.00")).toBeInTheDocument();
    expect(table.getByText("limit @ $5,100.00")).toBeInTheDocument();
  });

  it("filters working and closed records", () => {
    render(
      <TradeHistory
        fills={[fill]}
        orders={[pendingOrder, filledLimitOrder, cancelledOrder]}
        journal={[]}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /working 1/i }));
    let table = within(screen.getByLabelText("Trade history"));
    expect(table.getByText("limit @ $4,900.00")).toBeInTheDocument();
    expect(table.queryByText("Filled")).not.toBeInTheDocument();
    expect(table.queryByText("Cancelled")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /closed 2/i }));
    table = within(screen.getByLabelText("Trade history"));
    expect(table.getByText("Filled")).toBeInTheDocument();
    expect(table.getByText("Cancelled")).toBeInTheDocument();
    expect(table.queryByText("limit @ $4,900.00")).not.toBeInTheDocument();
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
      price: 4800,
      quantity: 0.25,
    });
  });

  it("edits trigger prices for stop and target orders", () => {
    const onUpdateOrder = vi.fn(() => ({ ok: true }));

    render(
      <TradeHistory
        fills={[]}
        orders={[stopLossOrder]}
        journal={[]}
        onUpdateOrder={onUpdateOrder}
      />,
    );

    expect(
      screen.getByText(/stop loss trigger @ \$4,600\.00/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit order order-stop" }),
    );
    fireEvent.change(screen.getByLabelText("Trigger price"), {
      target: { value: "4550" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save order order-stop" }),
    );

    expect(onUpdateOrder).toHaveBeenCalledWith("order-stop", {
      price: 4550,
      quantity: 0.5,
    });
  });

  it("labels bracket/OCO legs and their source fills with the same group", () => {
    render(
      <TradeHistory
        fills={[bracketFill]}
        orders={[bracketStopOrder, bracketTargetOrder]}
        journal={[]}
      />,
    );

    expect(screen.getByText(/stop loss trigger @ \$4,600\.00/)).toBeInTheDocument();
    expect(
      screen.getByText(/take profit trigger @ \$5,800\.00/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("OCO 1")).toHaveLength(2);
  });
});
