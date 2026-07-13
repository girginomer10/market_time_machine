import type { CompletedRun } from "../history/runHistory";
import type {
  PracticeRecommendation,
  ScenarioMode,
  ScenarioPackage,
} from "../../types";

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
  trackId: "foundation";
  trackTitle: string;
  completedMilestones: number;
  totalMilestones: number;
  title: string;
  objective: string;
  rationale: string;
  evidence?: string;
  scenarioId: string;
  scenarioTitle: string;
  mode: ScenarioMode;
  focusLabel: string;
  steps: readonly ["Brief", "Plan", "Review"];
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

function supportedMode(
  scenario: ScenarioPackage,
  preferred: ScenarioMode,
): ScenarioMode {
  if (scenario.meta.supportedModes.includes(preferred)) return preferred;
  if (scenario.meta.supportedModes.includes("explorer")) return "explorer";
  return scenario.meta.supportedModes[0] ?? "explorer";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPracticeRecommendation(
  value: unknown,
): value is PracticeRecommendation {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.priority === 1 || value.priority === 2 || value.priority === 3) &&
    typeof value.title === "string" &&
    typeof value.rationale === "string" &&
    typeof value.evidence === "string" &&
    typeof value.suggestedPractice === "string"
  );
}

function validRecommendations(run: CompletedRun): PracticeRecommendation[] {
  const candidate: unknown = run.report.recommendations;
  return Array.isArray(candidate)
    ? candidate.filter(isPracticeRecommendation)
    : [];
}

export function foundationMilestones(
  runs: CompletedRun[],
): PracticeMilestone[] {
  const scenarioCount = new Set(runs.map((run) => run.scenarioId)).size;
  return [
    {
      id: "complete_replay",
      title: "Complete one replay",
      description: "Finish a historical lab and unlock its evidence report.",
      complete: runs.length > 0,
    },
    {
      id: "document_every_decision",
      title: "Document every executed decision",
      description:
        "Complete a replay where every executed decision has a linked structured plan with a stated reason and risk plan.",
      complete: runs.some(hasDocumentedDecision),
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

function pct(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return `${Math.round(value * 100)}%`;
}

function targetFor(
  recommendation: PracticeRecommendation,
  run: CompletedRun,
): PracticeTarget | undefined {
  switch (recommendation.id) {
    case "complete-documented-decision":
      return {
        label: "Executed decisions",
        current: String(
          run.report.journalQuality?.executedDecisionCount ?? 0,
        ),
        target: "At least 1 documented decision",
      };
    case "journal-coverage":
      return {
        label: "Decision-note coverage",
        current: pct(run.report.journalQuality?.coverageRate),
        target: "At least 80%",
      };
    case "journal-risk-plan":
      return {
        label: "Risk-plan coverage",
        current: pct(run.report.journalQuality?.riskPlanRate),
        target: "At least 80%",
      };
    case "drawdown-control":
      return {
        label: "Maximum drawdown",
        current: pct(run.maxDrawdown),
        target: "Below 15%",
      };
    case "execution-drag": {
      const initialEquity = run.report.metrics.initialEquity;
      const drag =
        initialEquity > 0
          ? (run.report.metrics.feesPaid + run.report.metrics.slippagePaid) /
            initialEquity
          : undefined;
      return {
        label: "Execution drag",
        current: pct(drag),
        target: "Below 1% of starting equity",
      };
    }
    case "practice-exits":
      return {
        label: "Closed trade lifecycles",
        current: String(run.closedTradeCount),
        target: "At least 1",
      };
    default:
      if (recommendation.id.startsWith("behavior-")) {
        return {
          label: "Behavior check",
          target: "Review the same evidence after the next replay",
        };
      }
      return undefined;
  }
}

function preferredScenario(
  runs: CompletedRun[],
  scenarios: ScenarioPackage[],
): ScenarioPackage | undefined {
  const completedIds = new Set(runs.map((run) => run.scenarioId));
  return (
    scenarios.find((scenario) => !completedIds.has(scenario.meta.id)) ??
    scenarios.find((scenario) => scenario.meta.id === FOUNDATION_SCENARIO_ID) ??
    scenarios[0]
  );
}

export function buildPracticeCoachPlan(
  runs: CompletedRun[],
  scenarios: ScenarioPackage[],
): PracticeCoachPlan | undefined {
  const foundation =
    scenarios.find((scenario) => scenario.meta.id === FOUNDATION_SCENARIO_ID) ??
    scenarios[0];
  if (!foundation) return undefined;

  const milestones = foundationMilestones(runs);
  const completedMilestones = milestones.filter((item) => item.complete).length;
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
    trackId: "foundation" as const,
    trackTitle: "Decision Foundations",
    completedMilestones,
    totalMilestones: milestones.length,
    steps: ["Brief", "Plan", "Review"] as const,
    milestones,
  };

  if (runs.length === 0) {
    return {
      ...shared,
      kind: "first_run",
      title: "Make one complete, documented decision",
      objective:
        "Complete the EUR/GBP Brexit lab with at least one executed decision, then use the report to inspect the plan and outcome separately.",
      rationale:
        "A baseline replay gives the coach observable evidence before it recommends a narrower practice focus.",
      scenarioId: foundation.meta.id,
      scenarioTitle: foundation.meta.title,
      mode: supportedMode(foundation, "explorer"),
      focusLabel: "Structured decision baseline",
      evidenceRunCount: 0,
      ctaLabel: "Review first practice",
    };
  }

  const latest = [...runs].sort(byNewest)[0];
  const sourceScenario = scenarios.find(
    (scenario) => scenario.meta.id === latest.scenarioId,
  );
  const recommendation = validRecommendations(latest).sort(
    (left, right) => left.priority - right.priority,
  )[0];
  const fallback = sourceScenario ?? foundation;
  const availabilityNote = sourceScenario
    ? undefined
    : `The original lab is unavailable in this browser, so this focus is prepared in ${fallback.meta.title}.`;

  if (recommendation) {
    return {
      ...shared,
      kind: "next_run",
      title: recommendation.title,
      objective: recommendation.suggestedPractice,
      rationale: recommendation.rationale,
      evidence: recommendation.evidence,
      scenarioId: fallback.meta.id,
      scenarioTitle: fallback.meta.title,
      mode: supportedMode(fallback, latest.mode),
      focusLabel: recommendation.title,
      target: targetFor(recommendation, latest),
      sourceRunId: latest.id,
      sourceRunTitle: latest.scenarioTitle,
      evidenceRunCount: 1,
      availabilityNote,
      ctaLabel: "Review focused replay",
    };
  }

  const next = preferredScenario(runs, scenarios) ?? fallback;
  return {
    ...shared,
    kind: "next_run",
    title: "Broaden your regime practice",
    objective:
      "Complete a different historical regime with the same plan-before-action discipline, then compare the evidence instead of a single outcome.",
    rationale:
      "The latest report did not identify a priority process gap, so the next useful test is transfer across a different regime.",
    evidence: `Latest completed replay: ${latest.scenarioTitle}.`,
    scenarioId: next.meta.id,
    scenarioTitle: next.meta.title,
    mode: supportedMode(next, latest.mode),
    focusLabel: "Cross-regime consistency",
    sourceRunId: latest.id,
    sourceRunTitle: latest.scenarioTitle,
    evidenceRunCount: 1,
    ctaLabel: "Review next regime",
  };
}
