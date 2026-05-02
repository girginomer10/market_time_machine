import type { Fill, JournalEntry, Order } from "../../types";
import { formatCurrency, formatNumber } from "../../utils/format";

type Props = {
  fills: Fill[];
  orders: Order[];
  journal: JournalEntry[];
};

export default function TradeHistory({ fills, orders, journal }: Props) {
  const byFill = new Map(journal.filter((j) => j.fillId).map((j) => [j.fillId!, j]));
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
    <div className="list" aria-label="Trade history">
      {pending.map((order) => (
        <div className="list-item pending-order" key={order.id}>
          <div className="row">
            <strong>
              <span className="dot mixed" /> PENDING {order.side.toUpperCase()}{" "}
              {formatNumber(order.quantity, 6)} {order.symbol}
            </strong>
            <span className="panel-sub">
              {new Date(order.createdAt).toISOString().slice(0, 10)}
            </span>
          </div>
          <div className="row subtle">
            <span>
              {order.type}{" "}
              {order.limitPrice ? `limit ${formatCurrency(order.limitPrice)}` : ""}
            </span>
            <span>waiting for trigger</span>
          </div>
          {order.note ? (
            <div className="row subtle" style={{ color: "var(--text-1)" }}>
              <span>“{order.note}”</span>
            </div>
          ) : null}
        </div>
      ))}
      {sorted.map((fill) => {
        const note = byFill.get(fill.id);
        const cls = fill.side === "buy" ? "pos" : "neg";
        return (
          <div className="list-item" key={fill.id}>
            <div className="row">
              <strong>
                <span className={`dot ${cls}`} /> {fill.side.toUpperCase()}{" "}
                {formatNumber(fill.quantity, 6)} {fill.symbol}
              </strong>
              <span className="panel-sub">
                {new Date(fill.time).toISOString().slice(0, 10)}
              </span>
            </div>
            <div className="row subtle">
              <span>fill {formatCurrency(fill.price)}</span>
              <span>fees {formatCurrency(fill.commission + fill.spreadCost)}</span>
            </div>
            {note ? (
              <div className="row subtle" style={{ color: "var(--text-1)" }}>
                <span>“{note.note}”</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
