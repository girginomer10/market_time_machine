import type { Fill, JournalEntry, Order } from "../../types";
import { formatCurrency, formatNumber } from "../../utils/format";

type Props = {
  fills: Fill[];
  orders: Order[];
  journal: JournalEntry[];
  onCancelOrder?: (orderId: string) => void;
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
}: Props) {
  const byFill = new Map(
    journal.filter((j) => j.fillId).map((j) => [j.fillId!, j]),
  );
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const sorted = [...fills].sort((a, b) => b.time.localeCompare(a.time));
  const openOrders = orders
    .filter((order) => order.status !== "filled")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const hasActions = Boolean(onCancelOrder);
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
            <tr
              className={order.status === "pending" ? "pending" : undefined}
              key={order.id}
            >
              <td>{dateLabel(order.createdAt)}</td>
              <td className={order.side === "buy" ? "pos" : "neg"}>
                {order.side}
              </td>
              <td>
                {order.type}
                {order.limitPrice
                  ? ` @ ${formatCurrency(order.limitPrice)}`
                  : ""}
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
                    <button
                      className="order-action-button"
                      type="button"
                      onClick={() => onCancelOrder?.(order.id)}
                      aria-label={`Cancel order ${order.id}`}
                    >
                      Cancel
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              ) : null}
            </tr>
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
                  {sourceOrder?.type === "limit" && sourceOrder.limitPrice
                    ? ` @ ${formatCurrency(sourceOrder.limitPrice)}`
                    : ""}
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
