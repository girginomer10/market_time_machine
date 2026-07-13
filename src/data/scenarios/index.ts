import type { ScenarioPackage } from "../../types";
import { localScenarioModules } from "./localScenarioModules";

const shippedScenarioModules = import.meta.glob<Record<string, unknown>>(
  [
    "./btc-2020-2021/index.ts",
    "./sp500-covid-2020/index.ts",
    "./qqq-rate-hike-2022/index.ts",
    "./kre-banking-crisis-2023/index.ts",
  ],
  { eager: true },
);

const scenarioModules = {
  ...shippedScenarioModules,
  ...localScenarioModules,
};

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

export function buildScenarioRegistry(
  entries: ScenarioPackage[],
): Record<string, ScenarioPackage> {
  const registry: Record<string, ScenarioPackage> = {};
  for (const scenario of entries) {
    if (registry[scenario.meta.id]) {
      throw new Error(`Duplicate scenario id: ${scenario.meta.id}`);
    }
    registry[scenario.meta.id] = scenario;
  }
  return registry;
}

export const scenarioRegistry = buildScenarioRegistry(scenarios);

export const defaultScenarioId = "btc-2020-2021";

export function getScenario(id: string): ScenarioPackage | undefined {
  return scenarioRegistry[id];
}

export function listScenarios(): ScenarioPackage[] {
  return Object.values(scenarioRegistry);
}
