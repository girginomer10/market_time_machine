import { useEffect, useMemo, useState } from "react";
import type { AuditEvent, AuditEventType } from "../../types";

type Props = {
  events: AuditEvent[];
  limit?: number;
};

type AuditFilter = "all" | "orders" | "fills" | "risk" | "replay";

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
  corporate_action: "Corporate",
  session_restored: "Session",
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
  const [filter, setFilter] = useState<AuditFilter>("all");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(limit);
  const sorted = useMemo(
    () =>
      [...events].sort(
        (a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id),
      ),
    [events],
  );
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sorted.filter((event) => {
      if (!matchesFilter(event, filter)) return false;
      if (!normalizedQuery) return true;
      return [
        event.message,
        event.type,
        event.symbol,
        event.orderId,
        event.fillId,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [filter, query, sorted]);
  const visible = filtered.slice(0, visibleCount);

  useEffect(() => {
    setVisibleCount(limit);
  }, [filter, limit, query]);

  if (events.length === 0) {
    return (
      <div className="empty-state audit-empty">
        Replay audit events will appear here as orders, fills, margin checks,
        and system actions occur.
      </div>
    );
  }

  return (
    <div className="audit-shell">
      <div className="audit-tools">
        <label>
          <span>Event type</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as AuditFilter)}
          >
            <option value="all">All events</option>
            <option value="orders">Orders</option>
            <option value="fills">Fills</option>
            <option value="risk">Risk and financing</option>
            <option value="replay">Replay steps</option>
          </select>
        </label>
        <label>
          <span>Search audit</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Symbol, order, message…"
          />
        </label>
      </div>
      <div className="audit-result-meta" aria-live="polite">
        Showing {visible.length} of {filtered.length} matching events · {events.length}{" "}
        total
      </div>
      {visible.length === 0 ? (
        <div className="empty-state">No audit events match these filters.</div>
      ) : (
        <>
          <div className="audit-list" aria-label="Replay audit trail">
            {visible.map((event) => (
              <article
                className={`audit-item ${toneFor(event.type)}`}
                key={event.id}
              >
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
          {visible.length < filtered.length ? (
            <button
              className="btn audit-more"
              type="button"
              onClick={() => setVisibleCount((count) => count + limit)}
            >
              Show {Math.min(limit, filtered.length - visible.length)} more
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function matchesFilter(event: AuditEvent, filter: AuditFilter): boolean {
  if (filter === "all") return true;
  if (filter === "orders") {
    return event.type.startsWith("order_") || event.type === "tif_expired";
  }
  if (filter === "fills") return event.type === "fill";
  if (filter === "replay") {
    return (
      event.type === "replay_step" ||
      event.type === "corporate_action" ||
      event.type === "session_restored"
    );
  }
  return (
    event.type === "margin_call" ||
    event.type === "forced_liquidation" ||
    event.type === "borrow_cost"
  );
}
