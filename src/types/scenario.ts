import type {
  AssetClass,
  BenchmarkPoint,
  Candle,
  CorporateAction,
  Granularity,
  IndicatorSnapshot,
  Instrument,
  MarketCalendar,
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
  maxParticipationRate?: number;
  partialFillPolicy?: "disabled" | "volume_limited";
  stopFillPolicy?: "trigger_price" | "gap_open";
  marketHoursEnforced?: boolean;
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
  dataVersion?: string;
  sourceManifest?: string[];
  generatedAt?: string;
  priceAdjustment?: "raw" | "split_adjusted" | "total_return";
  marketCalendarId?: string;
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
  marketCalendar?: MarketCalendar;
  corporateActions?: CorporateAction[];
};
