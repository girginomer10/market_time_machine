import type { ScenarioPackage } from "../../types";
import { btc20202021Scenario } from "./btc-2020-2021";

export const scenarioRegistry: Record<string, ScenarioPackage> = {
  [btc20202021Scenario.meta.id]: btc20202021Scenario,
};

export const defaultScenarioId = btc20202021Scenario.meta.id;

export function getScenario(id: string): ScenarioPackage | undefined {
  return scenarioRegistry[id];
}

export function listScenarios(): ScenarioPackage[] {
  return Object.values(scenarioRegistry);
}
