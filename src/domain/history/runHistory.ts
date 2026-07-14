import type {
  DrillAssessment,
  ReportPayload,
  ReportScore,
  ScenarioMode,
} from "../../types";
import type { BrokerMode } from "../../store/sessionStore";
import { parseDrillAssessment } from "./practiceLedger";
import { PRACTICE_DRILL_REFLECTION_MAX_LENGTH } from "../../types/reporting";

export const RUN_HISTORY_STORAGE_KEY = "market-time-machine.run-history.v1";
export const MAX_SAVED_RUNS = 12;
export const MAX_ARCHIVED_REPORT_EQUITY_POINTS = 512;
export const MAX_ARCHIVED_REPORT_COLLECTION_ITEMS = 2_000;
export const MAX_ARCHIVED_REPORT_TEXT_LENGTH = 100_000;

const MAX_ARCHIVED_REPORT_ID_LENGTH = 4_096;
const MAX_ARCHIVED_REPORT_SCORE_COMPONENTS = 5;
const MAX_ARCHIVED_REPORT_RECOMMENDATIONS = 100;
const MAX_ARCHIVED_REPORT_EVIDENCE_ITEMS = 1_000;
const MAX_ARCHIVED_REPORT_COUNT = 10_000_000;
const MAX_ARCHIVED_REPORT_ABSOLUTE_NUMBER = Number.MAX_SAFE_INTEGER;

export type CompletedRun = {
  id: string;
  /** Stable for one replay session, including save/restore round trips. */
  runInstanceId?: string;
  completedAt: string;
  scenarioId: string;
  scenarioTitle: string;
  currency?: string;
  pricePrecision?: number;
  mode: ScenarioMode;
  brokerMode: BrokerMode;
  sampleData: boolean;
  totalReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
  maxDrawdown: number;
  scoreStatus: ReportScore["status"] | "unavailable";
  score?: number;
  executionCount: number;
  closedTradeCount: number;
  journalEntryCount: number;
  journalCoverage?: number;
  report: ReportPayload;
};

export type RunHistoryStats = {
  completedRuns: number;
  scenariosCompleted: number;
  journaledRuns: number;
  bestScore?: number;
  averageScore?: number;
};

export type RunComparison = {
  previous?: CompletedRun;
  returnDelta?: number;
  excessReturnDelta?: number;
  drawdownDelta?: number;
  scoreDelta?: number;
};

type HistoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type RecordCompletedRunInput = {
  report: ReportPayload;
  runInstanceId?: string;
  mode: ScenarioMode;
  brokerMode: BrokerMode;
  currency?: string;
  pricePrecision?: number;
  completedAt?: string;
};

function browserStorage(): HistoryStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isReportNumber(value: unknown): value is number {
  return (
    isFiniteNumber(value) &&
    Math.abs(value) <= MAX_ARCHIVED_REPORT_ABSOLUTE_NUMBER
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoundedText(
  value: unknown,
  maximumLength = MAX_ARCHIVED_REPORT_TEXT_LENGTH,
): value is string {
  return typeof value === "string" && value.length <= maximumLength;
}

function isBoundedNonEmptyString(
  value: unknown,
  maximumLength = MAX_ARCHIVED_REPORT_ID_LENGTH,
): value is string {
  return isNonEmptyString(value) && value.length <= maximumLength;
}

function isTimestamp(value: unknown): value is string {
  return (
    isBoundedNonEmptyString(value) && Number.isFinite(Date.parse(value))
  );
}

function isOptionalBoundedNonEmptyString(
  value: unknown,
): value is string | undefined {
  return value === undefined || isBoundedNonEmptyString(value);
}

function isOptionalTimestamp(value: unknown): value is string | undefined {
  return value === undefined || isTimestamp(value);
}

function isOptionalReportNumber(value: unknown): value is number | undefined {
  return value === undefined || isReportNumber(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= MAX_ARCHIVED_REPORT_COUNT
  );
}

function isBoundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return isFiniteNumber(value) && value >= minimum && value <= maximum;
}

function isOptionalBoundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number | undefined {
  return value === undefined || isBoundedNumber(value, minimum, maximum);
}

function isBoundedArray(
  value: unknown,
  maximumItems: number,
  validate: (candidate: unknown) => boolean,
): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every((candidate) => validate(candidate))
  );
}

function isOptionalBoundedArray(
  value: unknown,
  maximumItems: number,
  validate: (candidate: unknown) => boolean,
): boolean {
  return value === undefined || isBoundedArray(value, maximumItems, validate);
}

function isBoundedStringArray(
  value: unknown,
  maximumItems = MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
): value is string[] {
  return isBoundedArray(value, maximumItems, isBoundedText);
}

function isScenarioMode(value: unknown): value is ScenarioMode {
  return ["explorer", "professional", "blind", "challenge"].includes(
    String(value),
  );
}

function isBrokerMode(value: unknown): value is BrokerMode {
  return ["scenario", "ideal", "realistic", "harsh"].includes(String(value));
}

function isUniqueStringArray(
  value: unknown,
  maximumItems = MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
): value is string[] {
  return (
    isBoundedArray(value, maximumItems, isBoundedNonEmptyString) &&
    new Set(value).size === value.length
  );
}

function sameStringMembers(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

const PRACTICE_EVENT_TYPES = new Set([
  "news",
  "earnings",
  "macro",
  "central_bank",
  "regulation",
  "geopolitical",
  "analyst_rating",
  "price_event",
  "social_sentiment",
  "onchain",
  "corporate_action",
]);

function isOptionalText(value: unknown): value is string | undefined {
  return value === undefined || isBoundedText(value);
}

function isPracticeDefinitionSnapshot(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const initialPlanRule = value.initialPlanRule;
  const checkpointRule = value.checkpointRule;
  const rubric = value.rubric;
  if (!isRecord(initialPlanRule) || !isRecord(checkpointRule) || !isRecord(rubric)) {
    return false;
  }
  const requiredFields = initialPlanRule.requiredFields;
  const actions = checkpointRule.actions;
  const weights = rubric.weights;
  const componentIds = [
    "plan_coverage",
    "checkpoint_coverage",
    "event_linkage",
    "rule_adherence",
  ];
  const allowedPlanFields = [
    "thesis",
    "invalidation",
    "exitPlan",
    "acceptedRisk",
  ];
  const allowedActions = ["hold", "reduce", "exit", "wait"];
  if (
    !isBoundedNonEmptyString(value.id) ||
    !isBoundedNonEmptyString(value.competencyId) ||
    !isNonNegativeInteger(value.definitionVersion) ||
    Number(value.definitionVersion) < 1 ||
    !isBoundedNonEmptyString(value.rubricVersion) ||
    !isBoundedNonEmptyString(value.title, MAX_ARCHIVED_REPORT_TEXT_LENGTH) ||
    !isBoundedText(value.description) ||
    !isBoundedNonEmptyString(value.scenarioId) ||
    !isBoundedNonEmptyString(value.primarySymbol) ||
    !isScenarioMode(value.mode) ||
    typeof initialPlanRule.requiredBeforeFirstOrder !== "boolean" ||
    !isUniqueStringArray(requiredFields, allowedPlanFields.length) ||
    requiredFields.some((field) => !allowedPlanFields.includes(field)) ||
    !Number.isInteger(checkpointRule.minimumImportance) ||
    Number(checkpointRule.minimumImportance) < 1 ||
    Number(checkpointRule.minimumImportance) > 5 ||
    checkpointRule.mapping !== "next_primary_candle_close" ||
    checkpointRule.groupSameReplayIndex !== true ||
    typeof checkpointRule.requireReflection !== "boolean" ||
    !isUniqueStringArray(actions, allowedActions.length) ||
    !sameStringMembers(actions, allowedActions) ||
    !isRecord(weights) ||
    Object.keys(weights).length !== componentIds.length ||
    !componentIds.every(
      (id) =>
        isFiniteNumber(weights[id]) &&
        Number(weights[id]) >= 0 &&
        Number(weights[id]) <= 1,
    ) ||
    Math.abs(
      componentIds.reduce((sum, id) => sum + Number(weights[id]), 0) - 1,
    ) > 0.000001 ||
    !isFiniteNumber(rubric.violationPenalty) ||
    rubric.violationPenalty < 0 ||
    rubric.violationPenalty > 100
  ) {
    return false;
  }
  return true;
}

function isPracticePlanSnapshot(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return (
    isOptionalText(value.thesis) &&
    isOptionalText(value.invalidation) &&
    isOptionalText(value.exitPlan) &&
    isOptionalText(value.acceptedRisk) &&
    (value.linkedEventIds === undefined ||
      isUniqueStringArray(value.linkedEventIds))
  );
}

function isPracticeDrillSnapshot(value: unknown): boolean {
  if (!isRecord(value) || !isPracticeDefinitionSnapshot(value.definition)) {
    return false;
  }
  if (
    !isPracticePlanSnapshot(value.initialPlan) ||
    !Array.isArray(value.checkpoints) ||
    value.checkpoints.length > MAX_ARCHIVED_REPORT_COLLECTION_ITEMS ||
    !Array.isArray(value.violations) ||
    value.violations.length > MAX_ARCHIVED_REPORT_COLLECTION_ITEMS
  ) {
    return false;
  }
  const definition = value.definition;
  const checkpointRule = definition.checkpointRule;
  if (!isRecord(checkpointRule)) return false;
  const checkpointIds = new Set<string>();
  const responseIds = new Set<string>();
  const allEventIds = new Set<string>();
  let previousReplayIndex = -1;
  for (const candidate of value.checkpoints) {
    if (!isRecord(candidate) || !isRecord(candidate.checkpoint)) return false;
    const checkpoint = candidate.checkpoint;
    if (
      !isBoundedNonEmptyString(checkpoint.id) ||
      checkpointIds.has(checkpoint.id) ||
      checkpoint.drillId !== definition.id ||
      checkpoint.definitionVersion !== definition.definitionVersion ||
      !isNonNegativeInteger(checkpoint.replayIndex) ||
      Number(checkpoint.replayIndex) <= previousReplayIndex ||
      !isTimestamp(checkpoint.replayTime) ||
      !isUniqueStringArray(checkpoint.eventIds) ||
      checkpoint.eventIds.length === 0 ||
      !Array.isArray(candidate.events) ||
      candidate.events.length > MAX_ARCHIVED_REPORT_COLLECTION_ITEMS
    ) {
      return false;
    }
    checkpointIds.add(checkpoint.id);
    previousReplayIndex = Number(checkpoint.replayIndex);
    const checkpointTime = Date.parse(checkpoint.replayTime);
    const eventIds = new Set<string>();
    for (const event of candidate.events) {
      if (
        !isRecord(event) ||
        !isBoundedNonEmptyString(event.id) ||
        eventIds.has(event.id) ||
        allEventIds.has(event.id) ||
        !isTimestamp(event.publishedAt) ||
        Date.parse(event.publishedAt) > checkpointTime ||
        !isBoundedNonEmptyString(event.title, MAX_ARCHIVED_REPORT_TEXT_LENGTH) ||
        !PRACTICE_EVENT_TYPES.has(String(event.type)) ||
        !Number.isInteger(event.importance) ||
        Number(event.importance) < 1 ||
        Number(event.importance) > 5 ||
        (event.source !== undefined &&
          !isBoundedNonEmptyString(event.source, MAX_ARCHIVED_REPORT_TEXT_LENGTH))
      ) {
        return false;
      }
      eventIds.add(event.id);
      allEventIds.add(event.id);
    }
    if (!sameStringMembers(checkpoint.eventIds, [...eventIds])) return false;

    if (candidate.response !== undefined) {
      const response = candidate.response;
      if (
        !isRecord(response) ||
        !isBoundedNonEmptyString(response.id) ||
        responseIds.has(response.id) ||
        response.drillId !== definition.id ||
        response.definitionVersion !== definition.definitionVersion ||
        response.checkpointId !== checkpoint.id ||
        response.replayTime !== checkpoint.replayTime ||
        response.status !== "answered" ||
        !["hold", "reduce", "exit", "wait"].includes(String(response.action)) ||
        !isUniqueStringArray(response.eventIds) ||
        !sameStringMembers(response.eventIds, checkpoint.eventIds) ||
        !isOptionalText(response.reflection) ||
        (checkpointRule.requireReflection === true &&
          (typeof response.reflection !== "string" ||
            response.reflection.trim().length === 0)) ||
        (typeof response.reflection === "string" &&
          response.reflection.length > PRACTICE_DRILL_REFLECTION_MAX_LENGTH) ||
        (response.positionQuantity !== undefined &&
          !isReportNumber(response.positionQuantity)) ||
        (response.workingOrderIds !== undefined &&
          !isUniqueStringArray(response.workingOrderIds))
      ) {
        return false;
      }
      responseIds.add(response.id);
    }
  }
  const violationIds = new Set<string>();
  for (const violation of value.violations) {
    if (
      !isRecord(violation) ||
      !isBoundedNonEmptyString(violation.id) ||
      violationIds.has(violation.id) ||
      violation.drillId !== definition.id ||
      violation.definitionVersion !== definition.definitionVersion ||
      ![
        "order_before_plan",
        "checkpoint_skipped",
        "advance_while_checkpoint_open",
        "invalid_checkpoint_response",
      ].includes(String(violation.code)) ||
      !isTimestamp(violation.replayTime) ||
      (violation.checkpointId !== undefined &&
        (!isBoundedNonEmptyString(violation.checkpointId) ||
          !checkpointIds.has(violation.checkpointId))) ||
      !isBoundedNonEmptyString(
        violation.evidence,
        MAX_ARCHIVED_REPORT_TEXT_LENGTH,
      )
    ) {
      return false;
    }
    violationIds.add(violation.id);
  }
  return true;
}

function practiceDrillMatchesAssessment(
  value: Record<string, unknown>,
  assessment: DrillAssessment,
  scenarioId: string,
): boolean {
  const definition = value.definition;
  const checkpoints = value.checkpoints;
  const violations = value.violations;
  if (
    !isRecord(definition) ||
    !isRecord(definition.rubric) ||
    !isRecord(definition.rubric.weights) ||
    !Array.isArray(checkpoints) ||
    !Array.isArray(violations)
  ) {
    return false;
  }

  const eligibleEventIds = new Set<string>();
  const linkedEventIds = new Set<string>();
  let answeredCheckpointCount = 0;
  for (const candidate of checkpoints) {
    if (!isRecord(candidate) || !isRecord(candidate.checkpoint)) return false;
    const checkpoint = candidate.checkpoint;
    if (!Array.isArray(checkpoint.eventIds)) return false;
    for (const eventId of checkpoint.eventIds) {
      if (typeof eventId !== "string") return false;
      eligibleEventIds.add(eventId);
    }
    if (candidate.response !== undefined) {
      if (!isRecord(candidate.response) || !Array.isArray(candidate.response.eventIds)) {
        return false;
      }
      answeredCheckpointCount += 1;
      for (const eventId of candidate.response.eventIds) {
        if (typeof eventId !== "string") return false;
        linkedEventIds.add(eventId);
      }
    }
  }

  const skippedCheckpointIds = new Set<string>();
  for (const violation of violations) {
    if (!isRecord(violation) || violation.code !== "checkpoint_skipped") continue;
    if (!isNonEmptyString(violation.checkpointId)) return false;
    skippedCheckpointIds.add(violation.checkpointId);
  }

  const weights = definition.rubric.weights;
  return (
    definition.scenarioId === scenarioId &&
    definition.id === assessment.drillId &&
    definition.competencyId === assessment.competencyId &&
    definition.definitionVersion === assessment.definitionVersion &&
    definition.rubricVersion === assessment.rubricVersion &&
    assessment.components.every(
      (component) =>
        isFiniteNumber(weights[component.id]) &&
        Math.abs(Number(weights[component.id]) - component.weight) <= 0.000001,
    ) &&
    assessment.eligibleCheckpointCount === checkpoints.length &&
    assessment.answeredCheckpointCount === answeredCheckpointCount &&
    assessment.skippedCheckpointCount === skippedCheckpointIds.size &&
    assessment.eligibleEventCount === eligibleEventIds.size &&
    assessment.linkedEventCount === linkedEventIds.size &&
    assessment.violationCount === violations.length
  );
}

const BEHAVIORAL_FLAG_TYPES = new Set([
  "panic_sell",
  "fomo_buy",
  "dip_catching",
  "early_profit_take",
  "holding_loser",
  "overtrading",
  "news_overreaction",
  "excessive_leverage",
]);

const ORDER_TYPES = new Set(["market", "limit", "stop_loss", "take_profit"]);
const ORDER_STATUSES = new Set([
  "pending",
  "filled",
  "partially_filled",
  "cancelled",
  "rejected",
  "expired",
]);
const AUDIT_EVENT_TYPES = new Set([
  "replay_step",
  "order_placed",
  "order_rejected",
  "order_cancelled",
  "order_updated",
  "fill",
  "margin_call",
  "forced_liquidation",
  "borrow_cost",
  "tif_expired",
  "corporate_action",
  "session_restored",
]);
const SCORE_COMPONENT_IDS = new Set([
  "risk_adjusted_return",
  "benchmark_outperformance",
  "drawdown_control",
  "decision_consistency",
  "journal_quality",
]);

function isDecisionPlan(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isOptionalText(value.thesis) &&
    isOptionalText(value.invalidation) &&
    isOptionalText(value.exitPlan) &&
    isOptionalText(value.acceptedRisk) &&
    (value.linkedEventIds === undefined ||
      isUniqueStringArray(value.linkedEventIds))
  );
}

function isFill(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedNonEmptyString(value.id) &&
    isBoundedNonEmptyString(value.orderId) &&
    isTimestamp(value.time) &&
    isBoundedNonEmptyString(value.symbol) &&
    (value.side === "buy" || value.side === "sell") &&
    [
      value.quantity,
      value.price,
      value.referencePrice,
      value.commission,
      value.spreadCost,
      value.slippage,
      value.totalCost,
    ].every(isReportNumber) &&
    (value.reason === undefined ||
      ["user_order", "working_order", "forced_liquidation", "borrow_cost"].includes(
        String(value.reason),
      )) &&
    isOptionalReportNumber(value.liquidityParticipation) &&
    (value.executionPriceSource === undefined ||
      [
        "market",
        "limit",
        "stop_trigger",
        "gap_open",
        "forced_liquidation",
        "financing",
      ].includes(String(value.executionPriceSource))) &&
    (value.forcedLiquidation === undefined ||
      typeof value.forcedLiquidation === "boolean") &&
    isOptionalText(value.note) &&
    (value.decisionPlan === undefined || isDecisionPlan(value.decisionPlan))
  );
}

function isOrder(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const optionalNumberKeys = [
    "limitPrice",
    "triggerPrice",
    "remainingQuantity",
    "filledQuantity",
    "averageFillPrice",
  ] as const;
  return (
    isBoundedNonEmptyString(value.id) &&
    isTimestamp(value.createdAt) &&
    isBoundedNonEmptyString(value.symbol) &&
    (value.side === "buy" || value.side === "sell") &&
    ORDER_TYPES.has(String(value.type)) &&
    isReportNumber(value.quantity) &&
    optionalNumberKeys.every((key) => isOptionalReportNumber(value[key])) &&
    isOptionalBoundedNonEmptyString(value.ocoGroupId) &&
    (value.timeInForce === undefined ||
      value.timeInForce === "day" ||
      value.timeInForce === "gtc") &&
    isOptionalTimestamp(value.expiresAt) &&
    isOptionalBoundedNonEmptyString(value.rejectionCode) &&
    isOptionalTimestamp(value.triggeredAt) &&
    isOptionalTimestamp(value.closedAt) &&
    ORDER_STATUSES.has(String(value.status)) &&
    isOptionalText(value.rejectionReason) &&
    isOptionalText(value.note) &&
    (value.decisionPlan === undefined || isDecisionPlan(value.decisionPlan))
  );
}

function isAuditEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedNonEmptyString(value.id) &&
    isTimestamp(value.time) &&
    AUDIT_EVENT_TYPES.has(String(value.type)) &&
    isBoundedText(value.message) &&
    isOptionalBoundedNonEmptyString(value.orderId) &&
    isOptionalBoundedNonEmptyString(value.fillId) &&
    isOptionalBoundedNonEmptyString(value.symbol)
  );
}

function isJournalEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedNonEmptyString(value.id) &&
    isTimestamp(value.time) &&
    isOptionalBoundedNonEmptyString(value.fillId) &&
    isBoundedText(value.note) &&
    isOptionalBoundedNonEmptyString(value.symbol) &&
    (value.decisionPlan === undefined || isDecisionPlan(value.decisionPlan))
  );
}

function isMarketEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedNonEmptyString(value.id) &&
    isTimestamp(value.happenedAt) &&
    isTimestamp(value.publishedAt) &&
    isBoundedText(value.title) &&
    PRACTICE_EVENT_TYPES.has(String(value.type)) &&
    isBoundedText(value.summary) &&
    isUniqueStringArray(value.affectedSymbols) &&
    Number.isInteger(value.importance) &&
    Number(value.importance) >= 1 &&
    Number(value.importance) <= 5 &&
    (value.sentiment === undefined ||
      ["positive", "negative", "mixed", "neutral"].includes(
        String(value.sentiment),
      )) &&
    isOptionalText(value.source) &&
    isOptionalText(value.sourceUrl)
  );
}

function isEquityPoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isTimestamp(value.time) &&
    isReportNumber(value.portfolioValue) &&
    isReportNumber(value.benchmarkValue) &&
    (value.isInitial === undefined || typeof value.isInitial === "boolean") &&
    isOptionalReportNumber(value.financingCost) &&
    isOptionalReportNumber(value.equityAdjustment)
  );
}

function isTradeOutcome(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isFill(value.fill) &&
    isReportNumber(value.realizedPnl) &&
    isReportNumber(value.contributionPct) &&
    isOptionalReportNumber(value.matchedQuantity) &&
    isOptionalTimestamp(value.entryTime) &&
    (value.positionSide === undefined ||
      value.positionSide === "long" ||
      value.positionSide === "short")
  );
}

function isBehavioralFlag(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedNonEmptyString(value.id) &&
    BEHAVIORAL_FLAG_TYPES.has(String(value.type)) &&
    Number.isInteger(value.severity) &&
    Number(value.severity) >= 1 &&
    Number(value.severity) <= 5 &&
    isUniqueStringArray(value.tradeIds) &&
    isBoundedText(value.evidence) &&
    isOptionalReportNumber(value.estimatedImpact)
  );
}

function isDecisionActualContext(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isTimestamp(value.firstFillTime) &&
    isTimestamp(value.lastFillTime) &&
    isNonNegativeInteger(value.fillCount) &&
    isReportNumber(value.executedQuantity) &&
    isReportNumber(value.averageFillPrice) &&
    isOptionalReportNumber(value.realizedPnl) &&
    ["realized_gain", "realized_loss", "realized_flat", "not_realized"].includes(
      String(value.result),
    )
  );
}

function isDecisionReplayPoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isFill(value.fill) &&
    isOptionalBoundedArray(
      value.fills,
      MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
      isFill,
    ) &&
    (value.order === undefined || isOrder(value.order)) &&
    isOptionalTimestamp(value.decisionTime) &&
    (value.journalEntry === undefined || isJournalEntry(value.journalEntry)) &&
    (value.decisionPlan === undefined || isDecisionPlan(value.decisionPlan)) &&
    isOptionalBoundedArray(
      value.visibleEvents,
      MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
      isMarketEvent,
    ) &&
    isOptionalBoundedArray(
      value.linkedEvents,
      MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
      isMarketEvent,
    ) &&
    isBoundedArray(
      value.auditEvents,
      MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
      isAuditEvent,
    ) &&
    (value.tradeOutcome === undefined || isTradeOutcome(value.tradeOutcome)) &&
    isOptionalBoundedArray(
      value.tradeOutcomes,
      MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
      isTradeOutcome,
    ) &&
    (value.actual === undefined || isDecisionActualContext(value.actual)) &&
    isOptionalReportNumber(value.equityBefore) &&
    isOptionalReportNumber(value.equityAfter)
  );
}

function isPerformanceAttribution(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [
    value.realizedTradePnl,
    value.unrealizedAndResidualPnl,
    value.feesPaid,
    value.slippagePaid,
    value.financingPaid,
    value.benchmarkPnl,
    value.activePnl,
  ].every(isReportNumber);
}

function isScenarioProvenance(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedText(value.license) &&
    isBoundedStringArray(value.dataSources) &&
    (value.sourceManifest === undefined ||
      isBoundedStringArray(value.sourceManifest)) &&
    isOptionalText(value.dataVersion) &&
    isOptionalTimestamp(value.generatedAt) &&
    (value.priceAdjustment === undefined ||
      ["raw", "split_adjusted", "total_return"].includes(
        String(value.priceAdjustment),
      )) &&
    isOptionalBoundedNonEmptyString(value.marketCalendarId) &&
    typeof value.isSampleData === "boolean" &&
    (value.dataFidelity === undefined ||
      ["observed", "derived", "synthetic", "mixed"].includes(
        String(value.dataFidelity),
      )) &&
    (value.observedFields === undefined ||
      isBoundedStringArray(value.observedFields)) &&
    (value.derivedFields === undefined ||
      isBoundedStringArray(value.derivedFields))
  );
}

function isReportScoreComponent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    SCORE_COMPONENT_IDS.has(String(value.id)) &&
    isBoundedText(value.label) &&
    isBoundedNumber(value.weight, 0, 1) &&
    isOptionalBoundedNumber(value.score, 0, 100) &&
    (value.status === "scored" || value.status === "not_applicable") &&
    isBoundedText(value.evidence)
  );
}

function isReportScore(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    (value.status !== "scored" && value.status !== "insufficient_evidence") ||
    !isOptionalBoundedNumber(value.overall, 0, 100) ||
    !isBoundedArray(
      value.components,
      MAX_ARCHIVED_REPORT_SCORE_COMPONENTS,
      isReportScoreComponent,
    ) ||
    !isBoundedText(value.methodology) ||
    !isOptionalText(value.reason)
  ) {
    return false;
  }
  const ids = value.components.flatMap((component) =>
    isRecord(component) && typeof component.id === "string" ? [component.id] : [],
  );
  return new Set(ids).size === ids.length;
}

function isJournalQualitySummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    ["assessed", "insufficient_evidence", "not_applicable"].includes(
      String(value.status),
    ) &&
    isOptionalBoundedNumber(value.score, 0, 100) &&
    isNonNegativeInteger(value.executedDecisionCount) &&
    isNonNegativeInteger(value.linkedEntryCount) &&
    isBoundedNumber(value.coverageRate, 0, 1) &&
    isBoundedNumber(value.reasonRate, 0, 1) &&
    isBoundedNumber(value.riskPlanRate, 0, 1) &&
    isOptionalBoundedNumber(value.structuredPlanRate, 0, 1) &&
    isOptionalBoundedNumber(value.eventLinkRate, 0, 1) &&
    isBoundedStringArray(value.evidence, MAX_ARCHIVED_REPORT_EVIDENCE_ITEMS)
  );
}

function isDecisionConsistencySummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    ["assessed", "insufficient_evidence", "not_applicable"].includes(
      String(value.status),
    ) &&
    isOptionalBoundedNumber(value.score, 0, 100) &&
    isNonNegativeInteger(value.assessedDecisionCount) &&
    isNonNegativeInteger(value.behavioralFlagCount) &&
    isNonNegativeInteger(value.severeBehavioralFlagCount) &&
    isNonNegativeInteger(value.forcedLiquidationCount) &&
    isBoundedStringArray(value.evidence, MAX_ARCHIVED_REPORT_EVIDENCE_ITEMS)
  );
}

function isPracticeRecommendation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedNonEmptyString(value.id) &&
    Number.isInteger(value.priority) &&
    Number(value.priority) >= 1 &&
    Number(value.priority) <= 3 &&
    isBoundedText(value.title) &&
    isBoundedText(value.rationale) &&
    isBoundedText(value.evidence) &&
    isBoundedText(value.suggestedPractice)
  );
}

function isExecutionQuality(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    [
      value.totalFills,
      value.partialFillCount,
      value.rejectedOrderCount,
      value.expiredOrderCount,
      value.forcedLiquidationCount,
      value.marginEventCount,
    ].every(isNonNegativeInteger) &&
    isReportNumber(value.borrowCostPaid) &&
    isOptionalReportNumber(value.averageLiquidityParticipation)
  );
}

function isAuditSummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [
    value.totalEvents,
    value.orderEvents,
    value.fillEvents,
    value.riskEvents,
  ].every(isNonNegativeInteger);
}

function isReportMetrics(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const requiredMetricKeys = [
    "totalReturn",
    "benchmarkReturn",
    "excessReturn",
    "maxDrawdown",
    "volatility",
    "winRate",
    "exposureTime",
    "turnover",
    "feesPaid",
    "slippagePaid",
    "initialEquity",
    "finalEquity",
    "benchmarkInitial",
    "benchmarkFinal",
  ] as const;
  const optionalMetricKeys = [
    "sharpe",
    "sortino",
    "calmar",
    "profitFactor",
    "averageWin",
    "averageLoss",
  ] as const;
  return (
    requiredMetricKeys.every((key) => isReportNumber(value[key])) &&
    optionalMetricKeys.every((key) => isOptionalReportNumber(value[key]))
  );
}

function isBoundedDrillAssessment(value: DrillAssessment): boolean {
  return (
    isBoundedNonEmptyString(value.drillId) &&
    isOptionalBoundedNonEmptyString(value.competencyId) &&
    isNonNegativeInteger(value.definitionVersion) &&
    value.definitionVersion > 0 &&
    isBoundedNonEmptyString(value.rubricVersion) &&
    isBoundedText(value.methodology) &&
    [
      value.eligibleCheckpointCount,
      value.answeredCheckpointCount,
      value.skippedCheckpointCount,
      value.eligibleEventCount,
      value.linkedEventCount,
      value.violationCount,
    ].every(isNonNegativeInteger) &&
    value.components.every(
      (component) =>
        isBoundedText(component.label) && isBoundedText(component.evidence),
    )
  );
}

function isReportPayload(value: unknown): value is ReportPayload {
  if (!isRecord(value) || !isReportMetrics(value.metrics)) return false;
  const assessment =
    value.practiceAssessment === undefined
      ? undefined
      : parseDrillAssessment(value.practiceAssessment);
  if (
    (value.practiceAssessment !== undefined && !assessment) ||
    (assessment !== undefined && !isBoundedDrillAssessment(assessment)) ||
    (value.practiceDrill !== undefined &&
      !isPracticeDrillSnapshot(value.practiceDrill)) ||
    (value.practiceDrill !== undefined && !assessment)
  ) {
    return false;
  }
  if (assessment && isRecord(value.practiceDrill)) {
    if (!isNonEmptyString(value.scenarioId) ||
      !practiceDrillMatchesAssessment(
        value.practiceDrill,
        assessment,
        value.scenarioId,
      )) {
      return false;
    }
  }
  return (
    isBoundedNonEmptyString(value.scenarioId) &&
    isBoundedNonEmptyString(
      value.scenarioTitle,
      MAX_ARCHIVED_REPORT_TEXT_LENGTH,
    ) &&
    isBoundedArray(
      value.equityCurve,
      MAX_ARCHIVED_REPORT_EQUITY_POINTS,
      isEquityPoint,
    ) &&
    (value.bestTrade === undefined || isTradeOutcome(value.bestTrade)) &&
    (value.worstTrade === undefined || isTradeOutcome(value.worstTrade)) &&
    isNonNegativeInteger(value.totalTrades) &&
    (value.closedTradeCount === undefined ||
      isNonNegativeInteger(value.closedTradeCount)) &&
    isOptionalBoundedArray(
      value.tradeOutcomes,
      MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
      isTradeOutcome,
    ) &&
    isOptionalBoundedArray(
      value.fills,
      MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
      isFill,
    ) &&
    isBoundedArray(
      value.behavioralFlags,
      MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
      isBehavioralFlag,
    ) &&
    isOptionalBoundedArray(
      value.journal,
      MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
      isJournalEntry,
    ) &&
    isOptionalBoundedArray(
      value.decisionReplay,
      MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
      isDecisionReplayPoint,
    ) &&
    (value.attribution === undefined ||
      isPerformanceAttribution(value.attribution)) &&
    (value.provenance === undefined ||
      isScenarioProvenance(value.provenance)) &&
    (value.score === undefined || isReportScore(value.score)) &&
    (value.journalQuality === undefined ||
      isJournalQualitySummary(value.journalQuality)) &&
    (value.decisionConsistency === undefined ||
      isDecisionConsistencySummary(value.decisionConsistency)) &&
    isOptionalBoundedArray(
      value.recommendations,
      MAX_ARCHIVED_REPORT_RECOMMENDATIONS,
      isPracticeRecommendation,
    ) &&
    (value.executionQuality === undefined ||
      isExecutionQuality(value.executionQuality)) &&
    (value.auditSummary === undefined || isAuditSummary(value.auditSummary)) &&
    isOptionalBoundedArray(
      value.orders,
      MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
      isOrder,
    ) &&
    isOptionalBoundedArray(
      value.auditEvents,
      MAX_ARCHIVED_REPORT_COLLECTION_ITEMS,
      isAuditEvent,
    )
  );
}

export function isCompletedRun(value: unknown): value is CompletedRun {
  if (!isRecord(value)) return false;
  return (
    isBoundedNonEmptyString(value.id) &&
    (value.runInstanceId === undefined ||
      isBoundedNonEmptyString(value.runInstanceId)) &&
    isTimestamp(value.completedAt) &&
    isBoundedNonEmptyString(value.scenarioId) &&
    isBoundedNonEmptyString(
      value.scenarioTitle,
      MAX_ARCHIVED_REPORT_TEXT_LENGTH,
    ) &&
    (value.currency === undefined || isBoundedNonEmptyString(value.currency)) &&
    (value.pricePrecision === undefined ||
      (Number.isInteger(value.pricePrecision) &&
        Number(value.pricePrecision) >= 0 &&
        Number(value.pricePrecision) <= 8)) &&
    isScenarioMode(value.mode) &&
    isBrokerMode(value.brokerMode) &&
    typeof value.sampleData === "boolean" &&
    isReportNumber(value.totalReturn) &&
    isReportNumber(value.benchmarkReturn) &&
    isReportNumber(value.excessReturn) &&
    isReportNumber(value.maxDrawdown) &&
    ["scored", "insufficient_evidence", "unavailable"].includes(
      String(value.scoreStatus),
    ) &&
    (value.score === undefined ||
      isBoundedNumber(value.score, 0, 100)) &&
    isNonNegativeInteger(value.executionCount) &&
    isNonNegativeInteger(value.closedTradeCount) &&
    isNonNegativeInteger(value.journalEntryCount) &&
    (value.journalCoverage === undefined ||
      isBoundedNumber(value.journalCoverage, 0, 1)) &&
    isReportPayload(value.report) &&
    (value.report.practiceDrill === undefined ||
      value.report.practiceDrill.definition.mode === value.mode) &&
    value.report.scenarioId === value.scenarioId &&
    value.report.scenarioTitle === value.scenarioTitle &&
    value.report.metrics.totalReturn === value.totalReturn &&
    value.report.metrics.benchmarkReturn === value.benchmarkReturn &&
    value.report.metrics.excessReturn === value.excessReturn &&
    value.report.metrics.maxDrawdown === value.maxDrawdown &&
    (value.report.provenance?.isSampleData ?? true) === value.sampleData
  );
}

function downsampleReport(report: ReportPayload): ReportPayload {
  const maxEquityPoints = 240;
  const points = report.equityCurve;
  const equityCurve =
    points.length <= maxEquityPoints
      ? points
      : points.filter(
          (_point, index) =>
            index === 0 ||
            index === points.length - 1 ||
            index % Math.ceil(points.length / maxEquityPoints) === 0,
        );

  return {
    ...report,
    equityCurve,
    auditEvents: report.auditEvents?.slice(-250),
    orders: report.orders?.slice(-250),
    fills: report.fills?.slice(-250),
    journal: report.journal?.slice(-250),
    decisionReplay: report.decisionReplay?.map((point) => ({
      ...point,
      auditEvents: point.auditEvents.slice(-20),
    })),
  };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function runFingerprint(report: ReportPayload, mode: ScenarioMode): string {
  const fillIds = report.fills?.map((fill) => fill.id).join(",") ?? "";
  const journalIds = report.journal?.map((entry) => entry.id).join(",") ?? "";
  const orderIds = report.orders?.map((order) => order.id).join(",") ?? "";
  return stableHash(
    [
      report.scenarioId,
      mode,
      report.metrics.finalEquity,
      report.metrics.totalReturn,
      report.metrics.excessReturn,
      fillIds,
      journalIds,
      orderIds,
    ].join("|"),
  );
}

export function loadRunHistory(
  storage: HistoryStorage | undefined = browserStorage(),
): CompletedRun[] {
  if (!storage) return [];
  try {
    const serialized = storage.getItem(RUN_HISTORY_STORAGE_KEY);
    if (!serialized) return [];
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCompletedRun).slice(0, MAX_SAVED_RUNS);
  } catch {
    return [];
  }
}

export function persistRunHistory(
  runs: CompletedRun[],
  storage: HistoryStorage | undefined = browserStorage(),
): CompletedRun[] {
  if (!storage) return runs.slice(0, MAX_SAVED_RUNS);
  let retained = runs.slice(0, MAX_SAVED_RUNS);
  while (retained.length > 0) {
    try {
      storage.setItem(RUN_HISTORY_STORAGE_KEY, JSON.stringify(retained));
      return retained;
    } catch {
      retained = retained.slice(0, -1);
    }
  }
  try {
    storage.removeItem(RUN_HISTORY_STORAGE_KEY);
  } catch {
    // Storage may be disabled or full. The completed report remains in memory.
  }
  return [];
}

export function recordCompletedRun(
  input: RecordCompletedRunInput,
  storage: HistoryStorage | undefined = browserStorage(),
): { run: CompletedRun; history: CompletedRun[]; added: boolean } {
  const existing = loadRunHistory(storage);
  const id =
    input.runInstanceId ??
    `${input.report.scenarioId}-${runFingerprint(input.report, input.mode)}`;
  const duplicate = existing.find((run) => run.id === id);
  if (duplicate) return { run: duplicate, history: existing, added: false };

  const run: CompletedRun = {
    id,
    runInstanceId: input.runInstanceId,
    completedAt: input.completedAt ?? new Date().toISOString(),
    scenarioId: input.report.scenarioId,
    scenarioTitle: input.report.scenarioTitle,
    currency: input.currency,
    pricePrecision: input.pricePrecision,
    mode: input.mode,
    brokerMode: input.brokerMode,
    sampleData: input.report.provenance?.isSampleData ?? true,
    totalReturn: input.report.metrics.totalReturn,
    benchmarkReturn: input.report.metrics.benchmarkReturn,
    excessReturn: input.report.metrics.excessReturn,
    maxDrawdown: input.report.metrics.maxDrawdown,
    scoreStatus: input.report.score?.status ?? "unavailable",
    score: input.report.score?.overall,
    executionCount:
      input.report.executionQuality?.totalFills ??
      input.report.fills?.length ??
      input.report.totalTrades,
    closedTradeCount:
      input.report.closedTradeCount ?? input.report.tradeOutcomes?.length ?? 0,
    journalEntryCount: input.report.journal?.length ?? 0,
    journalCoverage: input.report.journalQuality?.coverageRate,
    report: downsampleReport(input.report),
  };
  const history = persistRunHistory([run, ...existing], storage);
  return { run, history, added: history.some((entry) => entry.id === id) };
}

export function removeCompletedRun(
  id: string,
  storage: HistoryStorage | undefined = browserStorage(),
): CompletedRun[] {
  return persistRunHistory(
    loadRunHistory(storage).filter((run) => run.id !== id),
    storage,
  );
}

export function clearRunHistory(
  storage: HistoryStorage | undefined = browserStorage(),
): void {
  try {
    storage?.removeItem(RUN_HISTORY_STORAGE_KEY);
  } catch {
    // Clearing history is best effort when browser storage is unavailable.
  }
}

export function runHistoryStats(runs: CompletedRun[]): RunHistoryStats {
  const scores = runs
    .map((run) => run.score)
    .filter((score): score is number => score !== undefined);
  return {
    completedRuns: runs.length,
    scenariosCompleted: new Set(runs.map((run) => run.scenarioId)).size,
    journaledRuns: runs.filter((run) => run.journalEntryCount > 0).length,
    bestScore: scores.length > 0 ? Math.max(...scores) : undefined,
    averageScore:
      scores.length > 0
        ? scores.reduce((sum, score) => sum + score, 0) / scores.length
        : undefined,
  };
}

export function compareRunWithPrevious(
  run: CompletedRun,
  history: CompletedRun[],
): RunComparison {
  const currentIndex = history.findIndex((entry) => entry.id === run.id);
  const candidates = currentIndex >= 0 ? history.slice(currentIndex + 1) : history;
  const previous = candidates.find(
    (entry) => entry.scenarioId === run.scenarioId,
  );
  if (!previous) return {};
  return {
    previous,
    returnDelta: run.totalReturn - previous.totalReturn,
    excessReturnDelta: run.excessReturn - previous.excessReturn,
    drawdownDelta: run.maxDrawdown - previous.maxDrawdown,
    scoreDelta:
      run.score !== undefined && previous.score !== undefined
        ? run.score - previous.score
        : undefined,
  };
}

export function exportRunHistory(runs: CompletedRun[]): string {
  return JSON.stringify(
    {
      format: "market-time-machine-run-history",
      version: 1,
      exportedAt: new Date().toISOString(),
      runs,
    },
    null,
    2,
  );
}
