import { replayTimeline } from "../replay/engine";
import type {
  DecisionPlan,
  DrillAssessment,
  DrillAssessmentComponent,
  DrillAssessmentComponentId,
  DrillAssessmentInput,
  DrillCheckpoint,
  DrillCheckpointAction,
  DrillCheckpointResponse,
  DrillDefinition,
  DrillPlanField,
  DrillValidationIssue,
  DrillValidationResult,
  MarketEvent,
  NextDrillCheckpointInput,
  ScenarioPackage,
} from "../../types";
import { PRACTICE_DRILL_REFLECTION_MAX_LENGTH } from "../../types/reporting";

const PLAN_FIELDS = new Set<DrillPlanField>([
  "thesis",
  "invalidation",
  "exitPlan",
  "acceptedRisk",
]);
const CHECKPOINT_ACTIONS = new Set<DrillCheckpointAction>([
  "hold",
  "reduce",
  "exit",
  "wait",
]);
const COMPONENT_LABELS: Record<DrillAssessmentComponentId, string> = {
  plan_coverage: "Initial plan coverage",
  checkpoint_coverage: "Checkpoint coverage",
  event_linkage: "Event linkage",
  rule_adherence: "Rule adherence",
};
const RUBRIC_COMPONENT_IDS = [
  "plan_coverage",
  "checkpoint_coverage",
  "event_linkage",
  "rule_adherence",
] as const satisfies readonly DrillAssessmentComponentId[];
const RUBRIC_FINGERPRINT_PREFIX = "drill-rubric-v1:";
const LEGACY_RUBRIC_FINGERPRINT_PREFIX = "legacy-drill-rubric-v1:";
const CHECKPOINT_SCHEDULE_FINGERPRINT_PREFIX = "drill-checkpoints-v1:";

type CanonicalRubricFingerprintPayload = {
  weights: Array<[DrillAssessmentComponentId, number]>;
  violationPenalty: number;
};

export type ParsedDrillRubricFingerprint = DrillDefinition["rubric"];

type CanonicalCheckpointScheduleEntry = Pick<
  DrillCheckpoint,
  | "id"
  | "drillId"
  | "definitionVersion"
  | "replayIndex"
  | "replayTime"
> & { eventIds: string[] };

function canonicalCheckpointSchedule(
  checkpoints: readonly DrillCheckpoint[],
): CanonicalCheckpointScheduleEntry[] {
  return [...new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint])).values()]
    .sort(
      (left, right) =>
        left.replayIndex - right.replayIndex || left.id.localeCompare(right.id),
    )
    .map((checkpoint) => ({
      id: checkpoint.id,
      drillId: checkpoint.drillId,
      definitionVersion: checkpoint.definitionVersion,
      replayIndex: checkpoint.replayIndex,
      replayTime: checkpoint.replayTime,
      eventIds: [...checkpoint.eventIds].sort((left, right) =>
        left.localeCompare(right),
      ),
    }));
}

/** Collision-free identity for every input that defines checkpoint coverage. */
export function drillCheckpointScheduleFingerprint(
  checkpoints: readonly DrillCheckpoint[],
): string {
  return `${CHECKPOINT_SCHEDULE_FINGERPRINT_PREFIX}${JSON.stringify(
    canonicalCheckpointSchedule(checkpoints),
  )}`;
}

export function parseDrillCheckpointScheduleFingerprint(
  fingerprint: string,
): CanonicalCheckpointScheduleEntry[] | undefined {
  if (!fingerprint.startsWith(CHECKPOINT_SCHEDULE_FINGERPRINT_PREFIX)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(
      fingerprint.slice(CHECKPOINT_SCHEDULE_FINGERPRINT_PREFIX.length),
    );
    if (!Array.isArray(parsed)) return undefined;
    const entries: DrillCheckpoint[] = [];
    const ids = new Set<string>();
    for (const value of parsed) {
      if (
        typeof value !== "object" ||
        value === null ||
        Object.keys(value).length !== 6 ||
        !("id" in value) ||
        typeof value.id !== "string" ||
        value.id.trim().length === 0 ||
        ids.has(value.id) ||
        !("drillId" in value) ||
        typeof value.drillId !== "string" ||
        value.drillId.trim().length === 0 ||
        !("definitionVersion" in value) ||
        !Number.isInteger(value.definitionVersion) ||
        Number(value.definitionVersion) < 1 ||
        !("replayIndex" in value) ||
        !Number.isInteger(value.replayIndex) ||
        Number(value.replayIndex) < 0 ||
        !("replayTime" in value) ||
        typeof value.replayTime !== "string" ||
        !Number.isFinite(Date.parse(value.replayTime)) ||
        !("eventIds" in value) ||
        !Array.isArray(value.eventIds) ||
        value.eventIds.length === 0 ||
        value.eventIds.some(
          (eventId: unknown) =>
            typeof eventId !== "string" || !eventId.trim(),
        ) ||
        new Set(value.eventIds).size !== value.eventIds.length
      ) {
        return undefined;
      }
      ids.add(value.id);
      entries.push({
        id: value.id,
        drillId: value.drillId,
        definitionVersion: Number(value.definitionVersion),
        replayIndex: Number(value.replayIndex),
        replayTime: value.replayTime,
        eventIds: value.eventIds as string[],
      });
    }
    const canonical = canonicalCheckpointSchedule(entries);
    return drillCheckpointScheduleFingerprint(canonical) === fingerprint
      ? canonical
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Verifies that persisted assessment totals describe the schedule encoded by
 * the fingerprint instead of merely repeating a trusted fingerprint string.
 */
export function assessmentMatchesCheckpointScheduleFingerprint(
  assessment: Pick<
    DrillAssessment,
    | "drillId"
    | "definitionVersion"
    | "checkpointScheduleFingerprint"
    | "eligibleCheckpointCount"
    | "answeredCheckpointCount"
    | "skippedCheckpointCount"
    | "eligibleEventCount"
    | "linkedEventCount"
  >,
): boolean {
  if (!assessment.checkpointScheduleFingerprint) return false;
  const schedule = parseDrillCheckpointScheduleFingerprint(
    assessment.checkpointScheduleFingerprint,
  );
  if (!schedule) return false;
  const eventCount = new Set(
    schedule.flatMap((checkpoint) => checkpoint.eventIds),
  ).size;
  return (
    schedule.length > 0 &&
    schedule.every(
      (checkpoint) =>
        checkpoint.drillId === assessment.drillId &&
        checkpoint.definitionVersion === assessment.definitionVersion,
    ) &&
    assessment.eligibleCheckpointCount === schedule.length &&
    assessment.answeredCheckpointCount + assessment.skippedCheckpointCount <=
      schedule.length &&
    assessment.eligibleEventCount === eventCount &&
    assessment.linkedEventCount <= eventCount
  );
}

/**
 * Returns a collision-free canonical identity for every scoring input owned by
 * a drill rubric. Key order is fixed deliberately so authored JSON property
 * order cannot change the identity.
 */
export function drillRubricFingerprint(
  rubric: DrillDefinition["rubric"],
): string {
  const payload: CanonicalRubricFingerprintPayload = {
    weights: RUBRIC_COMPONENT_IDS.map((id) => [id, rubric.weights[id]]),
    violationPenalty: rubric.violationPenalty,
  };
  return `${RUBRIC_FINGERPRINT_PREFIX}${JSON.stringify(payload)}`;
}

export function parseDrillRubricFingerprint(
  fingerprint: string,
): ParsedDrillRubricFingerprint | undefined {
  if (!fingerprint.startsWith(RUBRIC_FINGERPRINT_PREFIX)) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      fingerprint.slice(RUBRIC_FINGERPRINT_PREFIX.length),
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Object.keys(parsed).length !== 2 ||
      !("weights" in parsed) ||
      !("violationPenalty" in parsed) ||
      !Array.isArray((parsed as CanonicalRubricFingerprintPayload).weights) ||
      !Number.isFinite(
        (parsed as CanonicalRubricFingerprintPayload).violationPenalty,
      ) ||
      (parsed as CanonicalRubricFingerprintPayload).violationPenalty < 0 ||
      (parsed as CanonicalRubricFingerprintPayload).violationPenalty > 100
    ) {
      return undefined;
    }
    const weights = new Map<DrillAssessmentComponentId, number>();
    for (const entry of (parsed as CanonicalRubricFingerprintPayload).weights) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        !RUBRIC_COMPONENT_IDS.includes(entry[0]) ||
        !Number.isFinite(entry[1]) ||
        entry[1] < 0 ||
        entry[1] > 1 ||
        weights.has(entry[0])
      ) {
        return undefined;
      }
      weights.set(entry[0], entry[1]);
    }
    if (
      weights.size !== RUBRIC_COMPONENT_IDS.length ||
      Math.abs([...weights.values()].reduce((sum, weight) => sum + weight, 0) - 1) >
        1e-9
    ) {
      return undefined;
    }
    const rubric: ParsedDrillRubricFingerprint = {
      weights: {
        plan_coverage: weights.get("plan_coverage")!,
        checkpoint_coverage: weights.get("checkpoint_coverage")!,
        event_linkage: weights.get("event_linkage")!,
        rule_adherence: weights.get("rule_adherence")!,
      },
      violationPenalty: (
        parsed as CanonicalRubricFingerprintPayload
      ).violationPenalty,
    };
    return drillRubricFingerprint(rubric) === fingerprint ? rubric : undefined;
  } catch {
    return undefined;
  }
}

function assessmentWeightsMatchRubric(
  assessment: DrillAssessment,
  rubric: ParsedDrillRubricFingerprint,
): boolean {
  return (
    assessment.components.length === RUBRIC_COMPONENT_IDS.length &&
    RUBRIC_COMPONENT_IDS.every((id) => {
      const matching = assessment.components.filter((entry) => entry.id === id);
      return (
        matching.length === 1 &&
        Number.isFinite(matching[0].weight) &&
        Math.abs(matching[0].weight - rubric.weights[id]) <= 0.000001
      );
    })
  );
}

function scoreMatches(left: number | undefined, right: number): boolean {
  return (
    left !== undefined &&
    Number.isFinite(left) &&
    left >= 0 &&
    left <= 100 &&
    Math.abs(left - right) <= 0.000001
  );
}

function nonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Recomputes every completed-assessment score from its compact aggregate
 * evidence. This preserves ledger-only assessment history without trusting a
 * persisted component or overall score that contradicts the recorded counts.
 */
export function completedAssessmentMatchesAggregateEvidence(
  assessment: DrillAssessment,
): boolean {
  if (assessment.status !== "completed" || !assessment.rubricFingerprint) {
    return false;
  }
  const rubric = parseDrillRubricFingerprint(assessment.rubricFingerprint);
  if (!rubric || !assessmentWeightsMatchRubric(assessment, rubric)) {
    return false;
  }
  if (
    !nonNegativeSafeInteger(assessment.eligibleCheckpointCount) ||
    assessment.eligibleCheckpointCount <= 0 ||
    !nonNegativeSafeInteger(assessment.answeredCheckpointCount) ||
    !nonNegativeSafeInteger(assessment.skippedCheckpointCount) ||
    assessment.answeredCheckpointCount !==
      assessment.eligibleCheckpointCount ||
    assessment.skippedCheckpointCount !== 0 ||
    !nonNegativeSafeInteger(assessment.eligibleEventCount) ||
    assessment.eligibleEventCount <= 0 ||
    !nonNegativeSafeInteger(assessment.linkedEventCount) ||
    assessment.linkedEventCount > assessment.eligibleEventCount ||
    !nonNegativeSafeInteger(assessment.violationCount)
  ) {
    return false;
  }

  const expectedScores: Record<DrillAssessmentComponentId, number> = {
    plan_coverage: 100,
    checkpoint_coverage: roundedScore(
      (assessment.answeredCheckpointCount /
        assessment.eligibleCheckpointCount) *
        100,
    ),
    event_linkage: roundedScore(
      (assessment.linkedEventCount / assessment.eligibleEventCount) * 100,
    ),
    rule_adherence: roundedScore(
      100 - assessment.violationCount * rubric.violationPenalty,
    ),
  };
  const components = new Map<
    DrillAssessmentComponentId,
    DrillAssessmentComponent
  >();
  for (const component of assessment.components) {
    if (
      components.has(component.id) ||
      component.status !== "assessed" ||
      !scoreMatches(component.score, expectedScores[component.id])
    ) {
      return false;
    }
    components.set(component.id, component);
  }
  if (
    components.size !== RUBRIC_COMPONENT_IDS.length ||
    !RUBRIC_COMPONENT_IDS.every((id) => components.has(id))
  ) {
    return false;
  }
  const expectedOverallScore = roundedScore(
    RUBRIC_COMPONENT_IDS.reduce(
      (sum, id) => sum + expectedScores[id] * rubric.weights[id],
      0,
    ),
  );
  return scoreMatches(assessment.overallScore, expectedOverallScore);
}

export function assessmentHasConsistentRubricFingerprint(
  assessment: DrillAssessment,
): boolean {
  if (assessment.rubricFingerprint === undefined) return true;
  const rubric = parseDrillRubricFingerprint(assessment.rubricFingerprint);
  return Boolean(rubric && assessmentWeightsMatchRubric(assessment, rubric));
}

/**
 * Legacy assessments did not persist violationPenalty. They remain readable
 * and comparable with assessments that share their exact component weights,
 * but are intentionally isolated from fully identified new rubrics.
 */
export function effectiveAssessmentRubricFingerprint(
  assessment: DrillAssessment,
): string {
  if (assessment.rubricFingerprint?.trim()) {
    return assessment.rubricFingerprint;
  }
  const weights = RUBRIC_COMPONENT_IDS.map((id) => [
    id,
    assessment.components.find((component) => component.id === id)?.weight ??
      null,
  ]);
  return `${LEGACY_RUBRIC_FINGERPRINT_PREFIX}${JSON.stringify({ weights })}`;
}

/** Only explicitly fingerprinted assessments can match a complete rubric. */
export function assessmentMatchesRubricFingerprint(
  assessment: DrillAssessment,
  expectedFingerprint: string,
): boolean {
  if (!parseDrillRubricFingerprint(expectedFingerprint)) return false;
  return (
    assessment.rubricFingerprint === expectedFingerprint &&
    assessmentHasConsistentRubricFingerprint(assessment)
  );
}

function timestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function roundedScore(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

function uniqueStrings(values: readonly string[]): boolean {
  return (
    values.every((value) => typeof value === "string" && value.trim().length > 0) &&
    new Set(values).size === values.length
  );
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function eligibleEventsFor(
  definition: DrillDefinition,
  scenario: ScenarioPackage,
): MarketEvent[] {
  return scenario.events
    .filter(
      (event) =>
        event.importance >= definition.checkpointRule.minimumImportance &&
        event.affectedSymbols.includes(definition.primarySymbol),
    )
    .sort((left, right) => {
      const leftTime = timestamp(left.publishedAt) ?? Number.POSITIVE_INFINITY;
      const rightTime = timestamp(right.publishedAt) ?? Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.id.localeCompare(right.id);
    });
}

function nextCloseIndex(
  closes: Array<{ time: string; epoch: number; replayIndex: number }>,
  eventTime: number,
): number {
  let low = 0;
  let high = closes.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (closes[middle].epoch >= eventTime) {
      result = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return result;
}

/**
 * Maps eligible events to the next real close of the drill's primary symbol.
 * Event timestamps are deliberately not added to the replay clock: doing so
 * would make the previous close look tradable after newly published news.
 */
export function buildDrillCheckpointSchedule(
  definition: DrillDefinition,
  scenario: ScenarioPackage,
): DrillCheckpoint[] {
  const timeline = replayTimeline(scenario);
  const replayIndexByEpoch = new Map<number, number>();
  timeline.forEach((time, index) => {
    const epoch = timestamp(time);
    if (epoch !== undefined && !replayIndexByEpoch.has(epoch)) {
      replayIndexByEpoch.set(epoch, index);
    }
  });
  const closes = scenario.candles
    .filter((candle) => candle.symbol === definition.primarySymbol)
    .flatMap((candle) => {
      const epoch = timestamp(candle.closeTime);
      const replayIndex = epoch === undefined ? undefined : replayIndexByEpoch.get(epoch);
      return epoch === undefined || replayIndex === undefined
        ? []
        : [{ time: timeline[replayIndex], epoch, replayIndex }];
    })
    .sort(
      (left, right) =>
        left.epoch - right.epoch || left.replayIndex - right.replayIndex,
    );
  const byReplayIndex = new Map<
    number,
    { replayTime: string; events: MarketEvent[] }
  >();

  for (const event of eligibleEventsFor(definition, scenario)) {
    const eventTime = timestamp(event.publishedAt);
    if (eventTime === undefined) continue;
    const closeIndex = nextCloseIndex(closes, eventTime);
    if (closeIndex < 0) continue;
    const close = closes[closeIndex];
    const group = byReplayIndex.get(close.replayIndex) ?? {
      replayTime: close.time,
      events: [],
    };
    group.events.push(event);
    byReplayIndex.set(close.replayIndex, group);
  }

  return [...byReplayIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([replayIndex, group]) => {
      const eventIds = group.events
        .sort((left, right) => {
          const leftTime = timestamp(left.publishedAt) ?? 0;
          const rightTime = timestamp(right.publishedAt) ?? 0;
          return leftTime - rightTime || left.id.localeCompare(right.id);
        })
        .map((event) => event.id);
      return {
        id: `${definition.id}:checkpoint:${replayIndex}:${eventIds.join("+")}`,
        drillId: definition.id,
        definitionVersion: definition.definitionVersion,
        replayIndex,
        replayTime: group.replayTime,
        eventIds,
      };
    });
}

export function validateDrillDefinition(
  definition: DrillDefinition,
  scenario: ScenarioPackage,
): DrillValidationResult {
  const issues: DrillValidationIssue[] = [];
  const add = (code: string, message: string, path?: string) => {
    issues.push({ code, message, path });
  };

  if (!definition.id.trim()) {
    add("definition.id_missing", "Drill id is required.", "id");
  }
  if (
    typeof definition.competencyId !== "string" ||
    !definition.competencyId.trim()
  ) {
    add(
      "definition.competency_id_missing",
      "Competency id is required.",
      "competencyId",
    );
  }
  if (!Number.isInteger(definition.definitionVersion) || definition.definitionVersion < 1) {
    add(
      "definition.version_invalid",
      "definitionVersion must be a positive integer.",
      "definitionVersion",
    );
  }
  if (!definition.rubricVersion.trim()) {
    add(
      "definition.rubric_version_missing",
      "Rubric version is required.",
      "rubricVersion",
    );
  }
  if (!definition.title.trim() || !definition.description.trim()) {
    add(
      "definition.copy_missing",
      "Drill title and description are required.",
      "title",
    );
  }
  if (definition.scenarioId !== scenario.meta.id) {
    add(
      "definition.scenario_mismatch",
      `Drill expects ${definition.scenarioId}, not ${scenario.meta.id}.`,
      "scenarioId",
    );
  }
  if (!scenario.meta.symbols.includes(definition.primarySymbol)) {
    add(
      "definition.primary_symbol_unknown",
      `Primary symbol ${definition.primarySymbol} is not declared by the scenario.`,
      "primarySymbol",
    );
  }
  if (!scenario.meta.supportedModes.includes(definition.mode)) {
    add(
      "definition.mode_unsupported",
      `Scenario does not support ${definition.mode} mode.`,
      "mode",
    );
  }
  if (
    !Number.isInteger(definition.checkpointRule.minimumImportance) ||
    definition.checkpointRule.minimumImportance < 1 ||
    definition.checkpointRule.minimumImportance > 5
  ) {
    add(
      "definition.importance_invalid",
      "Checkpoint importance must be an integer from 1 to 5.",
      "checkpointRule.minimumImportance",
    );
  }
  if (definition.checkpointRule.mapping !== "next_primary_candle_close") {
    add(
      "definition.mapping_unsupported",
      "Only next_primary_candle_close mapping is supported.",
      "checkpointRule.mapping",
    );
  }
  if (definition.checkpointRule.groupSameReplayIndex !== true) {
    add(
      "definition.grouping_unsupported",
      "Events mapped to the same replay index must be grouped into one checkpoint.",
      "checkpointRule.groupSameReplayIndex",
    );
  }
  if (typeof definition.checkpointRule.requireReflection !== "boolean") {
    add(
      "definition.reflection_rule_invalid",
      "requireReflection must be a boolean.",
      "checkpointRule.requireReflection",
    );
  }
  if (typeof definition.initialPlanRule.requiredBeforeFirstOrder !== "boolean") {
    add(
      "definition.initial_plan_rule_invalid",
      "requiredBeforeFirstOrder must be a boolean.",
      "initialPlanRule.requiredBeforeFirstOrder",
    );
  }
  const actions = definition.checkpointRule.actions;
  if (
    !uniqueStrings(actions) ||
    actions.length !== CHECKPOINT_ACTIONS.size ||
    ![...CHECKPOINT_ACTIONS].every((action) => actions.includes(action))
  ) {
    add(
      "definition.actions_invalid",
      "Checkpoint actions must contain Hold, Reduce, Exit, and Wait exactly once.",
      "checkpointRule.actions",
    );
  }
  const planFields = definition.initialPlanRule.requiredFields;
  if (
    !uniqueStrings(planFields) ||
    planFields.some((field) => !PLAN_FIELDS.has(field))
  ) {
    add(
      "definition.plan_fields_invalid",
      "Initial-plan fields must be unique supported decision-plan fields.",
      "initialPlanRule.requiredFields",
    );
  } else if (planFields.length === 0) {
    add(
      "definition.plan_fields_empty",
      "A practice drill must require at least one supported initial-plan field.",
      "initialPlanRule.requiredFields",
    );
  }

  const weightEntries = Object.entries(definition.rubric.weights) as Array<
    [DrillAssessmentComponentId, number]
  >;
  if (
    weightEntries.length !== Object.keys(COMPONENT_LABELS).length ||
    weightEntries.some(
      ([id, weight]) =>
        !(id in COMPONENT_LABELS) ||
        !Number.isFinite(weight) ||
        weight < 0 ||
        weight > 1,
    ) ||
    Math.abs(weightEntries.reduce((sum, [, weight]) => sum + weight, 0) - 1) >
      1e-9
  ) {
    add(
      "definition.weights_invalid",
      "Process-only rubric weights must contain four finite values that sum to 1.",
      "rubric.weights",
    );
  }
  if (
    !Number.isFinite(definition.rubric.violationPenalty) ||
    definition.rubric.violationPenalty < 0 ||
    definition.rubric.violationPenalty > 100
  ) {
    add(
      "definition.violation_penalty_invalid",
      "Violation penalty must be between 0 and 100.",
      "rubric.violationPenalty",
    );
  }

  const eligibleEvents = eligibleEventsFor(definition, scenario);
  if (eligibleEvents.length === 0) {
    add(
      "definition.checkpoints_empty",
      "The drill has no eligible event checkpoints.",
      "checkpointRule",
    );
  } else {
    const mappedIds = new Set(
      buildDrillCheckpointSchedule(definition, scenario).flatMap(
        (checkpoint) => checkpoint.eventIds,
      ),
    );
    for (const event of eligibleEvents) {
      if (!mappedIds.has(event.id)) {
        add(
          "definition.event_unmappable",
          `Event ${event.id} has no primary-symbol candle close at or after publication.`,
          `events.${event.id}`,
        );
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

export function nextDrillCheckpoint({
  schedule,
  currentIndex,
  requestedIndex,
  resolvedCheckpointIds,
}: NextDrillCheckpointInput): DrillCheckpoint | undefined {
  if (
    !Number.isInteger(currentIndex) ||
    !Number.isInteger(requestedIndex) ||
    requestedIndex < currentIndex
  ) {
    return undefined;
  }
  const resolved = new Set(resolvedCheckpointIds);
  return [...schedule]
    .filter(
      (checkpoint) =>
        !resolved.has(checkpoint.id) &&
        checkpoint.replayIndex >= currentIndex &&
        checkpoint.replayIndex <= requestedIndex,
    )
    .sort(
      (left, right) =>
        left.replayIndex - right.replayIndex || left.id.localeCompare(right.id),
    )[0];
}

export function validateDrillCheckpointResponse(
  definition: DrillDefinition,
  checkpoint: DrillCheckpoint,
  response: DrillCheckpointResponse,
  visibleEventIds: Iterable<string>,
): DrillValidationResult {
  const issues: DrillValidationIssue[] = [];
  const add = (code: string, message: string, path?: string) => {
    issues.push({ code, message, path });
  };
  const visible = new Set(visibleEventIds);

  if (!response.id.trim()) {
    add("response.id_missing", "Response id is required.", "id");
  }
  if (
    checkpoint.drillId !== definition.id ||
    checkpoint.definitionVersion !== definition.definitionVersion ||
    response.drillId !== definition.id ||
    response.definitionVersion !== definition.definitionVersion
  ) {
    add(
      "response.definition_mismatch",
      "Response and checkpoint must match the active drill definition.",
    );
  }
  if (response.checkpointId !== checkpoint.id) {
    add(
      "response.checkpoint_mismatch",
      "Response references a different checkpoint.",
      "checkpointId",
    );
  }
  const responseTime = timestamp(response.replayTime);
  const checkpointTime = timestamp(checkpoint.replayTime);
  if (
    responseTime === undefined ||
    checkpointTime === undefined ||
    responseTime !== checkpointTime
  ) {
    add(
      "response.time_mismatch",
      "Response must be recorded at the checkpoint replay time.",
      "replayTime",
    );
  }
  if (
    !uniqueStrings(response.eventIds) ||
    !sameStringSet(response.eventIds, checkpoint.eventIds)
  ) {
    add(
      "response.events_mismatch",
      "Response must preserve every checkpoint event exactly once.",
      "eventIds",
    );
  }
  if (checkpoint.eventIds.some((eventId) => !visible.has(eventId))) {
    add(
      "response.event_not_visible",
      "A checkpoint response cannot reference an event outside the visible snapshot.",
      "eventIds",
    );
  }
  if (response.linkedEventIds !== undefined) {
    if (!uniqueStrings(response.linkedEventIds)) {
      add(
        "response.linked_events_invalid",
        "Explicitly linked event ids must be non-empty and unique.",
        "linkedEventIds",
      );
    } else if (
      response.linkedEventIds.some(
        (eventId) =>
          !checkpoint.eventIds.includes(eventId) || !visible.has(eventId),
      )
    ) {
      add(
        "response.linked_event_not_visible",
        "An explicit event link must belong to this visible checkpoint.",
        "linkedEventIds",
      );
    }
  }
  if (response.status !== "answered" && response.status !== "skipped") {
    add(
      "response.status_invalid",
      "Response status must be answered or skipped.",
      "status",
    );
  } else if (response.status === "answered") {
    if (!response.action || !definition.checkpointRule.actions.includes(response.action)) {
      add(
        "response.action_invalid",
        "Answered checkpoints require an allowed action.",
        "action",
      );
    }
    if (
      definition.checkpointRule.requireReflection &&
      !response.reflection?.trim()
    ) {
      add(
        "response.reflection_missing",
        "Answered checkpoints require a reflection describing what changed.",
        "reflection",
      );
    }
  } else if (response.action !== undefined) {
    add(
      "response.skipped_action_present",
      "A skipped checkpoint cannot claim a decision action.",
      "action",
    );
  } else if ((response.linkedEventIds?.length ?? 0) > 0) {
    add(
      "response.skipped_links_present",
      "A skipped checkpoint cannot claim explicit event links.",
      "linkedEventIds",
    );
  }
  if (
    response.reflection !== undefined &&
    response.reflection.length > PRACTICE_DRILL_REFLECTION_MAX_LENGTH
  ) {
    add(
      "response.reflection_too_long",
      `Checkpoint reflections cannot exceed ${PRACTICE_DRILL_REFLECTION_MAX_LENGTH.toLocaleString("en-US")} characters.`,
      "reflection",
    );
  }
  if (
    response.positionQuantity !== undefined &&
    !Number.isFinite(response.positionQuantity)
  ) {
    add(
      "response.position_invalid",
      "Checkpoint position quantity must be finite when provided.",
      "positionQuantity",
    );
  }
  if (
    response.workingOrderIds !== undefined &&
    !uniqueStrings(response.workingOrderIds)
  ) {
    add(
      "response.working_orders_invalid",
      "Working-order ids must be non-empty and unique.",
      "workingOrderIds",
    );
  }

  return { valid: issues.length === 0, issues };
}

function planFieldPresent(plan: DecisionPlan, field: DrillPlanField): boolean {
  return Boolean(plan[field]?.trim());
}

function component(
  definition: DrillDefinition,
  id: DrillAssessmentComponentId,
  input: Omit<DrillAssessmentComponent, "id" | "label" | "weight">,
): DrillAssessmentComponent {
  return {
    id,
    label: COMPONENT_LABELS[id],
    weight: definition.rubric.weights[id],
    ...input,
  };
}

/**
 * Scores observable practice process only. The input intentionally has no
 * return, P/L, benchmark, future price, or hindsight-labelled outcome fields.
 */
export function assessDrill(input: DrillAssessmentInput): DrillAssessment {
  const { definition } = input;
  const checkpoints = [...new Map(
    input.checkpoints
      .filter(
        (checkpoint) =>
          checkpoint.drillId === definition.id &&
          checkpoint.definitionVersion === definition.definitionVersion,
      )
      .map((checkpoint) => [checkpoint.id, checkpoint]),
  ).values()].sort(
    (left, right) =>
      left.replayIndex - right.replayIndex || left.id.localeCompare(right.id),
  );
  const checkpointById = new Map(
    checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]),
  );
  const responseByCheckpoint = new Map<string, DrillCheckpointResponse>();
  for (const response of input.responses) {
    const checkpoint = checkpointById.get(response.checkpointId);
    if (!checkpoint) continue;
    if (
      response.drillId !== definition.id ||
      response.definitionVersion !== definition.definitionVersion
    ) {
      continue;
    }
    responseByCheckpoint.set(response.checkpointId, response);
  }

  const answered: DrillCheckpointResponse[] = [];
  const skipped: DrillCheckpointResponse[] = [];
  for (const checkpoint of checkpoints) {
    const response = responseByCheckpoint.get(checkpoint.id);
    if (!response) continue;
    if (response.status === "skipped") {
      skipped.push(response);
      continue;
    }
    if (
      validateDrillCheckpointResponse(
        definition,
        checkpoint,
        response,
        checkpoint.eventIds,
      ).valid
    ) {
      answered.push(response);
    }
  }

  const eligibleEventIds = new Set(
    checkpoints.flatMap((checkpoint) => checkpoint.eventIds),
  );
  const hasExplicitEventLinkage = answered.every(
    (response) => response.linkedEventIds !== undefined,
  );
  const linkedEventIds = new Set(
    answered.flatMap((response) =>
      (response.linkedEventIds ?? []).filter((eventId) =>
        eligibleEventIds.has(eventId),
      ),
    ),
  );
  const requiredPlanFields = definition.initialPlanRule.requiredFields;
  const presentPlanFields = input.initialPlan
    ? requiredPlanFields.filter((field) =>
        planFieldPresent(input.initialPlan!, field),
      ).length
    : 0;
  const planComplete =
    requiredPlanFields.length === 0 ||
    presentPlanFields === requiredPlanFields.length;

  const planComponent = (() => {
    if (!input.initialPlan) {
      return component(definition, "plan_coverage", {
        status: input.positionOpened
          ? "insufficient_evidence"
          : "not_applicable",
        evidence: input.positionOpened
          ? "A position was opened, but no initial plan evidence was available; missing evidence is not scored as zero."
          : "No position was opened, so an initial trading plan was not applicable.",
      });
    }
    if (requiredPlanFields.length === 0) {
      return component(definition, "plan_coverage", {
        status: "not_applicable",
        evidence: "This drill version declares no required initial-plan fields.",
      });
    }
    return component(definition, "plan_coverage", {
      status: "assessed",
      score: roundedScore(
        (presentPlanFields / requiredPlanFields.length) * 100,
      ),
      evidence: `${presentPlanFields} of ${requiredPlanFields.length} required initial-plan fields were recorded.`,
    });
  })();

  const checkpointComponent = (() => {
    if (checkpoints.length === 0) {
      return component(definition, "checkpoint_coverage", {
        status: "not_applicable",
        evidence: "This drill produced no eligible checkpoints.",
      });
    }
    if (answered.length === 0 && skipped.length === 0) {
      return component(definition, "checkpoint_coverage", {
        status: "insufficient_evidence",
        evidence:
          "No checkpoint response evidence was recorded; missing evidence is not scored as zero.",
      });
    }
    return component(definition, "checkpoint_coverage", {
      status: "assessed",
      score: roundedScore((answered.length / checkpoints.length) * 100),
      evidence: `${answered.length} of ${checkpoints.length} checkpoint groups were answered; ${skipped.length} were explicitly skipped.`,
    });
  })();

  const eventComponent = (() => {
    if (eligibleEventIds.size === 0) {
      return component(definition, "event_linkage", {
        status: "not_applicable",
        evidence: "No eligible events were available for linkage.",
      });
    }
    if (answered.length === 0) {
      return component(definition, "event_linkage", {
        status: "insufficient_evidence",
        evidence:
          "No answered checkpoint linked visible events; missing evidence is not scored as zero.",
      });
    }
    if (!hasExplicitEventLinkage) {
      return component(definition, "event_linkage", {
        status: "insufficient_evidence",
        evidence:
          "This legacy attempt did not record which visible events the user explicitly linked; checkpoint membership is not treated as a decision link.",
      });
    }
    return component(definition, "event_linkage", {
      status: "assessed",
      score: roundedScore((linkedEventIds.size / eligibleEventIds.size) * 100),
      evidence: `${linkedEventIds.size} of ${eligibleEventIds.size} eligible visible events were linked to an answered checkpoint reflection.`,
    });
  })();

  const relevantViolations = input.violations.filter(
    (violation) =>
      violation.drillId === definition.id &&
      violation.definitionVersion === definition.definitionVersion,
  );
  const adherenceComponent = component(definition, "rule_adherence", {
    status: "assessed",
    score: roundedScore(
      100 - relevantViolations.length * definition.rubric.violationPenalty,
    ),
    evidence:
      relevantViolations.length === 0
        ? "No drill-rule violations were recorded."
        : `${relevantViolations.length} drill-rule violation(s) were recorded.`,
  });
  const components = [
    planComponent,
    checkpointComponent,
    eventComponent,
    adherenceComponent,
  ];
  const assessed = components.filter(
    (entry) => entry.status === "assessed" && entry.score !== undefined,
  );
  const substantiveEvidence = assessed.some(
    (entry) => entry.id !== "rule_adherence",
  );
  const assessedWeight = assessed.reduce((sum, entry) => sum + entry.weight, 0);
  const overallScore =
    substantiveEvidence && assessedWeight > 0
      ? roundedScore(
          assessed.reduce(
            (sum, entry) => sum + (entry.score ?? 0) * entry.weight,
            0,
          ) / assessedWeight,
        )
      : undefined;
  const allCheckpointsAnswered =
    checkpoints.length > 0 && answered.length === checkpoints.length;
  const status =
    input.replayCompleted &&
    input.positionOpened &&
    planComplete &&
    allCheckpointsAnswered &&
    hasExplicitEventLinkage &&
    skipped.length === 0
      ? "completed"
      : "incomplete";

  return {
    drillId: definition.id,
    competencyId: definition.competencyId,
    definitionVersion: definition.definitionVersion,
    rubricVersion: definition.rubricVersion,
    rubricFingerprint: drillRubricFingerprint(definition.rubric),
    checkpointScheduleFingerprint:
      drillCheckpointScheduleFingerprint(checkpoints),
    ...(hasExplicitEventLinkage
      ? { eventLinkageEvidenceVersion: 1 as const }
      : {}),
    status,
    overallScore,
    methodology: `Process-only score: ${roundedScore(
      definition.rubric.weights.plan_coverage * 100,
    )}% initial plan coverage, ${roundedScore(
      definition.rubric.weights.checkpoint_coverage * 100,
    )}% checkpoint coverage, ${roundedScore(
      definition.rubric.weights.event_linkage * 100,
    )}% visible-event linkage, and ${roundedScore(
      definition.rubric.weights.rule_adherence * 100,
    )}% rule adherence. Inapplicable or missing evidence is omitted rather than converted to zero; assessed weights are normalized.`,
    components,
    eligibleCheckpointCount: checkpoints.length,
    answeredCheckpointCount: answered.length,
    skippedCheckpointCount: skipped.length,
    eligibleEventCount: eligibleEventIds.size,
    linkedEventCount: linkedEventIds.size,
    violationCount: relevantViolations.length,
  };
}
