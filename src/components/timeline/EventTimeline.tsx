import type { MarketEvent } from "../../types";

type Props = {
  events: MarketEvent[];
};

function dotClassFor(sentiment: MarketEvent["sentiment"]): string {
  switch (sentiment) {
    case "positive":
      return "dot pos";
    case "negative":
      return "dot neg";
    case "mixed":
      return "dot warn";
    case "neutral":
      return "dot mixed";
    default:
      return "dot";
  }
}

export default function EventTimeline({ events }: Props) {
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
    <div className="list" aria-label="Event timeline">
      {sorted.map((event) => (
        <div className="list-item" key={event.id}>
          <div className="row">
            <div className="timeline-event-importance">
              <span className={dotClassFor(event.sentiment)} />
              <strong>{event.title}</strong>
            </div>
            <span className="panel-sub">
              {new Date(event.publishedAt).toISOString().slice(0, 10)}
            </span>
          </div>
          <div className="row subtle">
            <span>{event.summary}</span>
          </div>
          <div className="row subtle">
            <span>{event.type.replace(/_/g, " ")}</span>
            <span>importance {event.importance}/5</span>
          </div>
        </div>
      ))}
    </div>
  );
}
