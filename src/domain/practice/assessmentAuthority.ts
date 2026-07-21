import { getDrillForScenario } from "../../data/practice/drills";
import { getScenario } from "../../data/scenarios";
import { scenarioDataVersionsEqual } from "../../data/scenarios/dataVersions";
import type { DrillDefinition, ReportPayload } from "../../types";
import { completedPracticeAssessmentScore } from "./evidenceProfile";
import {
  assessmentMatchesCheckpointScheduleFingerprint,
  assessmentMatchesRubricFingerprint,
  buildDrillCheckpointSchedule,
  drillCheckpointScheduleFingerprint,
  drillRubricFingerprint,
} from "./drills";

export type AuthoritativePracticeAssessmentContext = {
  definition: DrillDefinition;
  checkpointScheduleFingerprint: string;
  source: "archived_snapshot" | "current_catalog";
};

function definitionMatchesAssessment(
  definition: DrillDefinition,
  report: Pick<ReportPayload, "scenarioId" | "practiceAssessment">,
): boolean {
  const assessment = report.practiceAssessment;
  return Boolean(
    assessment &&
      definition.scenarioId === report.scenarioId &&
      definition.id === assessment.drillId &&
      definition.competencyId === assessment.competencyId &&
      definition.definitionVersion === assessment.definitionVersion &&
      definition.rubricVersion === assessment.rubricVersion &&
      assessmentMatchesRubricFingerprint(
        assessment,
        drillRubricFingerprint(definition.rubric),
      ),
  );
}

/**
 * Resolves the schedule that is allowed to label a retained assessment as
 * measured. A full archived drill snapshot is its own immutable authority;
 * assessment-only records must still match the current exact scenario data and
 * complete current drill schedule.
 */
export function authoritativePracticeAssessmentContext(
  report: Pick<
    ReportPayload,
    | "scenarioId"
    | "provenance"
    | "practiceAssessment"
    | "practiceDrill"
  >,
): AuthoritativePracticeAssessmentContext | undefined {
  const assessment = report.practiceAssessment;
  if (!assessment || !assessmentMatchesCheckpointScheduleFingerprint(assessment)) {
    return undefined;
  }

  const snapshot = report.practiceDrill;
  if (snapshot) {
    const checkpointScheduleFingerprint =
      drillCheckpointScheduleFingerprint(
        snapshot.checkpoints.map((entry) => ({
          ...entry.checkpoint,
          eventIds: [...entry.checkpoint.eventIds],
        })),
      );
    return definitionMatchesAssessment(snapshot.definition, report) &&
      assessment.checkpointScheduleFingerprint === checkpointScheduleFingerprint
      ? {
          definition: snapshot.definition,
          checkpointScheduleFingerprint,
          source: "archived_snapshot",
        }
      : undefined;
  }

  const scenario = getScenario(report.scenarioId);
  if (
    !scenario ||
    !scenarioDataVersionsEqual(
      report.scenarioId,
      report.provenance?.dataVersion,
      scenario.meta.dataVersion,
    )
  ) {
    return undefined;
  }
  const definition = getDrillForScenario(assessment.drillId, scenario);
  if (!definition || !definitionMatchesAssessment(definition, report)) {
    return undefined;
  }
  const checkpointScheduleFingerprint = drillCheckpointScheduleFingerprint(
    buildDrillCheckpointSchedule(definition, scenario),
  );
  return assessment.checkpointScheduleFingerprint ===
    checkpointScheduleFingerprint
    ? {
        definition,
        checkpointScheduleFingerprint,
        source: "current_catalog",
      }
    : undefined;
}

export function authoritativeCompletedPracticeAssessmentScore(
  report: Pick<
    ReportPayload,
    | "scenarioId"
    | "provenance"
    | "practiceAssessment"
    | "practiceDrill"
  >,
  executionCount: number,
): number | undefined {
  return authoritativePracticeAssessmentContext(report)
    ? completedPracticeAssessmentScore(
        report.practiceAssessment,
        executionCount,
      )
    : undefined;
}
