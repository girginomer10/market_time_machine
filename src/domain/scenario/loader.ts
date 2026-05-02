import type {
  BenchmarkPoint,
  Candle,
  IndicatorSnapshot,
  Instrument,
  MarketEvent,
  ScenarioPackage,
} from "../../types";
import type { BrokerConfig, ScenarioMeta } from "../../types/scenario";
import {
  validateScenarioPackage,
  type ValidationIssue,
  type ValidationResult,
} from "../validation/scenario";

export type RawScenarioFiles = {
  scenario: ScenarioMeta;
  instruments: Instrument[];
  candles: Candle[];
  events?: MarketEvent[];
  indicators?: IndicatorSnapshot[];
  benchmarks?: BenchmarkPoint[];
  broker: BrokerConfig;
};

export function assembleScenario(raw: RawScenarioFiles): ScenarioPackage {
  const sortedCandles = [...raw.candles].sort((a, b) => {
    const symbolOrder = a.symbol.localeCompare(b.symbol);
    if (symbolOrder !== 0) return symbolOrder;
    return a.closeTime.localeCompare(b.closeTime);
  });
  const sortedEvents = [...(raw.events ?? [])].sort((a, b) =>
    a.publishedAt.localeCompare(b.publishedAt),
  );
  const sortedIndicators = [...(raw.indicators ?? [])].sort((a, b) =>
    a.availableAt.localeCompare(b.availableAt),
  );
  const sortedBenchmarks = [...(raw.benchmarks ?? [])].sort((a, b) =>
    a.time.localeCompare(b.time),
  );

  return {
    meta: raw.scenario,
    instruments: raw.instruments,
    candles: sortedCandles,
    events: sortedEvents,
    indicators: sortedIndicators,
    benchmarks: sortedBenchmarks,
    broker: raw.broker,
  };
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
