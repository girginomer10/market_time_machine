export type AssetClass =
  | "crypto"
  | "equity"
  | "index"
  | "fx"
  | "commodity"
  | "rates"
  | "etf";

export type Granularity = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export type Candle = {
  symbol: string;
  openTime: string;
  closeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjustedClose?: number;
  source?: string;
};

export type Instrument = {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  exchange?: string;
  currency: string;
  timezone: string;
  allowFractional?: boolean;
  tickSize?: number;
  lotSize?: number;
};

export type EventType =
  | "news"
  | "earnings"
  | "macro"
  | "central_bank"
  | "regulation"
  | "geopolitical"
  | "analyst_rating"
  | "price_event"
  | "social_sentiment"
  | "onchain"
  | "corporate_action";

export type MarketEvent = {
  id: string;
  happenedAt: string;
  publishedAt: string;
  title: string;
  type: EventType;
  summary: string;
  affectedSymbols: string[];
  importance: 1 | 2 | 3 | 4 | 5;
  sentiment?: "positive" | "negative" | "mixed" | "neutral";
  source?: string;
  sourceUrl?: string;
};

export type IndicatorSnapshot = {
  symbol: string;
  name: string;
  time: string;
  availableAt: string;
  value: number | Record<string, number>;
  parameters?: Record<string, string | number | boolean>;
};

export type BenchmarkPoint = {
  symbol: string;
  time: string;
  value: number;
};

export type TradablePrice = {
  symbol: string;
  time: string;
  price: number;
  bid: number;
  ask: number;
};
