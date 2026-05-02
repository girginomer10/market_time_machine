import type { BrokerConfig, Position } from "../../types";
import type { BrokerPresetName } from "./executionModels";

export type MarginPolicy = {
  initialMarginRate: number;
  maintenanceMarginRate: number;
  liquidationThreshold: number;
  borrowRateBps: number;
};

export const IDEAL_MARGIN_POLICY: MarginPolicy = {
  initialMarginRate: 1,
  maintenanceMarginRate: 1,
  liquidationThreshold: 0,
  borrowRateBps: 0,
};

export const REALISTIC_MARGIN_POLICY: MarginPolicy = {
  initialMarginRate: 0.5,
  maintenanceMarginRate: 0.25,
  liquidationThreshold: 0.2,
  borrowRateBps: 200,
};

export const HARSH_MARGIN_POLICY: MarginPolicy = {
  initialMarginRate: 0.5,
  maintenanceMarginRate: 0.3,
  liquidationThreshold: 0.25,
  borrowRateBps: 600,
};

export const MARGIN_POLICY_PRESETS: Record<BrokerPresetName, MarginPolicy> = {
  ideal: IDEAL_MARGIN_POLICY,
  realistic: REALISTIC_MARGIN_POLICY,
  harsh: HARSH_MARGIN_POLICY,
};

export function getMarginPolicyPreset(name: BrokerPresetName): MarginPolicy {
  return { ...MARGIN_POLICY_PRESETS[name] };
}

export function marginPolicyFromBroker(broker: BrokerConfig): MarginPolicy {
  const leverage = Math.max(1, broker.maxLeverage || 1);
  const initialMarginRate = 1 / leverage;
  const maintenanceMarginRate = Math.max(0.05, initialMarginRate / 2);
  const liquidationThreshold = Math.max(0, maintenanceMarginRate * 0.8);
  return {
    initialMarginRate,
    maintenanceMarginRate,
    liquidationThreshold,
    borrowRateBps: broker.borrowRateBps ?? 0,
  };
}

export function initialMarginRequired(
  notional: number,
  policy: MarginPolicy,
): number {
  return Math.abs(notional) * policy.initialMarginRate;
}

export function maintenanceMarginRequired(
  positionsNotional: number,
  policy: MarginPolicy,
): number {
  return Math.abs(positionsNotional) * policy.maintenanceMarginRate;
}

export function positionsGrossNotional(
  positions: Iterable<Position>,
): number {
  let total = 0;
  for (const p of positions) {
    total += Math.abs(p.marketValue);
  }
  return total;
}

export function accountEquity(
  cash: number,
  positionsNetValue: number,
): number {
  return cash + positionsNetValue;
}

export function marginUtilization(
  positionsGross: number,
  equity: number,
): number {
  if (equity <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(positionsGross) / equity;
}

export type MarginSnapshot = {
  cash: number;
  positionsGrossNotional: number;
  positionsNetValue: number;
  equity: number;
  initialMarginRequirement: number;
  maintenanceMarginRequirement: number;
  liquidationLevel: number;
  excessEquity: number;
  marginUtilization: number;
  isMarginCall: boolean;
  requiresLiquidation: boolean;
};

export type MarginSnapshotInputs = {
  cash: number;
  positionsGrossNotional: number;
  positionsNetValue: number;
  policy: MarginPolicy;
};

export function marginSnapshot(
  inputs: MarginSnapshotInputs,
): MarginSnapshot {
  const { cash, positionsGrossNotional: gross, positionsNetValue, policy } =
    inputs;
  const equity = accountEquity(cash, positionsNetValue);
  const initial = initialMarginRequired(gross, policy);
  const maintenance = maintenanceMarginRequired(gross, policy);
  const liquidationLevel = Math.abs(gross) * policy.liquidationThreshold;
  const utilization = marginUtilization(gross, equity);
  const hasExposure = gross > 0;
  return {
    cash,
    positionsGrossNotional: gross,
    positionsNetValue,
    equity,
    initialMarginRequirement: initial,
    maintenanceMarginRequirement: maintenance,
    liquidationLevel,
    excessEquity: equity - maintenance,
    marginUtilization: utilization,
    isMarginCall: hasExposure && equity < maintenance,
    requiresLiquidation: hasExposure && equity < liquidationLevel,
  };
}

export function isMarginCall(
  positionsGross: number,
  equity: number,
  policy: MarginPolicy,
): boolean {
  if (positionsGross <= 0) return false;
  return equity < maintenanceMarginRequired(positionsGross, policy);
}

export function requiresLiquidation(
  positionsGross: number,
  equity: number,
  policy: MarginPolicy,
): boolean {
  if (positionsGross <= 0) return false;
  return equity < Math.abs(positionsGross) * policy.liquidationThreshold;
}

export function borrowCostFor(
  notional: number,
  days: number,
  policy: MarginPolicy,
): number {
  if (notional <= 0 || days <= 0 || policy.borrowRateBps <= 0) return 0;
  const annualRate = policy.borrowRateBps / 10_000;
  return Math.abs(notional) * annualRate * (days / 365);
}

export function canOpenAdditionalNotional(
  inputs: MarginSnapshotInputs,
  additionalNotional: number,
): boolean {
  const snap = marginSnapshot(inputs);
  const additionalInitial = initialMarginRequired(
    additionalNotional,
    inputs.policy,
  );
  return snap.excessEquity >= additionalInitial;
}
