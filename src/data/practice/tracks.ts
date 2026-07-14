import type {
  PracticeTrack,
  PracticeTrackCompletionCriteria,
  PracticeTrackEvidenceScope,
  PracticeTrackUnit,
} from "../../domain/practice/tracks";
import {
  eventDisciplineEurGbpV1,
  eventDisciplineEurUsdV1,
  eventDisciplineKreV1,
  eventDisciplineQqqV1,
} from "./drills";

export const EURGBP_BREXIT_2016_DATA_VERSION =
  "ECB EXR D.GBP.EUR.SP00.A; retrieved 2026-07-13T00:00:00.000Z" as const;
export const EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION =
  "ECB EXR D.USD.EUR.SP00.A; retrieved 2026-07-14T00:00:00.000Z" as const;

const CLEAN_EVENT_PROCESS_CRITERIA = {
  assessmentStatus: "completed",
  minimumOverallScore: 80,
  minimumComponentScores: {
    plan_coverage: 80,
    checkpoint_coverage: 100,
    event_linkage: 100,
    rule_adherence: 100,
  },
  minimumAnsweredCheckpointRate: 1,
  minimumLinkedEventRate: 1,
  maximumViolationCount: 0,
} as const satisfies PracticeTrackCompletionCriteria;

const SOURCE_OBSERVED_FX_SCOPE = {
  marketEvidence: "source_observed",
  eventEvidence: "official_sources",
  dataFidelity: "mixed",
  sampleData: false,
  sourceReviewed: true,
  limitations:
    "The daily ECB reference-rate observation is source-observed; open, high, low, and volume are derived or unavailable, so this is not intraday execution evidence.",
} as const satisfies PracticeTrackEvidenceScope;

const OFFICIAL_EVENTS_SYNTHETIC_MARKET_SCOPE = {
  marketEvidence: "synthetic",
  eventEvidence: "official_sources",
  dataFidelity: "synthetic",
  sampleData: true,
  sourceReviewed: false,
  limitations:
    "Event publications and timestamps cite official sources, but every market price and benchmark value is synthetic sample data and is not completion-grade market evidence.",
} as const satisfies PracticeTrackEvidenceScope;

function validatedFxUnit(input: {
  id: string;
  order: number;
  title: string;
  description: string;
  scenarioId: string;
  scenarioDataVersion: string;
  drill: typeof eventDisciplineEurGbpV1;
}): PracticeTrackUnit {
  return {
    id: input.id,
    version: 1,
    status: "validated",
    order: input.order,
    title: input.title,
    description: input.description,
    scenario: {
      id: input.scenarioId,
      dataVersion: input.scenarioDataVersion,
      dataFidelity: "mixed",
      sampleData: false,
    },
    drill: {
      id: input.drill.id,
      definitionVersion: input.drill.definitionVersion,
      rubricVersion: input.drill.rubricVersion,
      mode: input.drill.mode,
    },
    evidenceScope: SOURCE_OBSERVED_FX_SCOPE,
    completionCriteria: CLEAN_EVENT_PROCESS_CRITERIA,
  };
}

function previewSyntheticUnit(input: {
  id: string;
  order: number;
  title: string;
  description: string;
  scenarioId: string;
  drill: typeof eventDisciplineQqqV1;
}): PracticeTrackUnit {
  return {
    id: input.id,
    version: 1,
    status: "preview",
    order: input.order,
    title: input.title,
    description: input.description,
    scenario: {
      id: input.scenarioId,
      dataVersion: null,
      dataFidelity: "synthetic",
      sampleData: true,
    },
    drill: {
      id: input.drill.id,
      definitionVersion: input.drill.definitionVersion,
      rubricVersion: input.drill.rubricVersion,
      mode: input.drill.mode,
    },
    evidenceScope: OFFICIAL_EVENTS_SYNTHETIC_MARKET_SCOPE,
    completionCriteria: CLEAN_EVENT_PROCESS_CRITERIA,
  };
}

export const DECISION_FOUNDATIONS_TRACK_ID =
  "decision-foundations-v1" as const;
export const EVENT_PRESSURE_TRANSFER_TRACK_ID =
  "event-pressure-transfer-v1" as const;
export const VOLATILITY_DISCIPLINE_TRACK_ID =
  "volatility-discipline-v1" as const;

const decisionFoundationsEurGbpUnit = validatedFxUnit({
  id: "decision-foundations-eurgbp-v1",
  order: 1,
  title: "Plan before the Brexit event path",
  description:
    "Demonstrate a complete initial plan and a clean response at every important EUR/GBP event checkpoint.",
  scenarioId: "eurgbp-brexit-2016",
  scenarioDataVersion: EURGBP_BREXIT_2016_DATA_VERSION,
  drill: eventDisciplineEurGbpV1,
});

const eventPressureEurGbpUnit = validatedFxUnit({
  id: "event-pressure-transfer-eurgbp-v1",
  order: 1,
  title: "Political shock and policy response",
  description:
    "Apply event discipline to the Brexit result and the policy sequence that follows it.",
  scenarioId: "eurgbp-brexit-2016",
  scenarioDataVersion: EURGBP_BREXIT_2016_DATA_VERSION,
  drill: eventDisciplineEurGbpV1,
});

const eventPressureEurUsdUnit = validatedFxUnit({
  id: "event-pressure-transfer-eurusd-v1",
  order: 2,
  title: "Pandemic liquidity and central-bank response",
  description:
    "Transfer the same process to a different regime with overlapping health, funding, Fed, and ECB releases.",
  scenarioId: "eurusd-covid-liquidity-2020",
  scenarioDataVersion: EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION,
  drill: eventDisciplineEurUsdV1,
});

const volatilityQqqUnit = previewSyntheticUnit({
  id: "volatility-discipline-qqq-v1",
  order: 1,
  title: "Rate-shock event cadence",
  description:
    "Preview the process around official CPI and Federal Reserve releases; synthetic QQQ prices cannot earn track credit.",
  scenarioId: "qqq-rate-hike-2022",
  drill: eventDisciplineQqqV1,
});

const volatilityKreUnit = previewSyntheticUnit({
  id: "volatility-discipline-kre-v1",
  order: 2,
  title: "Banking-crisis event cadence",
  description:
    "Preview the process around official regulator and policy releases; synthetic KRE prices cannot earn track credit.",
  scenarioId: "kre-banking-crisis-2023",
  drill: eventDisciplineKreV1,
});

export const decisionFoundationsTrack = {
  id: DECISION_FOUNDATIONS_TRACK_ID,
  version: 1,
  status: "open",
  title: "Decision Foundations",
  description:
    "Build the minimum repeatable habit: plan first, then respond explicitly to each newly visible high-importance event.",
  completionPolicy: {
    unitEvidence: "all_criteria_same_attempt",
    trackCompletion: "all_validated_units",
  },
  units: [decisionFoundationsEurGbpUnit],
} as const satisfies PracticeTrack;

export const eventPressureTransferTrack = {
  id: EVENT_PRESSURE_TRANSFER_TRACK_ID,
  version: 1,
  status: "open",
  title: "Event Pressure Transfer",
  description:
    "Prove the same process in two distinct source-reviewed FX regimes without combining evidence across attempts.",
  completionPolicy: {
    unitEvidence: "all_criteria_same_attempt",
    trackCompletion: "all_validated_units",
    minimumSourceReviewedScenarios: 2,
  },
  units: [eventPressureEurGbpUnit, eventPressureEurUsdUnit],
} as const satisfies PracticeTrack;

export const volatilityDisciplineTrack = {
  id: VOLATILITY_DISCIPLINE_TRACK_ID,
  version: 1,
  status: "preview",
  title: "Volatility Discipline",
  description:
    "Preview event-discipline transfer into equity and banking volatility while keeping official-event evidence separate from synthetic market paths.",
  completionPolicy: {
    unitEvidence: "all_criteria_same_attempt",
    trackCompletion: "all_validated_units",
  },
  units: [volatilityQqqUnit, volatilityKreUnit],
} as const satisfies PracticeTrack;

const BUILT_IN_TRACKS: readonly PracticeTrack[] = [
  decisionFoundationsTrack,
  eventPressureTransferTrack,
  volatilityDisciplineTrack,
];

export function listBuiltInPracticeTracks(): PracticeTrack[] {
  return [...BUILT_IN_TRACKS];
}

export function getBuiltInPracticeTrack(id: string): PracticeTrack | undefined {
  return BUILT_IN_TRACKS.find((track) => track.id === id);
}
