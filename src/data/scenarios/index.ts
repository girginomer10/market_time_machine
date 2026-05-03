import type { ScenarioPackage } from "../../types";

const scenarioModules = import.meta.glob<Record<string, unknown>>(
  "./*/index.ts",
  { eager: true },
);

function isScenarioPackage(value: unknown): value is ScenarioPackage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ScenarioPackage>;
  return (
    Boolean(candidate.meta?.id) &&
    Array.isArray(candidate.instruments) &&
    Array.isArray(candidate.candles) &&
    Array.isArray(candidate.events) &&
    Array.isArray(candidate.indicators) &&
    Array.isArray(candidate.benchmarks) &&
    Boolean(candidate.broker)
  );
}

const scenarios = Object.values(scenarioModules)
  .flatMap((module) => Object.values(module).filter(isScenarioPackage))
  .sort((a, b) => a.meta.id.localeCompare(b.meta.id));

export const scenarioRegistry: Record<string, ScenarioPackage> =
  Object.fromEntries(scenarios.map((scenario) => [scenario.meta.id, scenario]));

export const defaultScenarioId = "btc-2020-2021";

export function getScenario(id: string): ScenarioPackage | undefined {
  return scenarioRegistry[id];
}

export function listScenarios(): ScenarioPackage[] {
  return Object.values(scenarioRegistry);
}
