import type { ScenarioPackage } from "../../types";
import { validateScenarioStrict } from "../../domain/scenario/loader";
import { localScenarioModules } from "./localScenarioModules";

const USER_SCENARIOS_STORAGE_KEY = "market-time-machine.user-scenarios.v1";

const shippedScenarioModules = import.meta.glob<Record<string, unknown>>(
  [
    "./btc-2020-2021/index.ts",
    "./eurgbp-brexit-2016/index.ts",
    "./eurusd-covid-liquidity-2020/index.ts",
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

export function isScenarioPackage(value: unknown): value is ScenarioPackage {
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

function storedUserScenarios(): ScenarioPackage[] {
  if (typeof window === "undefined") return [];
  try {
    const serialized = window.localStorage.getItem(USER_SCENARIOS_STORAGE_KEY);
    if (!serialized) return [];
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isScenarioPackage).filter((scenario) =>
      validateScenarioStrict(scenario).valid,
    );
  } catch {
    return [];
  }
}

const scenarios = Object.values(scenarioModules)
  .flatMap((module) => Object.values(module).filter(isScenarioPackage))
  .sort((a, b) => a.meta.id.localeCompare(b.meta.id));

const bundledScenarioIds = new Set(scenarios.map((scenario) => scenario.meta.id));
const userScenarios = storedUserScenarios().filter(
  (scenario) => !bundledScenarioIds.has(scenario.meta.id),
);

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

export const scenarioRegistry = buildScenarioRegistry([
  ...scenarios,
  ...userScenarios,
]);

export const defaultScenarioId = "eurgbp-brexit-2016";

export function getScenario(id: string): ScenarioPackage | undefined {
  return scenarioRegistry[id];
}

export function listScenarios(): ScenarioPackage[] {
  return Object.values(scenarioRegistry).sort((a, b) =>
    a.meta.title.localeCompare(b.meta.title),
  );
}

export type RegisterUserScenarioResult = {
  ok: boolean;
  persisted: boolean;
  scenario?: ScenarioPackage;
  message?: string;
  warnings?: string[];
};

function persistUserScenarios(): boolean {
  if (typeof window === "undefined") return false;
  const entries = Object.values(scenarioRegistry).filter(
    (scenario) => !bundledScenarioIds.has(scenario.meta.id),
  );
  try {
    window.localStorage.setItem(
      USER_SCENARIOS_STORAGE_KEY,
      JSON.stringify(entries),
    );
    return true;
  } catch {
    return false;
  }
}

export function registerUserScenario(
  candidate: unknown,
): RegisterUserScenarioResult {
  if (!isScenarioPackage(candidate)) {
    return {
      ok: false,
      persisted: false,
      message: "The file is not a complete Market Time Machine scenario package.",
    };
  }
  const validation = validateScenarioStrict(candidate);
  if (!validation.valid) {
    return {
      ok: false,
      persisted: false,
      message: validation.errors
        .slice(0, 5)
        .map((issue) => `${issue.path || issue.code}: ${issue.message}`)
        .join(" "),
    };
  }
  if (bundledScenarioIds.has(candidate.meta.id)) {
    return {
      ok: false,
      persisted: false,
      message: `The bundled scenario id "${candidate.meta.id}" cannot be replaced.`,
    };
  }

  scenarioRegistry[candidate.meta.id] = candidate;
  const persisted = persistUserScenarios();
  return {
    ok: true,
    persisted,
    scenario: candidate,
    warnings: validation.warnings.map((issue) => issue.message),
    message: persisted
      ? "Scenario added to this browser."
      : "Scenario loaded for this visit, but browser storage could not retain it.",
  };
}

export function removeUserScenario(id: string): boolean {
  if (bundledScenarioIds.has(id) || !scenarioRegistry[id]) return false;
  delete scenarioRegistry[id];
  persistUserScenarios();
  return true;
}

export function isUserScenario(id: string): boolean {
  return Boolean(scenarioRegistry[id]) && !bundledScenarioIds.has(id);
}
