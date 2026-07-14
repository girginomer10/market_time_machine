import { useId } from "react";
import { PRACTICE_DRILL_REFLECTION_MAX_LENGTH } from "../../types";
import type {
  DrillAssessment,
  DrillAssessmentComponent,
  DrillDefinition,
  PracticeDrillCheckpointEvidence,
  PracticeDrillEventSnapshot,
  PracticeDrillReportSnapshot,
} from "../../types";
import { formatTime } from "../../utils/format";
import "./drillDebrief.css";

type Props = {
  definition: Readonly<DrillDefinition>;
  assessment: DrillAssessment;
  practiceDrill?: PracticeDrillReportSnapshot;
  previousComparableProcessScore?: number;
};

const ACTION_LABELS = {
  hold: "Hold",
  reduce: "Reduce",
  exit: "Exit",
  wait: "Wait",
} as const;

const VIOLATION_LABELS = {
  order_before_plan: "Order placed before the plan",
  checkpoint_skipped: "Checkpoint skipped",
  advance_while_checkpoint_open: "Replay advanced with a checkpoint open",
  invalid_checkpoint_response: "Invalid checkpoint response",
} as const;

const PLAN_FIELDS = [
  ["Thesis", "thesis"],
  ["Invalidation", "invalidation"],
  ["Exit plan", "exitPlan"],
  ["Accepted risk", "acceptedRisk"],
] as const;

function scoreLabel(score: number): string {
  return `${Math.round(score * 10) / 10}/100`;
}

function componentResult(component: DrillAssessmentComponent): string {
  if (component.status === "not_applicable") return "Not applicable";
  if (component.status === "insufficient_evidence" || component.score === undefined) {
    return "Not assessed";
  }
  return scoreLabel(component.score);
}

function comparisonFor(
  current: number | undefined,
  previous: number | undefined,
): { previous: string; delta: string; direction: "up" | "down" | "flat" } | undefined {
  if (
    current === undefined ||
    previous === undefined ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous)
  ) {
    return undefined;
  }
  const roundedDelta = Math.round((current - previous) * 10) / 10;
  return {
    previous: scoreLabel(previous),
    delta:
      roundedDelta === 0
        ? "No change"
        : `${roundedDelta > 0 ? "+" : ""}${roundedDelta} points`,
    direction: roundedDelta > 0 ? "up" : roundedDelta < 0 ? "down" : "flat",
  };
}

function sortableTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function chronologicalCheckpoints(
  checkpoints: readonly PracticeDrillCheckpointEvidence[],
): PracticeDrillCheckpointEvidence[] {
  return [...checkpoints].sort((left, right) =>
    left.checkpoint.replayIndex - right.checkpoint.replayIndex ||
    sortableTime(left.checkpoint.replayTime) -
      sortableTime(right.checkpoint.replayTime) ||
    left.checkpoint.id.localeCompare(right.checkpoint.id),
  );
}

function orderedCheckpointEvents(
  evidence: PracticeDrillCheckpointEvidence,
): PracticeDrillEventSnapshot[] {
  const byId = new Map(evidence.events.map((event) => [event.id, event]));
  const seen = new Set<string>();
  const ordered = evidence.checkpoint.eventIds.flatMap((eventId) => {
    const event = byId.get(eventId);
    if (!event || seen.has(event.id)) return [];
    seen.add(event.id);
    return [event];
  });
  const remaining = evidence.events
    .filter((event) => !seen.has(event.id))
    .sort((left, right) =>
      sortableTime(left.publishedAt) - sortableTime(right.publishedAt) ||
      left.id.localeCompare(right.id),
    );
  return [...ordered, ...remaining];
}

export default function DrillDebrief({
  definition,
  assessment,
  practiceDrill,
  previousComparableProcessScore,
}: Props) {
  const titleId = useId();
  const planTitleId = useId();
  const checkpointTitleId = useId();
  const violationTitleId = useId();
  const componentsTitleId = useId();
  const comparison = comparisonFor(
    assessment.overallScore,
    previousComparableProcessScore,
  );
  const checkpoints = practiceDrill
    ? chronologicalCheckpoints(practiceDrill.checkpoints)
    : [];
  const violations = practiceDrill
    ? [...practiceDrill.violations].sort((left, right) =>
        sortableTime(left.replayTime) - sortableTime(right.replayTime) ||
        left.id.localeCompare(right.id),
      )
    : [];

  return (
    <section className="drill-debrief" aria-labelledby={titleId}>
      <header className="drill-debrief-head">
        <div>
          <span>Drill debrief · Process evidence</span>
          <h2 id={titleId}>{definition.title}</h2>
          <p>
            This review assesses the decisions you documented and the rules you
            followed. It does not grade the market outcome.
          </p>
        </div>
        <span
          className={`drill-completion-status ${assessment.status}`}
          role="status"
        >
          {assessment.status === "completed" ? "Completed" : "Incomplete"}
        </span>
      </header>

      <div className="drill-debrief-summary">
        <div className="drill-process-score">
          <span>Overall process score</span>
          <strong>
            {assessment.overallScore === undefined
              ? "Not assessed"
              : scoreLabel(assessment.overallScore)}
          </strong>
          {comparison ? (
            <div className={`drill-score-comparison ${comparison.direction}`}>
              <span>Previous comparable drill: {comparison.previous}</span>
              <strong>{comparison.delta}</strong>
            </div>
          ) : null}
        </div>

        <dl className="drill-evidence-counts" aria-label="Recorded evidence counts">
          <div>
            <dt>Answered checkpoints</dt>
            <dd>
              {assessment.answeredCheckpointCount}/{assessment.eligibleCheckpointCount}
            </dd>
          </div>
          <div>
            <dt>Skipped checkpoints</dt>
            <dd>{assessment.skippedCheckpointCount}</dd>
          </div>
          <div>
            <dt>Linked visible events</dt>
            <dd>
              {assessment.linkedEventCount}/{assessment.eligibleEventCount}
            </dd>
          </div>
          <div>
            <dt>Rule violations</dt>
            <dd>{assessment.violationCount}</dd>
          </div>
        </dl>
      </div>

      {practiceDrill ? (
        <>
          <section className="drill-plan-review" aria-labelledby={planTitleId}>
            <div className="drill-debrief-section-head">
              <h3 id={planTitleId}>Initial plan</h3>
              <span>Process evidence captured for this report</span>
            </div>
            {practiceDrill.initialPlan ? (
              <dl className="drill-plan-grid">
                {PLAN_FIELDS.map(([label, field]) => (
                  <div key={field}>
                    <dt>{label}</dt>
                    <dd>{practiceDrill.initialPlan?.[field] || "Not recorded"}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="drill-evidence-empty" role="note">
                No initial plan was recorded in this report.
              </p>
            )}
          </section>

          <section
            className="drill-checkpoint-review"
            aria-labelledby={checkpointTitleId}
          >
            <div className="drill-debrief-section-head">
              <h3 id={checkpointTitleId}>Checkpoint decision record</h3>
              <span>
                {checkpoints.length} {checkpoints.length === 1 ? "checkpoint" : "checkpoints"}
              </span>
            </div>
            {checkpoints.length > 0 ? (
              <ol className="drill-checkpoint-list">
                {checkpoints.map((evidence, index) => {
                  const events = orderedCheckpointEvents(evidence);
                  const reflection = evidence.response?.reflection?.slice(
                    0,
                    PRACTICE_DRILL_REFLECTION_MAX_LENGTH,
                  );
                  return (
                    <li key={evidence.checkpoint.id}>
                      <article className="drill-checkpoint-record">
                        <header>
                          <div>
                            <span>Checkpoint {index + 1}</span>
                            <h4>{formatTime(evidence.checkpoint.replayTime)}</h4>
                          </div>
                          <span>Replay step {evidence.checkpoint.replayIndex}</span>
                        </header>

                        <div className="drill-checkpoint-events">
                          <h5>Information reviewed</h5>
                          {events.length > 0 ? (
                            <ul>
                              {events.map((event) => (
                                <li key={event.id}>
                                  <div>
                                    <strong>{event.title}</strong>
                                    <span>Importance {event.importance}/5</span>
                                  </div>
                                  <small>
                                    Published {formatTime(event.publishedAt)}
                                    {event.source ? ` · ${event.source}` : ""}
                                  </small>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>No safe event display snapshot was retained.</p>
                          )}
                        </div>

                        <div className="drill-checkpoint-response">
                          <h5>Recorded process decision</h5>
                          {evidence.response ? (
                            <>
                              <div className="drill-recorded-action">
                                <span>Action</span>
                                <strong>{ACTION_LABELS[evidence.response.action]}</strong>
                              </div>
                              {reflection ? (
                                <blockquote>{reflection}</blockquote>
                              ) : (
                                <p>
                                  No reflection was required or recorded for this
                                  checkpoint.
                                </p>
                              )}
                            </>
                          ) : (
                            <p>No answered response was recorded for this checkpoint.</p>
                          )}
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="drill-evidence-empty" role="note">
                No detailed checkpoint evidence was recorded in this report.
              </p>
            )}
          </section>

          <section className="drill-violation-review" aria-labelledby={violationTitleId}>
            <div className="drill-debrief-section-head">
              <h3 id={violationTitleId}>Rule evidence</h3>
              <span>
                {violations.length} {violations.length === 1 ? "violation" : "violations"}
              </span>
            </div>
            {violations.length > 0 ? (
              <ul className="drill-violation-list">
                {violations.map((violation) => (
                  <li key={violation.id}>
                    <div>
                      <strong>{VIOLATION_LABELS[violation.code]}</strong>
                      <time dateTime={violation.replayTime}>
                        {formatTime(violation.replayTime)}
                      </time>
                    </div>
                    <p>{violation.evidence}</p>
                    {violation.checkpointId ? (
                      <small>Checkpoint: {violation.checkpointId}</small>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="drill-evidence-empty" role="note">
                No drill-rule violations were recorded.
              </p>
            )}
          </section>
        </>
      ) : (
        <p className="drill-legacy-evidence" role="note">
          This legacy report retains its versioned process assessment, but not
          the initial plan or checkpoint decision text.
        </p>
      )}

      <section className="drill-components" aria-labelledby={componentsTitleId}>
        <div className="drill-debrief-section-head">
          <h3 id={componentsTitleId}>Process components</h3>
          <span>{assessment.components.length} components</span>
        </div>
        <ul>
          {assessment.components.map((component) => (
            <li key={component.id}>
              <div className="drill-component-title">
                <div>
                  <h4>{component.label}</h4>
                  <span>Weight {Math.round(component.weight * 100)}%</span>
                </div>
                <strong
                  className={
                    component.status === "assessed" && component.score !== undefined
                      ? "assessed"
                      : "unassessed"
                  }
                >
                  {componentResult(component)}
                </strong>
              </div>
              <p>{component.evidence}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="drill-rubric">
        <div>
          <span>Rubric</span>
          <strong>{assessment.rubricVersion}</strong>
        </div>
        <p>{assessment.methodology}</p>
      </footer>
    </section>
  );
}
