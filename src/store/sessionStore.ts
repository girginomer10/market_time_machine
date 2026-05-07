import { create } from "zustand";
import type {
  AuditEvent,
  BrokerConfig,
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
  ScenarioPackage,
} from "../types";
import {
  getBrokerPreset,
  type BrokerPresetName,
} from "../domain/broker/executionModels";
import { defaultScenarioId, getScenario } from "../data/scenarios";
import {
  lastVisibleCandleIndex,
  REPLAY_SPEEDS,
  timeAtIndex,
  tradablePricesFor,
  visibleBenchmark,
  visibleCandles,
  visibleEvents,
  visibleIndicators,
} from "../domain/replay/engine";
import {
  applyFinancingCost,
  applyFill,
  emptyPortfolio,
  markToMarket,
  snapshotPortfolio,
  type PortfolioState,
} from "../domain/portfolio/portfolio";
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
export type BrokerMode = "scenario" | BrokerPresetName;

export type BracketOrderRequest = {
  symbol: string;
  side: OrderSide;
  quantity: number;
  stopPrice: number;
  targetPrice: number;
  note?: string;
};

export type SessionState = {
  scenario: ScenarioPackage;
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
};

type SessionActions = {
  selectScenario: (id: string) => void;
  resetScenario: () => void;
  play: () => void;
  pause: () => void;
  stepForward: () => void;
  setSpeed: (label: ReplaySpeed["label"]) => void;
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
  const primaryCandles = scenario.candles.filter(
    (c) => c.symbol === primarySymbol,
  );
  return {
    scenario,
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
    primaryCandlesLength: primaryCandles.length,
  };
}

function currentTimeFor(state: Pick<SessionState, "scenario" | "currentIndex" | "primarySymbol">): string {
  const candles = state.scenario.candles.filter(
    (c) => c.symbol === state.primarySymbol,
  );
  return timeAtIndex(candles, state.currentIndex, state.scenario.meta.startTime);
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
    buyingPower: equity * leverage,
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
  const symbolCandles = state.scenario.candles.filter(
    (c) => c.symbol === state.primarySymbol,
  );
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
    auditEvents: state.auditEvents.filter((event) => event.time <= currentTime),
    workingOrders: state.orders.filter(
      (order) =>
        order.status === "pending" || order.status === "partially_filled",
    ),
    replayStatus: state.status,
  };
}

function journalEntryForFill(fill: Fill, note?: string): JournalEntry | undefined {
  const trimmed = note?.trim();
  if (!trimmed) return undefined;
  return {
    id: `jrn_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`,
    time: fill.time,
    fillId: fill.id,
    note: trimmed,
    symbol: fill.symbol,
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

function cancelOcoSiblings(orders: Order[], filledOrder: Order): Order[] {
  if (!filledOrder.ocoGroupId) return orders;
  return orders.map((order) =>
    order.id !== filledOrder.id &&
    order.status === "pending" &&
    order.ocoGroupId === filledOrder.ocoGroupId
      ? { ...order, status: "cancelled" }
      : order,
  );
}

function isSameUtcDate(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

function isWorkingOrder(order: Order): boolean {
  return order.status === "pending" || order.status === "partially_filled";
}

function isOrderExpired(order: Order, currentTime: string): boolean {
  if (!isWorkingOrder(order)) return false;
  if (order.expiresAt && order.expiresAt <= currentTime) return true;
  return order.timeInForce === "day" && !isSameUtcDate(order.createdAt, currentTime);
}

function isMarketOpen(
  scenario: ScenarioPackage,
  broker: BrokerConfig,
  time: string,
): boolean {
  if (!broker.marketHoursEnforced || !scenario.marketCalendar) return true;
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return true;
  const dayKey = date.toISOString().slice(0, 10);
  if (scenario.marketCalendar.holidays?.includes(dayKey)) return false;
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return scenario.marketCalendar.sessions.some((session) => {
    if (session.dayOfWeek !== date.getUTCDay()) return false;
    const [openHour, openMinute] = session.open.split(":").map(Number);
    const [closeHour, closeMinute] = session.close.split(":").map(Number);
    const open = openHour * 60 + openMinute;
    const close = closeHour * 60 + closeMinute;
    return minutes >= open && minutes <= close;
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
): { portfolio: PortfolioState; auditEvents: AuditEvent[] } {
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

function applyForcedLiquidationIfNeeded(
  portfolio: PortfolioState,
  orders: Order[],
  fills: Fill[],
  broker: BrokerConfig,
  scenario: ScenarioPackage,
  currentTime: string,
  auditEvents: AuditEvent[],
): {
  portfolio: PortfolioState;
  orders: Order[];
  fills: Fill[];
  auditEvents: AuditEvent[];
  rejectionMessage?: string;
} {
  if (broker.marginCallPolicy !== "liquidate_on_threshold") {
    return { portfolio, orders, fills, auditEvents };
  }
  const prices = tradablePricesFor(scenario, currentTime, broker);
  let marked = markToMarket(portfolio, prices);
  const margin = buildMarginSnapshot(marked, broker);
  if (!margin.requiresLiquidation) {
    if (margin.isMarginCall) {
      return {
        portfolio: marked,
        orders,
        fills,
        auditEvents: [
          ...auditEvents,
          auditEvent(auditEvents, {
            time: currentTime,
            type: "margin_call",
            message: "Maintenance margin breached.",
          }),
        ],
      };
    }
    return { portfolio: marked, orders, fills, auditEvents };
  }

  let nextOrders = [...orders];
  let nextFills = [...fills];
  let nextAudit = [
    ...auditEvents,
    auditEvent(auditEvents, {
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
      spreadCost: breakdown.spreadCost,
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
    rejectionMessage: "Forced liquidation executed.",
  };
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
> {
  let portfolio = state.portfolio;
  const fills = [...state.fills];
  const orders = [...state.orders];
  const journal = [...state.journal];
  let auditEvents = [...state.auditEvents];
  let rejectionMessage = state.rejectionMessage;
  const primaryCandles = state.scenario.candles.filter(
    (c) => c.symbol === state.primarySymbol,
  );

  for (let i = fromIndex; i <= toIndex; i++) {
    const currentTime = timeAtIndex(
      primaryCandles,
      i,
      state.scenario.meta.startTime,
    );
    auditEvents = [
      ...auditEvents,
      auditEvent(auditEvents, {
        time: currentTime,
        type: "replay_step",
        message: `Replay advanced to ${currentTime}.`,
      }),
    ];
    for (let orderIndex = 0; orderIndex < orders.length; orderIndex++) {
      const order = orders[orderIndex];
      if (!isWorkingOrder(order)) continue;
      if (isOrderExpired(order, currentTime)) {
        orders[orderIndex] = {
          ...order,
          status: "expired",
          remainingQuantity: order.remainingQuantity ?? order.quantity,
          closedAt: currentTime,
        };
        auditEvents = [
          ...auditEvents,
          auditEvent(auditEvents, {
            time: currentTime,
            type: "tif_expired",
            message: `Working order expired: ${order.symbol} ${order.type}.`,
            orderId: order.id,
            symbol: order.symbol,
          }),
        ];
        continue;
      }
      const symbolCandles = state.scenario.candles.filter(
        (c) => c.symbol === order.symbol,
      );
      const candleIndex = lastVisibleCandleIndex(symbolCandles, currentTime);
      const candle = candleIndex >= 0 ? symbolCandles[candleIndex] : undefined;
      if (!candle || candle.closeTime !== currentTime) continue;
      if (
        !isPendingOrderTriggered({
          order,
          high: candle.high,
          low: candle.low,
        })
      ) {
        continue;
      }

      const result = executePendingOrderFill({
        order,
        broker: state.broker,
        cash: portfolio.cash,
        position: portfolio.positions[order.symbol],
        currentTime: candle.closeTime,
        instrument: state.scenario.instruments.find(
          (i) => i.symbol === order.symbol,
        ),
        marketOpen: isMarketOpen(state.scenario, state.broker, candle.closeTime),
        candle,
        candleVolumeNotional: candle.volume * candle.close,
      });
      orders[orderIndex] = result.order;
      if (!result.ok) {
        rejectionMessage = result.reason;
        auditEvents = [
          ...auditEvents,
          auditEvent(auditEvents, {
            time: candle.closeTime,
            type: "order_rejected",
            message: result.reason,
            orderId: result.order.id,
            symbol: result.order.symbol,
          }),
        ];
        continue;
      }
      if (result.order.status === "filled") {
        orders.splice(
          0,
          orders.length,
          ...cancelOcoSiblings(orders, result.order),
        );
      }
      const prices = tradablePricesFor(
        state.scenario,
        candle.closeTime,
        state.broker,
      );
      portfolio = markToMarket(applyFill(portfolio, result.fill), prices);
      fills.push(result.fill);
      const entry = journalEntryForFill(result.fill, order.note);
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

    const previousTime = timeAtIndex(
      primaryCandles,
      Math.max(0, i - 1),
      state.scenario.meta.startTime,
    );
    const prices = tradablePricesFor(state.scenario, currentTime, state.broker);
    portfolio = markToMarket(portfolio, prices);
    const financing = applyBorrowCosts(
      portfolio,
      state.broker,
      previousTime,
      currentTime,
      auditEvents,
    );
    portfolio = financing.portfolio;
    auditEvents = financing.auditEvents;
    const liquidation = applyForcedLiquidationIfNeeded(
      portfolio,
      orders,
      fills,
      state.broker,
      state.scenario,
      currentTime,
      auditEvents,
    );
    portfolio = liquidation.portfolio;
    orders.splice(0, orders.length, ...liquidation.orders);
    fills.splice(0, fills.length, ...liquidation.fills);
    auditEvents = liquidation.auditEvents;
    rejectionMessage = liquidation.rejectionMessage ?? rejectionMessage;
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
  };
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...buildInitialState(defaultScenarioId),

  selectScenario: (id: string) => {
    set(buildInitialState(id));
  },

  resetScenario: () => {
    set(buildInitialState(get().scenario.meta.id));
  },

  play: () => {
    const { status, currentIndex, primaryCandlesLength } = get();
    if (status === "finished") return;
    if (currentIndex >= primaryCandlesLength - 1) {
      set({ status: "finished" });
      return;
    }
    set({ status: "playing" });
  },

  pause: () => {
    if (get().status === "playing") {
      set({ status: "paused" });
    }
  },

  stepForward: () => {
    const state = get();
    if (state.status === "finished") return;
    const nextIndex = Math.min(
      state.currentIndex + state.speed.candlesPerTick,
      state.primaryCandlesLength - 1,
    );
    const isFinished = nextIndex >= state.primaryCandlesLength - 1;
    const triggered = processTriggeredLimitOrders(
      state,
      state.currentIndex + 1,
      nextIndex,
    );
    set({
      ...triggered,
      currentIndex: nextIndex,
      status: isFinished ? "finished" : state.status === "playing" ? "playing" : "paused",
    });
    if (isFinished) {
      finalizeReport();
    }
  },

  setSpeed: (label) => {
    const found = REPLAY_SPEEDS.find((s) => s.label === label);
    if (found) set({ speed: { ...found } });
  },

  setBrokerMode: (mode) => {
    const state = get();
    if (state.fills.length > 0) {
      set({
        rejectionMessage:
          "Broker model is locked after the first fill. Reset the scenario to change it.",
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
    const finalIndex = Math.max(0, state.primaryCandlesLength - 1);
    const triggered = processTriggeredLimitOrders(
      state,
      state.currentIndex + 1,
      finalIndex,
    );
    set({
      ...triggered,
      currentIndex: finalIndex,
      status: "finished",
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
    const symbolCandles = state.scenario.candles.filter(
      (c) => c.symbol === req.symbol,
    );
    const candleIdx = lastVisibleCandleIndex(symbolCandles, currentTime);
    const visibleCandle = candleIdx >= 0 ? symbolCandles[candleIdx] : undefined;
    const result = executeMarketOrder({
      request: req,
      broker: state.broker,
      cash: state.portfolio.cash,
      position: state.portfolio.positions[req.symbol],
      tradablePrice,
      currentTime,
      instrument: state.scenario.instruments.find((i) => i.symbol === req.symbol),
      marketOpen: isMarketOpen(state.scenario, state.broker, currentTime),
      candleVolumeNotional: visibleCandle
        ? visibleCandle.volume * visibleCandle.close
        : undefined,
    });
    if (!result.ok) {
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
    const entry = journalEntryForFill(result.fill, req.note);
    const newJournal = entry ? [...state.journal, entry] : state.journal;
    const { margin, risk } = marginAndRiskFor(newPortfolio, state.broker);
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
    set({
      orders: [...state.orders, result.order],
      fills: [...state.fills, result.fill],
      portfolio: newPortfolio,
      journal: newJournal,
      auditEvents: [...state.auditEvents, placedAudit, fillAudit],
      margin,
      risk,
      rejectionMessage: undefined,
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
    const result = createLimitOrder({
      request: req,
      broker: state.broker,
      cash: state.portfolio.cash,
      position: state.portfolio.positions[req.symbol],
      tradablePrice,
      currentTime,
      instrument: state.scenario.instruments.find((i) => i.symbol === req.symbol),
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
    const pendingOrderContext = {
      broker: state.broker,
      cash: state.portfolio.cash,
      position: state.portfolio.positions[req.symbol],
      tradablePrice,
      currentTime,
      instrument: state.scenario.instruments.find((i) => i.symbol === req.symbol),
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
    const context = {
      broker: state.broker,
      cash: state.portfolio.cash,
      position: state.portfolio.positions[req.symbol],
      tradablePrice,
      currentTime,
      instrument: state.scenario.instruments.find((i) => i.symbol === req.symbol),
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
        note: req.note,
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
        note: req.note,
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

    set({
      orders: [...state.orders, stop.order, target.order],
      auditEvents: [
        ...state.auditEvents,
        auditEvent(state.auditEvents, {
          time: currentTime,
          type: "order_placed",
          message: "Bracket OCO exit placed.",
          orderId: stop.order.id,
          symbol: req.symbol,
        }),
      ],
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
    if (order.status !== "pending") {
      const message = "Only working orders can be cancelled.";
      set({ rejectionMessage: message });
      return { ok: false, message };
    }
    set({
      orders: state.orders.map((candidate) =>
        candidate.id === orderId
          ? { ...candidate, status: "cancelled" }
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
      order.status !== "pending" ||
      (order.type !== "limit" &&
        order.type !== "stop_loss" &&
        order.type !== "take_profit")
    ) {
      const message = "Only working orders can be updated.";
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
    const request: PendingOrderRequest =
      order.type === "limit"
        ? {
            symbol: order.symbol,
            side: order.side,
            type: "limit",
            quantity: updates.quantity,
            limitPrice: updates.price,
            ocoGroupId: order.ocoGroupId,
            note: order.note,
          }
        : {
            symbol: order.symbol,
            side: order.side,
            type: order.type,
            quantity: updates.quantity,
            triggerPrice: updates.price,
            ocoGroupId: order.ocoGroupId,
            note: order.note,
          };
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
              quantity: result.order.quantity,
              limitPrice: result.order.limitPrice,
              triggerPrice: result.order.triggerPrice,
              remainingQuantity: result.order.remainingQuantity,
              filledQuantity: 0,
              averageFillPrice: undefined,
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
  });
  useSessionStore.setState({ report });
}

export function selectSnapshot(state: SessionStore): ReplaySnapshot {
  return buildSnapshot(state);
}
