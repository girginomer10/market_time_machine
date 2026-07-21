import { validateDrillDefinition } from "./drills";
import type {
  DrillAssessmentComponentId,
  DrillCheckpointAction,
  DrillDefinition,
  DrillPlanField,
  ScenarioMode,
  ScenarioPackage,
} from "../../types";

export type DrillAuthoringIssue = {
  code: string;
  message: string;
  path: string;
};

export type DrillAuthoringResult = {
  valid: boolean;
  drills: DrillDefinition[];
  issues: DrillAuthoringIssue[];
};

const SCENARIO_MODES = new Set<ScenarioMode>([
  "explorer",
  "professional",
  "blind",
  "challenge",
]);
const PLAN_FIELDS = new Set<DrillPlanField>([
  "thesis",
  "invalidation",
  "exitPlan",
  "acceptedRisk",
]);
const CHECKPOINT_ACTIONS = new Set<DrillCheckpointAction>([
  "hold",
  "reduce",
  "exit",
  "wait",
]);
const COMPONENT_IDS: readonly DrillAssessmentComponentId[] = [
  "plan_coverage",
  "checkpoint_coverage",
  "event_linkage",
  "rule_adherence",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: DrillAuthoringIssue[],
  code: string,
  message: string,
  path: string,
): void {
  issues.push({ code, message, path });
}

function readString(
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: DrillAuthoringIssue[],
): string | undefined {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) {
    addIssue(
      issues,
      "drills.string_required",
      `${field} must be a non-empty string.`,
      `${path}.${field}`,
    );
    return undefined;
  }
  return value;
}

function readBoolean(
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: DrillAuthoringIssue[],
): boolean | undefined {
  const value = record[field];
  if (typeof value !== "boolean") {
    addIssue(
      issues,
      "drills.boolean_required",
      `${field} must be a boolean.`,
      `${path}.${field}`,
    );
    return undefined;
  }
  return value;
}

function readFiniteNumber(
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: DrillAuthoringIssue[],
): number | undefined {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addIssue(
      issues,
      "drills.number_required",
      `${field} must be a finite number.`,
      `${path}.${field}`,
    );
    return undefined;
  }
  return value;
}

function readRecord(
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: DrillAuthoringIssue[],
): Record<string, unknown> | undefined {
  const value = record[field];
  if (!isRecord(value)) {
    addIssue(
      issues,
      "drills.object_required",
      `${field} must be an object.`,
      `${path}.${field}`,
    );
    return undefined;
  }
  return value;
}

function readStringArray(
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: DrillAuthoringIssue[],
): string[] | undefined {
  const value = record[field];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    addIssue(
      issues,
      "drills.string_array_required",
      `${field} must be an array of non-empty strings.`,
      `${path}.${field}`,
    );
    return undefined;
  }
  return [...value] as string[];
}

function parseDefinition(
  value: unknown,
  index: number,
  scenario: ScenarioPackage,
  issues: DrillAuthoringIssue[],
): DrillDefinition | undefined {
  const path = `drills[${index}]`;
  if (!isRecord(value)) {
    addIssue(
      issues,
      "drills.definition_object_required",
      "Each drill definition must be an object.",
      path,
    );
    return undefined;
  }
  const issueCount = issues.length;
  const id = readString(value, "id", path, issues);
  const competencyId = readString(value, "competencyId", path, issues);
  const definitionVersion = readFiniteNumber(
    value,
    "definitionVersion",
    path,
    issues,
  );
  if (
    definitionVersion !== undefined &&
    (!Number.isInteger(definitionVersion) || definitionVersion < 1)
  ) {
    addIssue(
      issues,
      "drills.definition_version_invalid",
      "definitionVersion must be a positive integer.",
      `${path}.definitionVersion`,
    );
  }
  const rubricVersion = readString(value, "rubricVersion", path, issues);
  const title = readString(value, "title", path, issues);
  const description = readString(value, "description", path, issues);
  const scenarioId = readString(value, "scenarioId", path, issues);
  const primarySymbol = readString(value, "primarySymbol", path, issues);
  const modeValue = readString(value, "mode", path, issues);
  const mode = SCENARIO_MODES.has(modeValue as ScenarioMode)
    ? (modeValue as ScenarioMode)
    : undefined;
  if (modeValue !== undefined && mode === undefined) {
    addIssue(
      issues,
      "drills.mode_invalid",
      "mode must be explorer, professional, blind, or challenge.",
      `${path}.mode`,
    );
  }

  const initialPlanRule = readRecord(
    value,
    "initialPlanRule",
    path,
    issues,
  );
  const requiredBeforeFirstOrder = initialPlanRule
    ? readBoolean(
        initialPlanRule,
        "requiredBeforeFirstOrder",
        `${path}.initialPlanRule`,
        issues,
      )
    : undefined;
  const planFieldValues = initialPlanRule
    ? readStringArray(
        initialPlanRule,
        "requiredFields",
        `${path}.initialPlanRule`,
        issues,
      )
    : undefined;
  const requiredFields = planFieldValues?.every((field) =>
    PLAN_FIELDS.has(field as DrillPlanField),
  )
    ? (planFieldValues as DrillPlanField[])
    : undefined;
  if (planFieldValues && requiredFields === undefined) {
    addIssue(
      issues,
      "drills.plan_field_invalid",
      "requiredFields contains an unsupported plan field.",
      `${path}.initialPlanRule.requiredFields`,
    );
  }

  const checkpointRule = readRecord(
    value,
    "checkpointRule",
    path,
    issues,
  );
  const minimumImportanceValue = checkpointRule
    ? readFiniteNumber(
        checkpointRule,
        "minimumImportance",
        `${path}.checkpointRule`,
        issues,
      )
    : undefined;
  const minimumImportance =
    minimumImportanceValue !== undefined &&
    Number.isInteger(minimumImportanceValue) &&
    minimumImportanceValue >= 1 &&
    minimumImportanceValue <= 5
      ? (minimumImportanceValue as 1 | 2 | 3 | 4 | 5)
      : undefined;
  if (minimumImportanceValue !== undefined && minimumImportance === undefined) {
    addIssue(
      issues,
      "drills.minimum_importance_invalid",
      "minimumImportance must be an integer from 1 to 5.",
      `${path}.checkpointRule.minimumImportance`,
    );
  }
  const mappingValue = checkpointRule
    ? readString(
        checkpointRule,
        "mapping",
        `${path}.checkpointRule`,
        issues,
      )
    : undefined;
  const mapping =
    mappingValue === "next_primary_candle_close" ? mappingValue : undefined;
  if (mappingValue !== undefined && mapping === undefined) {
    addIssue(
      issues,
      "drills.mapping_invalid",
      "mapping must be next_primary_candle_close.",
      `${path}.checkpointRule.mapping`,
    );
  }
  const groupSameReplayIndexValue = checkpointRule
    ? checkpointRule.groupSameReplayIndex
    : undefined;
  const groupSameReplayIndex =
    groupSameReplayIndexValue === true ? true : undefined;
  if (checkpointRule && groupSameReplayIndex === undefined) {
    addIssue(
      issues,
      "drills.grouping_invalid",
      "groupSameReplayIndex must be true.",
      `${path}.checkpointRule.groupSameReplayIndex`,
    );
  }
  const requireReflection = checkpointRule
    ? readBoolean(
        checkpointRule,
        "requireReflection",
        `${path}.checkpointRule`,
        issues,
      )
    : undefined;
  const actionValues = checkpointRule
    ? readStringArray(
        checkpointRule,
        "actions",
        `${path}.checkpointRule`,
        issues,
      )
    : undefined;
  const actions = actionValues?.every((action) =>
    CHECKPOINT_ACTIONS.has(action as DrillCheckpointAction),
  )
    ? (actionValues as DrillCheckpointAction[])
    : undefined;
  if (actionValues && actions === undefined) {
    addIssue(
      issues,
      "drills.action_invalid",
      "actions contains an unsupported checkpoint action.",
      `${path}.checkpointRule.actions`,
    );
  }

  const rubric = readRecord(value, "rubric", path, issues);
  const weightsRecord = rubric
    ? readRecord(rubric, "weights", `${path}.rubric`, issues)
    : undefined;
  const weights = {} as Record<DrillAssessmentComponentId, number>;
  if (weightsRecord) {
    const unknownWeightKeys = Object.keys(weightsRecord).filter(
      (key) => !COMPONENT_IDS.includes(key as DrillAssessmentComponentId),
    );
    if (unknownWeightKeys.length > 0) {
      addIssue(
        issues,
        "drills.weight_key_invalid",
        `Unknown rubric weight key(s): ${unknownWeightKeys.join(", ")}.`,
        `${path}.rubric.weights`,
      );
    }
    for (const componentId of COMPONENT_IDS) {
      const weight = readFiniteNumber(
        weightsRecord,
        componentId,
        `${path}.rubric.weights`,
        issues,
      );
      if (weight !== undefined) weights[componentId] = weight;
    }
  }
  const violationPenalty = rubric
    ? readFiniteNumber(
        rubric,
        "violationPenalty",
        `${path}.rubric`,
        issues,
      )
    : undefined;

  if (
    issues.length !== issueCount ||
    !id ||
    !competencyId ||
    definitionVersion === undefined ||
    !rubricVersion ||
    !title ||
    !description ||
    !scenarioId ||
    !primarySymbol ||
    !mode ||
    requiredBeforeFirstOrder === undefined ||
    !requiredFields ||
    minimumImportance === undefined ||
    !mapping ||
    !groupSameReplayIndex ||
    requireReflection === undefined ||
    !actions ||
    !weightsRecord ||
    violationPenalty === undefined
  ) {
    return undefined;
  }

  const definition: DrillDefinition = {
    id,
    competencyId,
    definitionVersion,
    rubricVersion,
    title,
    description,
    scenarioId,
    primarySymbol,
    mode,
    initialPlanRule: {
      requiredBeforeFirstOrder,
      requiredFields: [...requiredFields],
    },
    checkpointRule: {
      minimumImportance,
      mapping,
      groupSameReplayIndex,
      requireReflection,
      actions: [...actions],
    },
    rubric: {
      weights: { ...weights },
      violationPenalty,
    },
  };
  const domainValidation = validateDrillDefinition(definition, scenario);
  if (!domainValidation.valid) {
    for (const issue of domainValidation.issues) {
      addIssue(
        issues,
        `drills.${issue.code}`,
        issue.message,
        issue.path ? `${path}.${issue.path}` : path,
      );
    }
    return undefined;
  }
  return definition;
}

/**
 * Parses untrusted scenario-authored drill data without assuming any nested
 * property exists. Only definitions that also pass domain validation are
 * returned.
 */
export function parseScenarioDrillDefinitions(
  value: unknown,
  scenario: ScenarioPackage,
): DrillAuthoringResult {
  if (value === undefined) return { valid: true, drills: [], issues: [] };
  if (!Array.isArray(value)) {
    return {
      valid: false,
      drills: [],
      issues: [
        {
          code: "drills.array_required",
          message: "Scenario drills must be an array.",
          path: "drills",
        },
      ],
    };
  }

  const issues: DrillAuthoringIssue[] = [];
  if (
    value.length > 0 &&
    (typeof scenario.meta.dataVersion !== "string" ||
      !scenario.meta.dataVersion.trim())
  ) {
    addIssue(
      issues,
      "meta.data_version_required_for_drills",
      "Scenario dataVersion must be a non-empty string when authored drills are present.",
      "meta.dataVersion",
    );
  }
  const drills: DrillDefinition[] = [];
  const seenIds = new Map<string, number>();
  for (let index = 0; index < value.length; index++) {
    const parsed = parseDefinition(value[index], index, scenario, issues);
    if (!parsed) continue;
    const previous = seenIds.get(parsed.id);
    if (previous !== undefined) {
      addIssue(
        issues,
        "drills.id_duplicate",
        `Drill id ${parsed.id} is already declared at drills[${previous}].`,
        `drills[${index}].id`,
      );
      continue;
    }
    seenIds.set(parsed.id, index);
    drills.push(parsed);
  }
  return { valid: issues.length === 0, drills, issues };
}

export function validateScenarioDrillDefinitions(
  value: unknown,
  scenario: ScenarioPackage,
): DrillAuthoringResult {
  return parseScenarioDrillDefinitions(value, scenario);
}
