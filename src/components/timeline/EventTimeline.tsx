import type { MarketEvent } from "../../types";

type Props = {
  events: MarketEvent[];
  eventNumbers: Map<string, number>;
  hoveredEventId?: string;
  onHoverEvent: (id?: string) => void;
};

function eventTone(event: MarketEvent): string {
  if (event.sentiment === "positive") return "positive";
  if (event.sentiment === "negative") return "negative";
  if (event.sentiment === "mixed") return "mixed";
  return "neutral";
}

function eventDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 10);
}

export default function EventTimeline({
  events,
  eventNumbers,
  hoveredEventId,
  onHoverEvent,
}: Props) {
  const sorted = [...events].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );

  if (sorted.length === 0) {
    return (
      <div className="timeline-empty">
        No events have been published in the visible replay window yet.
      </div>
    );
  }

  return (
    <div className="event-list" aria-label="Event timeline">
      {sorted.map((event) => {
        const number = eventNumbers.get(event.id) ?? 0;
        return (
          <article
            className={
              hoveredEventId === event.id ? "event-row active" : "event-row"
            }
            key={event.id}
            onMouseEnter={() => onHoverEvent(event.id)}
            onMouseLeave={() => onHoverEvent(undefined)}
          >
            <div className={`event-num ${eventTone(event)}`}>{number}</div>
            <div className="event-body">
              <div className="event-meta">
                <span>{eventDate(event.publishedAt)}</span>
                <span className={`event-tag ${eventTone(event)}`}>
                  {event.type.replace(/_/g, " ")}
                </span>
                <span>importance {event.importance}/5</span>
                {event.sourceUrl ? (
                  <a
                    className="event-source-link"
                    href={event.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {event.source ?? "Source"}
                  </a>
                ) : event.source ? (
                  <span className="event-source">{event.source}</span>
                ) : null}
              </div>
              <strong>{event.title}</strong>
              <p>{event.summary}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
