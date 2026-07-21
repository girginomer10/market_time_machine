import type { ScenarioPackage } from "../../types";
import { validateScenarioStrict } from "../../domain/scenario/loader";
import { scenarioReplayContractDataVersion } from "./dataVersions";
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

function hasAuthorDeclaredDataVersion(scenario: ScenarioPackage): boolean {
  return (
    typeof scenario.meta.dataVersion === "string" &&
    scenario.meta.dataVersion.trim().length > 0
  );
}

function deepFreezeScenario<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeScenario(child, seen);
  }
  return Object.freeze(value);
}

function withDerivedDataVersion(scenario: ScenarioPackage): ScenarioPackage {
  const copied = JSON.parse(JSON.stringify(scenario)) as ScenarioPackage;
  return deepFreezeScenario({
    ...copied,
    meta: {
      ...copied.meta,
      dataVersion: scenarioReplayContractDataVersion(copied),
    },
  });
}

function storedUserScenarios(): ScenarioPackage[] {
  if (typeof window === "undefined") return [];
  try {
    const serialized = window.localStorage.getItem(USER_SCENARIOS_STORAGE_KEY);
    if (!serialized) return [];
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    const packages = parsed.filter(isScenarioPackage);
    const idCounts = new Map<string, number>();
    for (const scenario of packages) {
      idCounts.set(scenario.meta.id, (idCounts.get(scenario.meta.id) ?? 0) + 1);
    }
    return packages
      .filter((scenario) => idCounts.get(scenario.meta.id) === 1)
      .filter(hasAuthorDeclaredDataVersion)
      .filter((scenario) => validateScenarioStrict(scenario).valid)
      .map(withDerivedDataVersion);
  } catch {
    return [];
  }
}

const scenarios = Object.values(scenarioModules)
  .flatMap((module) => Object.values(module).filter(isScenarioPackage))
  .sort((a, b) => a.meta.id.localeCompare(b.meta.id));

const bundledScenarioIds = new Set(
  scenarios.map((scenario) => scenario.meta.id),
);
const userScenarios = storedUserScenarios().filter(
  (scenario) => !bundledScenarioIds.has(scenario.meta.id),
);

export function buildScenarioRegistry(
  entries: ScenarioPackage[],
): Record<string, ScenarioPackage> {
  const registry = Object.create(null) as Record<string, ScenarioPackage>;
  for (const scenario of entries) {
    if (Object.prototype.hasOwnProperty.call(registry, scenario.meta.id)) {
      throw new Error(`Duplicate scenario id: ${scenario.meta.id}`);
    }
    registry[scenario.meta.id] = deepFreezeScenario(scenario);
  }
  return registry;
}

const mutableScenarioRegistry = buildScenarioRegistry([
  ...scenarios,
  ...userScenarios,
]);

export const scenarioRegistry: Readonly<Record<string, ScenarioPackage>> =
  new Proxy(mutableScenarioRegistry, {
    set: () => false,
    deleteProperty: () => false,
    defineProperty: () => false,
    setPrototypeOf: () => false,
    preventExtensions: () => false,
  });

export const defaultScenarioId = "eurgbp-brexit-2016";

export function getScenario(id: string): ScenarioPackage | undefined {
  return mutableScenarioRegistry[id];
}

export function listScenarios(): ScenarioPackage[] {
  return Object.values(mutableScenarioRegistry).sort((a, b) =>
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
  const entries = Object.values(mutableScenarioRegistry).filter(
    (scenario) => !bundledScenarioIds.has(scenario.meta.id),
  );
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(USER_SCENARIOS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        USER_SCENARIOS_STORAGE_KEY,
        JSON.stringify(entries),
      );
    }
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
      message:
        "The file is not a complete Market Time Machine scenario package.",
    };
  }
  if (!hasAuthorDeclaredDataVersion(candidate)) {
    return {
      ok: false,
      persisted: false,
      message:
        "Imported scenarios require a non-empty meta.dataVersion author label. After validation, the app replaces it with a content-derived SHA-256 identity so saved sessions restore against the exact data.",
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
  if (
    Object.prototype.hasOwnProperty.call(
      mutableScenarioRegistry,
      candidate.meta.id,
    )
  ) {
    return {
      ok: false,
      persisted: false,
      message: `An imported scenario with id "${candidate.meta.id}" already exists. Remove it before importing a replacement.`,
    };
  }

  const scenario = withDerivedDataVersion(candidate);
  mutableScenarioRegistry[candidate.meta.id] = scenario;
  const persisted = persistUserScenarios();
  return {
    ok: true,
    persisted,
    scenario,
    warnings: validation.warnings.map((issue) => issue.message),
    message: persisted
      ? "Scenario added to this browser."
      : "Scenario loaded for this visit, but browser storage could not retain it.",
  };
}

export type RemoveUserScenarioResult = {
  ok: boolean;
  persisted: boolean;
  message: string;
};

export function removeUserScenario(id: string): RemoveUserScenarioResult {
  if (bundledScenarioIds.has(id) || !mutableScenarioRegistry[id]) {
    return {
      ok: false,
      persisted: false,
      message: "That imported scenario is no longer available in this browser.",
    };
  }
  delete mutableScenarioRegistry[id];
  const persisted = persistUserScenarios();
  return {
    ok: true,
    persisted,
    message: persisted
      ? "Imported scenario removed from this browser."
      : "Imported scenario removed for this visit, but browser storage could not be updated; it may return after reload.",
  };
}

export function isUserScenario(id: string): boolean {
  return Boolean(mutableScenarioRegistry[id]) && !bundledScenarioIds.has(id);
}
