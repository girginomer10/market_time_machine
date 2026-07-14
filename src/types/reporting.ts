import type { MarketEvent } from "./market";
import type { DataFidelity } from "./scenario";
import type {
  AuditEvent,
  DecisionPlan,
  Fill,
  JournalEntry,
  Order,
} from "./trading";
import type {
  DrillAssessment,
  DrillCheckpoint,
  DrillCheckpointAction,
  DrillCheckpointResponse,
  DrillDefinition,
  DrillRuleViolation,
} from "./practice";

/** Raw checkpoint reflection retained only in a full report/archive snapshot. */
export const PRACTICE_DRILL_REFLECTION_MAX_LENGTH = 2_000;

export type PracticeDrillPlanSnapshot = Readonly<
  Omit<DecisionPlan, "linkedEventIds"> & {
    linkedEventIds?: readonly string[];
  }
>;

export type PracticeDrillEventSnapshot = Readonly<
  Pick<
    MarketEvent,
    "id" | "publishedAt" | "title" | "type" | "importance" | "source"
  >
>;

export type PracticeDrillCheckpointSnapshot = Readonly<
  Omit<DrillCheckpoint, "eventIds"> & {
    eventIds: readonly string[];
  }
>;

/**
 * A validated response captured at a resolved checkpoint. Skipped or malformed
 * responses remain represented by the checkpoint and/or violation evidence.
 */
export type PracticeDrillAnsweredResponseSnapshot = Readonly<
  Omit<
    DrillCheckpointResponse,
    "status" | "action" | "eventIds" | "workingOrderIds"
  > & {
    status: "answered";
    action: DrillCheckpointAction;
    eventIds: readonly string[];
    workingOrderIds?: readonly string[];
  }
>;

export type PracticeDrillCheckpointEvidence = Readonly<{
  checkpoint: PracticeDrillCheckpointSnapshot;
  response?: PracticeDrillAnsweredResponseSnapshot;
  /** Safe display-only event fields; excludes summaries and source URLs. */
  events: readonly PracticeDrillEventSnapshot[];
}>;

/** Self-contained drill evidence retained with a full report and its archive. */
export type PracticeDrillReportSnapshot = Readonly<{
  definition: Readonly<DrillDefinition>;
  initialPlan?: PracticeDrillPlanSnapshot;
  checkpoints: readonly PracticeDrillCheckpointEvidence[];
  violations: readonly Readonly<DrillRuleViolation>[];
}>;

export type BehavioralFlagType =
  | "panic_sell"
  | "fomo_buy"
  | "dip_catching"
  | "early_profit_take"
  | "holding_loser"
  | "overtrading"
  | "news_overreaction"
  | "excessive_leverage";

export type BehavioralFlag = {
  id: string;
  type: BehavioralFlagType;
  severity: 1 | 2 | 3 | 4 | 5;
  tradeIds: string[];
  evidence: string;
  estimatedImpact?: number;
};

export type ReportMetrics = {
  totalReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
  maxDrawdown: number;
  volatility: number;
  sharpe?: number;
  sortino?: number;
  calmar?: number;
  winRate: number;
  profitFactor?: number;
  averageWin?: number;
  averageLoss?: number;
  exposureTime: number;
  turnover: number;
  feesPaid: number;
  slippagePaid: number;
  initialEquity: number;
  finalEquity: number;
  benchmarkInitial: number;
  benchmarkFinal: number;
};

export type EquityPoint = {
  time: string;
  portfolioValue: number;
  benchmarkValue: number;
  isInitial?: boolean;
  financingCost?: number;
  equityAdjustment?: number;
};

export type TradeOutcome = {
  fill: Fill;
  realizedPnl: number;
  contributionPct: number;
  matchedQuantity?: number;
  entryTime?: string;
  positionSide?: "long" | "short";
};

export type FinancingCostPoint = {
  time: string;
  amount: number;
};

export type DecisionActualContext = {
  firstFillTime: string;
  lastFillTime: string;
  fillCount: number;
  executedQuantity: number;
  averageFillPrice: number;
  realizedPnl?: number;
  result: "realized_gain" | "realized_loss" | "realized_flat" | "not_realized";
};

export type DecisionReplayPoint = {
  fill: Fill;
  fills?: Fill[];
  order?: Order;
  decisionTime?: string;
  journalEntry?: JournalEntry;
  decisionPlan?: DecisionPlan;
  visibleEvents?: MarketEvent[];
  linkedEvents?: MarketEvent[];
  auditEvents: AuditEvent[];
  tradeOutcome?: TradeOutcome;
  tradeOutcomes?: TradeOutcome[];
  actual?: DecisionActualContext;
  equityBefore?: number;
  equityAfter?: number;
};

export type PerformanceAttribution = {
  realizedTradePnl: number;
  unrealizedAndResidualPnl: number;
  feesPaid: number;
  slippagePaid: number;
  financingPaid: number;
  benchmarkPnl: number;
  activePnl: number;
};

export type ScenarioProvenance = {
  license: string;
  dataSources: string[];
  sourceManifest?: string[];
  dataVersion?: string;
  generatedAt?: string;
  priceAdjustment?: "raw" | "split_adjusted" | "total_return";
  marketCalendarId?: string;
  isSampleData: boolean;
  dataFidelity?: DataFidelity;
  observedFields?: string[];
  derivedFields?: string[];
};

export type ReportScoreComponentId =
  | "risk_adjusted_return"
  | "benchmark_outperformance"
  | "drawdown_control"
  | "decision_consistency"
  | "journal_quality";

export type ReportScoreComponent = {
  id: ReportScoreComponentId;
  label: string;
  /** Fraction of the overall score. The five documented weights sum to 1. */
  weight: number;
  score?: number;
  status: "scored" | "not_applicable";
  evidence: string;
};

export type ReportScore = {
  status: "scored" | "insufficient_evidence";
  overall?: number;
  components: ReportScoreComponent[];
  methodology: string;
  reason?: string;
};

export type JournalQualitySummary = {
  status: "assessed" | "insufficient_evidence" | "not_applicable";
  score?: number;
  executedDecisionCount: number;
  linkedEntryCount: number;
  coverageRate: number;
  reasonRate: number;
  riskPlanRate: number;
  structuredPlanRate?: number;
  eventLinkRate?: number;
  evidence: string[];
};

export type DecisionConsistencySummary = {
  status: "assessed" | "insufficient_evidence" | "not_applicable";
  score?: number;
  assessedDecisionCount: number;
  behavioralFlagCount: number;
  severeBehavioralFlagCount: number;
  forcedLiquidationCount: number;
  evidence: string[];
};

export type PracticeRecommendation = {
  id: string;
  priority: 1 | 2 | 3;
  title: string;
  rationale: string;
  evidence: string;
  suggestedPractice: string;
};

export type ExecutionQuality = {
  totalFills: number;
  partialFillCount: number;
  rejectedOrderCount: number;
  expiredOrderCount: number;
  forcedLiquidationCount: number;
  marginEventCount: number;
  borrowCostPaid: number;
  averageLiquidityParticipation?: number;
};

export type AuditSummary = {
  totalEvents: number;
  orderEvents: number;
  fillEvents: number;
  riskEvents: number;
};

export type ReportPayload = {
  scenarioId: string;
  scenarioTitle: string;
  metrics: ReportMetrics;
  equityCurve: EquityPoint[];
  bestTrade?: TradeOutcome;
  worstTrade?: TradeOutcome;
  totalTrades: number;
  closedTradeCount?: number;
  tradeOutcomes?: TradeOutcome[];
  fills?: Fill[];
  behavioralFlags: BehavioralFlag[];
  journal?: JournalEntry[];
  decisionReplay?: DecisionReplayPoint[];
  attribution?: PerformanceAttribution;
  provenance?: ScenarioProvenance;
  score?: ReportScore;
  journalQuality?: JournalQualitySummary;
  decisionConsistency?: DecisionConsistencySummary;
  recommendations?: PracticeRecommendation[];
  executionQuality?: ExecutionQuality;
  auditSummary?: AuditSummary;
  orders?: Order[];
  auditEvents?: AuditEvent[];
  /** Versioned process evidence from an active practice drill, when present. */
  practiceAssessment?: DrillAssessment;
  /** Detailed evidence is full-report-only and deliberately excluded from the compact ledger. */
  practiceDrill?: PracticeDrillReportSnapshot;
};
