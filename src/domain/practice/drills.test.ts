import { describe, expect, it } from "vitest";
import {
  EVENT_DISCIPLINE_COMPETENCY_ID,
  EVENT_DISCIPLINE_EURGBP_V1_ID,
  eventDisciplineEurGbpV1,
  eventDisciplineEurUsdV1,
  eventDisciplineKreV1,
  eventDisciplineQqqV1,
  getBuiltInDrill,
  listBuiltInDrills,
} from "../../data/practice/drills";
import { eurGbpBrexit2016Scenario } from "../../data/scenarios/eurgbp-brexit-2016";
import { eurUsdCovidLiquidity2020Scenario } from "../../data/scenarios/eurusd-covid-liquidity-2020";
import { kreBankingCrisis2023Scenario } from "../../data/scenarios/kre-banking-crisis-2023";
import { qqqRateHike2022Scenario } from "../../data/scenarios/qqq-rate-hike-2022";
import { makeScenario } from "../../test/fixtures";
import type {
  DrillCheckpoint,
  DrillCheckpointResponse,
  DrillDefinition,
  DrillRuleViolation,
} from "../../types";
import {
  assessDrill,
  buildDrillCheckpointSchedule,
  nextDrillCheckpoint,
  validateDrillCheckpointResponse,
  validateDrillDefinition,
} from "./drills";

function responseFor(
  checkpoint: DrillCheckpoint,
  overrides: Partial<DrillCheckpointResponse> = {},
): DrillCheckpointResponse {
  return {
    id: `response-${checkpoint.id}`,
    drillId: checkpoint.drillId,
    definitionVersion: checkpoint.definitionVersion,
    checkpointId: checkpoint.id,
    replayTime: checkpoint.replayTime,
    eventIds: [...checkpoint.eventIds],
    status: "answered",
    action: "hold",
    reflection: "The visible event changes the risk balance, but not the plan yet.",
    positionQuantity: 1,
    workingOrderIds: [],
    ...overrides,
  };
}

function testDefinition(scenarioId = "test"): DrillDefinition {
  return {
    id: "published-at-test-v1",
    competencyId: "published-at-process",
    definitionVersion: 1,
    rubricVersion: "published-at-process-v1",
    title: "Published-time test",
    description: "A fixture drill for checkpoint mapping.",
    scenarioId,
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
  };
}

describe("built-in practice drill catalog", () => {
  it("exposes a valid versioned EUR/GBP Event Discipline definition", () => {
    expect(getBuiltInDrill(EVENT_DISCIPLINE_EURGBP_V1_ID)).toBe(
      eventDisciplineEurGbpV1,
    );
    expect(listBuiltInDrills()).toEqual([
      eventDisciplineEurGbpV1,
      eventDisciplineEurUsdV1,
      eventDisciplineQqqV1,
      eventDisciplineKreV1,
    ]);
    expect(
      listBuiltInDrills().map((definition) => definition.competencyId),
    ).toEqual(Array(4).fill(EVENT_DISCIPLINE_COMPETENCY_ID));
    expect(
      validateDrillDefinition(
        eventDisciplineEurGbpV1,
        eurGbpBrexit2016Scenario,
      ),
    ).toEqual({ valid: true, issues: [] });
    expect(eventDisciplineEurGbpV1.rubric.weights).toEqual({
      plan_coverage: 0.3,
      checkpoint_coverage: 0.3,
      event_linkage: 0.2,
      rule_adherence: 0.2,
    });
  });

  it.each([
    [eventDisciplineEurUsdV1, eurUsdCovidLiquidity2020Scenario],
    [eventDisciplineQqqV1, qqqRateHike2022Scenario],
    [eventDisciplineKreV1, kreBankingCrisis2023Scenario],
  ])(
    "validates %s and maps every eligible importance-4+ event",
    (definition, scenario) => {
      expect(validateDrillDefinition(definition, scenario)).toEqual({
        valid: true,
        issues: [],
      });
      const eligibleIds = scenario.events
        .filter(
          (event) =>
            event.importance >= definition.checkpointRule.minimumImportance &&
            event.affectedSymbols.includes(definition.primarySymbol),
        )
        .map((event) => event.id)
        .sort();
      const schedule = buildDrillCheckpointSchedule(definition, scenario);

      expect(schedule.length).toBeGreaterThan(0);
      expect(schedule.flatMap((checkpoint) => checkpoint.eventIds).sort()).toEqual(
        eligibleIds,
      );
    },
  );
});

describe("drill checkpoint schedule", () => {
  it("groups six important EUR/GBP events into five replay checkpoints", () => {
    const schedule = buildDrillCheckpointSchedule(
      eventDisciplineEurGbpV1,
      eurGbpBrexit2016Scenario,
    );

    expect(schedule).toHaveLength(5);
    expect(schedule.flatMap((checkpoint) => checkpoint.eventIds)).toHaveLength(6);
    const referendumDay = schedule.find((checkpoint) =>
      checkpoint.eventIds.includes("evt-2016-06-24-referendum-result"),
    );
    expect(referendumDay).toMatchObject({
      replayTime: "2016-06-24T15:00:00.000Z",
      eventIds: [
        "evt-2016-06-24-referendum-result",
        "evt-2016-06-24-boe-statement",
      ],
    });
  });

  it("maps by publishedAt to the next real primary close, not happenedAt", () => {
    const scenario = makeScenario();
    const event = scenario.events.find((candidate) => candidate.id === "evt-2");
    expect(event).toMatchObject({
      happenedAt: "2024-01-04T12:00:00.000Z",
      publishedAt: "2024-01-05T16:00:00.000Z",
    });

    const schedule = buildDrillCheckpointSchedule(testDefinition(), scenario);
    const expectedClose = scenario.candles.find(
      (candle) => Date.parse(candle.closeTime) >= Date.parse(event!.publishedAt),
    )?.closeTime;

    expect(schedule).toHaveLength(1);
    expect(schedule[0].replayTime).toBe(expectedClose);
    expect(Date.parse(schedule[0].replayTime)).toBeGreaterThan(
      Date.parse(event!.happenedAt),
    );
  });

  it("returns the earliest unresolved checkpoint in a requested replay range", () => {
    const schedule = buildDrillCheckpointSchedule(
      eventDisciplineEurGbpV1,
      eurGbpBrexit2016Scenario,
    );
    const first = nextDrillCheckpoint({
      schedule,
      currentIndex: 0,
      requestedIndex: schedule.at(-1)!.replayIndex,
      resolvedCheckpointIds: [],
    });
    expect(first?.id).toBe(schedule[0].id);

    expect(
      nextDrillCheckpoint({
        schedule,
        currentIndex: schedule[0].replayIndex,
        requestedIndex: schedule.at(-1)!.replayIndex,
        resolvedCheckpointIds: [schedule[0].id],
      })?.id,
    ).toBe(schedule[1].id);
    expect(
      nextDrillCheckpoint({
        schedule,
        currentIndex: 10,
        requestedIndex: 9,
        resolvedCheckpointIds: [],
      }),
    ).toBeUndefined();
  });
});

describe("drill validation", () => {
  it("reports definition mismatches, invalid weights, and unmappable events", () => {
    const scenario = makeScenario();
    const invalid = {
      ...testDefinition("another-scenario"),
      primarySymbol: "MISSING",
      rubric: {
        weights: {
          plan_coverage: 0.3,
          checkpoint_coverage: 0.3,
          event_linkage: 0.2,
          rule_adherence: 0.1,
        },
        violationPenalty: 20,
      },
    } satisfies DrillDefinition;
    const result = validateDrillDefinition(invalid, scenario);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "definition.scenario_mismatch",
        "definition.primary_symbol_unknown",
        "definition.weights_invalid",
        "definition.checkpoints_empty",
      ]),
    );
  });

  it("accepts only a response linked to the active visible checkpoint", () => {
    const checkpoint = buildDrillCheckpointSchedule(
      eventDisciplineEurGbpV1,
      eurGbpBrexit2016Scenario,
    )[1];
    const valid = responseFor(checkpoint);
    expect(
      validateDrillCheckpointResponse(
        eventDisciplineEurGbpV1,
        checkpoint,
        valid,
        checkpoint.eventIds,
      ),
    ).toEqual({ valid: true, issues: [] });

    const invalid = responseFor(checkpoint, {
      eventIds: [checkpoint.eventIds[0]],
      reflection: "  ",
    });
    const result = validateDrillCheckpointResponse(
      eventDisciplineEurGbpV1,
      checkpoint,
      invalid,
      [checkpoint.eventIds[0]],
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "response.events_mismatch",
        "response.event_not_visible",
        "response.reflection_missing",
      ]),
    );

    const oversized = validateDrillCheckpointResponse(
      eventDisciplineEurGbpV1,
      checkpoint,
      responseFor(checkpoint, { reflection: "x".repeat(2_001) }),
      checkpoint.eventIds,
    );
    expect(oversized.issues.map((issue) => issue.code)).toContain(
      "response.reflection_too_long",
    );
  });
});

describe("process-only drill assessment", () => {
  const schedule = buildDrillCheckpointSchedule(
    eventDisciplineEurGbpV1,
    eurGbpBrexit2016Scenario,
  );
  const completePlan = {
    thesis: "Policy uncertainty supports a defined EUR exposure.",
    invalidation: "Exit if the published policy path contradicts the thesis.",
    exitPlan: "Reduce or exit at the next checkpoint if invalidated.",
    acceptedRisk: "At most 1% of starting equity.",
  };

  it("scores only observable plan, checkpoint, event, and rule evidence", () => {
    const assessment = assessDrill({
      definition: eventDisciplineEurGbpV1,
      checkpoints: schedule,
      initialPlan: completePlan,
      responses: schedule.map((checkpoint) => responseFor(checkpoint)),
      violations: [],
      positionOpened: true,
      replayCompleted: true,
    });

    expect(assessment).toMatchObject({
      drillId: EVENT_DISCIPLINE_EURGBP_V1_ID,
      competencyId: EVENT_DISCIPLINE_COMPETENCY_ID,
      status: "completed",
      overallScore: 100,
      eligibleCheckpointCount: 5,
      answeredCheckpointCount: 5,
      eligibleEventCount: 6,
      linkedEventCount: 6,
      violationCount: 0,
    });
    expect(assessment.components.map(({ id, score }) => [id, score])).toEqual([
      ["plan_coverage", 100],
      ["checkpoint_coverage", 100],
      ["event_linkage", 100],
      ["rule_adherence", 100],
    ]);
    expect(assessment.methodology).toContain("Process-only score");
  });

  it("leaves absent evidence unscored instead of converting it to zero", () => {
    const assessment = assessDrill({
      definition: eventDisciplineEurGbpV1,
      checkpoints: schedule,
      responses: [],
      violations: [],
      positionOpened: true,
      replayCompleted: false,
    });

    expect(assessment.status).toBe("incomplete");
    expect(assessment.overallScore).toBeUndefined();
    const plan = assessment.components.find(
      (entry) => entry.id === "plan_coverage",
    );
    const checkpoint = assessment.components.find(
      (entry) => entry.id === "checkpoint_coverage",
    );
    const event = assessment.components.find(
      (entry) => entry.id === "event_linkage",
    );
    expect(plan?.status).toBe("insufficient_evidence");
    expect(plan?.score).toBeUndefined();
    expect(checkpoint?.status).toBe("insufficient_evidence");
    expect(checkpoint?.score).toBeUndefined();
    expect(event?.status).toBe("insufficient_evidence");
    expect(event?.score).toBeUndefined();
  });

  it("distinguishes explicit partial process evidence from missing evidence", () => {
    const violation: DrillRuleViolation = {
      id: "violation-1",
      drillId: eventDisciplineEurGbpV1.id,
      definitionVersion: eventDisciplineEurGbpV1.definitionVersion,
      code: "order_before_plan",
      replayTime: schedule[0].replayTime,
      evidence: "An order was attempted before the initial plan was complete.",
    };
    const assessment = assessDrill({
      definition: eventDisciplineEurGbpV1,
      checkpoints: schedule,
      initialPlan: {
        thesis: "A partial plan.",
        acceptedRisk: "1% of equity.",
      },
      responses: [responseFor(schedule[0])],
      violations: [violation],
      positionOpened: true,
      replayCompleted: false,
    });

    expect(assessment.status).toBe("incomplete");
    expect(assessment.overallScore).toBeGreaterThan(0);
    expect(assessment.overallScore).toBeLessThan(100);
    expect(
      assessment.components.find((entry) => entry.id === "plan_coverage"),
    ).toMatchObject({ status: "assessed", score: 50 });
    expect(
      assessment.components.find((entry) => entry.id === "rule_adherence"),
    ).toMatchObject({ status: "assessed", score: 80 });
  });

  it("keeps a no-trade replay incomplete when the learner stayed flat", () => {
    const assessment = assessDrill({
      definition: eventDisciplineEurGbpV1,
      checkpoints: schedule,
      responses: schedule.map((checkpoint) =>
        responseFor(checkpoint, {
          action: "wait",
          positionQuantity: 0,
          reflection: "No new entry is justified by the visible information.",
        }),
      ),
      violations: [],
      positionOpened: false,
      replayCompleted: true,
    });

    expect(assessment.status).toBe("incomplete");
    const plan = assessment.components.find(
      (entry) => entry.id === "plan_coverage",
    );
    expect(plan?.status).toBe("not_applicable");
    expect(plan?.score).toBeUndefined();
    expect(assessment.overallScore).toBe(100);
  });
});
