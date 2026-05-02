import type {
  BrokerConfig,
  Fill,
  Instrument,
  Order,
  OrderSide,
  Position,
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
  note?: string;
};

export type LimitOrderRequest = {
  symbol: string;
  side: OrderSide;
  type: "limit";
  quantity: number;
  limitPrice: number;
  note?: string;
};

export type OrderRequest = MarketOrderRequest;
export type PendingOrderRequest = LimitOrderRequest;

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
    status: "pending",
    note: request.note,
  };

  const normalizedQuantity = normalizeQuantity(
    request.quantity,
    broker,
    inputs.instrument,
  );
  const fillBreakdown = tradablePrice
    ? priceWithSpreadAndSlippage(tradablePrice.price, request.side, broker, {
        quantity: normalizedQuantity,
        candleVolumeNotional: inputs.candleVolumeNotional,
        volatility: inputs.volatility,
      })
    : undefined;
  const notional = fillBreakdown
    ? fillBreakdown.fillPrice * normalizedQuantity
    : 0;
  const commission = fillBreakdown ? commissionFor(notional, broker) : 0;
  const validation = validateMarketOrder({
    side: request.side,
    rawQuantity: request.quantity,
    normalizedQuantity,
    referencePrice: tradablePrice?.price ?? 0,
    executionPrice: fillBreakdown?.fillPrice,
    cash,
    fees: commission,
    position,
    broker,
    hasPrice: Boolean(tradablePrice),
    marketOpen: inputs.marketOpen,
    candleVolumeNotional: inputs.candleVolumeNotional,
    maxParticipationRate: inputs.maxParticipationRate,
  });

  if (!validation.ok) {
    return {
      ok: false,
      order: {
        ...order,
        status: "rejected",
        rejectionReason: validation.message,
      },
      reason: validation.message,
    };
  }

  if (!tradablePrice || !fillBreakdown) {
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

  const fill: Fill = {
    id: generateId("fil"),
    orderId: order.id,
    time: currentTime,
    symbol: request.symbol,
    side: request.side,
    quantity: normalizedQuantity,
    price: fillBreakdown.fillPrice,
    referencePrice: tradablePrice.price,
    commission,
    spreadCost: fillBreakdown.spreadCost,
    slippage: fillBreakdown.slippage,
    totalCost: notional + commission,
    note: request.note,
  };

  return {
    ok: true,
    fill,
    order: { ...order, status: "filled", quantity: normalizedQuantity },
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
    status: "pending",
    note: request.note,
  };

  if (!Number.isFinite(request.limitPrice) || request.limitPrice <= 0) {
    return {
      ok: false,
      order: {
        ...order,
        status: "rejected",
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
    },
  };
}

export type LimitFillInputs = {
  order: Order;
  broker: BrokerConfig;
  cash: number;
  position?: Position;
  currentTime: string;
  instrument?: Instrument;
  marketOpen?: boolean;
};

export function executeLimitOrderFill(inputs: LimitFillInputs): FillResult {
  const { order, broker, cash, position, currentTime } = inputs;
  const limitPrice = order.limitPrice ?? 0;
  if (order.type !== "limit" || !Number.isFinite(limitPrice) || limitPrice <= 0) {
    return {
      ok: false,
      order: {
        ...order,
        status: "rejected",
        rejectionReason: "Invalid limit price",
      },
      reason: "Invalid limit price",
    };
  }
  const normalizedQuantity = normalizeQuantity(
    order.quantity,
    broker,
    inputs.instrument,
  );
  const notional = limitPrice * normalizedQuantity;
  const commission = commissionFor(notional, broker);
  const validation = validateMarketOrder({
    side: order.side,
    rawQuantity: order.quantity,
    normalizedQuantity,
    referencePrice: limitPrice,
    executionPrice: limitPrice,
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
        rejectionReason: validation.message,
      },
      reason: validation.message,
    };
  }

  const fill: Fill = {
    id: generateId("fil"),
    orderId: order.id,
    time: currentTime,
    symbol: order.symbol,
    side: order.side,
    quantity: normalizedQuantity,
    price: limitPrice,
    referencePrice: limitPrice,
    commission,
    spreadCost: 0,
    slippage: 0,
    totalCost: notional + commission,
    note: order.note,
  };

  return {
    ok: true,
    fill,
    order: {
      ...order,
      quantity: normalizedQuantity,
      status: "filled",
    },
  };
}

export type LimitTriggerInput = {
  order: Order;
  high: number;
  low: number;
};

export function isLimitOrderTriggered(input: LimitTriggerInput): boolean {
  const { order, high, low } = input;
  if (order.status !== "pending" || order.type !== "limit") return false;
  const limit = order.limitPrice;
  if (!limit) return false;
  return order.side === "buy" ? low <= limit : high >= limit;
}
