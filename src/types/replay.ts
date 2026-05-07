import type {
  BenchmarkPoint,
  Candle,
  IndicatorSnapshot,
  MarketEvent,
  TradablePrice,
} from "./market";
import type { PortfolioSnapshot } from "./trading";
import type {
  AuditEvent,
  MarginSnapshot,
  Order,
  RiskSnapshot,
} from "./trading";

export type ReplayStatus = "idle" | "playing" | "paused" | "finished";

export type ReplaySpeedLabel = "step" | "1x" | "5x" | "20x" | "60x";

export type ReplaySpeed = {
  label: ReplaySpeedLabel;
  candlesPerTick: number;
  tickMs: number;
};

export type ReplayState = {
  scenarioId: string;
  status: ReplayStatus;
  currentIndex: number;
  currentTime: string;
  speed: ReplaySpeed;
};

export type ReplaySnapshot = {
  scenarioId: string;
  currentTime: string;
  currentIndex: number;
  visibleCandles: Candle[];
  visibleEvents: MarketEvent[];
  visibleIndicators: IndicatorSnapshot[];
  visibleBenchmark: BenchmarkPoint[];
  tradablePrices: TradablePrice[];
  portfolio: PortfolioSnapshot;
  margin?: MarginSnapshot;
  risk?: RiskSnapshot;
  auditEvents?: AuditEvent[];
  workingOrders?: Order[];
  replayStatus: ReplayStatus;
};
