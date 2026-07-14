import { useId } from "react";
import type { DecisionPlan, DrillDefinition, DrillPlanField } from "../../types";
import "./activeDrillBanner.css";

export type ActiveDrillStage = "brief" | "plan" | "execute" | "review";

const STAGES: ReadonlyArray<{ id: ActiveDrillStage; label: string }> = [
  { id: "brief", label: "Brief" },
  { id: "plan", label: "Plan" },
  { id: "execute", label: "Execute" },
  { id: "review", label: "Review" },
];

type Props = {
  definition: DrillDefinition;
  stage: ActiveDrillStage;
  answeredCheckpointCount: number;
  initialPlan?: DecisionPlan;
};

function hasPlanField(plan: DecisionPlan | undefined, field: DrillPlanField): boolean {
  return Boolean(plan?.[field]?.trim());
}

function planStatus(
  definition: DrillDefinition,
  initialPlan: DecisionPlan | undefined,
): { label: string; state: "empty" | "partial" | "complete" } {
  const required = definition.initialPlanRule.requiredFields;
  if (required.length === 0) return { label: "Complete", state: "complete" };
  const present = required.filter((field) => hasPlanField(initialPlan, field)).length;
  if (present === 0) return { label: "Not started", state: "empty" };
  if (present === required.length) return { label: "Complete", state: "complete" };
  return { label: "In progress", state: "partial" };
}

export default function ActiveDrillBanner({
  definition,
  stage,
  answeredCheckpointCount,
  initialPlan,
}: Props) {
  const titleId = useId();
  const currentStageIndex = STAGES.findIndex((entry) => entry.id === stage);
  const initialPlanStatus = planStatus(definition, initialPlan);
  const answered = Math.max(0, Math.floor(answeredCheckpointCount));

  return (
    <section className="active-drill-banner" aria-labelledby={titleId}>
      <div className="active-drill-heading">
        <span>Active drill</span>
        <h2 id={titleId}>{definition.title}</h2>
      </div>

      <ol className="active-drill-stages" aria-label="Drill stage">
        {STAGES.map((entry, index) => {
          const state =
            index < currentStageIndex
              ? "complete"
              : index === currentStageIndex
                ? "current"
                : "upcoming";
          return (
            <li
              className={state}
              key={entry.id}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span aria-hidden="true">{state === "complete" ? "✓" : index + 1}</span>
              <strong>{entry.label}</strong>
              {state === "current" ? (
                <span className="visually-hidden">Current stage</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <dl className="active-drill-status">
        <div>
          <dt>Initial plan</dt>
          <dd className={initialPlanStatus.state}>{initialPlanStatus.label}</dd>
        </div>
        <div>
          <dt>Checkpoint decisions recorded</dt>
          <dd>{answered}</dd>
        </div>
      </dl>
    </section>
  );
}
