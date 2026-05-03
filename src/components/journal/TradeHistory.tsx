import type { Fill, JournalEntry, Order } from "../../types";
import { formatCurrency, formatNumber } from "../../utils/format";

type Props = {
  fills: Fill[];
  orders: Order[];
  journal: JournalEntry[];
};

function dateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 10);
}

export default function TradeHistory({ fills, orders, journal }: Props) {
  const byFill = new Map(
    journal.filter((j) => j.fillId).map((j) => [j.fillId!, j]),
  );
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const sorted = [...fills].sort((a, b) => b.time.localeCompare(a.time));
  const pending = orders
    .filter((order) => order.status === "pending")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sorted.length === 0 && pending.length === 0) {
    return (
      <div className="empty-state">
        No fills or pending orders yet. Market fills and triggered limit orders
        will appear here with decision notes.
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
          </tr>
        </thead>
        <tbody>
          {pending.map((order) => (
            <tr className="pending" key={order.id}>
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
                <span className="status-badge working">Working</span>
              </td>
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
