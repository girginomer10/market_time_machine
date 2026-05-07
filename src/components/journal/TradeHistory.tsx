import { Fragment, useState } from "react";
import type { Fill, JournalEntry, Order } from "../../types";
import { formatCurrency, formatNumber } from "../../utils/format";

type OrderUpdate = {
  quantity: number;
  price: number;
};

type OrderUpdateResult = { ok: boolean; message?: string };

type HistoryView = "all" | "working" | "closed";

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

const HISTORY_VIEWS: Array<{ value: HistoryView; label: string }> = [
  { value: "all", label: "All" },
  { value: "working", label: "Working" },
  { value: "closed", label: "Closed" },
];

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

function buildOcoGroupLabels(orders: Order[]): Map<string, string> {
  const groups = orders
    .filter((order) => order.ocoGroupId)
    .reduce<Map<string, string>>((groupStartTimes, order) => {
      const id = order.ocoGroupId!;
      const currentStart = groupStartTimes.get(id);
      if (!currentStart || order.createdAt.localeCompare(currentStart) < 0) {
        groupStartTimes.set(id, order.createdAt);
      }
      return groupStartTimes;
    }, new Map());

  return new Map(
    [...groups.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))
      .map(([id], index) => [id, `OCO ${index + 1}`]),
  );
}

function ocoGroupLabel(
  order: Order | undefined,
  labels: Map<string, string>,
): string | undefined {
  if (!order?.ocoGroupId) return undefined;
  return labels.get(order.ocoGroupId);
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
  const [historyView, setHistoryView] = useState<HistoryView>("all");
  const [editingOrderId, setEditingOrderId] = useState<string | undefined>();
  const [draftLimitPrice, setDraftLimitPrice] = useState("");
  const [draftQuantity, setDraftQuantity] = useState("");
  const [editError, setEditError] = useState<string | undefined>();
  const byFill = new Map(
    journal.filter((j) => j.fillId).map((j) => [j.fillId!, j]),
  );
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const ocoGroupLabels = buildOcoGroupLabels(orders);
  const sorted = [...fills].sort((a, b) => b.time.localeCompare(a.time));
  const workingOrders = orders
    .filter((order) => order.status === "pending" || order.status === "partially_filled")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const closedOrders = orders
    .filter(
      (order) =>
        order.status !== "pending" &&
        order.status !== "partially_filled" &&
        order.status !== "filled",
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visibleWorkingOrders =
    historyView === "closed" ? [] : workingOrders;
  const visibleClosedOrders =
    historyView === "working" ? [] : closedOrders;
  const visibleFills = historyView === "working" ? [] : sorted;
  const totalRows = workingOrders.length + closedOrders.length + sorted.length;
  const visibleRows =
    visibleWorkingOrders.length + visibleClosedOrders.length + visibleFills.length;
  const viewCounts: Record<HistoryView, number> = {
    all: totalRows,
    working: workingOrders.length,
    closed: closedOrders.length + sorted.length,
  };
  const hasActions = Boolean(onCancelOrder || onUpdateOrder);
  const totalColumns = hasActions ? 7 : 6;

  function editablePriceFor(order: Order): number | undefined {
    return order.limitPrice ?? order.triggerPrice;
  }

  function priceFieldLabel(order: Order): string {
    return order.type === "limit" ? "Limit price" : "Trigger price";
  }

  function startEditing(order: Order): void {
    setEditingOrderId(order.id);
    setDraftLimitPrice(String(editablePriceFor(order) ?? ""));
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
    const price = Number(draftLimitPrice);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setEditError("Enter a positive quantity.");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setEditError("Enter a positive price.");
      return;
    }

    const result = onUpdateOrder(order.id, { quantity, price });
    if (result && !result.ok) {
      setEditError(result.message ?? "Order could not be updated.");
      return;
    }
    stopEditing();
  }

  if (totalRows === 0) {
    return (
      <div className="empty-state">
        No fills or orders yet. Market fills and triggered limit orders will
        appear here with decision notes.
      </div>
    );
  }
  return (
    <div className="trade-history-shell">
      <div className="history-filter" role="tablist" aria-label="Trade history view">
        {HISTORY_VIEWS.map((view) => (
          <button
            key={view.value}
            type="button"
            className={historyView === view.value ? "active" : ""}
            onClick={() => {
              setHistoryView(view.value);
              stopEditing();
            }}
            role="tab"
            aria-selected={historyView === view.value}
          >
            <span>{view.label}</span>
            <strong>{viewCounts[view.value]}</strong>
          </button>
        ))}
      </div>
      {visibleRows === 0 ? (
        <div className="empty-state">
          No {historyView} records in this replay yet.
        </div>
      ) : (
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
              {visibleWorkingOrders.map((order) => (
                <Fragment key={order.id}>
                  <OrderRow
                    order={order}
                    ocoGroupLabels={ocoGroupLabels}
                    hasActions={hasActions}
                    onCancelOrder={onCancelOrder}
                    onUpdateOrder={onUpdateOrder}
                    onStartEditing={startEditing}
                  />
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
                            <span>{priceFieldLabel(order)}</span>
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
              {visibleClosedOrders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  ocoGroupLabels={ocoGroupLabels}
                  hasActions={hasActions}
                  onCancelOrder={onCancelOrder}
                  onUpdateOrder={onUpdateOrder}
                  onStartEditing={startEditing}
                />
              ))}
              {visibleFills.map((fill) => {
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
                      {sourceOrder ? (
                        <OrderTypeText
                          order={sourceOrder}
                          ocoGroupLabels={ocoGroupLabels}
                        />
                      ) : (
                        "market"
                      )}
                    </td>
                    <td className="right">{formatNumber(fill.quantity, 6)}</td>
                    <td className="right">{formatCurrency(fill.price)}</td>
                    <td>
                      <span className="status-badge filled">Filled</span>
                      {fill.reason ? (
                        <small className="execution-note">
                          {fill.reason.replace("_", " ")}
                          {fill.executionPriceSource
                            ? ` · ${fill.executionPriceSource.replace("_", " ")}`
                            : ""}
                        </small>
                      ) : null}
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
      )}
    </div>
  );
}

function OrderRow({
  order,
  ocoGroupLabels,
  hasActions,
  onCancelOrder,
  onUpdateOrder,
  onStartEditing,
}: {
  order: Order;
  ocoGroupLabels: Map<string, string>;
  hasActions: boolean;
  onCancelOrder?: (orderId: string) => void;
  onUpdateOrder?: (
    orderId: string,
    updates: OrderUpdate,
  ) => OrderUpdateResult | void;
  onStartEditing: (order: Order) => void;
}) {
  return (
    <tr className={isWorkingOrder(order) ? "pending" : undefined}>
      <td>{dateLabel(order.createdAt)}</td>
      <td className={order.side === "buy" ? "pos" : "neg"}>{order.side}</td>
      <td>
        <OrderTypeText order={order} ocoGroupLabels={ocoGroupLabels} />
      </td>
      <td className="right">
        {formatNumber(order.remainingQuantity ?? order.quantity, 6)}
        {order.filledQuantity ? (
          <small>{formatNumber(order.filledQuantity, 6)} filled</small>
        ) : null}
      </td>
      <td className="right">
        {order.averageFillPrice ? formatCurrency(order.averageFillPrice) : <span className="muted">—</span>}
      </td>
      <td>
        <span className={`status-badge ${statusClass(order.status)}`}>
          {STATUS_LABELS[order.status]}
        </span>
      </td>
      {hasActions ? (
        <td>
          {isWorkingOrder(order) ? (
            <div className="order-action-group">
              {onUpdateOrder && order.type !== "market" ? (
                <button
                  className="order-action-button secondary"
                  type="button"
                  onClick={() => onStartEditing(order)}
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
  );
}

function isWorkingOrder(order: Order): boolean {
  return order.status === "pending" || order.status === "partially_filled";
}

function OrderTypeText({
  order,
  ocoGroupLabels,
}: {
  order: Order;
  ocoGroupLabels: Map<string, string>;
}) {
  const label = ocoGroupLabel(order, ocoGroupLabels);
  return (
    <>
      {orderTypeLabel(order.type)}
      {orderPriceText(order)}
      {label ? <small className="oco-chip">{label}</small> : null}
      {order.timeInForce ? (
        <small className="execution-note">
          {order.timeInForce.toUpperCase()}
          {order.expiresAt ? ` · expires ${dateLabel(order.expiresAt)}` : ""}
        </small>
      ) : null}
    </>
  );
}
