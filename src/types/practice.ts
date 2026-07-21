import type { DecisionPlan } from "./trading";
import type { ScenarioMode } from "./scenario";

export type DrillCheckpointAction = "hold" | "reduce" | "exit" | "wait";

export type DrillPlanField = keyof Pick<
  DecisionPlan,
  "thesis" | "invalidation" | "exitPlan" | "acceptedRisk"
>;

export type DrillAssessmentComponentId =
  | "plan_coverage"
  | "checkpoint_coverage"
  | "event_linkage"
  | "rule_adherence";

export type DrillDefinition = {
  id: string;
  /** Stable capability identity shared by equivalent drills across scenarios. */
  competencyId: string;
  definitionVersion: number;
  rubricVersion: string;
  title: string;
  description: string;
  scenarioId: string;
  primarySymbol: string;
  mode: ScenarioMode;
  initialPlanRule: {
    requiredBeforeFirstOrder: boolean;
    requiredFields: readonly DrillPlanField[];
  };
  checkpointRule: {
    minimumImportance: 1 | 2 | 3 | 4 | 5;
    mapping: "next_primary_candle_close";
    groupSameReplayIndex: true;
    requireReflection: boolean;
    actions: readonly DrillCheckpointAction[];
  };
  rubric: {
    weights: Record<DrillAssessmentComponentId, number>;
    violationPenalty: number;
  };
};

/**
 * A deterministic group of events that become visible at the same primary
 * instrument candle close. It intentionally carries IDs rather than event
 * copy so callers must resolve display content from the visible snapshot.
 */
export type DrillCheckpoint = {
  id: string;
  drillId: string;
  definitionVersion: number;
  replayIndex: number;
  replayTime: string;
  eventIds: string[];
};

export type DrillCheckpointResponse = {
  id: string;
  drillId: string;
  definitionVersion: number;
  checkpointId: string;
  replayTime: string;
  /** Exact event membership of the checkpoint; retained for replay integrity. */
  eventIds: string[];
  /**
   * Events the user explicitly selected as influencing this decision. Absent
   * only on legacy responses created before explicit linkage was captured.
   */
  linkedEventIds?: string[];
  status: "answered" | "skipped";
  action?: DrillCheckpointAction;
  reflection?: string;
  positionQuantity?: number;
  workingOrderIds?: string[];
};

export type DrillRuleViolationCode =
  | "order_before_plan"
  | "checkpoint_skipped"
  | "advance_while_checkpoint_open"
  | "invalid_checkpoint_response";

export type DrillRuleViolation = {
  id: string;
  drillId: string;
  definitionVersion: number;
  code: DrillRuleViolationCode;
  replayTime: string;
  checkpointId?: string;
  evidence: string;
};

export type DrillAssessmentComponentStatus =
  | "assessed"
  | "not_applicable"
  | "insufficient_evidence";

export type DrillAssessmentComponent = {
  id: DrillAssessmentComponentId;
  label: string;
  weight: number;
  status: DrillAssessmentComponentStatus;
  score?: number;
  evidence: string;
};

export type DrillAssessment = {
  drillId: string;
  /**
   * Optional only for persisted V2 assessments created before competency
   * identities were introduced. New runtime assessments always set it.
   */
  competencyId?: string;
  definitionVersion: number;
  rubricVersion: string;
  /**
   * Canonical identity of the rubric weights and violation penalty used for
   * this assessment. Optional only for persisted assessments created before
   * rubric-content identity was introduced.
   */
  rubricFingerprint?: string;
  /**
   * Canonical identity of the exact checkpoint ids, replay positions, times,
   * and event membership scored by this assessment. Optional only for legacy
   * assessments created before schedule identity was persisted.
   */
  checkpointScheduleFingerprint?: string;
  /**
   * Present only when event-linkage scores came from explicit user selections
   * rather than legacy automatic checkpoint membership.
   */
  eventLinkageEvidenceVersion?: 1;
  status: "completed" | "incomplete";
  overallScore?: number;
  methodology: string;
  components: DrillAssessmentComponent[];
  eligibleCheckpointCount: number;
  answeredCheckpointCount: number;
  skippedCheckpointCount: number;
  eligibleEventCount: number;
  linkedEventCount: number;
  violationCount: number;
};

export type DrillAssessmentInput = {
  definition: DrillDefinition;
  checkpoints: DrillCheckpoint[];
  initialPlan?: DecisionPlan;
  responses: DrillCheckpointResponse[];
  violations: DrillRuleViolation[];
  positionOpened: boolean;
  replayCompleted: boolean;
};

export type DrillValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export type DrillValidationResult = {
  valid: boolean;
  issues: DrillValidationIssue[];
};

export type NextDrillCheckpointInput = {
  schedule: DrillCheckpoint[];
  currentIndex: number;
  requestedIndex: number;
  resolvedCheckpointIds: Iterable<string>;
};
