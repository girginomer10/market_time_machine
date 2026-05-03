import { create } from "zustand";
import type {
  BrokerConfig,
  Fill,
  JournalEntry,
  Order,
  OrderSide,
  PortfolioSnapshot,
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
  applyFill,
  emptyPortfolio,
  markToMarket,
  snapshotPortfolio,
  type PortfolioState,
} from "../domain/portfolio/portfolio";
import {
  createLimitOrder,
  createPendingOrder,
  executePendingOrderFill,
  executeMarketOrder,
  isPendingOrderTriggered,
  type LimitOrderRequest,
  type OrderRequest,
  type PendingOrderRequest,
} from "../domain/broker/simulator";
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

function processTriggeredLimitOrders(
  state: SessionState,
  fromIndex: number,
  toIndex: number,
): Pick<
  SessionState,
  "portfolio" | "fills" | "orders" | "journal" | "rejectionMessage"
> {
  let portfolio = state.portfolio;
  const fills = [...state.fills];
  const orders = [...state.orders];
  const journal = [...state.journal];
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
    for (let orderIndex = 0; orderIndex < orders.length; orderIndex++) {
      const order = orders[orderIndex];
      if (order.status !== "pending") continue;
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
      });
      orders[orderIndex] = result.order;
      if (!result.ok) {
        rejectionMessage = result.reason;
        continue;
      }
      orders.splice(0, orders.length, ...cancelOcoSiblings(orders, result.order));
      const prices = tradablePricesFor(
        state.scenario,
        candle.closeTime,
        state.broker,
      );
      portfolio = markToMarket(applyFill(portfolio, result.fill), prices);
      fills.push(result.fill);
      const entry = journalEntryForFill(result.fill, order.note);
      if (entry) journal.push(entry);
      rejectionMessage = undefined;
    }
  }

  return {
    portfolio,
    fills,
    orders,
    journal,
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
      candleVolumeNotional: visibleCandle
        ? visibleCandle.volume * visibleCandle.close
        : undefined,
    });
    if (!result.ok) {
      set({
        orders: [...state.orders, result.order],
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
    set({
      orders: [...state.orders, result.order],
      fills: [...state.fills, result.fill],
      portfolio: newPortfolio,
      journal: newJournal,
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
    set({
      orders: [...state.orders, result.order],
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
    set({
      orders: [...state.orders, result.order],
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
      set({ rejectionMessage: stop.reason });
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
      set({ rejectionMessage: target.reason });
      return { ok: false, message: target.reason };
    }

    set({
      orders: [...state.orders, stop.order, target.order],
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
            }
          : candidate,
      ),
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
    initialCash: state.scenario.meta.initialCash,
  });
  useSessionStore.setState({ report });
}

export function selectSnapshot(state: SessionStore): ReplaySnapshot {
  return buildSnapshot(state);
}
