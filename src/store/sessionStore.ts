import { create } from "zustand";
import type {
  AuditEvent,
  BrokerConfig,
  CorporateAction,
  DecisionPlan,
  Fill,
  JournalEntry,
  MarginSnapshot,
  Order,
  OrderSide,
  PortfolioSnapshot,
  RiskSnapshot,
  ReplaySnapshot,
  ReplayStatus,
  ReplaySpeed,
  ScenarioMode,
  ScenarioPackage,
} from "../types";
import {
  getBrokerPreset,
  type BrokerPresetName,
} from "../domain/broker/executionModels";
import { defaultScenarioId, getScenario } from "../data/scenarios";
import {
  candlesForSymbol,
  lastVisibleCandleIndex,
  REPLAY_SPEEDS,
  replayTimeline,
  timeAtIndex,
  tradablePricesFor,
  visibleBenchmark,
  visibleCandles,
  visibleEvents,
  visibleIndicators,
} from "../domain/replay/engine";
import {
  applyCorporateAction,
  applyFinancingCost,
  applyFill,
  emptyPortfolio,
  markToMarket,
  snapshotPortfolio,
  type PortfolioState,
} from "../domain/portfolio/portfolio";
import { validateBroker } from "../domain/validation/scenario";
import {
  commissionFor,
  createLimitOrder,
  createPendingOrder,
  executePendingOrderFill,
  executeMarketOrder,
  isPendingOrderTriggered,
  priceWithSpreadAndSlippage,
  type LimitOrderRequest,
  type OrderRequest,
  type PendingOrderRequest,
} from "../domain/broker/simulator";
import {
  borrowCostFor,
  marginPolicyFromBroker,
  marginSnapshot,
  positionsGrossNotional,
} from "../domain/broker/margin";
import { buildReport } from "../domain/report/report";
import type { ReportPayload } from "../types/reporting";

const DEFAULT_SPEED = REPLAY_SPEEDS[1];
const SESSION_STORAGE_KEY = "market-time-machine.session.v1";
const SESSION_STORAGE_VERSION = 1;
export type BrokerMode = "scenario" | BrokerPresetName;

export type MajorEventPauseNotice = {
  eventId: string;
  title: string;
  publishedAt: string;
};

export type BracketOrderRequest = {
  symbol: string;
  side: OrderSide;
  quantity: number;
  stopPrice: number;
  targetPrice: number;
  timeInForce?: Order["timeInForce"];
  note?: string;
  decisionPlan?: DecisionPlan;
};

type FinancingCostEvent = { time: string; amount: number };

export type SessionState = {
  scenario: ScenarioPackage;
  mode: ScenarioMode;
  broker: BrokerConfig;
  brokerMode: BrokerMode;
  status: ReplayStatus;
  currentIndex: number;
  speed: ReplaySpeed;
  portfolio: PortfolioState;
  fills: Fill[];
  orders: Order[];
  journal: JournalEntry[];
  auditEvents: AuditEvent[];
  margin?: MarginSnapshot;
  risk?: RiskSnapshot;
  rejectionMessage?: string;
  report?: ReportPayload;
  primarySymbol: string;
  primaryCandlesLength: number;
  appliedCorporateActions: string[];
  marginCallActive: boolean;
  liquidityConsumed: Record<string, number>;
  financingCosts: FinancingCostEvent[];
  pauseOnMajorEvents: boolean;
  majorEventPauseNotice?: MajorEventPauseNotice;
};

type SessionActions = {
  selectScenario: (id: string) => void;
  resetScenario: () => void;
  play: () => void;
  pause: () => void;
  stepForward: () => void;
  setSpeed: (label: ReplaySpeed["label"]) => void;
  setPauseOnMajorEvents: (enabled: boolean) => void;
  setScenarioMode: (mode: ScenarioMode) => void;
  setBrokerMode: (mode: BrokerMode) => void;
  finish: () => void;
  submitMarketOrder: (req: OrderRequest) => { ok: boolean; message?: string };
  submitLimitOrder: (req: LimitOrderRequest) => { ok: boolean; message?: string };
  submitPendingOrder: (req: PendingOrderRequest) => { ok: boolean; message?: string };
  submitBracketOrder: (req: BracketOrderRequest) => { ok: boolean; message?: string };
  cancelOrder: (orderId: string) => { ok: boolean; message?: string };
  updateLimitOrder: (
    orderId: string,
    updates: Pick<LimitOrderRequest, "quantity" | "limitPrice">,
  ) => { ok: boolean; message?: string };
  updatePendingOrder: (
    orderId: string,
    updates: { quantity: number; price: number },
  ) => { ok: boolean; message?: string };
  addJournalNote: (note: string) => void;
  exportSession: () => string;
  importSession: (serialized: string) => { ok: boolean; message?: string };
  clearSavedSession: () => void;
  getSnapshot: () => ReplaySnapshot;
  clearRejection: () => void;
};

export type SessionStore = SessionState & SessionActions;

function buildInitialState(scenarioId: string): SessionState {
  const scenario = getScenario(scenarioId);
  if (!scenario) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }
  const primarySymbol = scenario.meta.symbols[0];
  const timeline = replayTimeline(scenario);
  const mode = scenario.meta.supportedModes[0] ?? "explorer";
  return {
    scenario,
    mode,
    broker: { ...scenario.broker },
    brokerMode: "scenario",
    status: "idle",
    currentIndex: 0,
    speed: { ...DEFAULT_SPEED },
    portfolio: emptyPortfolio(scenario.meta.initialCash),
    fills: [],
    orders: [],
    journal: [],
    auditEvents: [],
    margin: undefined,
    risk: undefined,
    primarySymbol,
    // Kept for selector compatibility; replay progress now spans all symbols.
    primaryCandlesLength: timeline.length,
    appliedCorporateActions: [],
    marginCallActive: false,
    liquidityConsumed: {},
    financingCosts: [],
    pauseOnMajorEvents: mode === "explorer",
    majorEventPauseNotice: undefined,
  };
}

type PersistedSession = {
  version: number;
  scenarioId: string;
  mode: ScenarioMode;
  broker: BrokerConfig;
  brokerMode: BrokerMode;
  status: ReplayStatus;
  currentIndex: number;
  speed: ReplaySpeed;
  portfolio: PortfolioState;
  fills: Fill[];
  orders: Order[];
  journal: JournalEntry[];
  auditEvents: AuditEvent[];
  report?: ReportPayload;
  appliedCorporateActions: string[];
  marginCallActive: boolean;
  liquidityConsumed: Record<string, number>;
  financingCosts: FinancingCostEvent[];
  pauseOnMajorEvents?: boolean;
};

function persistedSessionFor(state: SessionState): PersistedSession {
  return {
    version: SESSION_STORAGE_VERSION,
    scenarioId: state.scenario.meta.id,
    mode: state.mode,
    broker: state.broker,
    brokerMode: state.brokerMode,
    status: state.status === "playing" ? "paused" : state.status,
    currentIndex: state.currentIndex,
    speed: state.speed,
    portfolio: state.portfolio,
    fills: state.fills,
    orders: state.orders,
    journal: state.journal,
    auditEvents: state.auditEvents,
    report: state.report,
    appliedCorporateActions: state.appliedCorporateActions,
    marginCallActive: state.marginCallActive,
    liquidityConsumed: state.liquidityConsumed,
    financingCosts: state.financingCosts,
    pauseOnMajorEvents: state.pauseOnMajorEvents,
  };
}

function serializeSession(state: SessionState, pretty = false): string {
  return JSON.stringify(persistedSessionFor(state), null, pretty ? 2 : 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isValidDecisionPlan(value: unknown): value is DecisionPlan | undefined {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  if (
    !isOptionalString(value.thesis) ||
    !isOptionalString(value.invalidation) ||
    !isOptionalString(value.exitPlan) ||
    !isOptionalString(value.acceptedRisk)
  ) {
    return false;
  }
  if (value.linkedEventIds === undefined) return true;
  return (
    Array.isArray(value.linkedEventIds) &&
    value.linkedEventIds.every(isNonEmptyString) &&
    new Set(value.linkedEventIds).size === value.linkedEventIds.length
  );
}

function isValidBroker(value: unknown): value is BrokerConfig {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.baseCurrency) ||
    !isFiniteNumber(value.commissionRateBps) ||
    !isFiniteNumber(value.fixedFee) ||
    !isFiniteNumber(value.spreadBps) ||
    !isFiniteNumber(value.maxLeverage) ||
    typeof value.allowFractional !== "boolean" ||
    typeof value.allowShort !== "boolean" ||
    !["none", "fixed_bps", "volume_based", "volatility_based"].includes(
      String(value.slippageModel),
    )
  ) {
    return false;
  }
  if (
    value.slippageBps !== undefined &&
    !isFiniteNumber(value.slippageBps)
  ) {
    return false;
  }
  if (
    value.maxParticipationRate !== undefined &&
    !isFiniteNumber(value.maxParticipationRate)
  ) {
    return false;
  }
  if (value.borrowRateBps !== undefined && !isFiniteNumber(value.borrowRateBps)) {
    return false;
  }
  if (
    value.partialFillPolicy !== undefined &&
    !["disabled", "volume_limited"].includes(String(value.partialFillPolicy))
  ) {
    return false;
  }
  if (
    value.stopFillPolicy !== undefined &&
    !["trigger_price", "gap_open"].includes(String(value.stopFillPolicy))
  ) {
    return false;
  }
  if (
    value.marginCallPolicy !== undefined &&
    !["disabled", "liquidate_on_threshold", "reject_new_orders"].includes(
      String(value.marginCallPolicy),
    )
  ) {
    return false;
  }
  if (
    value.marketHoursEnforced !== undefined &&
    typeof value.marketHoursEnforced !== "boolean"
  ) {
    return false;
  }
  return validateBroker(value as unknown as BrokerConfig).every(
    (issue) => issue.level !== "error",
  );
}

const ORDER_SIDES = new Set(["buy", "sell"]);
const ORDER_TYPES = new Set(["market", "limit", "stop_loss", "take_profit"]);
const ORDER_STATUSES = new Set([
  "pending",
  "filled",
  "partially_filled",
  "cancelled",
  "rejected",
  "expired",
]);
const FILL_REASONS = new Set([
  "user_order",
  "working_order",
  "forced_liquidation",
  "borrow_cost",
]);
const PRICE_SOURCES = new Set([
  "market",
  "limit",
  "stop_trigger",
  "gap_open",
  "forced_liquidation",
  "financing",
]);
const AUDIT_TYPES = new Set([
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

function isOptionalPositiveNumber(value: unknown): boolean {
  return value === undefined || (isFiniteNumber(value) && value > 0);
}

function isOptionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined || (isFiniteNumber(value) && value >= 0);
}

function isValidOrder(value: unknown, symbols: Set<string>): value is Order {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.id) ||
    !isTimestamp(value.createdAt) ||
    !isNonEmptyString(value.symbol) ||
    !symbols.has(value.symbol) ||
    !ORDER_SIDES.has(String(value.side)) ||
    !ORDER_TYPES.has(String(value.type)) ||
    !ORDER_STATUSES.has(String(value.status)) ||
    !isFiniteNumber(value.quantity) ||
    value.quantity <= 0
  ) {
    return false;
  }
  if (
    !isOptionalPositiveNumber(value.limitPrice) ||
    !isOptionalPositiveNumber(value.triggerPrice) ||
    !isOptionalPositiveNumber(value.averageFillPrice) ||
    !isOptionalNonNegativeNumber(value.remainingQuantity) ||
    !isOptionalNonNegativeNumber(value.filledQuantity)
  ) {
    return false;
  }
  if (
    (value.timeInForce !== undefined &&
      value.timeInForce !== "day" &&
      value.timeInForce !== "gtc") ||
    (value.expiresAt !== undefined && !isTimestamp(value.expiresAt)) ||
    (value.triggeredAt !== undefined && !isTimestamp(value.triggeredAt)) ||
    (value.closedAt !== undefined && !isTimestamp(value.closedAt)) ||
    !isOptionalString(value.ocoGroupId) ||
    !isOptionalString(value.rejectionCode) ||
    !isOptionalString(value.rejectionReason) ||
    !isOptionalString(value.note) ||
    !isValidDecisionPlan(value.decisionPlan)
  ) {
    return false;
  }
  const remaining = isFiniteNumber(value.remainingQuantity)
    ? value.remainingQuantity
    : undefined;
  const filled = isFiniteNumber(value.filledQuantity)
    ? value.filledQuantity
    : undefined;
  return (
    (remaining === undefined || remaining <= value.quantity + 1e-9) &&
    (filled === undefined || filled <= value.quantity + 1e-9) &&
    (remaining === undefined ||
      filled === undefined ||
      remaining + filled <= value.quantity + 1e-7)
  );
}

function isValidFill(value: unknown, symbols: Set<string>): value is Fill {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.orderId) ||
    !isTimestamp(value.time) ||
    !isNonEmptyString(value.symbol) ||
    !symbols.has(value.symbol) ||
    !ORDER_SIDES.has(String(value.side)) ||
    !isFiniteNumber(value.quantity) ||
    value.quantity <= 0 ||
    !isFiniteNumber(value.price) ||
    value.price <= 0 ||
    !isFiniteNumber(value.referencePrice) ||
    value.referencePrice <= 0 ||
    !isFiniteNumber(value.commission) ||
    value.commission < 0 ||
    !isFiniteNumber(value.spreadCost) ||
    value.spreadCost < 0 ||
    !isFiniteNumber(value.slippage) ||
    !isFiniteNumber(value.totalCost) ||
    value.totalCost < 0
  ) {
    return false;
  }
  if (
    (value.reason !== undefined && !FILL_REASONS.has(String(value.reason))) ||
    (value.executionPriceSource !== undefined &&
      !PRICE_SOURCES.has(String(value.executionPriceSource))) ||
    (value.liquidityParticipation !== undefined &&
      (!isFiniteNumber(value.liquidityParticipation) ||
        value.liquidityParticipation < 0)) ||
    (value.forcedLiquidation !== undefined &&
      typeof value.forcedLiquidation !== "boolean") ||
    !isOptionalString(value.note) ||
    !isValidDecisionPlan(value.decisionPlan)
  ) {
    return false;
  }
  return true;
}

function isValidJournalEntry(
  value: unknown,
  symbols: Set<string>,
): value is JournalEntry {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isTimestamp(value.time) &&
    typeof value.note === "string" &&
    isOptionalString(value.fillId) &&
    isValidDecisionPlan(value.decisionPlan) &&
    (value.symbol === undefined ||
      (isNonEmptyString(value.symbol) && symbols.has(value.symbol)))
  );
}

function isValidAuditEvent(
  value: unknown,
  symbols: Set<string>,
): value is AuditEvent {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isTimestamp(value.time) &&
    AUDIT_TYPES.has(String(value.type)) &&
    typeof value.message === "string" &&
    isOptionalString(value.orderId) &&
    isOptionalString(value.fillId) &&
    (value.symbol === undefined ||
      (isNonEmptyString(value.symbol) && symbols.has(value.symbol)))
  );
}

function hasUniqueIds(records: Array<{ id: string }>): boolean {
  return new Set(records.map((record) => record.id)).size === records.length;
}

function isAtOrBefore(value: string, upperBound: string): boolean {
  return Date.parse(value) <= Date.parse(upperBound);
}

function rebuildPortfolioFromHistory(
  scenario: ScenarioPackage,
  fills: Fill[],
  financingCosts: FinancingCostEvent[],
  currentTime: string,
): { portfolio: PortfolioState; appliedCorporateActions: string[] } {
  type HistoryEvent =
    | { kind: "financing"; time: string; priority: 0; amount: number }
    | { kind: "action"; time: string; priority: 1; action: CorporateAction }
    | { kind: "fill"; time: string; priority: 2; fill: Fill };
  const firstReplayTime = scenario.candles.reduce<string | undefined>(
    (earliest, candle) =>
      !earliest || Date.parse(candle.closeTime) < Date.parse(earliest)
        ? candle.closeTime
        : earliest,
    undefined,
  );
  const events: HistoryEvent[] = [
    ...financingCosts.map((event) => ({
      kind: "financing" as const,
      time: event.time,
      priority: 0 as const,
      amount: event.amount,
    })),
    ...(scenario.corporateActions ?? [])
      .filter(
        (action) =>
          (!firstReplayTime || Date.parse(action.effectiveAt) > Date.parse(firstReplayTime)) &&
          isAtOrBefore(action.effectiveAt, currentTime),
      )
      .map((action) => ({
        kind: "action" as const,
        time: action.effectiveAt,
        priority: 1 as const,
        action,
      })),
    ...fills.map((fill) => ({
      kind: "fill" as const,
      time: fill.time,
      priority: 2 as const,
      fill,
    })),
  ].sort(
    (a, b) =>
      Date.parse(a.time) - Date.parse(b.time) || a.priority - b.priority,
  );

  let portfolio = emptyPortfolio(scenario.meta.initialCash);
  const appliedCorporateActions: string[] = [];
  for (const event of events) {
    if (event.kind === "financing") {
      portfolio = applyFinancingCost(portfolio, event.amount);
    } else if (event.kind === "action") {
      const shouldApply =
        (event.action.type === "split" &&
          scenario.meta.priceAdjustment === "raw") ||
        (event.action.type === "dividend" &&
          scenario.meta.priceAdjustment !== "total_return");
      if (shouldApply) {
        portfolio = applyCorporateAction(portfolio, event.action);
      }
      appliedCorporateActions.push(corporateActionKey(event.action));
    } else {
      portfolio = applyFill(portfolio, event.fill);
    }
  }
  portfolio = markToMarket(
    portfolio,
    tradablePricesFor(scenario, currentTime, scenario.broker),
  );
  return { portfolio, appliedCorporateActions };
}

function parsePersistedSession(serialized: string): SessionState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Session file is not valid JSON.");
  }
  if (!isRecord(parsed) || parsed.version !== SESSION_STORAGE_VERSION) {
    throw new Error("Unsupported session file version.");
  }
  if (typeof parsed.scenarioId !== "string") {
    throw new Error("Session file is missing a scenario ID.");
  }
  const base = buildInitialState(parsed.scenarioId);
  const symbols = new Set(base.scenario.meta.symbols);
  if (
    !Array.isArray(parsed.fills) ||
    !Array.isArray(parsed.orders) ||
    !Array.isArray(parsed.journal) ||
    !Array.isArray(parsed.auditEvents) ||
    !Array.isArray(parsed.financingCosts) ||
    !isValidBroker(parsed.broker)
  ) {
    throw new Error("Session file contains invalid trading state.");
  }
  if (
    parsed.pauseOnMajorEvents !== undefined &&
    typeof parsed.pauseOnMajorEvents !== "boolean"
  ) {
    throw new Error("Session file contains an invalid replay preference.");
  }
  if (
    !Number.isInteger(parsed.currentIndex) ||
    Number(parsed.currentIndex) < 0 ||
    Number(parsed.currentIndex) >= Math.max(1, base.primaryCandlesLength)
  ) {
    throw new Error("Session file contains an invalid replay position.");
  }
  const currentIndex = Number(parsed.currentIndex);
  if (
    typeof parsed.mode !== "string" ||
    !base.scenario.meta.supportedModes.includes(parsed.mode as ScenarioMode)
  ) {
    throw new Error("Session file contains an unsupported scenario mode.");
  }
  const mode = parsed.mode as ScenarioMode;
  const brokerMode: BrokerMode | undefined =
    parsed.brokerMode === "scenario" ||
    parsed.brokerMode === "ideal" ||
    parsed.brokerMode === "realistic" ||
    parsed.brokerMode === "harsh"
      ? parsed.brokerMode
      : undefined;
  if (!brokerMode) {
    throw new Error("Session file contains an unsupported broker mode.");
  }
  const status: ReplayStatus | undefined =
    parsed.status === "idle" ||
    parsed.status === "paused" ||
    parsed.status === "finished"
      ? parsed.status
      : undefined;
  if (!status) {
    throw new Error("Session file contains an invalid replay status.");
  }
  const speed = REPLAY_SPEEDS.find(
    (candidate) =>
      isRecord(parsed.speed) && candidate.label === parsed.speed.label,
  );
  if (!speed) {
    throw new Error("Session file contains an unsupported replay speed.");
  }
  const orders = parsed.orders.filter((value): value is Order =>
    isValidOrder(value, symbols),
  );
  const fills = parsed.fills.filter((value): value is Fill =>
    isValidFill(value, symbols),
  );
  const journal = parsed.journal.filter((value): value is JournalEntry =>
    isValidJournalEntry(value, symbols),
  );
  const auditEvents = parsed.auditEvents.filter((value): value is AuditEvent =>
    isValidAuditEvent(value, symbols),
  );
  const financingCosts = parsed.financingCosts.filter(
    (event): event is FinancingCostEvent =>
      isRecord(event) &&
      isTimestamp(event.time) &&
      isFiniteNumber(event.amount) &&
      event.amount >= 0,
  );
  if (
    orders.length !== parsed.orders.length ||
    fills.length !== parsed.fills.length ||
    journal.length !== parsed.journal.length ||
    auditEvents.length !== parsed.auditEvents.length ||
    financingCosts.length !== parsed.financingCosts.length ||
    !hasUniqueIds(orders) ||
    !hasUniqueIds(fills) ||
    !hasUniqueIds(journal) ||
    !hasUniqueIds(auditEvents)
  ) {
    throw new Error("Session file contains malformed history records.");
  }
  const currentTime = currentTimeFor({
    scenario: base.scenario,
    currentIndex,
  });
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const fillIds = new Set(fills.map((fill) => fill.id));
  const timelineIsValid =
    orders.every(
      (order) =>
        isAtOrBefore(order.createdAt, currentTime) &&
        (!order.triggeredAt || isAtOrBefore(order.triggeredAt, currentTime)) &&
        (!order.closedAt || isAtOrBefore(order.closedAt, currentTime)),
    ) &&
    fills.every((fill) => {
      const order = orderById.get(fill.orderId);
      return Boolean(
        order &&
          order.symbol === fill.symbol &&
          order.side === fill.side &&
          isAtOrBefore(fill.time, currentTime),
      );
    }) &&
    journal.every(
      (entry) =>
        isAtOrBefore(entry.time, currentTime) &&
        (!entry.fillId || fillIds.has(entry.fillId)),
    ) &&
    auditEvents.every(
      (event) =>
        isAtOrBefore(event.time, currentTime) &&
        (!event.orderId || orderById.has(event.orderId)) &&
        (!event.fillId || fillIds.has(event.fillId)),
    ) &&
    financingCosts.every((event) => isAtOrBefore(event.time, currentTime));
  if (!timelineIsValid) {
    throw new Error("Session history is inconsistent with its replay position.");
  }
  if (status === "finished" && orders.some(isWorkingOrder)) {
    throw new Error("A finished session cannot contain working orders.");
  }
  const broker =
    mode === "professional" || mode === "blind" || mode === "challenge"
      ? { ...base.scenario.broker }
      : brokerMode === "scenario"
        ? { ...base.scenario.broker }
        : {
            ...getBrokerPreset(brokerMode),
            baseCurrency: base.scenario.meta.baseCurrency,
          };
  const rebuilt = rebuildPortfolioFromHistory(
    base.scenario,
    fills,
    financingCosts,
    currentTime,
  );
  const liquidityConsumed = fills.reduce<Record<string, number>>(
    (totals, fill) => {
      const key = `${fill.time}:${fill.symbol}`;
      totals[key] = (totals[key] ?? 0) + fill.quantity * fill.referencePrice;
      return totals;
    },
    {},
  );
  const next: SessionState = {
    ...base,
    mode,
    broker,
    brokerMode,
    status,
    currentIndex,
    speed: { ...speed },
    portfolio: rebuilt.portfolio,
    fills,
    orders,
    journal,
    auditEvents,
    report: undefined,
    appliedCorporateActions: rebuilt.appliedCorporateActions,
    marginCallActive: false,
    liquidityConsumed,
    financingCosts,
    pauseOnMajorEvents:
      mode === "explorer" ? (parsed.pauseOnMajorEvents ?? true) : false,
    majorEventPauseNotice: undefined,
  };
  const prices = tradablePricesFor(
    next.scenario,
    currentTime,
    next.broker,
  );
  next.portfolio = markToMarket(next.portfolio, prices);
  const snapshots = marginAndRiskFor(next.portfolio, next.broker);
  next.margin = snapshots.margin;
  next.risk = snapshots.risk;
  next.marginCallActive = snapshots.margin.isMarginCall;
  if (status === "finished") {
    next.report = buildReport({
      scenario: next.scenario,
      fills: next.fills,
      orders: next.orders,
      auditEvents: next.auditEvents,
      initialCash: next.scenario.meta.initialCash,
      finalEquityOverride: snapshotPortfolio(next.portfolio, currentTime).totalValue,
      financingPaid: next.portfolio.financingPaid,
      financingCosts: next.financingCosts,
      journal: next.journal,
    });
  }
  return next;
}

function savedSession(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function initialState(): SessionState {
  const saved = savedSession();
  if (!saved) return buildInitialState(defaultScenarioId);
  try {
    return parsePersistedSession(saved);
  } catch {
    return buildInitialState(defaultScenarioId);
  }
}

function saveSession(state: SessionState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, serializeSession(state));
  } catch {
    // Persistence is best-effort; quota/privacy errors must not break replay.
  }
}

function currentTimeFor(
  state: Pick<SessionState, "scenario" | "currentIndex">,
): string {
  return timeAtIndex(
    replayTimeline(state.scenario),
    state.currentIndex,
    state.scenario.meta.startTime,
  );
}

function majorEventPauseFor(
  state: SessionState,
  requestedIndex: number,
): { index: number; notice: MajorEventPauseNotice } | undefined {
  if (
    state.status !== "playing" ||
    state.mode !== "explorer" ||
    !state.pauseOnMajorEvents
  ) {
    return undefined;
  }
  const timeline = replayTimeline(state.scenario);
  const currentTime = timeAtIndex(
    timeline,
    state.currentIndex,
    state.scenario.meta.startTime,
  );
  const requestedTime = timeAtIndex(
    timeline,
    requestedIndex,
    state.scenario.meta.endTime,
  );
  const currentTimestamp = Date.parse(currentTime);
  const requestedTimestamp = Date.parse(requestedTime);
  const event = [...state.scenario.events]
    .filter((candidate) => {
      const publishedTimestamp = Date.parse(candidate.publishedAt);
      return (
        candidate.importance >= 4 &&
        Number.isFinite(publishedTimestamp) &&
        publishedTimestamp > currentTimestamp &&
        publishedTimestamp <= requestedTimestamp
      );
    })
    .sort(
      (left, right) =>
        Date.parse(left.publishedAt) - Date.parse(right.publishedAt),
    )[0];
  if (!event) return undefined;

  const eventTimestamp = Date.parse(event.publishedAt);
  const eventIndex = timeline.findIndex(
    (time, index) =>
      index > state.currentIndex && Date.parse(time) >= eventTimestamp,
  );
  return {
    index:
      eventIndex >= 0 ? Math.min(requestedIndex, eventIndex) : requestedIndex,
    notice: {
      eventId: event.id,
      title: event.title,
      publishedAt: event.publishedAt,
    },
  };
}

function buildMarginSnapshot(
  portfolio: PortfolioState,
  broker: BrokerConfig,
): MarginSnapshot {
  const positions = Object.values(portfolio.positions);
  const gross = positionsGrossNotional(positions);
  const net = positions.reduce((sum, position) => sum + position.marketValue, 0);
  return marginSnapshot({
    cash: portfolio.cash,
    positionsGrossNotional: gross,
    positionsNetValue: net,
    policy: marginPolicyFromBroker(broker),
  });
}

function buildRiskSnapshot(
  broker: BrokerConfig,
  margin: MarginSnapshot,
): RiskSnapshot {
  const leverage = Math.max(1, broker.maxLeverage || 1);
  const equity = Math.max(0, margin.equity);
  return {
    buyingPower: Math.max(
      0,
      equity * leverage - margin.positionsGrossNotional,
    ),
    leverage:
      equity > 0 ? margin.positionsGrossNotional / equity : Number.POSITIVE_INFINITY,
    exposurePct:
      equity > 0 ? Math.min(10, margin.positionsGrossNotional / equity) : 0,
    liquidationWarning: margin.isMarginCall || margin.requiresLiquidation,
  };
}

function marginAndRiskFor(
  portfolio: PortfolioState,
  broker: BrokerConfig,
): { margin: MarginSnapshot; risk: RiskSnapshot } {
  const margin = buildMarginSnapshot(portfolio, broker);
  return {
    margin,
    risk: buildRiskSnapshot(broker, margin),
  };
}

function buildSnapshot(state: SessionState): ReplaySnapshot {
  const currentTime = currentTimeFor(state);
  const symbolCandles = candlesForSymbol(state.scenario, state.primarySymbol);
  const tradablePrices = tradablePricesFor(
    state.scenario,
    currentTime,
    state.broker,
  );
  const portfolioMarked = markToMarket(state.portfolio, tradablePrices);
  const portfolioSnap: PortfolioSnapshot = snapshotPortfolio(
    portfolioMarked,
    currentTime,
  );
  const { margin, risk } = marginAndRiskFor(portfolioMarked, state.broker);
  return {
    scenarioId: state.scenario.meta.id,
    currentTime,
    currentIndex: state.currentIndex,
    visibleCandles: visibleCandles(symbolCandles, currentTime),
    visibleEvents: visibleEvents(state.scenario.events, currentTime),
    visibleIndicators: visibleIndicators(
      state.scenario.indicators,
      currentTime,
    ),
    visibleBenchmark: visibleBenchmark(state.scenario.benchmarks, currentTime),
    tradablePrices,
    portfolio: portfolioSnap,
    margin,
    risk,
    auditEvents: state.auditEvents.filter(
      (event) => Date.parse(event.time) <= Date.parse(currentTime),
    ),
    workingOrders: state.orders.filter(
      (order) =>
        order.status === "pending" || order.status === "partially_filled",
    ),
    replayStatus: state.status,
  };
}

function compactDecisionPlan(
  plan: DecisionPlan | undefined,
): DecisionPlan | undefined {
  if (!plan) return undefined;
  const compacted: DecisionPlan = {
    thesis: plan.thesis?.trim() || undefined,
    invalidation: plan.invalidation?.trim() || undefined,
    exitPlan: plan.exitPlan?.trim() || undefined,
    acceptedRisk: plan.acceptedRisk?.trim() || undefined,
    linkedEventIds:
      plan.linkedEventIds && plan.linkedEventIds.length > 0
        ? [...new Set(plan.linkedEventIds)]
        : undefined,
  };
  return Object.values(compacted).some((value) => value !== undefined)
    ? compacted
    : undefined;
}

function journalEntryForFill(
  fill: Fill,
  note?: string,
  decisionPlan?: DecisionPlan,
): JournalEntry | undefined {
  const plan = compactDecisionPlan(decisionPlan ?? fill.decisionPlan);
  const trimmed = note?.trim() || plan?.thesis;
  if (!trimmed && !plan) return undefined;
  return {
    id: `jrn_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`,
    time: fill.time,
    fillId: fill.id,
    note: trimmed ?? "Structured decision plan recorded.",
    symbol: fill.symbol,
    decisionPlan: plan,
  };
}

function generateOcoGroupId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `oco_${Date.now().toString(36)}_${random}`;
}

function generateSystemId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function auditEvent(
  events: AuditEvent[],
  event: Omit<AuditEvent, "id">,
): AuditEvent {
  return {
    id: `aud_${events.length + 1}`,
    ...event,
  };
}

function updateOcoSiblingsAfterFill(
  orders: Order[],
  filledOrder: Order,
  fillQuantity: number,
  currentTime: string,
): Order[] {
  if (!filledOrder.ocoGroupId) return orders;
  return orders.map((order) => {
    if (
      order.id === filledOrder.id ||
      !isWorkingOrder(order) ||
      order.ocoGroupId !== filledOrder.ocoGroupId
    ) {
      return order;
    }
    if (filledOrder.status === "filled") {
      return { ...order, status: "cancelled", closedAt: currentTime };
    }
    const previousRemaining = order.remainingQuantity ?? order.quantity;
    const remainingQuantity = Math.max(0, previousRemaining - fillQuantity);
    if (remainingQuantity <= 1e-9) {
      return {
        ...order,
        quantity: order.filledQuantity ?? 0,
        remainingQuantity: 0,
        status: "cancelled",
        closedAt: currentTime,
      };
    }
    return {
      ...order,
      quantity: (order.filledQuantity ?? 0) + remainingQuantity,
      remainingQuantity,
    };
  });
}

function isWorkingOrder(order: Order): boolean {
  return order.status === "pending" || order.status === "partially_filled";
}

type ZonedTimeParts = {
  dateKey: string;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  minutes: number;
};

const WEEKDAY_INDEX: Record<string, ZonedTimeParts["dayOfWeek"]> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function zonedTimeParts(time: string, timezone: string): ZonedTimeParts | undefined {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const year = value("year");
    const month = value("month");
    const day = value("day");
    const weekday = value("weekday");
    const hour = Number(value("hour"));
    const minute = Number(value("minute"));
    if (
      !year ||
      !month ||
      !day ||
      !weekday ||
      WEEKDAY_INDEX[weekday] === undefined ||
      !Number.isFinite(hour) ||
      !Number.isFinite(minute)
    ) {
      return undefined;
    }
    return {
      dateKey: `${year}-${month}-${day}`,
      dayOfWeek: WEEKDAY_INDEX[weekday],
      minutes: hour * 60 + minute,
    };
  } catch {
    return undefined;
  }
}

function marketTimezone(scenario: ScenarioPackage): string {
  return scenario.marketCalendar?.timezone ?? "UTC";
}

function isSameMarketDate(
  scenario: ScenarioPackage,
  a: string,
  b: string,
): boolean {
  const timezone = marketTimezone(scenario);
  const first = zonedTimeParts(a, timezone);
  const second = zonedTimeParts(b, timezone);
  return Boolean(first && second && first.dateKey === second.dateKey);
}

function isOrderExpired(
  order: Order,
  currentTime: string,
  scenario: ScenarioPackage,
): boolean {
  if (!isWorkingOrder(order)) return false;
  if (
    order.expiresAt &&
    Date.parse(order.expiresAt) <= Date.parse(currentTime)
  ) {
    return true;
  }
  return (
    order.timeInForce === "day" &&
    !isSameMarketDate(scenario, order.createdAt, currentTime)
  );
}

function isMarketOpen(
  scenario: ScenarioPackage,
  broker: BrokerConfig,
  time: string,
): boolean {
  if (!broker.marketHoursEnforced || !scenario.marketCalendar) return true;
  const local = zonedTimeParts(time, scenario.marketCalendar.timezone);
  if (!local) return false;
  if (scenario.marketCalendar.holidays?.includes(local.dateKey)) return false;
  return scenario.marketCalendar.sessions.some((session) => {
    const [openHour, openMinute] = session.open.split(":").map(Number);
    const [closeHour, closeMinute] = session.close.split(":").map(Number);
    const open = openHour * 60 + openMinute;
    const close = closeHour * 60 + closeMinute;
    if (!Number.isFinite(open) || !Number.isFinite(close)) return false;
    if (open <= close) {
      return (
        session.dayOfWeek === local.dayOfWeek &&
        local.minutes >= open &&
        local.minutes <= close
      );
    }
    const previousDay = ((local.dayOfWeek + 6) % 7) as ZonedTimeParts["dayOfWeek"];
    return (
      (session.dayOfWeek === local.dayOfWeek && local.minutes >= open) ||
      (session.dayOfWeek === previousDay && local.minutes <= close)
    );
  });
}

function daysBetween(previousTime: string, currentTime: string): number {
  const start = Date.parse(previousTime);
  const end = Date.parse(currentTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return (end - start) / 86_400_000;
}

function applyBorrowCosts(
  portfolio: PortfolioState,
  broker: BrokerConfig,
  previousTime: string,
  currentTime: string,
  auditEvents: AuditEvent[],
): { portfolio: PortfolioState; auditEvents: AuditEvent[]; cost?: number } {
  const days = daysBetween(previousTime, currentTime);
  if (days <= 0) return { portfolio, auditEvents };
  const policy = marginPolicyFromBroker(broker);
  let cost = 0;
  for (const position of Object.values(portfolio.positions)) {
    if (position.quantity < 0) {
      cost += borrowCostFor(Math.abs(position.marketValue), days, policy);
    }
  }
  if (cost <= 0) return { portfolio, auditEvents };
  const nextPortfolio = applyFinancingCost(portfolio, cost);
  return {
    portfolio: nextPortfolio,
    cost,
    auditEvents: [
      ...auditEvents,
      auditEvent(auditEvents, {
        time: currentTime,
        type: "borrow_cost",
        message: `Borrow cost charged: ${cost.toFixed(2)}`,
      }),
    ],
  };
}

function corporateActionKey(action: CorporateAction): string {
  return [
    action.symbol,
    action.type,
    action.effectiveAt,
    action.ratio ?? "",
    action.amount ?? "",
  ].join(":");
}

function applyCorporateActionsThrough(
  portfolio: PortfolioState,
  orders: Order[],
  scenario: ScenarioPackage,
  previousTime: string,
  currentTime: string,
  appliedKeys: string[],
  auditEvents: AuditEvent[],
): {
  portfolio: PortfolioState;
  orders: Order[];
  appliedCorporateActions: string[];
  auditEvents: AuditEvent[];
} {
  const previousEpoch = Date.parse(previousTime);
  const currentEpoch = Date.parse(currentTime);
  const applied = new Set(appliedKeys);
  let nextPortfolio = portfolio;
  let nextOrders = orders;
  let nextAudit = auditEvents;
  const actions = [...(scenario.corporateActions ?? [])].sort(
    (a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt),
  );

  for (const action of actions) {
    const key = corporateActionKey(action);
    const actionEpoch = Date.parse(action.effectiveAt);
    if (
      applied.has(key) ||
      !Number.isFinite(actionEpoch) ||
      actionEpoch <= previousEpoch ||
      actionEpoch > currentEpoch
    ) {
      continue;
    }

    if (
      action.type === "split" &&
      scenario.meta.priceAdjustment === "raw" &&
      action.ratio &&
      action.ratio > 0
    ) {
      const ratio = action.ratio;
      const position = nextPortfolio.positions[action.symbol];
      if (position && Math.abs(position.quantity) > 1e-9) {
        nextPortfolio = {
          ...nextPortfolio,
          positions: {
            ...nextPortfolio.positions,
            [action.symbol]: {
              ...position,
              quantity: position.quantity * ratio,
              averagePrice: position.averagePrice / ratio,
              marketPrice: position.marketPrice / ratio,
              marketValue: position.marketValue,
              unrealizedPnl: position.unrealizedPnl,
            },
          },
        };
      }
      nextOrders = nextOrders.map((order) =>
        order.symbol === action.symbol && isWorkingOrder(order)
          ? {
              ...order,
              quantity: order.quantity * ratio,
              remainingQuantity:
                (order.remainingQuantity ?? order.quantity) * ratio,
              filledQuantity: (order.filledQuantity ?? 0) * ratio,
              averageFillPrice:
                order.averageFillPrice === undefined
                  ? undefined
                  : order.averageFillPrice / ratio,
              limitPrice:
                order.limitPrice === undefined
                  ? undefined
                  : order.limitPrice / ratio,
              triggerPrice:
                order.triggerPrice === undefined
                  ? undefined
                  : order.triggerPrice / ratio,
            }
          : order,
      );
    } else if (
      action.type === "dividend" &&
      scenario.meta.priceAdjustment !== "total_return" &&
      action.amount !== undefined
    ) {
      const quantity = nextPortfolio.positions[action.symbol]?.quantity ?? 0;
      const cashFlow = quantity * action.amount;
      if (Math.abs(cashFlow) > 1e-9) {
        nextPortfolio = {
          ...nextPortfolio,
          cash: nextPortfolio.cash + cashFlow,
          realizedPnl: nextPortfolio.realizedPnl + cashFlow,
        };
      }
    }

    applied.add(key);
    nextAudit = [
      ...nextAudit,
      auditEvent(nextAudit, {
        time: action.effectiveAt,
        type: "corporate_action",
        message:
          action.type === "split"
            ? `${action.symbol} split applied (${action.ratio ?? 1}:1).`
            : `${action.symbol} dividend applied (${action.amount ?? 0} ${action.currency ?? scenario.meta.baseCurrency}).`,
        symbol: action.symbol,
      }),
    ];
  }

  return {
    portfolio: nextPortfolio,
    orders: nextOrders,
    appliedCorporateActions: [...applied],
    auditEvents: nextAudit,
  };
}

function applyForcedLiquidationIfNeeded(
  portfolio: PortfolioState,
  orders: Order[],
  fills: Fill[],
  broker: BrokerConfig,
  scenario: ScenarioPackage,
  currentTime: string,
  auditEvents: AuditEvent[],
  marginCallActive: boolean,
): {
  portfolio: PortfolioState;
  orders: Order[];
  fills: Fill[];
  auditEvents: AuditEvent[];
  marginCallActive: boolean;
  rejectionMessage?: string;
} {
  const prices = tradablePricesFor(scenario, currentTime, broker);
  let marked = markToMarket(portfolio, prices);
  const margin = buildMarginSnapshot(marked, broker);
  if (broker.marginCallPolicy === "disabled" || !broker.marginCallPolicy) {
    return {
      portfolio: marked,
      orders,
      fills,
      auditEvents,
      marginCallActive: false,
    };
  }
  if (!margin.requiresLiquidation) {
    if (margin.isMarginCall) {
      return {
        portfolio: marked,
        orders,
        fills,
        auditEvents: marginCallActive
          ? auditEvents
          : [
              ...auditEvents,
              auditEvent(auditEvents, {
                time: currentTime,
                type: "margin_call",
                message: "Maintenance margin breached.",
              }),
            ],
        marginCallActive: true,
      };
    }
    return {
      portfolio: marked,
      orders,
      fills,
      auditEvents,
      marginCallActive: false,
    };
  }
  if (broker.marginCallPolicy !== "liquidate_on_threshold") {
    return {
      portfolio: marked,
      orders,
      fills,
      auditEvents: marginCallActive
        ? auditEvents
        : [
            ...auditEvents,
            auditEvent(auditEvents, {
              time: currentTime,
              type: "margin_call",
              message: "Margin threshold breached; new risk is blocked.",
            }),
          ],
      marginCallActive: true,
    };
  }

  const cancelledWorking = orders.filter(isWorkingOrder);
  let nextOrders = orders.map((order) =>
    isWorkingOrder(order)
      ? { ...order, status: "cancelled" as const, closedAt: currentTime }
      : order,
  );
  let nextFills = [...fills];
  let nextAudit = cancelledWorking.reduce<AuditEvent[]>(
    (events, order) => [
      ...events,
      auditEvent(events, {
        time: currentTime,
        type: "order_cancelled",
        message: `Order cancelled by liquidation: ${order.symbol} ${order.type}.`,
        orderId: order.id,
        symbol: order.symbol,
      }),
    ],
    [...auditEvents],
  );
  nextAudit = [
    ...auditEvents,
    ...nextAudit.slice(auditEvents.length),
    auditEvent(nextAudit, {
      time: currentTime,
      type: "forced_liquidation",
      message: "Liquidation threshold breached; positions were closed.",
    }),
  ];

  for (const position of Object.values(marked.positions)) {
    if (Math.abs(position.quantity) <= 1e-9) continue;
    const tradablePrice = prices.find((price) => price.symbol === position.symbol);
    const referencePrice = tradablePrice?.price ?? position.marketPrice;
    const side: OrderSide = position.quantity > 0 ? "sell" : "buy";
    const quantity = Math.abs(position.quantity);
    const breakdown = priceWithSpreadAndSlippage(referencePrice, side, broker);
    const notional = breakdown.fillPrice * quantity;
    const commission = commissionFor(notional, broker);
    const orderId = generateSystemId("liq_ord");
    const fill: Fill = {
      id: generateSystemId("liq_fil"),
      orderId,
      time: currentTime,
      symbol: position.symbol,
      side,
      quantity,
      price: breakdown.fillPrice,
      referencePrice,
      commission,
      spreadCost: breakdown.spreadCost * quantity,
      slippage: breakdown.slippage,
      totalCost: notional + commission,
      reason: "forced_liquidation",
      executionPriceSource: "forced_liquidation",
      forcedLiquidation: true,
    };
    const order: Order = {
      id: orderId,
      createdAt: currentTime,
      symbol: position.symbol,
      side,
      type: "market",
      quantity,
      timeInForce: "day",
      remainingQuantity: 0,
      filledQuantity: quantity,
      averageFillPrice: fill.price,
      status: "filled",
      closedAt: currentTime,
    };
    nextOrders = [...nextOrders, order];
    nextFills = [...nextFills, fill];
    marked = applyFill(marked, fill);
    nextAudit = [
      ...nextAudit,
      auditEvent(nextAudit, {
        time: currentTime,
        type: "fill",
        message: `Forced liquidation filled ${side} ${quantity} ${position.symbol}.`,
        orderId,
        fillId: fill.id,
        symbol: position.symbol,
      }),
    ];
  }

  return {
    portfolio: markToMarket(marked, prices),
    orders: nextOrders,
    fills: nextFills,
    auditEvents: nextAudit,
    marginCallActive: false,
  };
}

function latestVolatilityFor(
  scenario: ScenarioPackage,
  symbol: string,
  currentTime: string,
): number | undefined {
  const currentEpoch = Date.parse(currentTime);
  const indicator = scenario.indicators
    .filter(
      (candidate) =>
        candidate.symbol === symbol &&
        candidate.name.toLowerCase().includes("volatil") &&
        Date.parse(candidate.availableAt) <= currentEpoch,
    )
    .sort(
      (a, b) => Date.parse(b.availableAt) - Date.parse(a.availableAt),
    )[0];
  if (!indicator) return undefined;
  if (typeof indicator.value === "number") {
    return Number.isFinite(indicator.value) ? Math.max(0, indicator.value) : undefined;
  }
  const firstFinite = Object.values(indicator.value).find(Number.isFinite);
  return typeof firstFinite === "number" ? Math.max(0, firstFinite) : undefined;
}

function reservedGrossNotionalFor(
  orders: Order[],
  portfolio: PortfolioState,
  prices: Map<string, number>,
  excludeOrderId?: string,
): number {
  return orders.reduce((sum, order) => {
    if (!isWorkingOrder(order) || order.id === excludeOrderId) return sum;
    const quantity = order.remainingQuantity ?? order.quantity;
    const price =
      order.limitPrice ??
      order.triggerPrice ??
      prices.get(order.symbol) ??
      portfolio.positions[order.symbol]?.marketPrice;
    if (!price || !Number.isFinite(price) || price <= 0 || quantity <= 0) {
      return sum;
    }
    const held = portfolio.positions[order.symbol]?.quantity ?? 0;
    const delta = order.side === "buy" ? quantity : -quantity;
    const incrementalQuantity = Math.max(0, Math.abs(held + delta) - Math.abs(held));
    return sum + incrementalQuantity * price;
  }, 0);
}

function accountContextFor(
  portfolio: PortfolioState,
  orders: Order[],
  scenario: ScenarioPackage,
  broker: BrokerConfig,
  currentTime: string,
  excludeOrderId?: string,
): {
  accountEquity: number;
  positionsGrossNotional: number;
  reservedGrossNotional: number;
} {
  const tradablePrices = tradablePricesFor(scenario, currentTime, broker);
  const marked = markToMarket(portfolio, tradablePrices);
  const margin = buildMarginSnapshot(marked, broker);
  const priceMap = new Map(
    tradablePrices.map((price) => [price.symbol, price.price]),
  );
  return {
    accountEquity: margin.equity,
    positionsGrossNotional: margin.positionsGrossNotional,
    reservedGrossNotional: reservedGrossNotionalFor(
      orders,
      marked,
      priceMap,
      excludeOrderId,
    ),
  };
}

function riskIncreaseForOrder(
  portfolio: PortfolioState,
  symbol: string,
  side: OrderSide,
  quantity: number,
  price: number,
): number {
  const held = portfolio.positions[symbol]?.quantity ?? 0;
  const delta = side === "buy" ? quantity : -quantity;
  return Math.max(0, Math.abs(held + delta) - Math.abs(held)) * price;
}

function marginPolicyRejection(
  state: SessionState,
  symbol: string,
  side: OrderSide,
  quantity: number,
  price: number,
): string | undefined {
  if (state.broker.marginCallPolicy !== "reject_new_orders") return undefined;
  const currentTime = currentTimeFor(state);
  const marked = markToMarket(
    state.portfolio,
    tradablePricesFor(state.scenario, currentTime, state.broker),
  );
  const margin = buildMarginSnapshot(marked, state.broker);
  if (!margin.isMarginCall && !margin.requiresLiquidation) return undefined;
  return riskIncreaseForOrder(marked, symbol, side, quantity, price) > 1e-9
    ? "Margin threshold breached; only risk-reducing orders are allowed."
    : undefined;
}

function closeWorkingOrdersAtEnd(
  orders: Order[],
  currentTime: string,
  auditEvents: AuditEvent[],
): { orders: Order[]; auditEvents: AuditEvent[] } {
  let nextAudit = auditEvents;
  const nextOrders = orders.map((order) => {
    if (!isWorkingOrder(order)) return order;
    nextAudit = [
      ...nextAudit,
      auditEvent(nextAudit, {
        time: currentTime,
        type: "tif_expired",
        message: `Working order expired at scenario end: ${order.symbol} ${order.type}.`,
        orderId: order.id,
        symbol: order.symbol,
      }),
    ];
    return {
      ...order,
      status: "expired" as const,
      closedAt: currentTime,
      remainingQuantity: order.remainingQuantity ?? order.quantity,
    };
  });
  return { orders: nextOrders, auditEvents: nextAudit };
}

function candlesBetween(
  scenario: ScenarioPackage,
  startExclusive: string,
  endInclusive: string,
): ScenarioPackage["candles"] {
  const startEpoch = Date.parse(startExclusive);
  const endEpoch = Date.parse(endInclusive);
  const result: ScenarioPackage["candles"] = [];
  for (const symbol of scenario.meta.symbols) {
    const candles = candlesForSymbol(scenario, symbol);
    let low = 0;
    let high = candles.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (Date.parse(candles[middle].closeTime) <= startEpoch) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    for (let index = low; index < candles.length; index++) {
      const epoch = Date.parse(candles[index].closeTime);
      if (epoch > endEpoch) break;
      result.push(candles[index]);
    }
  }
  return result.sort((a, b) => {
    const timeDifference = Date.parse(a.closeTime) - Date.parse(b.closeTime);
    return timeDifference || a.symbol.localeCompare(b.symbol);
  });
}

function processTriggeredLimitOrders(
  state: SessionState,
  fromIndex: number,
  toIndex: number,
): Pick<
  SessionState,
  | "portfolio"
  | "fills"
  | "orders"
  | "journal"
  | "auditEvents"
  | "margin"
  | "risk"
  | "rejectionMessage"
  | "appliedCorporateActions"
  | "marginCallActive"
  | "liquidityConsumed"
  | "financingCosts"
> {
  let portfolio = state.portfolio;
  const fills = [...state.fills];
  const orders = [...state.orders];
  const journal = [...state.journal];
  let auditEvents = [...state.auditEvents];
  let rejectionMessage = state.rejectionMessage;
  let appliedCorporateActions = [...state.appliedCorporateActions];
  let marginCallActive = state.marginCallActive;
  const liquidityConsumed = { ...state.liquidityConsumed };
  const financingCosts = [...state.financingCosts];
  const timeline = replayTimeline(state.scenario);
  const processStart = timeAtIndex(
    timeline,
    Math.max(0, fromIndex - 1),
    state.scenario.meta.startTime,
  );
  const processEnd = timeAtIndex(
    timeline,
    Math.max(0, toIndex),
    state.scenario.meta.endTime,
  );
  const replayCandles = candlesBetween(
    state.scenario,
    processStart,
    processEnd,
  );
  let replayCandleIndex = 0;

  for (let i = fromIndex; i <= toIndex; i++) {
    const intervalStart = timeAtIndex(
      timeline,
      Math.max(0, i - 1),
      state.scenario.meta.startTime,
    );
    const currentTime = timeAtIndex(
      timeline,
      i,
      state.scenario.meta.startTime,
    );
    const startEpoch = Date.parse(intervalStart);
    const endEpoch = Date.parse(currentTime);
    const candlesInInterval: ScenarioPackage["candles"] = [];
    while (replayCandleIndex < replayCandles.length) {
      const candidate = replayCandles[replayCandleIndex];
      const epoch = Date.parse(candidate.closeTime);
      if (epoch > endEpoch) break;
      replayCandleIndex += 1;
      if (epoch > startEpoch) candlesInInterval.push(candidate);
    }
    // Consecutive entries in the global timeline bound exactly one candle-close
    // instant. Use the timeline representation so equivalent ISO encodings are
    // processed together and share one liquidity bucket.
    const executionTimes = candlesInInterval.length > 0 ? [currentTime] : [];
    let accountingTime = intervalStart;

    for (const executionTime of executionTimes) {
      const financing = applyBorrowCosts(
        portfolio,
        state.broker,
        accountingTime,
        executionTime,
        auditEvents,
      );
      portfolio = financing.portfolio;
      auditEvents = financing.auditEvents;
      if (financing.cost) {
        financingCosts.push({ time: executionTime, amount: financing.cost });
      }
      const actions = applyCorporateActionsThrough(
        portfolio,
        orders,
        state.scenario,
        accountingTime,
        executionTime,
        appliedCorporateActions,
        auditEvents,
      );
      portfolio = actions.portfolio;
      orders.splice(0, orders.length, ...actions.orders);
      appliedCorporateActions = actions.appliedCorporateActions;
      auditEvents = actions.auditEvents;
      accountingTime = executionTime;

      const prices = tradablePricesFor(
        state.scenario,
        executionTime,
        state.broker,
      );
      portfolio = markToMarket(portfolio, prices);
      const candlesAtTime = new Map(
        candlesInInterval.map((candle) => [candle.symbol, candle]),
      );
      const availableLiquidity = new Map<string, number>();
      for (const [symbol, candle] of candlesAtTime) {
        const rate = state.broker.maxParticipationRate;
        if (
          state.broker.partialFillPolicy === "volume_limited" &&
          rate &&
          rate > 0
        ) {
          const key = `${executionTime}:${symbol}`;
          availableLiquidity.set(
            symbol,
            Math.max(
              0,
              candle.volume * candle.close * rate -
                (liquidityConsumed[key] ?? 0),
            ),
          );
        }
      }

      for (let orderIndex = 0; orderIndex < orders.length; orderIndex++) {
        const order = orders[orderIndex];
        if (!isWorkingOrder(order)) continue;
        if (isOrderExpired(order, executionTime, state.scenario)) {
          orders[orderIndex] = {
            ...order,
            status: "expired",
            remainingQuantity: order.remainingQuantity ?? order.quantity,
            closedAt: executionTime,
          };
          auditEvents = [
            ...auditEvents,
            auditEvent(auditEvents, {
              time: executionTime,
              type: "tif_expired",
              message: `Working order expired: ${order.symbol} ${order.type}.`,
              orderId: order.id,
              symbol: order.symbol,
            }),
          ];
          continue;
        }
        const candle = candlesAtTime.get(order.symbol);
        if (!candle) continue;
        if (
          order.type !== "market" &&
          !isPendingOrderTriggered({
            order,
            high: candle.high,
            low: candle.low,
          })
        ) {
          continue;
        }

        const account = accountContextFor(
          portfolio,
          orders,
          state.scenario,
          state.broker,
          executionTime,
          order.id,
        );
        const result = executePendingOrderFill({
          order,
          broker: state.broker,
          cash: portfolio.cash,
          position: portfolio.positions[order.symbol],
          currentTime: executionTime,
          instrument: state.scenario.instruments.find(
            (instrument) => instrument.symbol === order.symbol,
          ),
          instrumentTradable:
            state.scenario.instruments.find(
              (instrument) => instrument.symbol === order.symbol,
            )?.tradable !== false,
          marketOpen: isMarketOpen(
            state.scenario,
            state.broker,
            candle.closeTime,
          ),
          candle,
          candleVolumeNotional: candle.volume * candle.close,
          availableCandleLiquidityNotional: availableLiquidity.get(order.symbol),
          volatility: latestVolatilityFor(
            state.scenario,
            order.symbol,
            executionTime,
          ),
          ...account,
        });
        if (!result.ok) {
          if (result.deferredForLiquidity) {
            orders[orderIndex] = result.order;
            continue;
          }
          if (result.reason === "Market closed") {
            continue;
          }
          orders[orderIndex] = result.order;
          rejectionMessage = result.reason;
          auditEvents = [
            ...auditEvents,
            auditEvent(auditEvents, {
              time: executionTime,
              type: "order_rejected",
              message: result.reason,
              orderId: result.order.id,
              symbol: result.order.symbol,
            }),
          ];
          continue;
        }
        orders[orderIndex] = result.order;
        orders.splice(
          0,
          orders.length,
          ...updateOcoSiblingsAfterFill(
            orders,
            result.order,
            result.fill.quantity,
            executionTime,
          ),
        );
        const remainingLiquidity = availableLiquidity.get(order.symbol);
        if (remainingLiquidity !== undefined) {
          const consumed = result.fill.quantity * result.fill.referencePrice;
          availableLiquidity.set(
            order.symbol,
            Math.max(0, remainingLiquidity - consumed),
          );
          const key = `${executionTime}:${order.symbol}`;
          liquidityConsumed[key] = (liquidityConsumed[key] ?? 0) + consumed;
        }
        portfolio = markToMarket(applyFill(portfolio, result.fill), prices);
        fills.push(result.fill);
        const entry = journalEntryForFill(
          result.fill,
          order.note,
          order.decisionPlan,
        );
        if (entry) journal.push(entry);
        auditEvents = [
          ...auditEvents,
          auditEvent(auditEvents, {
            time: result.fill.time,
            type: "fill",
            message: `${result.fill.side} ${result.fill.quantity} ${result.fill.symbol} filled at ${result.fill.price}.`,
            orderId: result.order.id,
            fillId: result.fill.id,
            symbol: result.fill.symbol,
          }),
        ];
        rejectionMessage = undefined;
      }

      const liquidation = applyForcedLiquidationIfNeeded(
        portfolio,
        orders,
        fills,
        state.broker,
        state.scenario,
        executionTime,
        auditEvents,
        marginCallActive,
      );
      portfolio = liquidation.portfolio;
      orders.splice(0, orders.length, ...liquidation.orders);
      fills.splice(0, fills.length, ...liquidation.fills);
      auditEvents = liquidation.auditEvents;
      marginCallActive = liquidation.marginCallActive;
      rejectionMessage = liquidation.rejectionMessage ?? rejectionMessage;
    }

    if (Date.parse(accountingTime) < endEpoch) {
      const financing = applyBorrowCosts(
        portfolio,
        state.broker,
        accountingTime,
        currentTime,
        auditEvents,
      );
      portfolio = financing.portfolio;
      auditEvents = financing.auditEvents;
      if (financing.cost) {
        financingCosts.push({ time: currentTime, amount: financing.cost });
      }
      const actions = applyCorporateActionsThrough(
        portfolio,
        orders,
        state.scenario,
        accountingTime,
        currentTime,
        appliedCorporateActions,
        auditEvents,
      );
      portfolio = actions.portfolio;
      orders.splice(0, orders.length, ...actions.orders);
      appliedCorporateActions = actions.appliedCorporateActions;
      auditEvents = actions.auditEvents;
    }
    const prices = tradablePricesFor(state.scenario, currentTime, state.broker);
    portfolio = markToMarket(portfolio, prices);
    const liquidation = applyForcedLiquidationIfNeeded(
      portfolio,
      orders,
      fills,
      state.broker,
      state.scenario,
      currentTime,
      auditEvents,
      marginCallActive,
    );
    portfolio = liquidation.portfolio;
    orders.splice(0, orders.length, ...liquidation.orders);
    fills.splice(0, fills.length, ...liquidation.fills);
    auditEvents = liquidation.auditEvents;
    marginCallActive = liquidation.marginCallActive;
    rejectionMessage = liquidation.rejectionMessage ?? rejectionMessage;
    auditEvents.push(
      auditEvent(auditEvents, {
        time: currentTime,
        type: "replay_step",
        message: `Replay advanced to ${currentTime}.`,
      }),
    );
  }

  const { margin, risk } = marginAndRiskFor(portfolio, state.broker);

  return {
    portfolio,
    fills,
    orders,
    journal,
    auditEvents,
    margin,
    risk,
    rejectionMessage,
    appliedCorporateActions,
    marginCallActive,
    liquidityConsumed,
    financingCosts,
  };
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...initialState(),

  selectScenario: (id: string) => {
    set(buildInitialState(id));
  },

  resetScenario: () => {
    set(buildInitialState(get().scenario.meta.id));
  },

  play: () => {
    const state = get();
    const { status, currentIndex, primaryCandlesLength } = state;
    if (status === "finished") return;
    if (currentIndex >= primaryCandlesLength - 1) {
      const finalTime = currentTimeFor(state);
      const closed = closeWorkingOrdersAtEnd(
        state.orders,
        finalTime,
        state.auditEvents,
      );
      set({
        ...closed,
        status: "finished",
        majorEventPauseNotice: undefined,
      });
      finalizeReport();
      return;
    }
    set({ status: "playing", majorEventPauseNotice: undefined });
  },

  pause: () => {
    if (get().status === "playing") {
      set({ status: "paused" });
    }
  },

  stepForward: () => {
    const state = get();
    if (state.status === "finished") return;
    const requestedIndex = Math.min(
      state.currentIndex + state.speed.candlesPerTick,
      state.primaryCandlesLength - 1,
    );
    const majorEventPause = majorEventPauseFor(state, requestedIndex);
    const nextIndex = majorEventPause?.index ?? requestedIndex;
    const isFinished = nextIndex >= state.primaryCandlesLength - 1;
    const triggered = processTriggeredLimitOrders(
      state,
      state.currentIndex + 1,
      nextIndex,
    );
    const endTime = timeAtIndex(
      replayTimeline(state.scenario),
      nextIndex,
      state.scenario.meta.endTime,
    );
    const closed = isFinished
      ? closeWorkingOrdersAtEnd(
          triggered.orders,
          endTime,
          triggered.auditEvents,
        )
      : undefined;
    set({
      ...triggered,
      ...(closed ?? {}),
      currentIndex: nextIndex,
      status: isFinished
        ? "finished"
        : majorEventPause
          ? "paused"
          : state.status === "playing"
            ? "playing"
            : "paused",
      majorEventPauseNotice: isFinished ? undefined : majorEventPause?.notice,
    });
    if (isFinished) {
      finalizeReport();
    }
  },

  setSpeed: (label) => {
    const found = REPLAY_SPEEDS.find((s) => s.label === label);
    if (found) set({ speed: { ...found } });
  },

  setPauseOnMajorEvents: (enabled) => {
    const state = get();
    if (state.mode !== "explorer") {
      set({
        pauseOnMajorEvents: false,
        majorEventPauseNotice: undefined,
        rejectionMessage:
          "Major-event auto-pause is available in Explorer mode.",
      });
      return;
    }
    set({
      pauseOnMajorEvents: enabled,
      majorEventPauseNotice: undefined,
      rejectionMessage: undefined,
    });
  },

  setScenarioMode: (mode) => {
    const state = get();
    if (!state.scenario.meta.supportedModes.includes(mode)) {
      set({ rejectionMessage: "This scenario does not support that mode." });
      return;
    }
    if (state.fills.length > 0 || state.orders.some(isWorkingOrder)) {
      set({
        rejectionMessage:
          "Scenario mode is locked after trading starts. Reset to change it.",
      });
      return;
    }
    set({
      mode,
      broker:
        mode === "professional" || mode === "blind" || mode === "challenge"
          ? { ...state.scenario.broker }
          : state.broker,
      brokerMode:
        mode === "professional" || mode === "blind" || mode === "challenge"
          ? "scenario"
          : state.brokerMode,
      pauseOnMajorEvents: mode === "explorer",
      majorEventPauseNotice: undefined,
      rejectionMessage: undefined,
    });
  },

  setBrokerMode: (mode) => {
    const state = get();
    if (
      state.mode === "professional" ||
      state.mode === "blind" ||
      state.mode === "challenge"
    ) {
      set({ rejectionMessage: "Broker settings are locked in this mode." });
      return;
    }
    if (
      state.fills.length > 0 ||
      state.orders.some((order) => order.status !== "rejected")
    ) {
      set({
        rejectionMessage:
          "Broker model is locked after the first accepted order. Reset the scenario to change it.",
      });
      return;
    }
    const broker =
      mode === "scenario"
        ? { ...state.scenario.broker }
        : {
            ...getBrokerPreset(mode),
            baseCurrency: state.scenario.meta.baseCurrency,
          };
    set({
      broker,
      brokerMode: mode,
      rejectionMessage: undefined,
    });
  },

  finish: () => {
    const state = get();
    if (state.status === "finished") return;
    if (state.mode === "blind" || state.mode === "challenge") {
      set({
        rejectionMessage:
          "Skip to end is disabled in blind and challenge modes. Replay the remaining market data.",
      });
      return;
    }
    const finalIndex = Math.max(0, state.primaryCandlesLength - 1);
    const triggered = processTriggeredLimitOrders(
      state,
      state.currentIndex + 1,
      finalIndex,
    );
    const finalTime = timeAtIndex(
      replayTimeline(state.scenario),
      finalIndex,
      state.scenario.meta.endTime,
    );
    const closed = closeWorkingOrdersAtEnd(
      triggered.orders,
      finalTime,
      triggered.auditEvents,
    );
    set({
      ...triggered,
      ...closed,
      currentIndex: finalIndex,
      status: "finished",
      majorEventPauseNotice: undefined,
    });
    finalizeReport();
  },

  submitMarketOrder: (req) => {
    const state = get();
    if (state.status === "finished") {
      return { ok: false, message: "Scenario already finished." };
    }
    const currentTime = currentTimeFor(state);
    const tradablePrices = tradablePricesFor(
      state.scenario,
      currentTime,
      state.broker,
    );
    const tradablePrice = tradablePrices.find((p) => p.symbol === req.symbol);
    const symbolCandles = candlesForSymbol(state.scenario, req.symbol);
    const candleIdx = lastVisibleCandleIndex(symbolCandles, currentTime);
    const visibleCandle = candleIdx >= 0 ? symbolCandles[candleIdx] : undefined;
    const currentPrice = tradablePrice?.price ?? visibleCandle?.close ?? 0;
    const marginRejection = marginPolicyRejection(
      state,
      req.symbol,
      req.side,
      req.quantity,
      currentPrice,
    );
    if (marginRejection) {
      set({ rejectionMessage: marginRejection });
      return { ok: false, message: marginRejection };
    }
    const account = accountContextFor(
      state.portfolio,
      state.orders,
      state.scenario,
      state.broker,
      currentTime,
    );
    const liquidityKey = `${currentTime}:${req.symbol}`;
    const configuredLiquidity =
      visibleCandle &&
      state.broker.partialFillPolicy === "volume_limited" &&
      state.broker.maxParticipationRate &&
      state.broker.maxParticipationRate > 0
        ? visibleCandle.volume *
          visibleCandle.close *
          state.broker.maxParticipationRate
        : undefined;
    const availableCandleLiquidityNotional =
      configuredLiquidity === undefined
        ? undefined
        : Math.max(
            0,
            configuredLiquidity - (state.liquidityConsumed[liquidityKey] ?? 0),
          );
    const result = executeMarketOrder({
      request: req,
      broker: state.broker,
      cash: state.portfolio.cash,
      position: state.portfolio.positions[req.symbol],
      tradablePrice,
      currentTime,
      instrument: state.scenario.instruments.find((i) => i.symbol === req.symbol),
      instrumentTradable:
        state.scenario.instruments.find((i) => i.symbol === req.symbol)
          ?.tradable !== false,
      marketOpen: isMarketOpen(state.scenario, state.broker, currentTime),
      candleVolumeNotional: visibleCandle
        ? visibleCandle.volume * visibleCandle.close
        : undefined,
      availableCandleLiquidityNotional,
      volatility: latestVolatilityFor(
        state.scenario,
        req.symbol,
        currentTime,
      ),
      ...account,
    });
    if (!result.ok) {
      if (result.deferredForLiquidity) {
        const placedAudit = auditEvent(state.auditEvents, {
          time: currentTime,
          type: "order_placed",
          message: `Market ${req.side} order placed and queued for liquidity.`,
          orderId: result.order.id,
          symbol: req.symbol,
        });
        set({
          orders: [...state.orders, result.order],
          auditEvents: [...state.auditEvents, placedAudit],
          rejectionMessage: undefined,
        });
        return { ok: true };
      }
      set({
        orders: [...state.orders, result.order],
        auditEvents: [
          ...state.auditEvents,
          auditEvent(state.auditEvents, {
            time: currentTime,
            type: "order_rejected",
            message: result.reason,
            orderId: result.order.id,
            symbol: req.symbol,
          }),
        ],
        rejectionMessage: result.reason,
      });
      return { ok: false, message: result.reason };
    }
    const newPortfolio = markToMarket(
      applyFill(state.portfolio, result.fill),
      tradablePrices,
    );
    const entry = journalEntryForFill(
      result.fill,
      req.note,
      req.decisionPlan,
    );
    const newJournal = entry ? [...state.journal, entry] : state.journal;
    const placedAudit = auditEvent(state.auditEvents, {
      time: currentTime,
      type: "order_placed",
      message: `Market ${req.side} order placed.`,
      orderId: result.order.id,
      symbol: req.symbol,
    });
    const fillAudit = auditEvent([...state.auditEvents, placedAudit], {
      time: result.fill.time,
      type: "fill",
      message: `${result.fill.side} ${result.fill.quantity} ${result.fill.symbol} filled at ${result.fill.price}.`,
      orderId: result.order.id,
      fillId: result.fill.id,
      symbol: result.fill.symbol,
    });
    const liquidation = applyForcedLiquidationIfNeeded(
      newPortfolio,
      [...state.orders, result.order],
      [...state.fills, result.fill],
      state.broker,
      state.scenario,
      currentTime,
      [...state.auditEvents, placedAudit, fillAudit],
      state.marginCallActive,
    );
    const { margin, risk } = marginAndRiskFor(
      liquidation.portfolio,
      state.broker,
    );
    set({
      orders: liquidation.orders,
      fills: liquidation.fills,
      portfolio: liquidation.portfolio,
      journal: newJournal,
      auditEvents: liquidation.auditEvents,
      liquidityConsumed:
        availableCandleLiquidityNotional === undefined
          ? state.liquidityConsumed
          : {
              ...state.liquidityConsumed,
              [liquidityKey]:
                (state.liquidityConsumed[liquidityKey] ?? 0) +
                result.fill.quantity * result.fill.referencePrice,
            },
      margin,
      risk,
      marginCallActive: liquidation.marginCallActive,
      rejectionMessage: liquidation.rejectionMessage,
    });
    return { ok: true };
  },

  submitLimitOrder: (req) => {
    const state = get();
    if (state.status === "finished") {
      return { ok: false, message: "Scenario already finished." };
    }
    const currentTime = currentTimeFor(state);
    const tradablePrices = tradablePricesFor(
      state.scenario,
      currentTime,
      state.broker,
    );
    const tradablePrice = tradablePrices.find((p) => p.symbol === req.symbol);
    const marginRejection = marginPolicyRejection(
      state,
      req.symbol,
      req.side,
      req.quantity,
      req.limitPrice,
    );
    if (marginRejection) {
      set({ rejectionMessage: marginRejection });
      return { ok: false, message: marginRejection };
    }
    const account = accountContextFor(
      state.portfolio,
      state.orders,
      state.scenario,
      state.broker,
      currentTime,
    );
    const result = createLimitOrder({
      request: req,
      broker: state.broker,
      cash: state.portfolio.cash,
      position: state.portfolio.positions[req.symbol],
      tradablePrice,
      currentTime,
      instrument: state.scenario.instruments.find((i) => i.symbol === req.symbol),
      instrumentTradable:
        state.scenario.instruments.find((i) => i.symbol === req.symbol)
          ?.tradable !== false,
      ...account,
    });
    const type = result.ok ? "order_placed" : "order_rejected";
    set({
      orders: [...state.orders, result.order],
      auditEvents: [
        ...state.auditEvents,
        auditEvent(state.auditEvents, {
          time: currentTime,
          type,
          message: result.ok ? "Limit order placed." : result.reason,
          orderId: result.order.id,
          symbol: req.symbol,
        }),
      ],
      rejectionMessage: result.ok ? undefined : result.reason,
    });
    return result.ok ? { ok: true } : { ok: false, message: result.reason };
  },

  submitPendingOrder: (req) => {
    const state = get();
    if (state.status === "finished") {
      return { ok: false, message: "Scenario already finished." };
    }
    const currentTime = currentTimeFor(state);
    const tradablePrices = tradablePricesFor(
      state.scenario,
      currentTime,
      state.broker,
    );
    const tradablePrice = tradablePrices.find((p) => p.symbol === req.symbol);
    const orderPrice =
      req.type === "limit" ? req.limitPrice : req.triggerPrice;
    const marginRejection = marginPolicyRejection(
      state,
      req.symbol,
      req.side,
      req.quantity,
      orderPrice,
    );
    if (marginRejection) {
      set({ rejectionMessage: marginRejection });
      return { ok: false, message: marginRejection };
    }
    const account = accountContextFor(
      state.portfolio,
      state.orders,
      state.scenario,
      state.broker,
      currentTime,
    );
    const pendingOrderContext = {
      broker: state.broker,
      cash: state.portfolio.cash,
      position: state.portfolio.positions[req.symbol],
      tradablePrice,
      currentTime,
      instrument: state.scenario.instruments.find((i) => i.symbol === req.symbol),
      instrumentTradable:
        state.scenario.instruments.find((i) => i.symbol === req.symbol)
          ?.tradable !== false,
      ...account,
    };
    const result = createPendingOrder({ ...pendingOrderContext, request: req });
    const type = result.ok ? "order_placed" : "order_rejected";
    set({
      orders: [...state.orders, result.order],
      auditEvents: [
        ...state.auditEvents,
        auditEvent(state.auditEvents, {
          time: currentTime,
          type,
          message: result.ok ? `${req.type} order placed.` : result.reason,
          orderId: result.order.id,
          symbol: req.symbol,
        }),
      ],
      rejectionMessage: result.ok ? undefined : result.reason,
    });
    return result.ok ? { ok: true } : { ok: false, message: result.reason };
  },

  submitBracketOrder: (req) => {
    const state = get();
    if (state.status === "finished") {
      return { ok: false, message: "Scenario already finished." };
    }
    if (
      !Number.isFinite(req.stopPrice) ||
      req.stopPrice <= 0 ||
      !Number.isFinite(req.targetPrice) ||
      req.targetPrice <= 0
    ) {
      const message = "Invalid bracket prices";
      set({ rejectionMessage: message });
      return { ok: false, message };
    }
    if (Math.abs(req.stopPrice - req.targetPrice) <= 0.0000001) {
      const message = "Stop and target prices must be different.";
      set({ rejectionMessage: message });
      return { ok: false, message };
    }

    const currentTime = currentTimeFor(state);
    const tradablePrices = tradablePricesFor(
      state.scenario,
      currentTime,
      state.broker,
    );
    const tradablePrice = tradablePrices.find((p) => p.symbol === req.symbol);
    if (!tradablePrice) {
      const message = "No tradable price at current replay time";
      set({ rejectionMessage: message });
      return { ok: false, message };
    }
    const held = state.portfolio.positions[req.symbol]?.quantity ?? 0;
    const isValidExit =
      req.side === "sell"
        ? held + 1e-9 >= req.quantity
        : held <= -req.quantity + 1e-9;
    if (!isValidExit) {
      const message = "Bracket quantity must reduce an existing position.";
      set({ rejectionMessage: message });
      return { ok: false, message };
    }
    const directionalPricesAreValid =
      req.side === "sell"
        ? req.stopPrice < tradablePrice.price &&
          req.targetPrice > tradablePrice.price
        : req.stopPrice > tradablePrice.price &&
          req.targetPrice < tradablePrice.price;
    if (!directionalPricesAreValid) {
      const message =
        req.side === "sell"
          ? "For a long exit, stop must be below market and target above market."
          : "For a short exit, stop must be above market and target below market.";
      set({ rejectionMessage: message });
      return { ok: false, message };
    }
    const account = accountContextFor(
      state.portfolio,
      state.orders,
      state.scenario,
      state.broker,
      currentTime,
    );
    const context = {
      broker: state.broker,
      cash: state.portfolio.cash,
      position: state.portfolio.positions[req.symbol],
      tradablePrice,
      currentTime,
      instrument: state.scenario.instruments.find((i) => i.symbol === req.symbol),
      instrumentTradable:
        state.scenario.instruments.find((i) => i.symbol === req.symbol)
          ?.tradable !== false,
      ...account,
    };
    const ocoGroupId = generateOcoGroupId();
    const stop = createPendingOrder({
      ...context,
      request: {
        symbol: req.symbol,
        side: req.side,
        type: "stop_loss",
        quantity: req.quantity,
        triggerPrice: req.stopPrice,
        ocoGroupId,
        timeInForce: req.timeInForce,
        note: req.note,
        decisionPlan: req.decisionPlan,
      },
    });
    if (!stop.ok) {
      set({
        auditEvents: [
          ...state.auditEvents,
          auditEvent(state.auditEvents, {
            time: currentTime,
            type: "order_rejected",
            message: stop.reason,
            orderId: stop.order.id,
            symbol: req.symbol,
          }),
        ],
        rejectionMessage: stop.reason,
      });
      return { ok: false, message: stop.reason };
    }
    const target = createPendingOrder({
      ...context,
      request: {
        symbol: req.symbol,
        side: req.side,
        type: "take_profit",
        quantity: req.quantity,
        triggerPrice: req.targetPrice,
        ocoGroupId,
        timeInForce: req.timeInForce,
        note: req.note,
        decisionPlan: req.decisionPlan,
      },
    });
    if (!target.ok) {
      set({
        auditEvents: [
          ...state.auditEvents,
          auditEvent(state.auditEvents, {
            time: currentTime,
            type: "order_rejected",
            message: target.reason,
            orderId: target.order.id,
            symbol: req.symbol,
          }),
        ],
        rejectionMessage: target.reason,
      });
      return { ok: false, message: target.reason };
    }

    const stopAudit = auditEvent(state.auditEvents, {
      time: currentTime,
      type: "order_placed",
      message: "Bracket OCO stop placed.",
      orderId: stop.order.id,
      symbol: req.symbol,
    });
    const targetAudit = auditEvent([...state.auditEvents, stopAudit], {
      time: currentTime,
      type: "order_placed",
      message: "Bracket OCO target placed.",
      orderId: target.order.id,
      symbol: req.symbol,
    });
    set({
      orders: [...state.orders, stop.order, target.order],
      auditEvents: [...state.auditEvents, stopAudit, targetAudit],
      rejectionMessage: undefined,
    });
    return { ok: true };
  },

  cancelOrder: (orderId) => {
    const state = get();
    if (state.status === "finished") {
      return { ok: false, message: "Scenario already finished." };
    }
    const order = state.orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      const message = "Order not found.";
      set({ rejectionMessage: message });
      return { ok: false, message };
    }
    if (!isWorkingOrder(order)) {
      const message = "Only working orders can be cancelled.";
      set({ rejectionMessage: message });
      return { ok: false, message };
    }
    set({
      orders: state.orders.map((candidate) =>
        candidate.id === orderId
          ? {
              ...candidate,
              status: "cancelled",
              closedAt: currentTimeFor(state),
            }
          : candidate,
      ),
      auditEvents: [
        ...state.auditEvents,
        auditEvent(state.auditEvents, {
          time: currentTimeFor(state),
          type: "order_cancelled",
          message: `Order cancelled: ${order.symbol} ${order.type}.`,
          orderId,
          symbol: order.symbol,
        }),
      ],
      rejectionMessage: undefined,
    });
    return { ok: true };
  },

  updateLimitOrder: (orderId, updates) => {
    const order = get().orders.find((candidate) => candidate.id === orderId);
    if (order && order.type !== "limit") {
      const message = "Only working limit orders can be updated here.";
      set({ rejectionMessage: message });
      return { ok: false, message };
    }
    return get().updatePendingOrder(orderId, {
      quantity: updates.quantity,
      price: updates.limitPrice,
    });
  },

  updatePendingOrder: (orderId, updates) => {
    const state = get();
    if (state.status === "finished") {
      return { ok: false, message: "Scenario already finished." };
    }
    const order = state.orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      const message = "Order not found.";
      set({ rejectionMessage: message });
      return { ok: false, message };
    }
    if (
      !isWorkingOrder(order) ||
      (order.type !== "limit" &&
        order.type !== "stop_loss" &&
        order.type !== "take_profit")
    ) {
      const message = "Only working orders can be updated.";
      set({ rejectionMessage: message });
      return { ok: false, message };
    }
    const previouslyFilled = order.filledQuantity ?? 0;
    if (updates.quantity <= previouslyFilled + 1e-9) {
      const message = "Updated quantity must exceed the quantity already filled.";
      set({ rejectionMessage: message });
      return { ok: false, message };
    }
    if (!Number.isFinite(updates.price) || updates.price <= 0) {
      const message = "Invalid order price";
      set({ rejectionMessage: message });
      return { ok: false, message };
    }

    const currentTime = currentTimeFor(state);
    const tradablePrices = tradablePricesFor(
      state.scenario,
      currentTime,
      state.broker,
    );
    const tradablePrice = tradablePrices.find((p) => p.symbol === order.symbol);
    const remainingQuantity = updates.quantity - previouslyFilled;
    const request: PendingOrderRequest =
      order.type === "limit"
        ? {
            symbol: order.symbol,
            side: order.side,
            type: "limit",
            quantity: remainingQuantity,
            limitPrice: updates.price,
            ocoGroupId: order.ocoGroupId,
            note: order.note,
            decisionPlan: order.decisionPlan,
          }
        : {
            symbol: order.symbol,
            side: order.side,
            type: order.type,
            quantity: remainingQuantity,
            triggerPrice: updates.price,
            ocoGroupId: order.ocoGroupId,
            note: order.note,
            decisionPlan: order.decisionPlan,
          };
    const account = accountContextFor(
      state.portfolio,
      state.orders,
      state.scenario,
      state.broker,
      currentTime,
      order.id,
    );
    const result = createPendingOrder({
      request,
      broker: state.broker,
      cash: state.portfolio.cash,
      position: state.portfolio.positions[order.symbol],
      tradablePrice,
      currentTime,
      instrument: state.scenario.instruments.find(
        (i) => i.symbol === order.symbol,
      ),
      instrumentTradable:
        state.scenario.instruments.find((i) => i.symbol === order.symbol)
          ?.tradable !== false,
      ...account,
    });
    if (!result.ok) {
      set({ rejectionMessage: result.reason });
      return { ok: false, message: result.reason };
    }

    set({
      orders: state.orders.map((candidate) =>
        candidate.id === orderId
          ? {
              ...candidate,
              quantity: previouslyFilled + result.order.quantity,
              limitPrice: result.order.limitPrice,
              triggerPrice: result.order.triggerPrice,
              remainingQuantity: result.order.remainingQuantity,
              filledQuantity: previouslyFilled,
              averageFillPrice: order.averageFillPrice,
            }
          : candidate,
      ),
      auditEvents: [
        ...state.auditEvents,
        auditEvent(state.auditEvents, {
          time: currentTime,
          type: "order_updated",
          message: `Working order updated: ${order.symbol} ${order.type}.`,
          orderId,
          symbol: order.symbol,
        }),
      ],
      rejectionMessage: undefined,
    });
    return { ok: true };
  },

  addJournalNote: (note) => {
    if (!note.trim()) return;
    const currentTime = currentTimeFor(get());
    set((state) => ({
      journal: [
        ...state.journal,
        {
          id: `jrn_${Date.now().toString(36)}_${Math.random()
            .toString(36)
            .slice(2, 6)}`,
          time: currentTime,
          note: note.trim(),
        },
      ],
    }));
  },

  exportSession: () => serializeSession(get(), true),

  importSession: (serialized) => {
    try {
      const restored = parsePersistedSession(serialized);
      restored.auditEvents = [
        ...restored.auditEvents,
        auditEvent(restored.auditEvents, {
          time: currentTimeFor(restored),
          type: "session_restored",
          message: "Saved session restored.",
        }),
      ];
      set(restored);
      if (restored.status === "finished" && !restored.report) {
        finalizeReport();
      }
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to restore session.";
      set({ rejectionMessage: message });
      return { ok: false, message };
    }
  },

  clearSavedSession: () => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Clearing persistence is best-effort in privacy-restricted browsers.
    }
  },

  getSnapshot: () => buildSnapshot(get()),

  clearRejection: () => set({ rejectionMessage: undefined }),
}));

function finalizeReport(): void {
  const state = useSessionStore.getState();
  const report = buildReport({
    scenario: state.scenario,
    fills: state.fills,
    orders: state.orders,
    auditEvents: state.auditEvents,
    initialCash: state.scenario.meta.initialCash,
    finalEquityOverride: snapshotPortfolio(state.portfolio, currentTimeFor(state))
      .totalValue,
    financingPaid: state.portfolio.financingPaid,
    financingCosts: state.financingCosts,
    journal: state.journal,
  });
  useSessionStore.setState({ report });
}

export function selectSnapshot(state: SessionStore): ReplaySnapshot {
  return buildSnapshot(state);
}

useSessionStore.subscribe((state) => {
  saveSession(state);
});
