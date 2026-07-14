import { useId } from "react";
import type {
  PracticeTrack,
  PracticeTrackProgress,
  PracticeTrackUnit,
  PracticeTrackUnitProgress,
} from "../../domain/practice/tracks";
import type { DrillAssessmentComponentId } from "../../types";
import "./practiceTracks.css";

type Props = {
  tracks: PracticeTrack[];
  progress: PracticeTrackProgress[];
  onPrepareUnit: (unit: PracticeTrackUnit) => void;
};

const COMPONENT_LABELS: Record<DrillAssessmentComponentId, string> = {
  plan_coverage: "Initial plan coverage",
  checkpoint_coverage: "Checkpoint coverage",
  event_linkage: "Visible-event linkage",
  rule_adherence: "Rule adherence",
};

const TRACK_PROGRESS_LABELS: Record<PracticeTrackProgress["status"], string> = {
  completed: "Completed",
  in_progress: "In progress",
  not_started: "Not started",
  preview: "Preview only",
};

const UNIT_STATUS_LABELS: Record<PracticeTrackUnitProgress["status"], string> = {
  completed: "Completed",
  incomplete: "Incomplete",
  preview: "Preview · No credit",
};

function fallbackProgress(track: PracticeTrack): PracticeTrackProgress {
  const units = track.units.map(
    (unit): PracticeTrackUnitProgress => ({
      unitId: unit.id,
      unitVersion: unit.version,
      status: unit.status === "preview" ? "preview" : "incomplete",
    }),
  );
  return {
    trackId: track.id,
    trackVersion: track.version,
    status: track.status === "preview" ? "preview" : "not_started",
    completedUnitCount: 0,
    creditableUnitCount: units.filter((unit) => unit.status !== "preview").length,
    units,
  };
}

function marketEvidenceLabel(unit: PracticeTrackUnit): string {
  return unit.evidenceScope.marketEvidence === "source_observed"
    ? "Source-observed market evidence"
    : "Synthetic sample market evidence";
}

function unitActionLabel(
  unit: PracticeTrackUnit,
  progress: PracticeTrackUnitProgress,
): string {
  if (unit.status === "preview" || progress.status === "preview") {
    return `Preview ${unit.title} — no credit`;
  }
  return progress.status === "completed"
    ? `Practice ${unit.title} again`
    : `Prepare ${unit.title}`;
}

function UnitCard({
  unit,
  progress,
  onPrepare,
}: {
  unit: PracticeTrackUnit;
  progress: PracticeTrackUnitProgress;
  onPrepare: (unit: PracticeTrackUnit) => void;
}) {
  const titleId = useId();
  const criteria = unit.completionCriteria;
  const componentCriteria = Object.entries(criteria.minimumComponentScores) as Array<
    [DrillAssessmentComponentId, number]
  >;
  const preview = unit.status === "preview" || progress.status === "preview";

  return (
    <li className={`practice-track-unit ${progress.status}`}>
      <article aria-labelledby={titleId}>
        <header className="practice-unit-head">
          <div>
            <span>Unit {unit.order}</span>
            <h4 id={titleId}>{unit.title}</h4>
          </div>
          <span className={`practice-unit-status ${progress.status}`}>
            {UNIT_STATUS_LABELS[progress.status]}
          </span>
        </header>
        <p className="practice-unit-description">{unit.description}</p>

        {preview ? (
          <p className="practice-preview-warning" role="note">
            Preview units do not award unit or track completion credit. They are
            available only to rehearse the process.
          </p>
        ) : null}

        <dl className="practice-unit-identity" aria-label="Versioned unit identity">
          <div>
            <dt>Scenario</dt>
            <dd>{unit.scenario.id}</dd>
          </div>
          <div>
            <dt>Scenario data version</dt>
            <dd>{unit.scenario.dataVersion ?? "Not versioned · Preview only"}</dd>
          </div>
          <div>
            <dt>Drill</dt>
            <dd>
              {unit.drill.id} · definition v{unit.drill.definitionVersion}
            </dd>
          </div>
          <div>
            <dt>Rubric and mode</dt>
            <dd>
              {unit.drill.rubricVersion} · {unit.drill.mode}
            </dd>
          </div>
        </dl>

        <section className="practice-evidence-disclosure" aria-label="Evidence disclosure">
          <div className="practice-unit-section-head">
            <h5>Evidence disclosure</h5>
            <span>{unit.evidenceScope.sourceReviewed ? "Source reviewed" : "Not source reviewed"}</span>
          </div>
          <dl>
            <div>
              <dt>Market evidence</dt>
              <dd>{marketEvidenceLabel(unit)}</dd>
            </div>
            <div>
              <dt>Event evidence</dt>
              <dd>Official-source publications</dd>
            </div>
            <div>
              <dt>Data fidelity</dt>
              <dd>{unit.evidenceScope.dataFidelity}</dd>
            </div>
            <div>
              <dt>Sample data</dt>
              <dd>{unit.evidenceScope.sampleData ? "Yes" : "No"}</dd>
            </div>
          </dl>
          <p className="practice-evidence-limitations">
            <strong>Limitations</strong>
            <span>{unit.evidenceScope.limitations}</span>
          </p>
        </section>

        <section className="practice-unit-criteria" aria-label="Completion criteria">
          <div className="practice-unit-section-head">
            <h5>Completion criteria</h5>
            <span>One attempt</span>
          </div>
          <p>
            Every criterion below must be met in the same completed assessment;
            evidence is not combined across runs.
          </p>
          <ul>
            <li>Overall process score ≥ {criteria.minimumOverallScore}/100</li>
            {componentCriteria.map(([id, score]) => (
              <li key={id}>
                {COMPONENT_LABELS[id]} ≥ {score}/100
              </li>
            ))}
            <li>
              Answered checkpoints ≥ {Math.round(criteria.minimumAnsweredCheckpointRate * 100)}%
            </li>
            <li>
              Linked visible events ≥ {Math.round(criteria.minimumLinkedEventRate * 100)}%
            </li>
            <li>Rule violations ≤ {criteria.maximumViolationCount}</li>
          </ul>
        </section>

        <footer className="practice-unit-footer">
          {progress.creditedAttemptId ? (
            <span>Credited attempt: {progress.creditedAttemptId}</span>
          ) : (
            <span>{preview ? "No credit can be recorded" : "No qualifying attempt yet"}</span>
          )}
          <button
            className={`btn ${progress.status === "incomplete" ? "primary" : ""}`}
            type="button"
            onClick={() => onPrepare(unit)}
          >
            {unitActionLabel(unit, progress)}
          </button>
        </footer>
      </article>
    </li>
  );
}

function TrackCard({
  track,
  progress,
  onPrepareUnit,
}: {
  track: PracticeTrack;
  progress: PracticeTrackProgress;
  onPrepareUnit: (unit: PracticeTrackUnit) => void;
}) {
  const titleId = useId();
  const unitProgress = new Map(
    progress.units.map((unit) => [`${unit.unitId}:${unit.unitVersion}`, unit]),
  );
  const orderedUnits = [...track.units].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );

  return (
    <article className={`practice-track ${track.status}`} aria-labelledby={titleId}>
      <header className="practice-track-head">
        <div>
          <div className="practice-track-labels">
            <span className={`practice-track-availability ${track.status}`}>
              {track.status === "open" ? "Open" : "Preview"}
            </span>
            <span>Track v{track.version}</span>
          </div>
          <h3 id={titleId}>{track.title}</h3>
          <p>{track.description}</p>
        </div>
        <div className={`practice-track-progress ${progress.status}`}>
          <span>{TRACK_PROGRESS_LABELS[progress.status]}</span>
          <strong>
            {progress.completedUnitCount}/{progress.creditableUnitCount}
          </strong>
          <small>validated units completed</small>
        </div>
      </header>

      <div className="practice-track-policy" role="note">
        <strong>Credit policy</strong>
        <span>
          A unit receives credit only when every criterion is met in one attempt.
          The track completes only when every validated unit is complete.
          {track.completionPolicy.minimumSourceReviewedScenarios
            ? ` At least ${track.completionPolicy.minimumSourceReviewedScenarios} distinct source-reviewed scenarios are required.`
            : ""}
        </span>
        {track.status === "preview" ? (
          <em>This preview track cannot award completion credit.</em>
        ) : null}
      </div>

      <ol className="practice-track-units">
        {orderedUnits.map((unit) => {
          const current = unitProgress.get(`${unit.id}:${unit.version}`) ?? {
            unitId: unit.id,
            unitVersion: unit.version,
            status: unit.status === "preview" ? "preview" as const : "incomplete" as const,
          };
          return (
            <UnitCard
              key={`${unit.id}:${unit.version}`}
              unit={unit}
              progress={current}
              onPrepare={onPrepareUnit}
            />
          );
        })}
      </ol>
    </article>
  );
}

export default function PracticeTracks({ tracks, progress, onPrepareUnit }: Props) {
  const titleId = useId();
  const progressByTrack = new Map(
    progress.map((entry) => [`${entry.trackId}:${entry.trackVersion}`, entry]),
  );

  return (
    <section className="practice-tracks" aria-labelledby={titleId}>
      <header className="practice-tracks-head">
        <span>Structured practice</span>
        <h2 id={titleId}>Practice tracks</h2>
        <p>
          Progress is awarded only by the exact versioned units and evidence
          criteria shown below. Preview content remains non-creditable.
        </p>
      </header>

      {tracks.length > 0 ? (
        <div className="practice-track-grid">
          {tracks.map((track) => (
            <TrackCard
              key={`${track.id}:${track.version}`}
              track={track}
              progress={
                progressByTrack.get(`${track.id}:${track.version}`) ??
                fallbackProgress(track)
              }
              onPrepareUnit={onPrepareUnit}
            />
          ))}
        </div>
      ) : (
        <div className="practice-tracks-empty" role="status">
          <strong>No practice tracks are available</strong>
          <p>The curated track catalog is empty.</p>
        </div>
      )}
    </section>
  );
}
