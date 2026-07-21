import { useEffect, useState, type FormEvent } from "react";
import {
  SESSION_TEXT_MAX_LENGTH,
  type JournalEntry,
  type ReplayStatus,
} from "../../types";

const journalDrafts = new Map<string, string>();

type Props = {
  draftKey?: string;
  entries: JournalEntry[];
  status: ReplayStatus;
  onAdd: (note: string) => void;
};

function dateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function DecisionJournal({
  draftKey,
  entries,
  status,
  onAdd,
}: Props) {
  const [draft, setDraft] = useState(() =>
    draftKey ? (journalDrafts.get(draftKey) ?? "") : "",
  );
  const [error, setError] = useState<string>();
  const isFinished = status === "finished";

  useEffect(() => {
    if (!draftKey) return;
    journalDrafts.set(draftKey, draft);
  }, [draft, draftKey]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    const note = draft.trim();
    if (!note) {
      setError("Write a note before adding it to the journal.");
      return;
    }
    onAdd(note);
    setDraft("");
    if (draftKey) journalDrafts.delete(draftKey);
    setError(undefined);
  }

  return (
    <div className="decision-journal">
      <form className="journal-compose" onSubmit={submit}>
        <label htmlFor="journal-note">Observation or decision note</label>
        <textarea
          id="journal-note"
          value={draft}
          maxLength={SESSION_TEXT_MAX_LENGTH}
          onChange={(event) => {
            setDraft(event.target.value.slice(0, SESSION_TEXT_MAX_LENGTH));
            setError(undefined);
          }}
          placeholder="What do you see, what is your thesis, and what would change your mind?"
          disabled={isFinished}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "journal-note-error" : undefined}
        />
        <div className="journal-compose-foot">
          <span>
            {isFinished
              ? "The replay is complete; reset it to start a new journal."
              : "General notes are timestamped at the current replay date."}
          </span>
          <button className="btn" type="submit" disabled={isFinished}>
            Add note
          </button>
        </div>
        {error ? (
          <span id="journal-note-error" className="order-edit-error" role="alert">
            {error}
          </span>
        ) : null}
      </form>

      {entries.length === 0 ? (
        <div className="empty-state journal-empty">
          Write what you see and why you are acting on it. Read it back at the
          end.
        </div>
      ) : (
        <div className="list">
          {[...entries]
            .sort((a, b) => b.time.localeCompare(a.time))
            .map((note) => (
              <div className="list-item journal-entry" key={note.id}>
                <div className="row">
                  <strong>{note.symbol ?? "General"}</strong>
                  <span className="panel-meta">{dateLabel(note.time)}</span>
                </div>
                <div className="row subtle">
                  <span>{note.note}</span>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
