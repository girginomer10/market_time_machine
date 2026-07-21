import {
  validatePracticeTrackCatalog,
  type PracticeTrack,
  type PracticeTrackCompletionCriteria,
  type PracticeTrackEvidenceScope,
  type PracticeTrackUnit,
} from "../../domain/practice/tracks";
import {
  eventDisciplineEurGbpV1,
  eventDisciplineEurUsdV1,
  eventDisciplineKreV1,
  eventDisciplineQqqV1,
} from "./drills";
import {
  buildDrillCheckpointSchedule,
  drillCheckpointScheduleFingerprint,
  drillRubricFingerprint,
} from "../../domain/practice/drills";
import { brokerConfigFingerprint } from "../../domain/broker/executionModels";
import type { BrokerConfig } from "../../types";
import type { ScenarioPackage } from "../../types";
import { eurGbpBrexit2016Scenario } from "../scenarios/eurgbp-brexit-2016";
import { eurUsdCovidLiquidity2020Scenario } from "../scenarios/eurusd-covid-liquidity-2020";
import { qqqRateHike2022Scenario } from "../scenarios/qqq-rate-hike-2022";
import { kreBankingCrisis2023Scenario } from "../scenarios/kre-banking-crisis-2023";
import {
  EURGBP_BREXIT_2016_DATA_VERSION,
  EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION,
  KRE_BANKING_CRISIS_2023_DATA_VERSION,
  QQQ_RATE_HIKE_2022_DATA_VERSION,
} from "../scenarios/dataVersions";
export {
  EURGBP_BREXIT_2016_DATA_VERSION,
  EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION,
} from "../scenarios/dataVersions";

// These duplicated, explicit configs are intentional track-version pins. The
// catalog validator compares their fingerprints with the live scenarios so an
// execution-rule change cannot silently rewrite existing unit identity.
const EURGBP_SCENARIO_BROKER = {
  baseCurrency: "GBP",
  commissionRateBps: 0,
  fixedFee: 0,
  spreadBps: 5,
  slippageModel: "fixed_bps",
  slippageBps: 2,
  allowFractional: true,
  allowShort: true,
  maxLeverage: 3,
  partialFillPolicy: "disabled",
  stopFillPolicy: "gap_open",
  marketHoursEnforced: false,
  marginCallPolicy: "liquidate_on_threshold",
  borrowRateBps: 100,
} as const satisfies BrokerConfig;

const EURUSD_SCENARIO_BROKER = {
  baseCurrency: "USD",
  commissionRateBps: 0,
  fixedFee: 0,
  spreadBps: 3,
  slippageModel: "fixed_bps",
  slippageBps: 1,
  allowFractional: true,
  allowShort: true,
  maxLeverage: 3,
  partialFillPolicy: "disabled",
  stopFillPolicy: "gap_open",
  marketHoursEnforced: false,
  marginCallPolicy: "liquidate_on_threshold",
  borrowRateBps: 100,
} as const satisfies BrokerConfig;

const QQQ_SCENARIO_BROKER = {
  baseCurrency: "USD",
  commissionRateBps: 0,
  fixedFee: 0,
  spreadBps: 3,
  slippageModel: "fixed_bps",
  slippageBps: 2,
  allowFractional: true,
  allowShort: true,
  maxLeverage: 2,
  marginCallPolicy: "reject_new_orders",
  borrowRateBps: 350,
} as const satisfies BrokerConfig;

const KRE_SCENARIO_BROKER = {
  baseCurrency: "USD",
  commissionRateBps: 0,
  fixedFee: 0,
  spreadBps: 5,
  slippageModel: "fixed_bps",
  slippageBps: 4,
  allowFractional: true,
  allowShort: true,
  maxLeverage: 2,
  marginCallPolicy: "reject_new_orders",
  borrowRateBps: 500,
} as const satisfies BrokerConfig;

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
  scenario: ScenarioPackage;
  brokerFingerprint: string;
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
      rubricFingerprint: drillRubricFingerprint(input.drill.rubric),
      checkpointScheduleFingerprint: drillCheckpointScheduleFingerprint(
        buildDrillCheckpointSchedule(input.drill, input.scenario),
      ),
      mode: input.drill.mode,
    },
    broker: {
      mode: "scenario",
      fingerprint: input.brokerFingerprint,
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
  scenarioDataVersion: string;
  scenario: ScenarioPackage;
  brokerFingerprint: string;
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
      dataVersion: input.scenarioDataVersion,
      dataFidelity: "synthetic",
      sampleData: true,
    },
    drill: {
      id: input.drill.id,
      definitionVersion: input.drill.definitionVersion,
      rubricVersion: input.drill.rubricVersion,
      rubricFingerprint: drillRubricFingerprint(input.drill.rubric),
      checkpointScheduleFingerprint: drillCheckpointScheduleFingerprint(
        buildDrillCheckpointSchedule(input.drill, input.scenario),
      ),
      mode: input.drill.mode,
    },
    broker: {
      mode: "scenario",
      fingerprint: input.brokerFingerprint,
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
  scenario: eurGbpBrexit2016Scenario,
  brokerFingerprint: brokerConfigFingerprint(EURGBP_SCENARIO_BROKER),
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
  scenario: eurGbpBrexit2016Scenario,
  brokerFingerprint: brokerConfigFingerprint(EURGBP_SCENARIO_BROKER),
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
  scenario: eurUsdCovidLiquidity2020Scenario,
  brokerFingerprint: brokerConfigFingerprint(EURUSD_SCENARIO_BROKER),
  drill: eventDisciplineEurUsdV1,
});

const volatilityQqqUnit = previewSyntheticUnit({
  id: "volatility-discipline-qqq-v1",
  order: 1,
  title: "Rate-shock event cadence",
  description:
    "Preview the process around official CPI and Federal Reserve releases; synthetic QQQ prices cannot earn track credit.",
  scenarioId: "qqq-rate-hike-2022",
  scenarioDataVersion: QQQ_RATE_HIKE_2022_DATA_VERSION,
  scenario: qqqRateHike2022Scenario,
  brokerFingerprint: brokerConfigFingerprint(QQQ_SCENARIO_BROKER),
  drill: eventDisciplineQqqV1,
});

const volatilityKreUnit = previewSyntheticUnit({
  id: "volatility-discipline-kre-v1",
  order: 2,
  title: "Banking-crisis event cadence",
  description:
    "Preview the process around official regulator and policy releases; synthetic KRE prices cannot earn track credit.",
  scenarioId: "kre-banking-crisis-2023",
  scenarioDataVersion: KRE_BANKING_CRISIS_2023_DATA_VERSION,
  scenario: kreBankingCrisis2023Scenario,
  brokerFingerprint: brokerConfigFingerprint(KRE_SCENARIO_BROKER),
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

const BUILT_IN_TRACK_VALIDATION = validatePracticeTrackCatalog(
  BUILT_IN_TRACKS,
  {
    scenarios: [
      eurGbpBrexit2016Scenario,
      eurUsdCovidLiquidity2020Scenario,
      qqqRateHike2022Scenario,
      kreBankingCrisis2023Scenario,
    ],
    drills: [
      eventDisciplineEurGbpV1,
      eventDisciplineEurUsdV1,
      eventDisciplineQqqV1,
      eventDisciplineKreV1,
    ],
  },
);
if (!BUILT_IN_TRACK_VALIDATION.valid) {
  throw new Error(
    `Built-in practice track catalog is invalid: ${BUILT_IN_TRACK_VALIDATION.issues
      .map((issue) => `${issue.path ?? issue.code}: ${issue.message}`)
      .join(" ")}`,
  );
}

export function listBuiltInPracticeTracks(): PracticeTrack[] {
  return [...BUILT_IN_TRACKS];
}

export function getBuiltInPracticeTrack(id: string): PracticeTrack | undefined {
  return BUILT_IN_TRACKS.find((track) => track.id === id);
}
