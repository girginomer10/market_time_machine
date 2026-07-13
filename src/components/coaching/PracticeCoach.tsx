import type { PracticeCoachPlan } from "../../domain/coaching/practiceCoach";
import { scenarioModeLabel } from "../../utils/scenarioMode";
import "./practiceCoach.css";

type Props = {
  plan: PracticeCoachPlan;
  onPrepare: (scenarioId: string, mode: PracticeCoachPlan["mode"]) => void;
  onViewSource?: (runId: string) => void;
};

export default function PracticeCoach({
  plan,
  onPrepare,
  onViewSource,
}: Props) {
  const progress = Math.round(
    (plan.completedMilestones / Math.max(1, plan.totalMilestones)) * 100,
  );

  return (
    <section className="practice-coach" aria-labelledby="practice-coach-title">
      <header className="practice-coach-head">
        <div>
          <span className="practice-coach-eyebrow">
            V2 preview · Personal Decision Gym
          </span>
          <h2 id="practice-coach-title">
            {plan.kind === "first_run" ? "Today’s practice" : "Next practice"}
          </h2>
        </div>
        <div className="practice-track-progress">
          <span>
            {plan.trackTitle} · {plan.completedMilestones}/{plan.totalMilestones}
          </span>
          <div
            className="practice-progress-bar"
            role="progressbar"
            aria-label={`${plan.trackTitle} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      </header>

      <div className="practice-assignment">
        <div className="practice-assignment-main">
          <span className="practice-focus">Focus · {plan.focusLabel}</span>
          <h3>{plan.title}</h3>
          <p>{plan.objective}</p>
          <div className="practice-scenario">
            <strong>{plan.scenarioTitle}</strong>
            <span>{scenarioModeLabel(plan.mode)} mode</span>
          </div>
          <ol className="practice-steps" aria-label="Practice loop">
            {plan.steps.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        <aside className="practice-evidence" aria-label="Why this practice">
          <strong>Why this practice</strong>
          <p>{plan.rationale}</p>
          {plan.evidence ? <blockquote>{plan.evidence}</blockquote> : null}
          {plan.target ? (
            <dl className="practice-target">
              <div>
                <dt>{plan.target.label}</dt>
                <dd>{plan.target.current ?? "Not yet measured"}</dd>
              </div>
              <div>
                <dt>Next target</dt>
                <dd>{plan.target.target}</dd>
              </div>
            </dl>
          ) : null}
          {plan.availabilityNote ? (
            <p className="practice-availability" role="note">
              {plan.availabilityNote}
            </p>
          ) : null}
          <small className="practice-provenance">
            <span>
              {plan.sourceRunTitle
                ? `Source run: ${plan.sourceRunTitle}`
                : "Onboarding baseline"}
            </span>
            <span>
              Evidence sample: {plan.evidenceRunCount}{" "}
              {plan.evidenceRunCount === 1 ? "run" : "runs"}
            </span>
            <span>Rubric: {plan.rubricVersion}</span>
          </small>
        </aside>
      </div>

      <div className="practice-coach-foot">
        <ol className="practice-milestones" aria-label="Foundation milestones">
          {plan.milestones.map((milestone) => (
            <li className={milestone.complete ? "complete" : "pending"} key={milestone.id}>
              <span aria-hidden="true">{milestone.complete ? "✓" : "○"}</span>
              <div>
                <strong>{milestone.title}</strong>
                <small>{milestone.description}</small>
              </div>
              <em>{milestone.complete ? "Complete" : "Pending"}</em>
            </li>
          ))}
        </ol>
        <div className="practice-actions">
          {plan.sourceRunId && onViewSource ? (
            <button
              className="btn"
              type="button"
              onClick={() => onViewSource(plan.sourceRunId!)}
            >
              View source report
            </button>
          ) : null}
          <button
            className="btn primary"
            type="button"
            onClick={() => onPrepare(plan.scenarioId, plan.mode)}
          >
            {plan.ctaLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
