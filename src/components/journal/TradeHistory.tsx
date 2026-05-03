import { Fragment, useState } from "react";
import type { Fill, JournalEntry, Order } from "../../types";
import { formatCurrency, formatNumber } from "../../utils/format";

type OrderUpdate = {
  quantity: number;
  limitPrice: number;
};

type OrderUpdateResult = { ok: boolean; message?: string };

type Props = {
  fills: Fill[];
  orders: Order[];
  journal: JournalEntry[];
  onCancelOrder?: (orderId: string) => void;
  onUpdateOrder?: (
    orderId: string,
    updates: OrderUpdate,
  ) => OrderUpdateResult | void;
};

const STATUS_LABELS: Record<Order["status"], string> = {
  pending: "Working",
  filled: "Filled",
  partially_filled: "Part-filled",
  cancelled: "Cancelled",
  rejected: "Rejected",
  expired: "Expired",
};

function statusClass(status: Order["status"]): string {
  if (status === "pending") return "working";
  return status.replace("_", "-");
}

function orderTypeLabel(type: Order["type"]): string {
  return type.replace("_", " ");
}

function orderPriceText(order: Order): string {
  const price = order.limitPrice ?? order.triggerPrice;
  if (!price) return "";
  const label = order.type === "limit" ? "" : " trigger";
  return `${label} @ ${formatCurrency(price)}`;
}

function dateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 10);
}

export default function TradeHistory({
  fills,
  orders,
  journal,
  onCancelOrder,
  onUpdateOrder,
}: Props) {
  const [editingOrderId, setEditingOrderId] = useState<string | undefined>();
  const [draftLimitPrice, setDraftLimitPrice] = useState("");
  const [draftQuantity, setDraftQuantity] = useState("");
  const [editError, setEditError] = useState<string | undefined>();
  const byFill = new Map(
    journal.filter((j) => j.fillId).map((j) => [j.fillId!, j]),
  );
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const sorted = [...fills].sort((a, b) => b.time.localeCompare(a.time));
  const openOrders = orders
    .filter((order) => order.status !== "filled")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const hasActions = Boolean(onCancelOrder || onUpdateOrder);
  const totalColumns = hasActions ? 7 : 6;

  function startEditing(order: Order): void {
    setEditingOrderId(order.id);
    setDraftLimitPrice(String(order.limitPrice ?? ""));
    setDraftQuantity(String(order.quantity));
    setEditError(undefined);
  }

  function stopEditing(): void {
    setEditingOrderId(undefined);
    setDraftLimitPrice("");
    setDraftQuantity("");
    setEditError(undefined);
  }

  function saveEdit(order: Order): void {
    if (!onUpdateOrder) return;
    const quantity = Number(draftQuantity);
    const limitPrice = Number(draftLimitPrice);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setEditError("Enter a positive quantity.");
      return;
    }
    if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
      setEditError("Enter a positive limit price.");
      return;
    }

    const result = onUpdateOrder(order.id, { quantity, limitPrice });
    if (result && !result.ok) {
      setEditError(result.message ?? "Order could not be updated.");
      return;
    }
    stopEditing();
  }

  if (sorted.length === 0 && openOrders.length === 0) {
    return (
      <div className="empty-state">
        No fills or orders yet. Market fills and triggered limit orders will
        appear here with decision notes.
      </div>
    );
  }
  return (
    <div className="trade-table-wrap" aria-label="Trade history">
      <table className="trade-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Side</th>
            <th>Type</th>
            <th className="right">Qty</th>
            <th className="right">Price</th>
            <th>Status</th>
            {hasActions ? <th>Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {openOrders.map((order) => (
            <Fragment key={order.id}>
              <tr
                className={order.status === "pending" ? "pending" : undefined}
              >
                <td>{dateLabel(order.createdAt)}</td>
                <td className={order.side === "buy" ? "pos" : "neg"}>
                  {order.side}
                </td>
                <td>
                  {orderTypeLabel(order.type)}
                  {orderPriceText(order)}
                </td>
                <td className="right">{formatNumber(order.quantity, 6)}</td>
                <td className="right muted">—</td>
                <td>
                  <span className={`status-badge ${statusClass(order.status)}`}>
                    {STATUS_LABELS[order.status]}
                  </span>
                </td>
                {hasActions ? (
                  <td>
                    {order.status === "pending" ? (
                      <div className="order-action-group">
                        {onUpdateOrder && order.type === "limit" ? (
                          <button
                            className="order-action-button secondary"
                            type="button"
                            onClick={() => startEditing(order)}
                            aria-label={`Edit order ${order.id}`}
                          >
                            Edit
                          </button>
                        ) : null}
                        {onCancelOrder ? (
                          <button
                            className="order-action-button"
                            type="button"
                            onClick={() => onCancelOrder(order.id)}
                            aria-label={`Cancel order ${order.id}`}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                ) : null}
              </tr>
              {editingOrderId === order.id ? (
                <tr className="order-edit-row">
                  <td colSpan={totalColumns}>
                    <form
                      className="order-edit-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveEdit(order);
                      }}
                    >
                      <label htmlFor={`order-${order.id}-limit`}>
                        <span>Limit price</span>
                        <input
                          id={`order-${order.id}-limit`}
                          inputMode="decimal"
                          min="0"
                          step="any"
                          type="number"
                          value={draftLimitPrice}
                          onChange={(event) =>
                            setDraftLimitPrice(event.target.value)
                          }
                        />
                      </label>
                      <label htmlFor={`order-${order.id}-quantity`}>
                        <span>Quantity</span>
                        <input
                          id={`order-${order.id}-quantity`}
                          inputMode="decimal"
                          min="0"
                          step="any"
                          type="number"
                          value={draftQuantity}
                          onChange={(event) =>
                            setDraftQuantity(event.target.value)
                          }
                        />
                      </label>
                      <button
                        className="order-action-button secondary"
                        type="submit"
                        aria-label={`Save order ${order.id}`}
                      >
                        Save
                      </button>
                      <button
                        className="order-action-button ghost"
                        type="button"
                        onClick={stopEditing}
                        aria-label={`Discard edits for order ${order.id}`}
                      >
                        Discard
                      </button>
                      {editError ? (
                        <span className="order-edit-error">{editError}</span>
                      ) : null}
                    </form>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
          {sorted.map((fill) => {
            const note = byFill.get(fill.id);
            const sourceOrder = ordersById.get(fill.orderId);
            return (
              <tr key={fill.id}>
                <td>
                  <span>{dateLabel(fill.time)}</span>
                  {note ? <small>{note.note}</small> : null}
                </td>
                <td className={fill.side === "buy" ? "pos" : "neg"}>
                  {fill.side}
                </td>
                <td>
                  {sourceOrder?.type ?? "market"}
                  {sourceOrder ? orderPriceText(sourceOrder) : ""}
                </td>
                <td className="right">{formatNumber(fill.quantity, 6)}</td>
                <td className="right">{formatCurrency(fill.price)}</td>
                <td>
                  <span className="status-badge filled">Filled</span>
                </td>
                {hasActions ? (
                  <td>
                    <span className="muted">—</span>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
