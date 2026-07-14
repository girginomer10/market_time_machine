import type { PracticeLedgerEntry } from "../history/practiceLedger";
import { validateDrillDefinition } from "./drills";
import type {
  DataFidelity,
  DrillAssessmentComponentId,
  DrillDefinition,
  ScenarioMode,
  ScenarioPackage,
} from "../../types";

const ASSESSMENT_COMPONENT_IDS = new Set<DrillAssessmentComponentId>([
  "plan_coverage",
  "checkpoint_coverage",
  "event_linkage",
  "rule_adherence",
]);

export type PracticeTrackStatus = "open" | "preview";
export type PracticeTrackUnitStatus = "validated" | "preview";

export type PracticeTrackEvidenceScope = {
  marketEvidence: "source_observed" | "synthetic";
  eventEvidence: "official_sources";
  dataFidelity: DataFidelity;
  sampleData: boolean;
  sourceReviewed: boolean;
  limitations: string;
};

export type PracticeTrackCompletionCriteria = {
  assessmentStatus: "completed";
  minimumOverallScore: number;
  minimumComponentScores: Partial<
    Record<DrillAssessmentComponentId, number>
  >;
  minimumAnsweredCheckpointRate: number;
  minimumLinkedEventRate: number;
  maximumViolationCount: number;
};

export type PracticeTrackUnit = {
  id: string;
  version: number;
  status: PracticeTrackUnitStatus;
  order: number;
  title: string;
  description: string;
  scenario: {
    id: string;
    /** Null is explicit and allowed only for non-creditable preview units. */
    dataVersion: string | null;
    dataFidelity: DataFidelity;
    sampleData: boolean;
  };
  drill: {
    id: string;
    definitionVersion: number;
    rubricVersion: string;
    mode: ScenarioMode;
  };
  evidenceScope: PracticeTrackEvidenceScope;
  completionCriteria: PracticeTrackCompletionCriteria;
};

export type PracticeTrack = {
  id: string;
  version: number;
  status: PracticeTrackStatus;
  title: string;
  description: string;
  completionPolicy: {
    unitEvidence: "all_criteria_same_attempt";
    trackCompletion: "all_validated_units";
    minimumSourceReviewedScenarios?: number;
  };
  units: readonly PracticeTrackUnit[];
};

export type PracticeTrackCatalogIssue = {
  code: string;
  message: string;
  path?: string;
};

export type PracticeTrackCatalogValidation = {
  valid: boolean;
  issues: PracticeTrackCatalogIssue[];
};

export type PracticeTrackUnitProgress = {
  unitId: string;
  unitVersion: number;
  status: "completed" | "incomplete" | "preview";
  creditedAttemptId?: string;
};

export type PracticeTrackProgress = {
  trackId: string;
  trackVersion: number;
  status: "completed" | "in_progress" | "not_started" | "preview";
  completedUnitCount: number;
  creditableUnitCount: number;
  units: PracticeTrackUnitProgress[];
};

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function boundedScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function boundedRate(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function versionIsValid(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

function unitReference(unit: PracticeTrackUnit): string {
  return [
    unit.scenario.id,
    unit.scenario.dataVersion ?? "<unversioned-preview>",
    unit.drill.id,
    unit.drill.definitionVersion,
    unit.drill.rubricVersion,
    unit.drill.mode,
  ].join("|");
}

function eligibleOfficialEvents(
  scenario: ScenarioPackage,
  drill: DrillDefinition,
) {
  return scenario.events.filter(
    (event) =>
      event.importance >= drill.checkpointRule.minimumImportance &&
      event.affectedSymbols.includes(drill.primarySymbol),
  );
}

/**
 * Validates curated track references against bundled scenario and drill
 * definitions. Runtime progress must use this curated catalog; arbitrary
 * imported scenario metadata is not itself an allowlist.
 */
export function validatePracticeTrackCatalog(
  tracks: readonly PracticeTrack[],
  dependencies: {
    scenarios: readonly ScenarioPackage[];
    drills: readonly DrillDefinition[];
  },
): PracticeTrackCatalogValidation {
  const issues: PracticeTrackCatalogIssue[] = [];
  const add = (code: string, message: string, path?: string) => {
    issues.push({ code, message, path });
  };
  const scenarioById = new Map(
    dependencies.scenarios.map((scenario) => [scenario.meta.id, scenario]),
  );
  const drillById = new Map(
    dependencies.drills.map((drill) => [drill.id, drill]),
  );
  if (scenarioById.size !== dependencies.scenarios.length) {
    add(
      "catalog.scenario_id_duplicate",
      "Scenario dependencies must have unique ids.",
    );
  }
  if (drillById.size !== dependencies.drills.length) {
    add(
      "catalog.drill_id_duplicate",
      "Drill dependencies must have unique ids.",
    );
  }

  const trackIds = new Set<string>();
  const unitIds = new Set<string>();
  for (const [trackIndex, track] of tracks.entries()) {
    const trackPath = `tracks[${trackIndex}]`;
    if (!nonEmpty(track.id) || trackIds.has(track.id)) {
      add(
        "track.id_invalid",
        "Track ids must be non-empty and unique.",
        `${trackPath}.id`,
      );
    }
    trackIds.add(track.id);
    if (track.status !== "open" && track.status !== "preview") {
      add(
        "track.status_invalid",
        "Track status must be open or preview.",
        `${trackPath}.status`,
      );
    }
    if (!versionIsValid(track.version)) {
      add(
        "track.version_invalid",
        "Track version must be a positive integer.",
        `${trackPath}.version`,
      );
    }
    if (!nonEmpty(track.title) || !nonEmpty(track.description)) {
      add(
        "track.copy_missing",
        "Track title and description are required.",
        trackPath,
      );
    }
    if (
      track.completionPolicy.unitEvidence !== "all_criteria_same_attempt" ||
      track.completionPolicy.trackCompletion !== "all_validated_units"
    ) {
      add(
        "track.completion_policy_invalid",
        "Track completion must require every unit's criteria in one attempt.",
        `${trackPath}.completionPolicy`,
      );
    }
    if (track.units.length === 0) {
      add("track.units_empty", "A track must declare at least one unit.", trackPath);
    }

    const references = new Set<string>();
    const orders = new Set<number>();
    for (const [unitIndex, unit] of track.units.entries()) {
      const unitPath = `${trackPath}.units[${unitIndex}]`;
      if (!nonEmpty(unit.id) || unitIds.has(unit.id)) {
        add(
          "unit.id_invalid",
          "Unit ids must be non-empty and globally unique.",
          `${unitPath}.id`,
        );
      }
      unitIds.add(unit.id);
      if (unit.status !== "validated" && unit.status !== "preview") {
        add(
          "unit.status_invalid",
          "Unit status must be validated or preview.",
          `${unitPath}.status`,
        );
      }
      if (!versionIsValid(unit.version)) {
        add(
          "unit.version_invalid",
          "Unit version must be a positive integer.",
          `${unitPath}.version`,
        );
      }
      if (!Number.isInteger(unit.order) || unit.order < 1) {
        add(
          "unit.order_invalid",
          "Unit order must be a positive integer.",
          `${unitPath}.order`,
        );
      } else if (orders.has(unit.order)) {
        add(
          "unit.order_duplicate",
          "Unit order must be unique within a track.",
          `${unitPath}.order`,
        );
      }
      orders.add(unit.order);
      if (!nonEmpty(unit.title) || !nonEmpty(unit.description)) {
        add(
          "unit.copy_missing",
          "Unit title and description are required.",
          unitPath,
        );
      }
      const reference = unitReference(unit);
      if (references.has(reference)) {
        add(
          "unit.reference_duplicate",
          "A track cannot repeat the same versioned scenario and drill reference.",
          unitPath,
        );
      }
      references.add(reference);

      const scenario = scenarioById.get(unit.scenario.id);
      const drill = drillById.get(unit.drill.id);
      if (!scenario) {
        add(
          "unit.scenario_unknown",
          `Scenario ${unit.scenario.id} is not in the curated dependency set.`,
          `${unitPath}.scenario.id`,
        );
      }
      if (!drill) {
        add(
          "unit.drill_unknown",
          `Drill ${unit.drill.id} is not in the curated dependency set.`,
          `${unitPath}.drill.id`,
        );
      }
      if (!scenario || !drill) continue;

      const actualVersion = scenario.meta.dataVersion ?? null;
      if (
        unit.status === "validated" &&
        (unit.scenario.dataVersion === null ||
          !nonEmpty(unit.scenario.dataVersion) ||
          unit.scenario.dataVersion !== actualVersion)
      ) {
        add(
          "unit.scenario_version_invalid",
          "Validated units require the exact non-empty scenario dataVersion.",
          `${unitPath}.scenario.dataVersion`,
        );
      } else if (
        unit.status === "preview" &&
        unit.scenario.dataVersion !== actualVersion
      ) {
        add(
          "unit.scenario_version_mismatch",
          "Preview units must also state the scenario's current version, including explicit null when absent.",
          `${unitPath}.scenario.dataVersion`,
        );
      }
      if (
        unit.scenario.dataFidelity !== scenario.meta.dataFidelity ||
        unit.evidenceScope.dataFidelity !== scenario.meta.dataFidelity
      ) {
        add(
          "unit.data_fidelity_mismatch",
          "Unit evidence fidelity must exactly match scenario provenance.",
          `${unitPath}.evidenceScope.dataFidelity`,
        );
      }
      const sampleData = scenario.meta.isSampleData ?? false;
      if (
        unit.scenario.sampleData !== sampleData ||
        unit.evidenceScope.sampleData !== sampleData
      ) {
        add(
          "unit.sample_data_mismatch",
          "Unit sample-data disclosure must match scenario provenance.",
          `${unitPath}.evidenceScope.sampleData`,
        );
      }
      if (
        unit.evidenceScope.marketEvidence === "source_observed" &&
        (sampleData ||
          !["observed", "mixed"].includes(scenario.meta.dataFidelity ?? "") ||
          !(scenario.meta.observedFields?.length ?? 0))
      ) {
        add(
          "unit.observed_evidence_invalid",
          "Source-observed market evidence requires non-sample observed or mixed provenance.",
          `${unitPath}.evidenceScope.marketEvidence`,
        );
      }
      if (
        unit.evidenceScope.marketEvidence === "synthetic" &&
        (!sampleData || scenario.meta.dataFidelity !== "synthetic")
      ) {
        add(
          "unit.synthetic_evidence_invalid",
          "Synthetic market evidence must be disclosed by a synthetic sample scenario.",
          `${unitPath}.evidenceScope.marketEvidence`,
        );
      }
      if (!nonEmpty(unit.evidenceScope.limitations)) {
        add(
          "unit.evidence_limitations_missing",
          "Every unit must state its evidence limitations.",
          `${unitPath}.evidenceScope.limitations`,
        );
      }
      if (
        unit.evidenceScope.sourceReviewed &&
        (!(scenario.meta.dataSources?.length ?? 0) ||
          !(scenario.meta.sourceManifest?.length ?? 0))
      ) {
        add(
          "unit.source_review_evidence_missing",
          "Source-reviewed evidence requires both source metadata and a source manifest.",
          `${unitPath}.evidenceScope.sourceReviewed`,
        );
      }

      if (
        drill.scenarioId !== unit.scenario.id ||
        drill.definitionVersion !== unit.drill.definitionVersion ||
        drill.rubricVersion !== unit.drill.rubricVersion ||
        drill.mode !== unit.drill.mode
      ) {
        add(
          "unit.drill_reference_mismatch",
          "Unit drill id, version, rubric, mode, and scenario must match the catalog definition.",
          `${unitPath}.drill`,
        );
      }
      if (!scenario.meta.supportedModes.includes(unit.drill.mode)) {
        add(
          "unit.mode_unsupported",
          `Scenario ${scenario.meta.id} does not support ${unit.drill.mode}.`,
          `${unitPath}.drill.mode`,
        );
      }
      const drillValidation = validateDrillDefinition(drill, scenario);
      if (!drillValidation.valid) {
        add(
          "unit.drill_invalid",
          `Drill validation failed: ${drillValidation.issues
            .map((issue) => issue.code)
            .join(", ")}.`,
          `${unitPath}.drill`,
        );
      }
      const officialEvents = eligibleOfficialEvents(scenario, drill);
      if (
        unit.evidenceScope.eventEvidence === "official_sources" &&
        (officialEvents.length === 0 ||
          officialEvents.some(
            (event) => !event.source?.trim() || !event.sourceUrl?.trim(),
          ))
      ) {
        add(
          "unit.official_event_evidence_invalid",
          "Official-event scope requires a source and URL for every eligible event.",
          `${unitPath}.evidenceScope.eventEvidence`,
        );
      }

      const criteria = unit.completionCriteria;
      const componentThresholds = Object.entries(
        criteria.minimumComponentScores,
      );
      if (
        criteria.assessmentStatus !== "completed" ||
        !boundedScore(criteria.minimumOverallScore) ||
        !boundedRate(criteria.minimumAnsweredCheckpointRate) ||
        !boundedRate(criteria.minimumLinkedEventRate) ||
        !Number.isInteger(criteria.maximumViolationCount) ||
        criteria.maximumViolationCount < 0 ||
        componentThresholds.length === 0 ||
        componentThresholds.some(
          ([id, score]) =>
            !ASSESSMENT_COMPONENT_IDS.has(
              id as DrillAssessmentComponentId,
            ) || score === undefined || !boundedScore(score),
        )
      ) {
        add(
          "unit.completion_criteria_invalid",
          "Completion thresholds must be finite and within their score/rate bounds.",
          `${unitPath}.completionCriteria`,
        );
      }
    }

    if (track.status === "open" && !track.units.some((unit) => unit.status === "validated")) {
      add(
        "track.open_without_validated_unit",
        "An open track must contain at least one validated unit.",
        trackPath,
      );
    }
    if (track.status === "preview" && track.units.some((unit) => unit.status !== "preview")) {
      add(
        "track.preview_unit_status_invalid",
        "A preview track may contain only preview units.",
        trackPath,
      );
    }
    const minimumRegimes =
      track.completionPolicy.minimumSourceReviewedScenarios;
    if (minimumRegimes !== undefined) {
      const reviewedScenarios = new Set(
        track.units
          .filter(
            (unit) =>
              unit.status === "validated" &&
              unit.evidenceScope.sourceReviewed &&
              unit.evidenceScope.marketEvidence === "source_observed",
          )
          .map((unit) => unit.scenario.id),
      );
      if (
        !Number.isInteger(minimumRegimes) ||
        minimumRegimes < 2 ||
        reviewedScenarios.size < minimumRegimes
      ) {
        add(
          "track.multi_regime_evidence_insufficient",
          "A validated multi-regime track requires at least two distinct source-reviewed scenarios.",
          `${trackPath}.completionPolicy.minimumSourceReviewedScenarios`,
        );
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Evaluates every requirement against one immutable ledger attempt. It never
 * combines a plan score from one run with checkpoint or provenance evidence
 * from another run.
 */
export function ledgerAttemptCompletesTrackUnit(
  unit: PracticeTrackUnit,
  attempt: PracticeLedgerEntry,
): boolean {
  if (unit.status !== "validated" || unit.scenario.dataVersion === null) {
    return false;
  }
  if (
    attempt.scenarioId !== unit.scenario.id ||
    attempt.scenarioDataVersion !== unit.scenario.dataVersion ||
    attempt.scenarioDataFidelity !== unit.scenario.dataFidelity ||
    attempt.sampleData !== unit.scenario.sampleData ||
    attempt.mode !== unit.drill.mode
  ) {
    return false;
  }
  const assessment = attempt.assessment;
  const criteria = unit.completionCriteria;
  if (
    !assessment ||
    assessment.drillId !== unit.drill.id ||
    assessment.definitionVersion !== unit.drill.definitionVersion ||
    assessment.rubricVersion !== unit.drill.rubricVersion ||
    assessment.status !== criteria.assessmentStatus ||
    assessment.overallScore === undefined ||
    !Number.isFinite(assessment.overallScore) ||
    assessment.overallScore < criteria.minimumOverallScore ||
    assessment.violationCount > criteria.maximumViolationCount
  ) {
    return false;
  }
  if (
    assessment.eligibleCheckpointCount <= 0 ||
    assessment.answeredCheckpointCount /
      assessment.eligibleCheckpointCount <
      criteria.minimumAnsweredCheckpointRate ||
    assessment.eligibleEventCount <= 0 ||
    assessment.linkedEventCount / assessment.eligibleEventCount <
      criteria.minimumLinkedEventRate
  ) {
    return false;
  }
  const componentById = new Map(
    assessment.components.map((component) => [component.id, component]),
  );
  return Object.entries(criteria.minimumComponentScores).every(
    ([id, threshold]) => {
      const component = componentById.get(id as DrillAssessmentComponentId);
      return (
        threshold !== undefined &&
        component?.status === "assessed" &&
        component.score !== undefined &&
        component.score >= threshold
      );
    },
  );
}

export function practiceTrackProgress(
  track: PracticeTrack,
  attempts: readonly PracticeLedgerEntry[],
): PracticeTrackProgress {
  const units = [...track.units]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((unit): PracticeTrackUnitProgress => {
      if (unit.status === "preview") {
        return {
          unitId: unit.id,
          unitVersion: unit.version,
          status: "preview",
        };
      }
      const creditedAttempt = attempts.find((attempt) =>
        ledgerAttemptCompletesTrackUnit(unit, attempt),
      );
      return {
        unitId: unit.id,
        unitVersion: unit.version,
        status: creditedAttempt ? "completed" : "incomplete",
        creditedAttemptId: creditedAttempt?.id,
      };
    });
  const creditableUnits = units.filter((unit) => unit.status !== "preview");
  const completedUnitCount = creditableUnits.filter(
    (unit) => unit.status === "completed",
  ).length;
  const status =
    track.status === "preview" || creditableUnits.length === 0
      ? "preview"
      : completedUnitCount === creditableUnits.length
        ? "completed"
        : completedUnitCount > 0
          ? "in_progress"
          : "not_started";

  return {
    trackId: track.id,
    trackVersion: track.version,
    status,
    completedUnitCount,
    creditableUnitCount: creditableUnits.length,
    units,
  };
}
