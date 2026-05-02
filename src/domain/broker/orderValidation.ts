import type {
  BrokerConfig,
  Instrument,
  OrderSide,
  Position,
} from "../../types";

export const REJECTION_REASONS = {
  INVALID_QUANTITY: "Invalid quantity",
  NO_TRADABLE_PRICE: "No tradable price at current replay time",
  INSTRUMENT_NOT_TRADABLE: "Instrument not tradable",
  MARKET_CLOSED: "Market closed",
  QUANTITY_BELOW_LOT_SIZE: "Quantity below lot size",
  INSUFFICIENT_CASH: "Insufficient cash",
  INSUFFICIENT_POSITION: "Insufficient position",
  SHORTING_DISABLED: "Shorting disabled",
  EXCEEDS_LEVERAGE: "Exceeds leverage",
  EXCEEDS_LIQUIDITY_LIMIT: "Exceeds liquidity limit",
} as const;

export type RejectionReasonCode = keyof typeof REJECTION_REASONS;
export type RejectionReasonMessage =
  (typeof REJECTION_REASONS)[RejectionReasonCode];

export type ValidationOk = { ok: true };
export type ValidationFail = {
  ok: false;
  code: RejectionReasonCode;
  message: RejectionReasonMessage;
};
export type ValidationResult = ValidationOk | ValidationFail;

const QUANTITY_EPSILON = 1e-9;

export function rejection(code: RejectionReasonCode): ValidationFail {
  return { ok: false, code, message: REJECTION_REASONS[code] };
}

export const ok: ValidationOk = { ok: true };

export function checkQuantity(quantity: number): ValidationResult {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return rejection("INVALID_QUANTITY");
  }
  return ok;
}

export function normalizeQuantity(
  quantity: number,
  broker: BrokerConfig,
  instrument?: Instrument,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 0;
  }
  const lotSize = instrument?.lotSize;
  const allowFractional = instrument?.allowFractional ?? broker.allowFractional;
  if (allowFractional && (!lotSize || lotSize <= 0)) {
    return quantity;
  }
  if (lotSize && lotSize > 0) {
    return Math.floor(quantity / lotSize) * lotSize;
  }
  return Math.floor(quantity);
}

export function checkLotSize(normalizedQuantity: number): ValidationResult {
  if (normalizedQuantity <= 0) {
    return rejection("QUANTITY_BELOW_LOT_SIZE");
  }
  return ok;
}

export type BuyingPowerInputs = {
  cash: number;
  notional: number;
  fees: number;
  broker: BrokerConfig;
};

export function buyingPower(cash: number, broker: BrokerConfig): number {
  const leverage = Math.max(1, broker.maxLeverage || 1);
  return Math.max(0, cash) * leverage;
}

export function checkBuyingPower(inputs: BuyingPowerInputs): ValidationResult {
  const { cash, notional, fees, broker } = inputs;
  const totalCost = notional + fees;
  if (totalCost <= cash + QUANTITY_EPSILON) {
    return ok;
  }
  const leverage = Math.max(1, broker.maxLeverage || 1);
  if (leverage <= 1) {
    return rejection("INSUFFICIENT_CASH");
  }
  const power = buyingPower(cash, broker);
  if (totalCost <= power + QUANTITY_EPSILON) {
    return ok;
  }
  return rejection("EXCEEDS_LEVERAGE");
}

export type LongShortInputs = {
  side: OrderSide;
  quantity: number;
  position?: Position;
  broker: BrokerConfig;
};

export function checkLongShortConstraint(
  inputs: LongShortInputs,
): ValidationResult {
  const { side, quantity, position, broker } = inputs;
  if (side !== "sell") {
    return ok;
  }
  const held = position?.quantity ?? 0;
  if (held + QUANTITY_EPSILON >= quantity) {
    return ok;
  }
  if (broker.allowShort) {
    return ok;
  }
  if (held > QUANTITY_EPSILON) {
    return rejection("INSUFFICIENT_POSITION");
  }
  return rejection("SHORTING_DISABLED");
}

export type LiquidityInputs = {
  quantity: number;
  referencePrice: number;
  candleVolumeNotional?: number;
  maxParticipationRate?: number;
};

export function checkLiquidity(inputs: LiquidityInputs): ValidationResult {
  const { quantity, referencePrice, candleVolumeNotional, maxParticipationRate } =
    inputs;
  if (
    !candleVolumeNotional ||
    candleVolumeNotional <= 0 ||
    !maxParticipationRate ||
    maxParticipationRate <= 0
  ) {
    return ok;
  }
  const orderNotional = quantity * referencePrice;
  const limit = candleVolumeNotional * maxParticipationRate;
  if (orderNotional > limit + QUANTITY_EPSILON) {
    return rejection("EXCEEDS_LIQUIDITY_LIMIT");
  }
  return ok;
}

export type TradabilityInputs = {
  hasPrice: boolean;
  marketOpen?: boolean;
};

export function checkTradability(inputs: TradabilityInputs): ValidationResult {
  if (!inputs.hasPrice) {
    return rejection("NO_TRADABLE_PRICE");
  }
  if (inputs.marketOpen === false) {
    return rejection("MARKET_CLOSED");
  }
  return ok;
}

export type MarketOrderValidationInputs = {
  side: OrderSide;
  rawQuantity: number;
  normalizedQuantity: number;
  referencePrice: number;
  executionPrice?: number;
  cash: number;
  fees: number;
  position?: Position;
  broker: BrokerConfig;
  hasPrice: boolean;
  marketOpen?: boolean;
  candleVolumeNotional?: number;
  maxParticipationRate?: number;
};

export function validateMarketOrder(
  inputs: MarketOrderValidationInputs,
): ValidationResult {
  const tradability = checkTradability({
    hasPrice: inputs.hasPrice,
    marketOpen: inputs.marketOpen,
  });
  if (!tradability.ok) return tradability;

  const quantity = checkQuantity(inputs.rawQuantity);
  if (!quantity.ok) return quantity;

  const lot = checkLotSize(inputs.normalizedQuantity);
  if (!lot.ok) return lot;

  if (inputs.side === "buy") {
    const notionalPrice = inputs.executionPrice ?? inputs.referencePrice;
    const power = checkBuyingPower({
      cash: inputs.cash,
      notional: inputs.normalizedQuantity * notionalPrice,
      fees: inputs.fees,
      broker: inputs.broker,
    });
    if (!power.ok) return power;
  } else {
    const longShort = checkLongShortConstraint({
      side: inputs.side,
      quantity: inputs.normalizedQuantity,
      position: inputs.position,
      broker: inputs.broker,
    });
    if (!longShort.ok) return longShort;

    const held = Math.max(0, inputs.position?.quantity ?? 0);
    const shortQuantity = Math.max(0, inputs.normalizedQuantity - held);
    if (shortQuantity > QUANTITY_EPSILON) {
      const notionalPrice = inputs.executionPrice ?? inputs.referencePrice;
      const power = checkBuyingPower({
        cash: inputs.cash,
        notional: shortQuantity * notionalPrice,
        fees: inputs.fees,
        broker: inputs.broker,
      });
      if (!power.ok) return power;
    }
  }

  const liquidity = checkLiquidity({
    quantity: inputs.normalizedQuantity,
    referencePrice: inputs.referencePrice,
    candleVolumeNotional: inputs.candleVolumeNotional,
    maxParticipationRate: inputs.maxParticipationRate,
  });
  if (!liquidity.ok) return liquidity;

  return ok;
}
