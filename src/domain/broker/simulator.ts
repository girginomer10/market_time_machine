import type {
  BrokerConfig,
  Candle,
  ExecutionPriceSource,
  Fill,
  Instrument,
  Order,
  OrderSide,
  Position,
  TimeInForce,
  TradablePrice,
} from "../../types";
import {
  commissionFor as brokerCommissionFor,
  marketFillPrice,
  type SlippageContext,
} from "./executionModels";
import {
  normalizeQuantity,
  validateMarketOrder,
} from "./orderValidation";

export type MarketOrderRequest = {
  symbol: string;
  side: OrderSide;
  type: "market";
  quantity: number;
  timeInForce?: TimeInForce;
  note?: string;
};

export type LimitOrderRequest = {
  symbol: string;
  side: OrderSide;
  type: "limit";
  quantity: number;
  limitPrice: number;
  ocoGroupId?: string;
  timeInForce?: TimeInForce;
  expiresAt?: string;
  note?: string;
};

export type TriggerOrderRequest = {
  symbol: string;
  side: OrderSide;
  type: "stop_loss" | "take_profit";
  quantity: number;
  triggerPrice: number;
  ocoGroupId?: string;
  timeInForce?: TimeInForce;
  expiresAt?: string;
  note?: string;
};

export type OrderRequest = MarketOrderRequest;
export type PendingOrderRequest = LimitOrderRequest | TriggerOrderRequest;

export type FillResult =
  | { ok: true; fill: Fill; order: Order }
  | { ok: false; order: Order; reason: string };

export type OrderPlacementResult =
  | { ok: true; order: Order }
  | { ok: false; order: Order; reason: string };

function generateId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function priceWithSpreadAndSlippage(
  referencePrice: number,
  side: OrderSide,
  broker: BrokerConfig,
  ctx: SlippageContext = {},
): { fillPrice: number; spreadCost: number; slippage: number } {
  const { fillPrice, spreadCost, slippage } = marketFillPrice(
    referencePrice,
    side,
    broker,
    ctx,
  );
  return {
    fillPrice,
    spreadCost,
    slippage,
  };
}

export function commissionFor(
  notional: number,
  broker: BrokerConfig,
): number {
  return brokerCommissionFor(notional, broker);
}

export type BrokerInputs = {
  request: OrderRequest;
  broker: BrokerConfig;
  cash: number;
  position?: Position;
  tradablePrice?: TradablePrice;
  currentTime: string;
  instrument?: Instrument;
  marketOpen?: boolean;
  candleVolumeNotional?: number;
  maxParticipationRate?: number;
  volatility?: number;
};

function orderFillProgress(
  quantity: number,
  fillPrice?: number,
  previousFilled = 0,
  previousAverage = 0,
) {
  const filledQuantity = previousFilled + quantity;
  const averageFillPrice =
    filledQuantity > 0 && fillPrice !== undefined
      ? (previousFilled * previousAverage + quantity * fillPrice) /
        filledQuantity
      : previousAverage;
  return {
    filledQuantity,
    averageFillPrice,
  };
}

function fillableQuantityFor(
  requestedQuantity: number,
  referencePrice: number,
  broker: BrokerConfig,
  candleVolumeNotional?: number,
): { quantity: number; participation?: number } {
  if (
    broker.partialFillPolicy !== "volume_limited" ||
    !broker.maxParticipationRate ||
    broker.maxParticipationRate <= 0 ||
    !candleVolumeNotional ||
    candleVolumeNotional <= 0 ||
    referencePrice <= 0
  ) {
    return { quantity: requestedQuantity };
  }

  const maxNotional = candleVolumeNotional * broker.maxParticipationRate;
  const maxQuantity = maxNotional / referencePrice;
  const quantity = Math.max(0, Math.min(requestedQuantity, maxQuantity));
  return {
    quantity,
    participation:
      candleVolumeNotional > 0 ? (quantity * referencePrice) / candleVolumeNotional : undefined,
  };
}

function statusForFill(
  normalizedQuantity: number,
  fillQuantity: number,
): Order["status"] {
  return fillQuantity + 1e-9 >= normalizedQuantity
    ? "filled"
    : "partially_filled";
}

export function executeMarketOrder(inputs: BrokerInputs): FillResult {
  const { request, broker, cash, position, tradablePrice, currentTime } =
    inputs;

  const order: Order = {
    id: generateId("ord"),
    createdAt: currentTime,
    symbol: request.symbol,
    side: request.side,
    type: "market",
    quantity: request.quantity,
    timeInForce: request.timeInForce ?? "day",
    status: "pending",
    note: request.note,
  };

  const normalizedQuantity = normalizeQuantity(
    request.quantity,
    broker,
    inputs.instrument,
  );
  const fillable = tradablePrice
    ? fillableQuantityFor(
        normalizedQuantity,
        tradablePrice.price,
        broker,
        inputs.candleVolumeNotional,
      )
    : { quantity: normalizedQuantity };
  const fillQuantity = fillable.quantity;
  const fillBreakdown = tradablePrice
    ? priceWithSpreadAndSlippage(tradablePrice.price, request.side, broker, {
        quantity: fillQuantity,
        candleVolumeNotional: inputs.candleVolumeNotional,
        volatility: inputs.volatility,
      })
    : undefined;
  const notional = fillBreakdown
    ? fillBreakdown.fillPrice * fillQuantity
    : 0;
  const commission = fillBreakdown ? commissionFor(notional, broker) : 0;
  const validation = validateMarketOrder({
    side: request.side,
    rawQuantity: request.quantity,
    normalizedQuantity: fillQuantity > 0 ? fillQuantity : normalizedQuantity,
    referencePrice: tradablePrice?.price ?? 0,
    executionPrice: fillBreakdown?.fillPrice,
    cash,
    fees: commission,
    position,
    broker,
    hasPrice: Boolean(tradablePrice),
    marketOpen: inputs.marketOpen,
    candleVolumeNotional: inputs.candleVolumeNotional,
    maxParticipationRate:
      broker.partialFillPolicy === "volume_limited"
        ? undefined
        : inputs.maxParticipationRate,
  });

  if (!validation.ok) {
    return {
      ok: false,
      order: {
        ...order,
        status: "rejected",
        rejectionCode: validation.code,
        rejectionReason: validation.message,
      },
      reason: validation.message,
    };
  }

  if (!tradablePrice || !fillBreakdown || fillQuantity <= 0) {
    return {
      ok: false,
      order: {
        ...order,
        status: "rejected",
        rejectionReason: "No tradable price at current replay time",
      },
      reason: "No tradable price at current replay time",
    };
  }

  const fillProgress = orderFillProgress(0, fillBreakdown.fillPrice);
  const fillStatus = statusForFill(normalizedQuantity, fillQuantity);

  const fill: Fill = {
    id: generateId("fil"),
    orderId: order.id,
    time: currentTime,
    symbol: request.symbol,
    side: request.side,
    quantity: fillQuantity,
    price: fillBreakdown.fillPrice,
    referencePrice: tradablePrice.price,
    commission,
    spreadCost: fillBreakdown.spreadCost,
    slippage: fillBreakdown.slippage,
    totalCost: notional + commission,
    reason: "user_order",
    liquidityParticipation: fillable.participation,
    executionPriceSource: "market",
    note: request.note,
  };

  return {
    ok: true,
    fill,
    order: {
      ...order,
      status: fillStatus,
      quantity: normalizedQuantity,
      remainingQuantity: Math.max(0, normalizedQuantity - fillQuantity),
      filledQuantity: fillQuantity,
      averageFillPrice:
        fillQuantity > 0 ? fillBreakdown.fillPrice : fillProgress.averageFillPrice,
      closedAt: currentTime,
    },
  };
}

export type LimitOrderInputs = {
  request: LimitOrderRequest;
  broker: BrokerConfig;
  cash: number;
  position?: Position;
  tradablePrice?: TradablePrice;
  currentTime: string;
  instrument?: Instrument;
  marketOpen?: boolean;
};

export type TriggerOrderInputs = Omit<LimitOrderInputs, "request"> & {
  request: TriggerOrderRequest;
};

export type PendingOrderInputs = Omit<LimitOrderInputs, "request"> & {
  request: PendingOrderRequest;
};

function isLimitOrderRequest(
  request: PendingOrderRequest,
): request is LimitOrderRequest {
  return request.type === "limit";
}

export function createLimitOrder(
  inputs: LimitOrderInputs,
): OrderPlacementResult {
  const { request, broker, cash, position, tradablePrice, currentTime } =
    inputs;
  const order: Order = {
    id: generateId("ord"),
    createdAt: currentTime,
    symbol: request.symbol,
    side: request.side,
    type: "limit",
    quantity: request.quantity,
    limitPrice: request.limitPrice,
    ocoGroupId: request.ocoGroupId,
    timeInForce: request.timeInForce ?? "gtc",
    expiresAt: request.expiresAt,
    remainingQuantity: request.quantity,
    filledQuantity: 0,
    status: "pending",
    note: request.note,
  };

  if (!Number.isFinite(request.limitPrice) || request.limitPrice <= 0) {
    return {
      ok: false,
      order: {
        ...order,
        status: "rejected",
        closedAt: currentTime,
        rejectionReason: "Invalid limit price",
      },
      reason: "Invalid limit price",
    };
  }

  const normalizedQuantity = normalizeQuantity(
    request.quantity,
    broker,
    inputs.instrument,
  );
  const notional = request.limitPrice * normalizedQuantity;
  const commission = commissionFor(notional, broker);
  const validation = validateMarketOrder({
    side: request.side,
    rawQuantity: request.quantity,
    normalizedQuantity,
    referencePrice: tradablePrice?.price ?? request.limitPrice,
    executionPrice: request.limitPrice,
    cash,
    fees: commission,
    position,
    broker,
    hasPrice: Boolean(tradablePrice),
    marketOpen: inputs.marketOpen,
  });

  if (!validation.ok) {
    return {
      ok: false,
      order: {
        ...order,
        status: "rejected",
        rejectionCode: validation.code,
        closedAt: currentTime,
        rejectionReason: validation.message,
      },
      reason: validation.message,
    };
  }

  return {
    ok: true,
    order: {
      ...order,
      quantity: normalizedQuantity,
      remainingQuantity: normalizedQuantity,
    },
  };
}

export function createTriggerOrder(
  inputs: TriggerOrderInputs,
): OrderPlacementResult {
  const { request, broker, cash, position, tradablePrice, currentTime } =
    inputs;
  const order: Order = {
    id: generateId("ord"),
    createdAt: currentTime,
    symbol: request.symbol,
    side: request.side,
    type: request.type,
    quantity: request.quantity,
    triggerPrice: request.triggerPrice,
    ocoGroupId: request.ocoGroupId,
    timeInForce: request.timeInForce ?? "gtc",
    expiresAt: request.expiresAt,
    remainingQuantity: request.quantity,
    filledQuantity: 0,
    status: "pending",
    note: request.note,
  };

  if (!Number.isFinite(request.triggerPrice) || request.triggerPrice <= 0) {
    return {
      ok: false,
      order: {
        ...order,
        status: "rejected",
        closedAt: currentTime,
        rejectionReason: "Invalid trigger price",
      },
      reason: "Invalid trigger price",
    };
  }

  const normalizedQuantity = normalizeQuantity(
    request.quantity,
    broker,
    inputs.instrument,
  );
  const notional = request.triggerPrice * normalizedQuantity;
  const commission = commissionFor(notional, broker);
  const validation = validateMarketOrder({
    side: request.side,
    rawQuantity: request.quantity,
    normalizedQuantity,
    referencePrice: tradablePrice?.price ?? request.triggerPrice,
    executionPrice: request.triggerPrice,
    cash,
    fees: commission,
    position,
    broker,
    hasPrice: Boolean(tradablePrice),
    marketOpen: inputs.marketOpen,
  });

  if (!validation.ok) {
    return {
      ok: false,
      order: {
        ...order,
        status: "rejected",
        rejectionCode: validation.code,
        closedAt: currentTime,
        rejectionReason: validation.message,
      },
      reason: validation.message,
    };
  }

  return {
    ok: true,
    order: {
      ...order,
      quantity: normalizedQuantity,
      remainingQuantity: normalizedQuantity,
    },
  };
}

export function createPendingOrder(
  inputs: PendingOrderInputs,
): OrderPlacementResult {
  const { request, ...context } = inputs;
  if (isLimitOrderRequest(request)) {
    return createLimitOrder({ ...context, request });
  }
  return createTriggerOrder({ ...context, request });
}

export type LimitFillInputs = {
  order: Order;
  broker: BrokerConfig;
  cash: number;
  position?: Position;
  currentTime: string;
  instrument?: Instrument;
  marketOpen?: boolean;
  candle?: Candle;
  candleVolumeNotional?: number;
};

export function executePendingOrderFill(inputs: LimitFillInputs): FillResult {
  const { order, broker, cash, position, currentTime } = inputs;
  const { fillPrice, priceSource } = pendingOrderFillPrice(
    order,
    broker,
    inputs.candle,
  );
  if (
    !["limit", "stop_loss", "take_profit"].includes(order.type) ||
    !Number.isFinite(fillPrice) ||
    fillPrice <= 0
  ) {
    return {
      ok: false,
      order: {
        ...order,
        status: "rejected",
        closedAt: currentTime,
        rejectionReason: "Invalid fill price",
      },
      reason: "Invalid fill price",
    };
  }
  const normalizedQuantity = normalizeQuantity(
    order.remainingQuantity ?? order.quantity,
    broker,
    inputs.instrument,
  );
  const fillable = fillableQuantityFor(
    normalizedQuantity,
    fillPrice,
    broker,
    inputs.candleVolumeNotional,
  );
  const fillQuantity = fillable.quantity;
  const notional = fillPrice * fillQuantity;
  const commission = commissionFor(notional, broker);
  const validation = validateMarketOrder({
    side: order.side,
    rawQuantity: order.remainingQuantity ?? order.quantity,
    normalizedQuantity: fillQuantity > 0 ? fillQuantity : normalizedQuantity,
    referencePrice: fillPrice,
    executionPrice: fillPrice,
    cash,
    fees: commission,
    position,
    broker,
    hasPrice: true,
    marketOpen: inputs.marketOpen,
  });
  if (!validation.ok) {
    return {
      ok: false,
      order: {
        ...order,
        status: "rejected",
        rejectionCode: validation.code,
        closedAt: currentTime,
        rejectionReason: validation.message,
      },
      reason: validation.message,
    };
  }

  if (fillQuantity <= 0) {
    return {
      ok: false,
      order: {
        ...order,
        status: "rejected",
        closedAt: currentTime,
        rejectionReason: "Insufficient liquidity for fill",
      },
      reason: "Insufficient liquidity for fill",
    };
  }

  const previousFilled = order.filledQuantity ?? 0;
  const previousAverage = order.averageFillPrice ?? 0;
  const progress = orderFillProgress(
    fillQuantity,
    fillPrice,
    previousFilled,
    previousAverage,
  );
  const totalQuantity = order.quantity;
  const remainingQuantity = Math.max(0, totalQuantity - progress.filledQuantity);
  const status = remainingQuantity <= 1e-9 ? "filled" : "partially_filled";

  const fill: Fill = {
    id: generateId("fil"),
    orderId: order.id,
    time: currentTime,
    symbol: order.symbol,
    side: order.side,
    quantity: fillQuantity,
    price: fillPrice,
    referencePrice:
      order.type === "limit" ? order.limitPrice ?? fillPrice : order.triggerPrice ?? fillPrice,
    commission,
    spreadCost: 0,
    slippage: 0,
    totalCost: notional + commission,
    reason: "working_order",
    liquidityParticipation: fillable.participation,
    executionPriceSource: priceSource,
    note: order.note,
  };

  return {
    ok: true,
    fill,
    order: {
      ...order,
      quantity: totalQuantity,
      remainingQuantity,
      filledQuantity: progress.filledQuantity,
      averageFillPrice: progress.averageFillPrice,
      triggeredAt: order.triggeredAt ?? currentTime,
      closedAt: status === "filled" ? currentTime : order.closedAt,
      status,
    },
  };
}

export function executeLimitOrderFill(inputs: LimitFillInputs): FillResult {
  return executePendingOrderFill(inputs);
}

export type LimitTriggerInput = {
  order: Order;
  high: number;
  low: number;
};

export function isPendingOrderTriggered(input: LimitTriggerInput): boolean {
  const { order, high, low } = input;
  if (order.status !== "pending" && order.status !== "partially_filled") {
    return false;
  }
  if (order.type === "limit") {
    const limit = order.limitPrice;
    if (!limit) return false;
    return order.side === "buy" ? low <= limit : high >= limit;
  }
  if (order.type === "stop_loss") {
    const trigger = order.triggerPrice;
    if (!trigger) return false;
    return order.side === "buy" ? high >= trigger : low <= trigger;
  }
  if (order.type === "take_profit") {
    const trigger = order.triggerPrice;
    if (!trigger) return false;
    return order.side === "buy" ? low <= trigger : high >= trigger;
  }
  return false;
}

export function isLimitOrderTriggered(input: LimitTriggerInput): boolean {
  return isPendingOrderTriggered(input);
}

function pendingOrderFillPrice(
  order: Order,
  broker: BrokerConfig,
  candle?: Candle,
): { fillPrice: number; priceSource: ExecutionPriceSource } {
  if (order.type === "limit") {
    return { fillPrice: order.limitPrice ?? 0, priceSource: "limit" };
  }
  const trigger = order.triggerPrice ?? 0;
  if (broker.stopFillPolicy !== "gap_open" || !candle) {
    return { fillPrice: trigger, priceSource: "stop_trigger" };
  }

  const gapped =
    (order.side === "sell" && candle.open <= trigger) ||
    (order.side === "buy" && candle.open >= trigger);
  if (gapped) {
    return { fillPrice: candle.open, priceSource: "gap_open" };
  }
  return { fillPrice: trigger, priceSource: "stop_trigger" };
}
