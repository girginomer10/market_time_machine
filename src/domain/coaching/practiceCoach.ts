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
import {
  assessmentMatchesCheckpointScheduleFingerprint,
  assessmentMatchesRubricFingerprint,
  buildDrillCheckpointSchedule,
  drillCheckpointScheduleFingerprint,
  drillRubricFingerprint,
} from "../practice/drills";
import { completedPracticeAssessmentScore } from "../practice/evidenceProfile";
import {
  canonicalScenarioDataVersion,
  scenarioDataVersionsEqual,
} from "../../data/scenarios/dataVersions";
import {
  brokerConfigFingerprint,
  getBrokerPreset,
  isBrokerConfigFingerprint,
} from "../broker/executionModels";

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
  scenarioDataVersion: string | null;
  brokerMode: CompletedRun["brokerMode"];
  brokerFingerprint: string;
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

export type PracticeCoachStartContext = Pick<
  PracticeCoachPlan,
  "scenarioDataVersion" | "brokerMode" | "brokerFingerprint"
>;

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
  const observableAttempts = useLedger
    ? ledger.filter((entry) => entry.facts.executionCount > 0)
    : runs.filter((run) => run.executionCount > 0);
  const scenarioCount = new Set(
    observableAttempts.map((attempt) => attempt.scenarioId),
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
  scenarioDataVersion: string | null;
  mode: ScenarioMode;
  brokerMode: CompletedRun["brokerMode"];
  brokerFingerprint?: string;
  executionCount: number;
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
              scenarioDataVersion: canonicalScenarioDataVersion(
                entry.scenarioId,
                entry.scenarioDataVersion,
              ),
              mode: entry.mode,
              brokerMode: entry.brokerMode,
              brokerFingerprint: entry.brokerFingerprint,
              executionCount: entry.facts.executionCount,
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
            scenarioDataVersion: canonicalScenarioDataVersion(
              run.scenarioId,
              run.report.provenance?.dataVersion,
            ),
            mode: run.mode,
            brokerMode: run.brokerMode,
            brokerFingerprint: run.brokerFingerprint,
            executionCount: run.executionCount,
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
  const scenario = scenarios.find(
    (candidate) => candidate.meta.id === attempt.scenarioId,
  );
  if (
    !scenario ||
    !scenarioDataVersionsEqual(
      attempt.scenarioId,
      attempt.scenarioDataVersion,
      scenario.meta.dataVersion,
    )
  ) {
    return undefined;
  }
  return listAvailableDrills(scenarios).find(
    (definition) =>
      definition.scenarioId === attempt.scenarioId &&
      definition.mode === attempt.mode &&
      definition.id === attempt.assessment.drillId &&
      definition.competencyId === attempt.assessment.competencyId &&
      definition.definitionVersion === attempt.assessment.definitionVersion &&
      definition.rubricVersion === attempt.assessment.rubricVersion &&
      assessmentMatchesRubricFingerprint(
        attempt.assessment,
        drillRubricFingerprint(definition.rubric),
      ) &&
      assessmentMatchesCheckpointScheduleFingerprint(attempt.assessment) &&
      attempt.assessment.checkpointScheduleFingerprint ===
        drillCheckpointScheduleFingerprint(
          buildDrillCheckpointSchedule(definition, scenario),
        ),
  );
}

function currentDefinitionForAttempt(
  attempt: PracticeAttempt,
  scenarios: readonly ScenarioPackage[],
): DrillDefinition | undefined {
  return listAvailableDrills(scenarios).find(
    (definition) =>
      definition.scenarioId === attempt.scenarioId &&
      definition.mode === attempt.mode &&
      definition.id === attempt.assessment.drillId &&
      definition.competencyId === attempt.assessment.competencyId &&
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

function definitionsHaveExactIdentity(
  left: DrillDefinition,
  right: DrillDefinition,
): boolean {
  return (
    left.scenarioId === right.scenarioId &&
    left.id === right.id &&
    left.competencyId === right.competencyId &&
    left.definitionVersion === right.definitionVersion &&
    left.rubricVersion === right.rubricVersion &&
    drillRubricFingerprint(left.rubric) ===
      drillRubricFingerprint(right.rubric) &&
    left.mode === right.mode
  );
}

function builtInDefinitionFor(
  definition: DrillDefinition,
): DrillDefinition | undefined {
  return listBuiltInDrills().find((candidate) =>
    definitionsHaveExactIdentity(candidate, definition),
  );
}

function definitionsShareTransferContract(
  source: DrillDefinition,
  candidate: DrillDefinition,
): boolean {
  return (
    source.competencyId === candidate.competencyId &&
    source.rubricVersion === candidate.rubricVersion &&
    drillRubricFingerprint(source.rubric) ===
      drillRubricFingerprint(candidate.rubric) &&
    source.mode === candidate.mode
  );
}

function practiceDefinitionContextKey(
  definition: DrillDefinition,
  dataVersion: string | null | undefined,
  brokerMode: CompletedRun["brokerMode"],
  brokerFingerprint: string,
): string {
  return JSON.stringify([
    definition.scenarioId,
    canonicalScenarioDataVersion(definition.scenarioId, dataVersion),
    definition.competencyId,
    definition.id,
    definition.definitionVersion,
    definition.rubricVersion,
    drillRubricFingerprint(definition.rubric),
    definition.mode,
    brokerMode,
    brokerFingerprint,
  ]);
}

function brokerForContext(
  scenario: ScenarioPackage,
  brokerMode: CompletedRun["brokerMode"],
) {
  return brokerMode === "scenario"
    ? scenario.broker
    : {
        ...getBrokerPreset(brokerMode),
        baseCurrency: scenario.meta.baseCurrency,
      };
}

function attemptHasCurrentBrokerIdentity(
  attempt: PracticeAttempt,
  scenario: ScenarioPackage,
): boolean {
  return Boolean(
    isBrokerConfigFingerprint(attempt.brokerFingerprint) &&
      attempt.brokerFingerprint ===
        brokerConfigFingerprint(brokerForContext(scenario, attempt.brokerMode)),
  );
}

function nextBuiltInDefinition(
  scenarios: readonly ScenarioPackage[],
  completedDefinitionContexts: ReadonlySet<string>,
  sourceDefinition: DrillDefinition,
): DrillDefinition | undefined {
  const scenarioById = new Map(
    scenarios.map((scenario) => [scenario.meta.id, scenario]),
  );
  const availableDefinitions = listAvailableDrills(scenarios);
  return listBuiltInDrills().find((definition) => {
    const scenario = scenarioById.get(definition.scenarioId);
    return Boolean(
      scenario &&
        definition.scenarioId !== sourceDefinition.scenarioId &&
        definitionsShareTransferContract(sourceDefinition, definition) &&
        availableDefinitions.some((available) =>
          definitionsHaveExactIdentity(available, definition),
        ) &&
        !completedDefinitionContexts.has(
          practiceDefinitionContextKey(
            definition,
            scenario.meta.dataVersion,
            "scenario",
            brokerConfigFingerprint(scenario.broker),
          ),
        ),
    );
  });
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

function destinationContext(
  destination: { definition: DrillDefinition; scenario: ScenarioPackage },
  exactAttempt?: PracticeAttempt,
): PracticeCoachStartContext {
  const brokerMode =
    exactAttempt && destination.definition.mode === "explorer"
      ? exactAttempt.brokerMode
      : "scenario";
  return {
    scenarioDataVersion: canonicalScenarioDataVersion(
      destination.scenario.meta.id,
      destination.scenario.meta.dataVersion,
    ),
    brokerMode,
    brokerFingerprint: brokerConfigFingerprint(
      brokerForContext(destination.scenario, brokerMode),
    ),
  };
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
      ...destinationContext(first),
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
      ...destinationContext(first),
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
    exactDefinition ?? currentDefinitionForAttempt(latestAttempt, scenarios),
    scenarios,
    foundation,
  );
  if (!currentDestination) return undefined;
  const unavailableNote = exactDefinition
    ? runs.length === 0
      ? "The detailed source report has expired; the compact ledger still preserves this versioned assessment."
      : undefined
    : `The exact source drill is no longer available, so the next attempt uses ${currentDestination.definition.title} without merging the old evidence.`;

  if (
    latestAttempt.assessment.status !== "completed" ||
    latestAttempt.assessment.eventLinkageEvidenceVersion !== 1
  ) {
    const { assessment } = latestAttempt;
    const legacyLinkage = assessment.eventLinkageEvidenceVersion !== 1;
    return {
      ...shared,
      kind: "next_run",
      title: legacyLinkage
        ? "Repeat with explicit event links"
        : "Finish every drill requirement",
      objective: legacyLinkage
        ? "Repeat the drill and explicitly select only the visible events that influenced each checkpoint decision."
        : "Execute at least one fully planned position, answer every checkpoint in replay order, and finish without a skipped decision.",
      rationale:
        legacyLinkage
          ? "This older attempt preserved checkpoint membership but did not record the user's explicit event selections, so it cannot create evidence or earn track credit."
          : "An incomplete attempt can diagnose missing evidence, but it cannot create an assessed competency claim or earn track credit.",
      evidence: legacyLinkage
        ? "Event linkage provenance was not recorded for this attempt."
        : `${assessment.answeredCheckpointCount}/${assessment.eligibleCheckpointCount} checkpoints answered · ${assessment.linkedEventCount}/${assessment.eligibleEventCount} events linked · ${assessment.violationCount} violations.`,
      scenarioId: currentDestination.scenario.meta.id,
      scenarioTitle: currentDestination.scenario.meta.title,
      drillId: currentDestination.definition.id,
      drillTitle: currentDestination.definition.title,
      mode: currentDestination.definition.mode,
      ...destinationContext(
        currentDestination,
        exactDefinition ? latestAttempt : undefined,
      ),
      focusLabel: legacyLinkage ? "Explicit event evidence" : "Complete evidence",
      target: {
        label: "Drill status",
        current: legacyLinkage ? "Legacy linkage unassessed" : "Incomplete",
        target: "Completed with a full plan and every checkpoint answered",
      },
      sourceRunId: sourceRun?.id,
      sourceRunTitle: latestAttempt.scenarioTitle,
      evidenceRunCount,
      availabilityNote: unavailableNote,
      ctaLabel: "Review completion practice",
    };
  }

  const authoritativeLatestScore = exactDefinition
    ? completedPracticeAssessmentScore(
        latestAttempt.assessment,
        latestAttempt.executionCount,
      )
    : undefined;
  const weak = authoritativeLatestScore !== undefined
    ? weakestComponent(latestAttempt.assessment)
    : undefined;
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
      ...destinationContext(
        currentDestination,
        exactDefinition ? latestAttempt : undefined,
      ),
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

  if (
    exactDefinition &&
    authoritativeLatestScore !== undefined &&
    !attemptHasCurrentBrokerIdentity(
      latestAttempt,
      currentDestination.scenario,
    )
  ) {
    return {
      ...shared,
      kind: "next_run",
      title: "Re-establish the exact broker context",
      objective:
        "Repeat this current-data drill under the current full execution settings so the next result has a broker identity that can support an honest comparison.",
      rationale:
        "The prior attempt retained a broker label but not the complete commission, spread, slippage, leverage, liquidity, hours, and margin configuration. It can remain process evidence, but it cannot support transfer or trend claims.",
      evidence: `Latest completed process score: ${Math.round(authoritativeLatestScore)}% on ${latestAttempt.scenarioTitle}; exact broker settings unavailable.`,
      scenarioId: currentDestination.scenario.meta.id,
      scenarioTitle: currentDestination.scenario.meta.title,
      drillId: currentDestination.definition.id,
      drillTitle: currentDestination.definition.title,
      mode: currentDestination.definition.mode,
      ...destinationContext(currentDestination, latestAttempt),
      focusLabel: "Versioned execution context",
      target: {
        label: "Comparable broker context",
        current: "Legacy broker label only",
        target: "1 completed attempt with full broker identity",
      },
      sourceRunId: sourceRun?.id,
      sourceRunTitle: latestAttempt.scenarioTitle,
      evidenceRunCount,
      availabilityNote: unavailableNote,
      ctaLabel: "Review broker-context repeat",
    };
  }

  const completedDefinitionContexts = new Set(
    attempts.flatMap((attempt) => {
      if (
        attempt.assessment.status !== "completed" ||
        attempt.assessment.eventLinkageEvidenceVersion !== 1 ||
        completedPracticeAssessmentScore(
          attempt.assessment,
          attempt.executionCount,
        ) === undefined
      ) {
        return [];
      }
      const definition = availableDefinitionFor(attempt, scenarios);
      const scenario = scenarios.find(
        (candidate) => candidate.meta.id === attempt.scenarioId,
      );
      return definition
        && scenario
        && attemptHasCurrentBrokerIdentity(attempt, scenario)
        ? [
            practiceDefinitionContextKey(
              definition,
              attempt.scenarioDataVersion,
              attempt.brokerMode,
              attempt.brokerFingerprint!,
            ),
          ]
        : [];
    }),
  );
  const transferSourceDefinition =
    authoritativeLatestScore !== undefined && exactDefinition
      ? builtInDefinitionFor(exactDefinition)
      : undefined;
  const nextDefinition = transferSourceDefinition
    ? nextBuiltInDefinition(
        scenarios,
        completedDefinitionContexts,
        transferSourceDefinition,
      )
    : undefined;
  const nextDestination = exactDefinition
    ? definitionDestination(
        nextDefinition ?? exactDefinition,
        scenarios,
        foundation,
      )
    : currentDestination;
  if (!nextDestination) return undefined;
  const assignmentKind =
    authoritativeLatestScore === undefined || !exactDefinition
      ? "refresh"
      : nextDefinition
        ? "transfer"
        : "repeat";
  return {
    ...shared,
    kind: "next_run",
    title:
      assignmentKind === "transfer"
        ? "Transfer clean Event Discipline to a new regime"
        : assignmentKind === "repeat"
          ? "Repeat the same context for a comparable trend"
          : "Re-establish Event Discipline on current data",
    objective:
      assignmentKind === "transfer"
        ? "Apply the same complete-plan and event-response process in the next available current-data regime, without combining criteria across attempts."
        : assignmentKind === "repeat"
          ? "Repeat the exact scenario data, drill, mode, and broker context so the evidence profile can make an honest trend comparison."
          : "Complete a fresh current-data baseline without treating the prior scenario version or unavailable drill context as comparable evidence.",
    rationale:
      assignmentKind === "transfer"
        ? "Every measured component met the shipped threshold; the next useful test is whether the same process transfers to another regime."
        : assignmentKind === "repeat"
          ? transferSourceDefinition
            ? "Every compatible available regime already has a completed current-data attempt in its exact drill, mode, and broker context, so another exact-context observation is more useful than a vague new score."
            : "No compatible cross-regime definition shares this exact authored competency and rubric contract, so another exact-context observation is the only honest comparison."
          : "The source context no longer matches an available current-data drill, so a fresh baseline is required before making a trend claim.",
    evidence:
      assignmentKind === "refresh"
        ? `The prior assessment from ${latestAttempt.scenarioTitle} does not match an available authoritative schedule and is not shown as a current measured score.`
        : `Latest completed process score: ${Math.round(authoritativeLatestScore!)}% on ${latestAttempt.scenarioTitle}.`,
    scenarioId: nextDestination.scenario.meta.id,
    scenarioTitle: nextDestination.scenario.meta.title,
    drillId: nextDestination.definition.id,
    drillTitle: nextDestination.definition.title,
    mode: nextDestination.definition.mode,
    ...destinationContext(
      nextDestination,
      assignmentKind === "repeat" ? latestAttempt : undefined,
    ),
    focusLabel:
      assignmentKind === "transfer"
        ? "Cross-regime process transfer"
        : assignmentKind === "repeat"
          ? "Comparable process trend"
          : "Current-data process baseline",
    target: {
      label:
        transferSourceDefinition || assignmentKind === "transfer"
          ? "Event Discipline process"
          : `${nextDestination.definition.title} process`,
      current:
        assignmentKind === "refresh"
          ? "No current comparable score"
          : `${Math.round(authoritativeLatestScore!)}%`,
      target: "Completed attempt with every component at its shipped threshold",
    },
    sourceRunId: sourceRun?.id,
    sourceRunTitle: latestAttempt.scenarioTitle,
    evidenceRunCount,
    availabilityNote:
      assignmentKind === "refresh"
        ? "The prior scenario data or exact drill context is unavailable, so this assignment starts a new comparison baseline."
        : unavailableNote,
    ctaLabel:
      assignmentKind === "transfer"
        ? "Review transfer practice"
        : assignmentKind === "repeat"
          ? "Review repeat practice"
          : "Review refreshed baseline",
  };
}
