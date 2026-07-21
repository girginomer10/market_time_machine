import { describe, expect, it } from "vitest";
import {
  EVENT_DISCIPLINE_EURGBP_V1_ID,
  eventDisciplineEurGbpV1,
  getDrillForScenario,
  listAvailableDrills,
  listBuiltInDrills,
} from "../../data/practice/drills";
import { eurGbpBrexit2016Scenario } from "../../data/scenarios/eurgbp-brexit-2016";
import { assembleScenario, type RawScenarioFiles } from "../scenario/loader";
import { validateScenarioPackage } from "../validation/scenario";
import { makeScenario } from "../../test/fixtures";
import type { DrillDefinition, ScenarioPackage } from "../../types";
import {
  parseScenarioDrillDefinitions,
  validateScenarioDrillDefinitions,
} from "./drillAuthoring";

function authoredDrill(
  overrides: Partial<DrillDefinition> = {},
): DrillDefinition {
  return {
    id: "test-event-discipline-v1",
    competencyId: "event-discipline",
    definitionVersion: 1,
    rubricVersion: "event-discipline-process-v1",
    title: "Test event discipline",
    description: "A data-only drill authored with the test scenario.",
    scenarioId: "test",
    primarySymbol: "TEST",
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
    ...overrides,
  };
}

function rawScenario(
  scenario: ScenarioPackage,
  drills?: DrillDefinition[],
): RawScenarioFiles {
  return {
    scenario: scenario.meta,
    instruments: scenario.instruments,
    candles: scenario.candles,
    events: scenario.events,
    indicators: scenario.indicators,
    benchmarks: scenario.benchmarks,
    broker: scenario.broker,
    marketCalendar: scenario.marketCalendar,
    corporateActions: scenario.corporateActions,
    drills,
  };
}

function versionedScenario(): ScenarioPackage {
  const scenario = makeScenario();
  return {
    ...scenario,
    meta: { ...scenario.meta, dataVersion: "test-data-v1" },
  };
}

describe("scenario-authored drill parsing", () => {
  it("parses, domain-validates, and defensively copies a valid definition", () => {
    const scenario = versionedScenario();
    const source = authoredDrill();
    const result = parseScenarioDrillDefinitions([source], scenario);

    expect(result).toEqual({ valid: true, drills: [source], issues: [] });
    expect(result.drills[0]).not.toBe(source);
    expect(result.drills[0].initialPlanRule.requiredFields).not.toBe(
      source.initialPlanRule.requiredFields,
    );
    expect(result.drills[0].checkpointRule.actions).not.toBe(
      source.checkpointRule.actions,
    );
    expect(result.drills[0].rubric.weights).not.toBe(source.rubric.weights);
  });

  it("never crashes on malformed nested unknown input", () => {
    const scenario = versionedScenario();
    const malformed = [
      null,
      {
        id: "broken-v1",
        competencyId: "broken-competency",
        definitionVersion: 1,
        rubricVersion: "broken-rubric-v1",
        title: "Broken",
        description: "Malformed nested values.",
        scenarioId: "test",
        primarySymbol: "TEST",
        mode: "explorer",
        initialPlanRule: null,
        checkpointRule: {
          minimumImportance: "high",
          mapping: {},
          groupSameReplayIndex: false,
          requireReflection: "yes",
          actions: null,
        },
        rubric: { weights: [], violationPenalty: Number.NaN },
      },
    ];

    expect(() =>
      parseScenarioDrillDefinitions(malformed, scenario),
    ).not.toThrow();
    const result = validateScenarioDrillDefinitions(malformed, scenario);
    expect(result.valid).toBe(false);
    expect(result.drills).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "drills.definition_object_required",
        "drills.object_required",
        "drills.number_required",
        "drills.string_required",
        "drills.grouping_invalid",
      ]),
    );
    expect(parseScenarioDrillDefinitions({ drills: [] }, scenario)).toMatchObject({
      valid: false,
      drills: [],
      issues: [{ code: "drills.array_required", path: "drills" }],
    });
  });

  it("requires a stable non-empty competency identity", () => {
    const scenario = versionedScenario();
    const { competencyId: _omitted, ...missingCompetency } = authoredDrill();

    for (const input of [missingCompetency, authoredDrill({ competencyId: " " })]) {
      const result = parseScenarioDrillDefinitions([input], scenario);

      expect(result.valid).toBe(false);
      expect(result.drills).toEqual([]);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "drills.string_required",
            path: "drills[0].competencyId",
          }),
        ]),
      );
    }
  });

  it("applies scenario matching and the existing domain validator", () => {
    const result = parseScenarioDrillDefinitions(
      [
        authoredDrill({
          scenarioId: "another-scenario",
          primarySymbol: "MISSING",
        }),
      ],
      versionedScenario(),
    );

    expect(result.valid).toBe(false);
    expect(result.drills).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "drills.definition.scenario_mismatch",
        "drills.definition.primary_symbol_unknown",
        "drills.definition.checkpoints_empty",
      ]),
    );
  });

  it("rejects an authored drill with no required initial-plan fields", () => {
    const result = parseScenarioDrillDefinitions(
      [
        authoredDrill({
          initialPlanRule: {
            requiredBeforeFirstOrder: true,
            requiredFields: [],
          },
        }),
      ],
      versionedScenario(),
    );

    expect(result.valid).toBe(false);
    expect(result.drills).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "drills.definition.plan_fields_empty",
        path: "drills[0].initialPlanRule.requiredFields",
      }),
    );
  });

  it("requires a positive definition version and unique ids", () => {
    const scenario = versionedScenario();
    const duplicate = authoredDrill();
    const result = parseScenarioDrillDefinitions(
      [duplicate, { ...duplicate }, authoredDrill({ id: "bad-version", definitionVersion: 0 })],
      scenario,
    );

    expect(result.valid).toBe(false);
    expect(result.drills).toHaveLength(1);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "drills.id_duplicate",
        "drills.definition_version_invalid",
      ]),
    );
  });
});

describe("scenario package integration", () => {
  it("assembleScenario validates and copies authored definitions", () => {
    const base = makeScenario();
    const source = authoredDrill();
    const assembled = assembleScenario(
      rawScenario(
        { ...base, meta: { ...base.meta, dataVersion: "test-data-v1" } },
        [source],
      ),
    );

    expect(assembled.drills).toEqual([source]);
    expect(assembled.drills?.[0]).not.toBe(source);
    source.title = "Mutated after assembly";
    expect(assembled.drills?.[0].title).toBe("Test event discipline");
    expect(
      validateScenarioPackage(assembled).errors.filter((issue) =>
        issue.code.startsWith("drills."),
      ),
    ).toEqual([]);
  });

  it("requires a non-empty scenario data version for authored drills", () => {
    const base = makeScenario();
    const versionless = { ...base, drills: [authoredDrill()] };
    const blankVersion = {
      ...base,
      meta: { ...base.meta, dataVersion: "   " },
      drills: [authoredDrill()],
    };

    for (const scenario of [versionless, blankVersion]) {
      expect(validateScenarioPackage(scenario)).toMatchObject({
        valid: false,
        errors: [
          expect.objectContaining({
            code: "meta.data_version_required_for_drills",
            path: "meta.dataVersion",
          }),
        ],
      });
    }
    expect(() =>
      assembleScenario(rawScenario(base, [authoredDrill()])),
    ).toThrow(/meta\.data_version_required_for_drills/);
    expect(() =>
      assembleScenario(rawScenario(blankVersion, [authoredDrill()])),
    ).toThrow(/meta\.data_version_required_for_drills/);

    expect(
      validateScenarioPackage({
        ...base,
        meta: { ...base.meta, dataVersion: "test-data-v1" },
        drills: [authoredDrill()],
      }).valid,
    ).toBe(true);
  });

  it("assembleScenario rejects a structurally valid but mismatched drill", () => {
    const base = versionedScenario();
    expect(() =>
      assembleScenario(
        rawScenario(base, [authoredDrill({ scenarioId: "wrong" })]),
      ),
    ).toThrow(/drills\.definition\.scenario_mismatch/);
  });

  it("validateScenarioPackage reports malformed nested drills without throwing", () => {
    const scenario = {
      ...versionedScenario(),
      drills: [{ ...authoredDrill(), checkpointRule: null }],
    } as unknown as ScenarioPackage;

    expect(() => validateScenarioPackage(scenario)).not.toThrow();
    const result = validateScenarioPackage(scenario);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "drills.object_required",
          path: "drills[0].checkpointRule",
        }),
      ]),
    );
  });
});

describe("available drill catalog", () => {
  it("merges validated authored drills without mutating the built-in catalog", () => {
    const builtInsBefore = listBuiltInDrills();
    const scenario = { ...versionedScenario(), drills: [authoredDrill()] };

    expect(listAvailableDrills([scenario])).toEqual([authoredDrill()]);
    expect(getDrillForScenario("test-event-discipline-v1", scenario)).toEqual(
      authoredDrill(),
    );
    expect(listBuiltInDrills()).toEqual(builtInsBefore);
  });

  it("does not let an imported definition replace a reserved built-in id", () => {
    const replacement = {
      ...eventDisciplineEurGbpV1,
      title: "Imported replacement",
    };
    const scenario = {
      ...eurGbpBrexit2016Scenario,
      drills: [replacement],
    };

    expect(getDrillForScenario(EVENT_DISCIPLINE_EURGBP_V1_ID, scenario)).toBe(
      eventDisciplineEurGbpV1,
    );
    expect(listAvailableDrills([scenario])).toEqual([
      eventDisciplineEurGbpV1,
    ]);
  });

  it("does not expose a built-in for an incompatible scenario-id lookalike", () => {
    const base = makeScenario();
    const lookalike = {
      ...base,
      meta: { ...base.meta, id: "eurgbp-brexit-2016" },
    };

    expect(listAvailableDrills([lookalike])).toEqual([]);
    expect(
      getDrillForScenario(EVENT_DISCIPLINE_EURGBP_V1_ID, lookalike),
    ).toBeUndefined();
  });

  it("does not expose any authored drill when its package drill set is invalid", () => {
    const scenario = {
      ...versionedScenario(),
      drills: [
        authoredDrill(),
        { ...authoredDrill({ id: "invalid-v1" }), rubric: null },
      ],
    } as unknown as ScenarioPackage;

    expect(listAvailableDrills([scenario])).toEqual([]);
    expect(getDrillForScenario("test-event-discipline-v1", scenario)).toBeUndefined();
  });
});
