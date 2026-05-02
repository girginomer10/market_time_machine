import type { Fill } from "./trading";

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
};

export type TradeOutcome = {
  fill: Fill;
  realizedPnl: number;
  contributionPct: number;
};

export type ReportPayload = {
  scenarioId: string;
  scenarioTitle: string;
  metrics: ReportMetrics;
  equityCurve: EquityPoint[];
  bestTrade?: TradeOutcome;
  worstTrade?: TradeOutcome;
  totalTrades: number;
  behavioralFlags: BehavioralFlag[];
};
