import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { PRACTICE_DRILL_REFLECTION_MAX_LENGTH } from "../../types";
import type {
  DrillCheckpoint,
  DrillCheckpointAction,
  DrillDefinition,
  MarketEvent,
} from "../../types";
import "./eventCheckpointDialog.css";

const ACTION_LABELS: Record<DrillCheckpointAction, string> = {
  hold: "Hold",
  reduce: "Reduce",
  exit: "Exit",
  wait: "Wait",
};

/** @deprecated Prefer the shared report/store boundary constant. */
export const CHECKPOINT_REFLECTION_MAX_LENGTH =
  PRACTICE_DRILL_REFLECTION_MAX_LENGTH;

type Props = {
  definition: DrillDefinition;
  checkpoint: DrillCheckpoint;
  visibleEvents: readonly MarketEvent[];
  onSubmit: (action: DrillCheckpointAction, reflection: string) => void;
};

function publishedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getAttribute("aria-hidden") !== "true");
}

export default function EventCheckpointDialog({
  definition,
  checkpoint,
  visibleEvents,
  onSubmit,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const requirementId = useId();
  const reflectionId = useId();
  const reflectionLabelId = useId();
  const reflectionHelpId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstActionRef = useRef<HTMLInputElement | null>(null);
  const [action, setAction] = useState<DrillCheckpointAction>();
  const [reflection, setReflection] = useState("");
  const reflectionRequired = definition.checkpointRule.requireReflection;

  const checkpointEvents = useMemo(() => {
    const byId = new Map(visibleEvents.map((event) => [event.id, event]));
    return checkpoint.eventIds.flatMap((eventId) => {
      const event = byId.get(eventId);
      return event ? [event] : [];
    });
  }, [checkpoint.eventIds, visibleEvents]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    firstActionRef.current?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
    };
  }, []);

  const canSubmit =
    action !== undefined &&
    (!reflectionRequired || reflection.trim().length > 0);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmedReflection = reflection.trim();
    if (!action || (reflectionRequired && !trimmedReflection)) return;
    onSubmit(action, trimmedReflection);
  }

  return (
    <div className="checkpoint-overlay">
      <div
        className="checkpoint-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${requirementId}`}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="checkpoint-dialog-head">
          <span>Mandatory decision checkpoint</span>
          <h2 id={titleId}>New information is now visible</h2>
          <p id={descriptionId}>
            Review only the evidence available at this replay moment, then state
            what you will do before continuing.
          </p>
        </header>

        <section
          className="checkpoint-events"
          aria-labelledby={`${titleId}-events`}
        >
          <div className="checkpoint-section-title">
            <h3 id={`${titleId}-events`}>Visible events</h3>
            <span>
              {checkpointEvents.length} {checkpointEvents.length === 1 ? "event" : "events"}
            </span>
          </div>
          {checkpointEvents.length > 0 ? (
            <ol>
              {checkpointEvents.map((event) => (
                <li key={event.id}>
                  <div className="checkpoint-event-meta">
                    <span>Importance {event.importance}/5</span>
                    <time dateTime={event.publishedAt}>
                      Published {publishedLabel(event.publishedAt)} UTC
                    </time>
                  </div>
                  <h4>{event.title}</h4>
                  <p>{event.summary}</p>
                  {event.sourceUrl ? (
                    <a href={event.sourceUrl} target="_blank" rel="noreferrer">
                      {event.source ? `Source: ${event.source}` : "View source"}
                    </a>
                  ) : event.source ? (
                    <small>Source: {event.source}</small>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="checkpoint-events-missing" role="note">
              Event details are unavailable in the current visible snapshot.
            </p>
          )}
        </section>

        <form className="checkpoint-response" onSubmit={submit}>
          <fieldset>
            <legend>What is your decision?</legend>
            <div className="checkpoint-actions">
              {definition.checkpointRule.actions.map((candidate, index) => (
                <label key={candidate} className={action === candidate ? "selected" : ""}>
                  <input
                    ref={index === 0 ? firstActionRef : undefined}
                    type="radio"
                    name="checkpoint-action"
                    value={candidate}
                    checked={action === candidate}
                    onChange={() => setAction(candidate)}
                    required
                  />
                  <span>{ACTION_LABELS[candidate]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="checkpoint-reflection" htmlFor={reflectionId}>
            <span id={reflectionLabelId}>
              What changed in your plan or risk?
              <em aria-hidden="true">
                {reflectionRequired ? "Required" : "Optional"}
              </em>
            </span>
            <textarea
              id={reflectionId}
              value={reflection}
              onChange={(event) =>
                setReflection(
                  event.target.value.slice(0, CHECKPOINT_REFLECTION_MAX_LENGTH),
                )
              }
              rows={4}
              required={reflectionRequired}
              aria-required={reflectionRequired}
              aria-labelledby={reflectionLabelId}
              aria-describedby={reflectionHelpId}
              maxLength={CHECKPOINT_REFLECTION_MAX_LENGTH}
              placeholder="Name the new evidence and the specific plan or risk change."
            />
            <small id={reflectionHelpId}>
              {reflectionRequired ? "Required" : "Optional"} · {reflection.length}
              /{CHECKPOINT_REFLECTION_MAX_LENGTH} characters
            </small>
          </label>

          <div className="checkpoint-submit-row">
            <p id={requirementId}>
              {reflectionRequired
                ? "This checkpoint cannot be dismissed. A decision and reflection are required to continue."
                : "This checkpoint cannot be dismissed. Choose a decision to continue; reflection is optional for this drill."}
            </p>
            <button className="btn primary" type="submit" disabled={!canSubmit}>
              Record decision and continue
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
