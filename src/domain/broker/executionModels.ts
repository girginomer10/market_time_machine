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

const BROKER_CONFIG_FINGERPRINT_PREFIX = "broker-config-v1:";

type BrokerConfigFingerprintPayload = {
  baseCurrency: string;
  commissionRateBps: number;
  fixedFee: number;
  spreadBps: number;
  slippageModel: SlippageModel;
  slippageBps: number | null;
  allowFractional: boolean;
  allowShort: boolean;
  maxLeverage: number;
  maxParticipationRate: number | null;
  partialFillPolicy: BrokerConfig["partialFillPolicy"] | null;
  stopFillPolicy: BrokerConfig["stopFillPolicy"] | null;
  marketHoursEnforced: boolean | null;
  marginCallPolicy: BrokerConfig["marginCallPolicy"] | null;
  borrowRateBps: number | null;
};

function brokerConfigFingerprintPayload(
  config: BrokerConfig,
): BrokerConfigFingerprintPayload {
  return {
    baseCurrency: config.baseCurrency,
    commissionRateBps: config.commissionRateBps,
    fixedFee: config.fixedFee,
    spreadBps: config.spreadBps,
    slippageModel: config.slippageModel,
    slippageBps: config.slippageBps ?? null,
    allowFractional: config.allowFractional,
    allowShort: config.allowShort,
    maxLeverage: config.maxLeverage,
    maxParticipationRate: config.maxParticipationRate ?? null,
    partialFillPolicy: config.partialFillPolicy ?? null,
    stopFillPolicy: config.stopFillPolicy ?? null,
    marketHoursEnforced: config.marketHoursEnforced ?? null,
    marginCallPolicy: config.marginCallPolicy ?? null,
    borrowRateBps: config.borrowRateBps ?? null,
  };
}

/**
 * Canonical, collision-free identity for every execution-setting field. The
 * full ordered payload is retained instead of a short client-side hash so a
 * configuration change can never compare equal through a hash collision.
 */
export function brokerConfigFingerprint(config: BrokerConfig): string {
  return `${BROKER_CONFIG_FINGERPRINT_PREFIX}${JSON.stringify(
    brokerConfigFingerprintPayload(config),
  )}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function optionalFiniteAtLeast(
  value: unknown,
  minimum: number,
): value is number | null {
  return value === null || finiteAtLeast(value, minimum);
}

/** Strictly accepts only the canonical v1 representation generated above. */
export function isBrokerConfigFingerprint(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value.startsWith(BROKER_CONFIG_FINGERPRINT_PREFIX)
  ) {
    return false;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(value.slice(BROKER_CONFIG_FINGERPRINT_PREFIX.length));
  } catch {
    return false;
  }
  if (!isRecord(payload)) return false;
  if (
    typeof payload.baseCurrency !== "string" ||
    payload.baseCurrency.trim().length === 0 ||
    !finiteAtLeast(payload.commissionRateBps, 0) ||
    !finiteAtLeast(payload.fixedFee, 0) ||
    !finiteAtLeast(payload.spreadBps, 0) ||
    !["none", "fixed_bps", "volume_based", "volatility_based"].includes(
      String(payload.slippageModel),
    ) ||
    !optionalFiniteAtLeast(payload.slippageBps, 0) ||
    typeof payload.allowFractional !== "boolean" ||
    typeof payload.allowShort !== "boolean" ||
    !finiteAtLeast(payload.maxLeverage, Number.MIN_VALUE) ||
    !optionalFiniteAtLeast(payload.maxParticipationRate, Number.MIN_VALUE) ||
    (payload.maxParticipationRate !== null &&
      Number(payload.maxParticipationRate) > 1) ||
    ![null, "disabled", "volume_limited"].includes(
      payload.partialFillPolicy as null | string,
    ) ||
    ![null, "trigger_price", "gap_open"].includes(
      payload.stopFillPolicy as null | string,
    ) ||
    (payload.marketHoursEnforced !== null &&
      typeof payload.marketHoursEnforced !== "boolean") ||
    ![null, "disabled", "liquidate_on_threshold", "reject_new_orders"].includes(
      payload.marginCallPolicy as null | string,
    ) ||
    !optionalFiniteAtLeast(payload.borrowRateBps, 0)
  ) {
    return false;
  }
  const config: BrokerConfig = {
    baseCurrency: payload.baseCurrency,
    commissionRateBps: payload.commissionRateBps,
    fixedFee: payload.fixedFee,
    spreadBps: payload.spreadBps,
    slippageModel: payload.slippageModel as SlippageModel,
    slippageBps:
      payload.slippageBps === null ? undefined : payload.slippageBps,
    allowFractional: payload.allowFractional,
    allowShort: payload.allowShort,
    maxLeverage: payload.maxLeverage,
    maxParticipationRate:
      payload.maxParticipationRate === null
        ? undefined
        : payload.maxParticipationRate,
    partialFillPolicy:
      payload.partialFillPolicy === null
        ? undefined
        : (payload.partialFillPolicy as BrokerConfig["partialFillPolicy"]),
    stopFillPolicy:
      payload.stopFillPolicy === null
        ? undefined
        : (payload.stopFillPolicy as BrokerConfig["stopFillPolicy"]),
    marketHoursEnforced:
      payload.marketHoursEnforced === null
        ? undefined
        : payload.marketHoursEnforced,
    marginCallPolicy:
      payload.marginCallPolicy === null
        ? undefined
        : (payload.marginCallPolicy as BrokerConfig["marginCallPolicy"]),
    borrowRateBps:
      payload.borrowRateBps === null ? undefined : payload.borrowRateBps,
  };
  return brokerConfigFingerprint(config) === value;
}

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
