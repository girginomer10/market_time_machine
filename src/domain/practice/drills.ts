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
      "Response must link every event in its checkpoint exactly once.",
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
  const linkedEventIds = new Set(
    answered.flatMap((response) =>
      response.eventIds.filter((eventId) => eligibleEventIds.has(eventId)),
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
    skipped.length === 0
      ? "completed"
      : "incomplete";

  return {
    drillId: definition.id,
    competencyId: definition.competencyId,
    definitionVersion: definition.definitionVersion,
    rubricVersion: definition.rubricVersion,
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
