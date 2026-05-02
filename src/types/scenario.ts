import type {
  AssetClass,
  BenchmarkPoint,
  Candle,
  Granularity,
  IndicatorSnapshot,
  Instrument,
  MarketEvent,
} from "./market";

export type ScenarioMode = "explorer" | "professional" | "blind" | "challenge";

export type Difficulty = "beginner" | "intermediate" | "advanced" | "expert";

export type SlippageModel =
  | "none"
  | "fixed_bps"
  | "volume_based"
  | "volatility_based";

export type BrokerConfig = {
  baseCurrency: string;
  commissionRateBps: number;
  fixedFee: number;
  spreadBps: number;
  slippageModel: SlippageModel;
  slippageBps?: number;
  allowFractional: boolean;
  allowShort: boolean;
  maxLeverage: number;
  marginCallPolicy?: "disabled" | "liquidate_on_threshold" | "reject_new_orders";
  borrowRateBps?: number;
};

export type ScenarioMeta = {
  id: string;
  title: string;
  subtitle?: string;
  assetClass: AssetClass;
  symbols: string[];
  startTime: string;
  endTime: string;
  baseCurrency: string;
  initialCash: number;
  defaultGranularity: Granularity;
  difficulty: Difficulty;
  tags: string[];
  supportedModes: ScenarioMode[];
  benchmarkSymbol?: string;
  license: string;
  dataSources: string[];
  isSampleData?: boolean;
  description?: string;
};

export type ScenarioPackage = {
  meta: ScenarioMeta;
  instruments: Instrument[];
  candles: Candle[];
  events: MarketEvent[];
  indicators: IndicatorSnapshot[];
  benchmarks: BenchmarkPoint[];
  broker: BrokerConfig;
};
