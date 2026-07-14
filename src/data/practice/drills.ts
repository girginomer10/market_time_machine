import { parseScenarioDrillDefinitions } from "../../domain/practice/drillAuthoring";
import { validateDrillDefinition } from "../../domain/practice/drills";
import type { DrillDefinition, ScenarioPackage } from "../../types";

export const EVENT_DISCIPLINE_EURGBP_V1_ID =
  "event-discipline-eurgbp-v1" as const;
export const EVENT_DISCIPLINE_EURUSD_V1_ID =
  "event-discipline-eurusd-v1" as const;
export const EVENT_DISCIPLINE_QQQ_V1_ID =
  "event-discipline-qqq-v1" as const;
export const EVENT_DISCIPLINE_KRE_V1_ID =
  "event-discipline-kre-v1" as const;
export const EVENT_DISCIPLINE_COMPETENCY_ID = "event-discipline" as const;

type EventDisciplineIdentity = Pick<
  DrillDefinition,
  "id" | "title" | "description" | "scenarioId" | "primarySymbol"
>;

function defineEventDisciplineDrill(
  identity: EventDisciplineIdentity,
): DrillDefinition {
  return {
    ...identity,
    competencyId: EVENT_DISCIPLINE_COMPETENCY_ID,
    definitionVersion: 1,
    rubricVersion: "event-discipline-process-v1",
    mode: "explorer",
    initialPlanRule: {
      requiredBeforeFirstOrder: true,
      requiredFields: [
        "thesis",
        "invalidation",
        "exitPlan",
        "acceptedRisk",
      ],
    },
    checkpointRule: {
      minimumImportance: 4,
      mapping: "next_primary_candle_close",
      groupSameReplayIndex: true,
      requireReflection: true,
      actions: ["hold", "reduce", "exit", "wait"],
    },
    rubric: {
      weights: {
        plan_coverage: 0.3,
        checkpoint_coverage: 0.3,
        event_linkage: 0.2,
        rule_adherence: 0.2,
      },
      violationPenalty: 20,
    },
  };
}

export const eventDisciplineEurGbpV1 = defineEventDisciplineDrill({
  id: EVENT_DISCIPLINE_EURGBP_V1_ID,
  title: "EUR/GBP Brexit — Event Discipline",
  description:
    "Write the complete initial plan, then make an explicit process decision whenever high-importance Brexit or Bank of England information becomes visible.",
  scenarioId: "eurgbp-brexit-2016",
  primarySymbol: "EURGBP",
});

export const eventDisciplineEurUsdV1 = defineEventDisciplineDrill({
  id: EVENT_DISCIPLINE_EURUSD_V1_ID,
  title: "EUR/USD COVID Liquidity — Event Discipline",
  description:
    "Apply the same event-response process while public-health, dollar-funding, Federal Reserve, and ECB information arrives in rapid succession.",
  scenarioId: "eurusd-covid-liquidity-2020",
  primarySymbol: "EURUSD",
});

export const eventDisciplineQqqV1 = defineEventDisciplineDrill({
  id: EVENT_DISCIPLINE_QQQ_V1_ID,
  title: "QQQ Rate Shock — Event Discipline",
  description:
    "Practice explicit process decisions around official inflation and Federal Reserve releases using the synthetic QQQ market path.",
  scenarioId: "qqq-rate-hike-2022",
  primarySymbol: "QQQ",
});

export const eventDisciplineKreV1 = defineEventDisciplineDrill({
  id: EVENT_DISCIPLINE_KRE_V1_ID,
  title: "KRE Banking Crisis — Event Discipline",
  description:
    "Practice explicit process decisions around official bank-resolution and policy releases using the synthetic KRE market path.",
  scenarioId: "kre-banking-crisis-2023",
  primarySymbol: "KRE",
});

const BUILT_IN_DRILLS: readonly DrillDefinition[] = [
  eventDisciplineEurGbpV1,
  eventDisciplineEurUsdV1,
  eventDisciplineQqqV1,
  eventDisciplineKreV1,
];

export function listBuiltInDrills(): DrillDefinition[] {
  return [...BUILT_IN_DRILLS];
}

export function getBuiltInDrill(id: string): DrillDefinition | undefined {
  return BUILT_IN_DRILLS.find((definition) => definition.id === id);
}

/**
 * Lists playable definitions for the supplied scenario packages. Authored
 * definitions are scenario-scoped and never mutate the built-in catalog used
 * by curated practice-track validation.
 */
export function listAvailableDrills(
  scenarios: readonly ScenarioPackage[],
): DrillDefinition[] {
  const scenarioById = new Map(
    scenarios.map((scenario) => [scenario.meta.id, scenario]),
  );
  const reservedBuiltInIds = new Set(
    BUILT_IN_DRILLS.map((definition) => definition.id),
  );
  const available = BUILT_IN_DRILLS.filter((definition) => {
    const scenario = scenarioById.get(definition.scenarioId);
    return Boolean(
      scenario && validateDrillDefinition(definition, scenario).valid,
    );
  });
  const seenAuthoredReferences = new Set<string>();

  for (const scenario of scenarios) {
    const authored = parseScenarioDrillDefinitions(scenario.drills, scenario);
    if (!authored.valid) continue;
    for (const definition of authored.drills) {
      if (reservedBuiltInIds.has(definition.id)) continue;
      const reference = `${scenario.meta.id}|${definition.id}|${definition.definitionVersion}`;
      if (seenAuthoredReferences.has(reference)) continue;
      seenAuthoredReferences.add(reference);
      available.push(definition);
    }
  }
  return available;
}

export function getDrillForScenario(
  id: string,
  scenario: ScenarioPackage,
): DrillDefinition | undefined {
  const builtIn = getBuiltInDrill(id);
  if (builtIn) {
    return builtIn.scenarioId === scenario.meta.id &&
      validateDrillDefinition(builtIn, scenario).valid
      ? builtIn
      : undefined;
  }
  const authored = parseScenarioDrillDefinitions(scenario.drills, scenario);
  if (!authored.valid) return undefined;
  return authored.drills.find((definition) => definition.id === id);
}
