import type { CompletedRun } from "../history/runHistory";
import type { PracticeLedgerEntry } from "../history/practiceLedger";
import type {
  DrillAssessment,
  DrillAssessmentComponent,
  DrillAssessmentComponentId,
  DrillDefinition,
  ScenarioMode,
  ScenarioPackage,
} from "../../types";
import {
  EVENT_DISCIPLINE_EURGBP_V1_ID,
  getBuiltInDrill,
  listAvailableDrills,
  listBuiltInDrills,
} from "../../data/practice/drills";

export const PRACTICE_COACH_RUBRIC_VERSION = "practice-coach-v1";
export const FOUNDATION_SCENARIO_ID = "eurgbp-brexit-2016";

export type PracticeMilestoneId =
  | "complete_replay"
  | "document_every_decision"
  | "practice_two_scenarios";

export type PracticeMilestone = {
  id: PracticeMilestoneId;
  title: string;
  description: string;
  complete: boolean;
};

export type PracticeTarget = {
  label: string;
  current?: string;
  target: string;
};

export type PracticeCoachPlan = {
  kind: "first_run" | "next_run";
  rubricVersion: typeof PRACTICE_COACH_RUBRIC_VERSION;
  trackId: "orientation";
  trackTitle: string;
  completedMilestones: number;
  totalMilestones: number;
  title: string;
  objective: string;
  rationale: string;
  evidence?: string;
  scenarioId: string;
  scenarioTitle: string;
  drillId: string;
  drillTitle: string;
  mode: ScenarioMode;
  focusLabel: string;
  steps: readonly ["Brief", "Plan", "Execute", "Review"];
  milestones: PracticeMilestone[];
  target?: PracticeTarget;
  sourceRunId?: string;
  sourceRunTitle?: string;
  evidenceRunCount: number;
  availabilityNote?: string;
  ctaLabel: string;
};

function byNewest(left: CompletedRun, right: CompletedRun): number {
  return Date.parse(right.completedAt) - Date.parse(left.completedAt);
}

function hasDocumentedDecision(run: CompletedRun): boolean {
  const quality = run.report.journalQuality;
  if (!quality || quality.executedDecisionCount < 1) return false;
  return (
    quality.linkedEntryCount >= quality.executedDecisionCount &&
    (quality.structuredPlanRate ?? 0) >= 1 &&
    quality.reasonRate >= 1 &&
    quality.riskPlanRate >= 1
  );
}

export function foundationMilestones(
  runs: CompletedRun[],
  ledger: readonly PracticeLedgerEntry[] = [],
): PracticeMilestone[] {
  const useLedger = ledger.length > 0;
  const scenarioCount = new Set(
    useLedger
      ? ledger.map((entry) => entry.scenarioId)
      : runs.map((run) => run.scenarioId),
  ).size;
  return [
    {
      id: "complete_replay",
      title: "Complete one observable decision",
      description:
        "Finish a historical lab with at least one executed decision so the report has process evidence.",
      complete: useLedger
        ? ledger.some((entry) => entry.facts.executionCount > 0)
        : runs.some((run) => run.executionCount > 0),
    },
    {
      id: "document_every_decision",
      title: "Document every executed decision",
      description:
        "Complete a replay where every executed decision has a linked structured plan with a stated reason and risk plan.",
      complete: useLedger
        ? ledger.some(
            (entry) =>
              entry.facts.executedDecisionCount > 0 &&
              entry.facts.linkedDecisionCount >=
                entry.facts.executedDecisionCount &&
              (entry.facts.structuredPlanRate ?? 0) >= 1 &&
              (entry.facts.reasonRate ?? 0) >= 1 &&
              (entry.facts.riskPlanRate ?? 0) >= 1,
          )
        : runs.some(hasDocumentedDecision),
    },
    {
      id: "practice_two_scenarios",
      title: "Practice across two regimes",
      description:
        "Complete two different scenarios before treating one result as a pattern.",
      complete: scenarioCount >= 2,
    },
  ];
}

type PracticeAttempt = {
  runId: string;
  completedAt: string;
  scenarioId: string;
  scenarioTitle: string;
  assessment: DrillAssessment;
};

const COMPONENT_TARGETS: Record<DrillAssessmentComponentId, number> = {
  plan_coverage: 80,
  checkpoint_coverage: 100,
  event_linkage: 100,
  rule_adherence: 100,
};

const COMPONENT_PRACTICE: Record<
  DrillAssessmentComponentId,
  { title: string; objective: string; focus: string }
> = {
  plan_coverage: {
    title: "Complete the plan before taking risk",
    objective:
      "Open at least one position only after recording the thesis, invalidation, exit plan, and accepted risk, then preserve that plan in the final debrief.",
    focus: "Initial plan coverage",
  },
  checkpoint_coverage: {
    title: "Answer every event checkpoint",
    objective:
      "Execute one planned position and record Hold, Reduce, Exit, or Wait at every checkpoint without leaving a decision unresolved.",
    focus: "Checkpoint coverage",
  },
  event_linkage: {
    title: "Link each decision to visible evidence",
    objective:
      "At every checkpoint, use the visible event set in the decision reflection and explain what changed before choosing an action.",
    focus: "Visible-event linkage",
  },
  rule_adherence: {
    title: "Complete one clean process run",
    objective:
      "Execute one fully planned position, answer every checkpoint in order, and finish without bypassing a plan or an open checkpoint.",
    focus: "Rule adherence",
  },
};

function practiceAttempts(
  runs: readonly CompletedRun[],
  ledger: readonly PracticeLedgerEntry[],
): PracticeAttempt[] {
  if (ledger.length > 0) {
    return ledger.flatMap((entry) =>
      entry.assessment
        ? [
            {
              runId: entry.runId,
              completedAt: entry.completedAt,
              scenarioId: entry.scenarioId,
              scenarioTitle: entry.scenarioTitle,
              assessment: entry.assessment,
            },
          ]
        : [],
    );
  }
  return runs.flatMap((run) =>
    run.report.practiceAssessment
      ? [
          {
            runId: run.id,
            completedAt: run.completedAt,
            scenarioId: run.scenarioId,
            scenarioTitle: run.scenarioTitle,
            assessment: run.report.practiceAssessment,
          },
        ]
      : [],
  );
}

function newestAttempt(attempts: readonly PracticeAttempt[]): PracticeAttempt | undefined {
  return [...attempts].sort(
    (left, right) =>
      Date.parse(right.completedAt) - Date.parse(left.completedAt) ||
      left.runId.localeCompare(right.runId),
  )[0];
}

function availableDefinitionFor(
  attempt: PracticeAttempt,
  scenarios: readonly ScenarioPackage[],
): DrillDefinition | undefined {
  return listAvailableDrills(scenarios).find(
    (definition) =>
      definition.scenarioId === attempt.scenarioId &&
      definition.id === attempt.assessment.drillId &&
      definition.definitionVersion === attempt.assessment.definitionVersion &&
      definition.rubricVersion === attempt.assessment.rubricVersion,
  );
}

function weakestComponent(
  assessment: DrillAssessment,
): DrillAssessmentComponent | undefined {
  return assessment.components
    .filter(
      (component) =>
        component.status === "assessed" && component.score !== undefined,
    )
    .sort(
      (left, right) =>
        (left.score ?? 100) - (right.score ?? 100) ||
        left.id.localeCompare(right.id),
    )
    .find(
      (component) =>
        (component.score ?? 0) < COMPONENT_TARGETS[component.id],
    );
}

function nextBuiltInDefinition(
  scenarios: readonly ScenarioPackage[],
  completedScenarioIds: ReadonlySet<string>,
): DrillDefinition | undefined {
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.meta.id));
  const available = listBuiltInDrills().filter((definition) =>
    scenarioIds.has(definition.scenarioId),
  );
  return (
    available.find(
      (definition) => !completedScenarioIds.has(definition.scenarioId),
    ) ?? available[0]
  );
}

function definitionDestination(
  definition: DrillDefinition | undefined,
  scenarios: readonly ScenarioPackage[],
  foundation: ScenarioPackage,
): { definition: DrillDefinition; scenario: ScenarioPackage } | undefined {
  const fallback = getBuiltInDrill(EVENT_DISCIPLINE_EURGBP_V1_ID);
  const resolved = definition ?? fallback;
  if (!resolved) return undefined;
  const scenario =
    scenarios.find((candidate) => candidate.meta.id === resolved.scenarioId) ??
    foundation;
  const compatible =
    resolved.scenarioId === scenario.meta.id ? resolved : fallback;
  return compatible ? { definition: compatible, scenario } : undefined;
}

export function buildPracticeCoachPlan(
  runs: CompletedRun[],
  scenarios: ScenarioPackage[],
  ledger: readonly PracticeLedgerEntry[] = [],
): PracticeCoachPlan | undefined {
  const foundation =
    scenarios.find((scenario) => scenario.meta.id === FOUNDATION_SCENARIO_ID) ??
    scenarios[0];
  if (!foundation) return undefined;

  const milestones = foundationMilestones(runs, ledger);
  const completedMilestones = milestones.filter((item) => item.complete).length;
  const evidenceRunCount = ledger.length > 0 ? ledger.length : runs.length;
  const shared: Pick<
    PracticeCoachPlan,
    | "rubricVersion"
    | "trackId"
    | "trackTitle"
    | "completedMilestones"
    | "totalMilestones"
    | "steps"
    | "milestones"
  > = {
    rubricVersion: PRACTICE_COACH_RUBRIC_VERSION,
    trackId: "orientation" as const,
    trackTitle: "Practice orientation",
    completedMilestones,
    totalMilestones: milestones.length,
    steps: ["Brief", "Plan", "Execute", "Review"] as const,
    milestones,
  };

  if (runs.length === 0 && ledger.length === 0) {
    const first = definitionDestination(undefined, scenarios, foundation);
    if (!first) return undefined;
    return {
      ...shared,
      kind: "first_run",
      title: "Complete one versioned decision drill",
      objective:
        "Execute at least one position from a complete written plan, then answer every Event Discipline checkpoint before reviewing the evidence.",
      rationale:
        "The coach needs one completed, process-scored drill before it can identify a measured component to repeat or transfer.",
      scenarioId: first.scenario.meta.id,
      scenarioTitle: first.scenario.meta.title,
      drillId: first.definition.id,
      drillTitle: first.definition.title,
      mode: first.definition.mode,
      focusLabel: "Versioned process baseline",
      target: {
        label: "Completed Event Discipline attempts",
        current: "0",
        target: "1 completed attempt",
      },
      evidenceRunCount: 0,
      ctaLabel: "Review first practice",
    };
  }

  const attempts = practiceAttempts(runs, ledger);
  const latestAttempt = newestAttempt(attempts);
  const latestRun = [...runs].sort(byNewest)[0];
  const sourceRun = latestAttempt
    ? runs.find((run) => run.id === latestAttempt.runId)
    : latestRun;

  if (!latestAttempt) {
    const first = definitionDestination(undefined, scenarios, foundation);
    if (!first) return undefined;
    const sourceScenarioAvailable = latestRun
      ? scenarios.some((scenario) => scenario.meta.id === latestRun.scenarioId)
      : true;
    return {
      ...shared,
      kind: "next_run",
      title: "Create the first comparable process record",
      objective:
        "Execute at least one position from a complete plan and answer every Event Discipline checkpoint so the result can enter the versioned evidence profile.",
      rationale:
        "Ordinary replay recommendations remain visible in their report, but this coach only assigns behavior the selected drill actually measures.",
      evidence: latestRun
        ? `${latestRun.scenarioTitle} has no completed versioned drill assessment.`
        : `Compact ledger: ${evidenceRunCount} factual attempt${evidenceRunCount === 1 ? "" : "s"}, with no versioned drill assessment.`,
      scenarioId: first.scenario.meta.id,
      scenarioTitle: first.scenario.meta.title,
      drillId: first.definition.id,
      drillTitle: first.definition.title,
      mode: first.definition.mode,
      focusLabel: "Comparable process evidence",
      target: {
        label: "Versioned drill status",
        current: "No completed assessment",
        target: "1 completed Event Discipline attempt",
      },
      sourceRunId: sourceRun?.id,
      sourceRunTitle: sourceRun?.scenarioTitle,
      evidenceRunCount,
      availabilityNote:
        !sourceScenarioAvailable && latestRun
          ? `The original lab is unavailable in this browser, so the first measured drill is prepared in ${first.scenario.meta.title}.`
          : runs.length === 0
          ? "Recent full reports are unavailable; this assignment uses the compact ledger without inventing a recommendation from missing detail."
          : undefined,
      ctaLabel: "Review next practice",
    };
  }

  const exactDefinition = availableDefinitionFor(latestAttempt, scenarios);
  const currentDestination = definitionDestination(
    exactDefinition,
    scenarios,
    foundation,
  );
  if (!currentDestination) return undefined;
  const unavailableNote = exactDefinition
    ? runs.length === 0
      ? "The detailed source report has expired; the compact ledger still preserves this versioned assessment."
      : undefined
    : `The exact source drill is no longer available, so the next attempt uses ${currentDestination.definition.title} without merging the old evidence.`;

  if (latestAttempt.assessment.status !== "completed") {
    const { assessment } = latestAttempt;
    return {
      ...shared,
      kind: "next_run",
      title: "Finish every drill requirement",
      objective:
        "Execute at least one fully planned position, answer every checkpoint in replay order, and finish without a skipped decision.",
      rationale:
        "An incomplete attempt can diagnose missing evidence, but it cannot create an assessed competency claim or earn track credit.",
      evidence: `${assessment.answeredCheckpointCount}/${assessment.eligibleCheckpointCount} checkpoints answered · ${assessment.linkedEventCount}/${assessment.eligibleEventCount} events linked · ${assessment.violationCount} violations.`,
      scenarioId: currentDestination.scenario.meta.id,
      scenarioTitle: currentDestination.scenario.meta.title,
      drillId: currentDestination.definition.id,
      drillTitle: currentDestination.definition.title,
      mode: currentDestination.definition.mode,
      focusLabel: "Complete evidence",
      target: {
        label: "Drill status",
        current: "Incomplete",
        target: "Completed with a full plan and every checkpoint answered",
      },
      sourceRunId: sourceRun?.id,
      sourceRunTitle: latestAttempt.scenarioTitle,
      evidenceRunCount,
      availabilityNote: unavailableNote,
      ctaLabel: "Review completion practice",
    };
  }

  const weak = weakestComponent(latestAttempt.assessment);
  if (weak) {
    const practice = COMPONENT_PRACTICE[weak.id];
    const target = COMPONENT_TARGETS[weak.id];
    return {
      ...shared,
      kind: "next_run",
      title: practice.title,
      objective: practice.objective,
      rationale:
        "This assignment comes from the lowest measured Event Discipline component and repeats the exact drill context when it is still available.",
      evidence: `${weak.label}: ${Math.round(weak.score ?? 0)}% in ${latestAttempt.scenarioTitle}.`,
      scenarioId: currentDestination.scenario.meta.id,
      scenarioTitle: currentDestination.scenario.meta.title,
      drillId: currentDestination.definition.id,
      drillTitle: currentDestination.definition.title,
      mode: currentDestination.definition.mode,
      focusLabel: practice.focus,
      target: {
        label: weak.label,
        current: `${Math.round(weak.score ?? 0)}%`,
        target: `At least ${target}%`,
      },
      sourceRunId: sourceRun?.id,
      sourceRunTitle: latestAttempt.scenarioTitle,
      evidenceRunCount,
      availabilityNote: unavailableNote,
      ctaLabel: "Review measured practice",
    };
  }

  const completedScenarioIds = new Set(
    attempts
      .filter((attempt) => attempt.assessment.status === "completed")
      .map((attempt) => attempt.scenarioId),
  );
  const nextDefinition = nextBuiltInDefinition(
    scenarios,
    completedScenarioIds,
  );
  const nextDestination = definitionDestination(
    nextDefinition ?? exactDefinition,
    scenarios,
    foundation,
  );
  if (!nextDestination) return undefined;
  const isTransfer =
    nextDestination.scenario.meta.id !== latestAttempt.scenarioId;
  return {
    ...shared,
    kind: "next_run",
    title: isTransfer
      ? "Transfer clean Event Discipline to a new regime"
      : "Repeat the same context for a comparable trend",
    objective: isTransfer
      ? "Apply the same complete-plan and event-response process in the next available regime, without combining criteria across attempts."
      : "Repeat the exact scenario, drill, mode, and broker context so the evidence profile can make an honest trend comparison.",
    rationale: isTransfer
      ? "Every measured component met the shipped threshold; the next useful test is whether the same process transfers to another regime."
      : "All available built-in regimes already have a completed attempt, so another exact-context observation is more useful than a vague new score.",
    evidence: `Latest completed process score: ${Math.round(latestAttempt.assessment.overallScore ?? 0)}% on ${latestAttempt.scenarioTitle}.`,
    scenarioId: nextDestination.scenario.meta.id,
    scenarioTitle: nextDestination.scenario.meta.title,
    drillId: nextDestination.definition.id,
    drillTitle: nextDestination.definition.title,
    mode: nextDestination.definition.mode,
    focusLabel: isTransfer
      ? "Cross-regime process transfer"
      : "Comparable process trend",
    target: {
      label: "Event Discipline process",
      current: `${Math.round(latestAttempt.assessment.overallScore ?? 0)}%`,
      target: "Completed attempt with every component at its shipped threshold",
    },
    sourceRunId: sourceRun?.id,
    sourceRunTitle: latestAttempt.scenarioTitle,
    evidenceRunCount,
    availabilityNote: unavailableNote,
    ctaLabel: isTransfer ? "Review transfer practice" : "Review repeat practice",
  };
}
