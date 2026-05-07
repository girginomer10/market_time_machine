import type { BrokerConfig, OrderSide, SlippageModel } from "../../types";

export const BPS_PER_UNIT = 10_000;

export const IDEAL_BROKER_CONFIG: BrokerConfig = {
  baseCurrency: "USD",
  commissionRateBps: 0,
  fixedFee: 0,
  spreadBps: 0,
  slippageModel: "none",
  slippageBps: 0,
  allowFractional: true,
  allowShort: false,
  maxLeverage: 1,
  maxParticipationRate: 1,
  partialFillPolicy: "disabled",
  stopFillPolicy: "trigger_price",
  marketHoursEnforced: false,
  marginCallPolicy: "disabled",
  borrowRateBps: 0,
};

export const REALISTIC_BROKER_CONFIG: BrokerConfig = {
  baseCurrency: "USD",
  commissionRateBps: 5,
  fixedFee: 0,
  spreadBps: 5,
  slippageModel: "fixed_bps",
  slippageBps: 3,
  allowFractional: true,
  allowShort: true,
  maxLeverage: 2,
  maxParticipationRate: 0.1,
  partialFillPolicy: "volume_limited",
  stopFillPolicy: "gap_open",
  marketHoursEnforced: true,
  marginCallPolicy: "reject_new_orders",
  borrowRateBps: 200,
};

export const HARSH_BROKER_CONFIG: BrokerConfig = {
  baseCurrency: "USD",
  commissionRateBps: 10,
  fixedFee: 1,
  spreadBps: 15,
  slippageModel: "volatility_based",
  slippageBps: 12,
  allowFractional: false,
  allowShort: true,
  maxLeverage: 4,
  maxParticipationRate: 0.05,
  partialFillPolicy: "volume_limited",
  stopFillPolicy: "gap_open",
  marketHoursEnforced: true,
  marginCallPolicy: "liquidate_on_threshold",
  borrowRateBps: 600,
};

export const BROKER_PRESETS = {
  ideal: IDEAL_BROKER_CONFIG,
  realistic: REALISTIC_BROKER_CONFIG,
  harsh: HARSH_BROKER_CONFIG,
} as const;

export type BrokerPresetName = keyof typeof BROKER_PRESETS;

export function getBrokerPreset(name: BrokerPresetName): BrokerConfig {
  return { ...BROKER_PRESETS[name] };
}

export function isBrokerPresetName(value: string): value is BrokerPresetName {
  return value === "ideal" || value === "realistic" || value === "harsh";
}

export type SlippageContext = {
  quantity?: number;
  candleVolumeNotional?: number;
  volatility?: number;
};

export function slippageBpsFor(
  model: SlippageModel,
  baseSlippageBps: number,
  referencePrice: number,
  ctx: SlippageContext = {},
): number {
  switch (model) {
    case "none":
      return 0;
    case "fixed_bps":
      return baseSlippageBps;
    case "volume_based": {
      const { quantity, candleVolumeNotional } = ctx;
      if (
        !quantity ||
        !candleVolumeNotional ||
        candleVolumeNotional <= 0 ||
        !Number.isFinite(referencePrice)
      ) {
        return baseSlippageBps;
      }
      const orderNotional = quantity * referencePrice;
      const participation = orderNotional / candleVolumeNotional;
      const clamped = Math.max(0, Math.min(participation, 1));
      return baseSlippageBps * (1 + clamped * 9);
    }
    case "volatility_based": {
      const sigma = Math.max(0, ctx.volatility ?? 0);
      return baseSlippageBps * (1 + sigma * 100);
    }
  }
}

export type FillPriceBreakdown = {
  fillPrice: number;
  spreadCost: number;
  slippage: number;
  effectiveSpreadBps: number;
  effectiveSlippageBps: number;
};

export function marketFillPrice(
  referencePrice: number,
  side: OrderSide,
  broker: BrokerConfig,
  ctx: SlippageContext = {},
): FillPriceBreakdown {
  const halfSpreadFraction = broker.spreadBps / 2 / BPS_PER_UNIT;
  const spreadCost = referencePrice * halfSpreadFraction;
  const baseSlippageBps = broker.slippageBps ?? 0;
  const effectiveSlippageBps = slippageBpsFor(
    broker.slippageModel,
    baseSlippageBps,
    referencePrice,
    ctx,
  );
  const slippage = referencePrice * (effectiveSlippageBps / BPS_PER_UNIT);
  const sign = side === "buy" ? 1 : -1;
  const fillPrice = referencePrice + sign * (spreadCost + slippage);
  return {
    fillPrice,
    spreadCost,
    slippage,
    effectiveSpreadBps: broker.spreadBps,
    effectiveSlippageBps,
  };
}

export function commissionFor(notional: number, broker: BrokerConfig): number {
  return notional * (broker.commissionRateBps / BPS_PER_UNIT) + broker.fixedFee;
}
