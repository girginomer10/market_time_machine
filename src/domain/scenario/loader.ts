import type {
  BenchmarkPoint,
  Candle,
  IndicatorSnapshot,
  Instrument,
  CorporateAction,
  DrillDefinition,
  MarketCalendar,
  MarketEvent,
  ScenarioPackage,
} from "../../types";
import type { BrokerConfig, ScenarioMeta } from "../../types/scenario";
import { compareTimestamps } from "../replay/timestamps";
import {
  validateScenarioPackage,
  type ValidationIssue,
  type ValidationResult,
} from "../validation/scenario";
import { parseScenarioDrillDefinitions } from "../practice/drillAuthoring";

export type RawScenarioFiles = {
  scenario: ScenarioMeta;
  instruments: Instrument[];
  candles: Candle[];
  events?: MarketEvent[];
  indicators?: IndicatorSnapshot[];
  benchmarks?: BenchmarkPoint[];
  broker: BrokerConfig;
  marketCalendar?: MarketCalendar;
  corporateActions?: CorporateAction[];
  drills?: DrillDefinition[];
};

export function assembleScenario(raw: RawScenarioFiles): ScenarioPackage {
  const sortedCandles = [...raw.candles].sort((a, b) => {
    const symbolOrder = a.symbol.localeCompare(b.symbol);
    if (symbolOrder !== 0) return symbolOrder;
    return compareTimestamps(a.closeTime, b.closeTime);
  });
  const sortedEvents = [...(raw.events ?? [])].sort((a, b) =>
    compareTimestamps(a.publishedAt, b.publishedAt),
  );
  const sortedIndicators = [...(raw.indicators ?? [])].sort((a, b) =>
    compareTimestamps(a.availableAt, b.availableAt),
  );
  const sortedBenchmarks = [...(raw.benchmarks ?? [])].sort((a, b) =>
    compareTimestamps(a.time, b.time),
  );
  const sortedCorporateActions = [...(raw.corporateActions ?? [])].sort(
    (a, b) => compareTimestamps(a.effectiveAt, b.effectiveAt),
  );

  const assembled: ScenarioPackage = {
    meta: raw.scenario,
    instruments: raw.instruments,
    candles: sortedCandles,
    events: sortedEvents,
    indicators: sortedIndicators,
    benchmarks: sortedBenchmarks,
    broker: raw.broker,
    marketCalendar: raw.marketCalendar,
    corporateActions: sortedCorporateActions,
  };
  const authoredDrills = parseScenarioDrillDefinitions(raw.drills, assembled);
  if (!authoredDrills.valid) {
    const detail = authoredDrills.issues
      .map((issue) => `${issue.code} @ ${issue.path}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Scenario "${raw.scenario.id}" has invalid authored drill definitions:\n${detail}`,
    );
  }
  return raw.drills === undefined
    ? assembled
    : { ...assembled, drills: authoredDrills.drills };
}

export type ScenarioValidationIssue = ValidationIssue;

export function validateScenario(
  scenario: ScenarioPackage,
): ScenarioValidationIssue[] {
  return validateScenarioPackage(scenario).issues;
}

export function validateScenarioStrict(
  scenario: ScenarioPackage,
): ValidationResult {
  return validateScenarioPackage(scenario);
}

export function assertScenarioValid(scenario: ScenarioPackage): void {
  const result = validateScenarioPackage(scenario);
  if (!result.valid) {
    const detail = result.errors
      .map((e) => `${e.code}${e.path ? ` @ ${e.path}` : ""}: ${e.message}`)
      .join("\n");
    throw new Error(
      `Scenario "${scenario.meta.id}" failed validation with ${result.errors.length} error(s):\n${detail}`,
    );
  }
}
