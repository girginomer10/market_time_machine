import type { AuditEvent, AuditEventType } from "../../types";

type Props = {
  events: AuditEvent[];
  limit?: number;
};

const TYPE_LABELS: Record<AuditEventType, string> = {
  replay_step: "Replay",
  order_placed: "Order",
  order_rejected: "Reject",
  order_cancelled: "Cancel",
  order_updated: "Update",
  fill: "Fill",
  margin_call: "Margin",
  forced_liquidation: "Liquidation",
  borrow_cost: "Borrow",
  tif_expired: "Expired",
};

function toneFor(type: AuditEventType): "neutral" | "good" | "warn" | "bad" {
  if (type === "fill" || type === "order_placed" || type === "order_updated") {
    return "good";
  }
  if (type === "order_rejected" || type === "forced_liquidation") return "bad";
  if (type === "margin_call" || type === "borrow_cost" || type === "tif_expired") {
    return "warn";
  }
  return "neutral";
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").slice(0, 16);
}

export default function AuditTrail({ events, limit = 40 }: Props) {
  const visible = [...events]
    .sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id))
    .slice(0, limit);

  if (visible.length === 0) {
    return (
      <div className="empty-state audit-empty">
        Replay audit events will appear here as orders, fills, margin checks,
        and system actions occur.
      </div>
    );
  }

  return (
    <div className="audit-list" aria-label="Replay audit trail">
      {visible.map((event) => (
        <article className={`audit-item ${toneFor(event.type)}`} key={event.id}>
          <div className="audit-item-head">
            <span className={`audit-type ${toneFor(event.type)}`}>
              {TYPE_LABELS[event.type]}
            </span>
            <time dateTime={event.time}>{timeLabel(event.time)}</time>
          </div>
          <p>{event.message}</p>
          {event.symbol || event.orderId || event.fillId ? (
            <div className="audit-meta">
              {event.symbol ? <span>{event.symbol}</span> : null}
              {event.orderId ? <span>{event.orderId}</span> : null}
              {event.fillId ? <span>{event.fillId}</span> : null}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
