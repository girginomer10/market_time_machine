import type {
  BenchmarkPoint,
  Candle,
  IndicatorSnapshot,
  Instrument,
  MarketEvent,
} from "../../../types";
import type { BrokerConfig, ScenarioMeta } from "../../../types/scenario";
import { assembleScenario } from "../../../domain/scenario/loader";

const SYMBOL = "BTCUSD";

const meta: ScenarioMeta = {
  id: "btc-2020-2021",
  title: "Bitcoin 2020–2021",
  subtitle:
    "Replay the COVID crash, halving, and 2021 bull cycle one daily candle at a time.",
  assetClass: "crypto",
  symbols: [SYMBOL],
  startTime: "2020-01-01T00:00:00.000Z",
  endTime: "2021-12-31T00:00:00.000Z",
  baseCurrency: "USD",
  initialCash: 10_000,
  defaultGranularity: "1d",
  difficulty: "intermediate",
  tags: ["crypto", "bull_market", "crash", "halving"],
  supportedModes: ["explorer", "professional"],
  benchmarkSymbol: SYMBOL,
  license: "CC-BY-4.0 (sample data)",
  dataSources: [
    "Synthetic deterministic sample data shaped to the publicly known BTC 2020-2021 macro path.",
  ],
  isSampleData: true,
  description:
    "Sample/demo dataset for the open source Financial History Lab vertical slice. Prices are deterministic samples that follow the public macro shape of BTC during 2020-2021. Not for trading decisions.",
};

const instruments: Instrument[] = [
  {
    symbol: SYMBOL,
    name: "Bitcoin / US Dollar",
    assetClass: "crypto",
    exchange: "Sample Exchange",
    currency: "USD",
    timezone: "UTC",
    allowFractional: true,
    tickSize: 0.01,
  },
];

const broker: BrokerConfig = {
  baseCurrency: "USD",
  commissionRateBps: 10,
  fixedFee: 0,
  spreadBps: 8,
  slippageModel: "fixed_bps",
  slippageBps: 4,
  allowFractional: true,
  allowShort: false,
  maxLeverage: 1,
  marginCallPolicy: "disabled",
};

const DAY_MS = 86_400_000;

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type Anchor = { date: string; price: number };

const anchors: Anchor[] = [
  { date: "2020-01-01", price: 7200 },
  { date: "2020-02-13", price: 10350 },
  { date: "2020-03-12", price: 4900 },
  { date: "2020-05-11", price: 8800 },
  { date: "2020-07-26", price: 9700 },
  { date: "2020-10-21", price: 12950 },
  { date: "2020-12-31", price: 28950 },
  { date: "2021-01-08", price: 41000 },
  { date: "2021-02-21", price: 57500 },
  { date: "2021-04-14", price: 64850 },
  { date: "2021-05-19", price: 36800 },
  { date: "2021-07-20", price: 29800 },
  { date: "2021-09-07", price: 46500 },
  { date: "2021-11-10", price: 68950 },
  { date: "2021-12-31", price: 47200 },
];

function buildCandles(): Candle[] {
  const start = Date.UTC(2020, 0, 1);
  const end = Date.UTC(2021, 11, 31);
  const candles: Candle[] = [];
  const rng = mulberry32(0x42_42_42_42);
  let prevClose = anchors[0].price;
  for (let t = start; t <= end; t += DAY_MS) {
    const date = new Date(t);
    const iso = date.toISOString().slice(0, 10);
    const target = interpolateAnchors(iso);
    const drift = target - prevClose;
    const noise = (rng() - 0.5) * Math.max(target * 0.025, 30);
    const close = Math.max(1000, prevClose + drift * 0.55 + noise);
    const open = prevClose;
    const directionalRange = Math.abs(close - open);
    const wick = directionalRange * (0.4 + rng() * 0.8);
    const high = Math.max(open, close) + wick * (0.3 + rng() * 0.7);
    const low = Math.min(open, close) - wick * (0.3 + rng() * 0.7);
    const volume = 8000 + rng() * 22000 + Math.abs(close - open) * 4;
    const openTime = new Date(t).toISOString();
    const closeTime = new Date(t + DAY_MS - 1).toISOString();
    candles.push({
      symbol: SYMBOL,
      openTime,
      closeTime,
      open: round2(open),
      high: round2(high),
      low: round2(Math.max(low, 800)),
      close: round2(close),
      volume: round2(volume),
      source: "sample",
    });
    prevClose = close;
  }
  return candles;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function interpolateAnchors(iso: string): number {
  const dayMs = Date.parse(`${iso}T00:00:00Z`);
  let prev = anchors[0];
  for (let i = 0; i < anchors.length; i++) {
    const cur = anchors[i];
    const curMs = Date.parse(`${cur.date}T00:00:00Z`);
    if (curMs >= dayMs) {
      const prevMs = Date.parse(`${prev.date}T00:00:00Z`);
      if (curMs === prevMs) return cur.price;
      const t = (dayMs - prevMs) / (curMs - prevMs);
      return prev.price + (cur.price - prev.price) * t;
    }
    prev = cur;
  }
  return prev.price;
}

const events: MarketEvent[] = [
  {
    id: "evt-2020-03-11-who",
    happenedAt: "2020-03-11T17:00:00.000Z",
    publishedAt: "2020-03-11T17:00:00.000Z",
    title: "WHO declares COVID-19 a pandemic",
    type: "macro",
    summary:
      "The World Health Organization formally declares the COVID-19 outbreak a global pandemic.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "WHO press conference",
  },
  {
    id: "evt-2020-03-15-fed",
    happenedAt: "2020-03-15T22:00:00.000Z",
    publishedAt: "2020-03-15T22:00:00.000Z",
    title: "Federal Reserve cuts rates to near zero",
    type: "central_bank",
    summary:
      "The Federal Reserve announces an emergency rate cut bringing the federal funds rate target range to 0–0.25%.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "Federal Reserve press release",
  },
  {
    id: "evt-2020-05-11-halving",
    happenedAt: "2020-05-11T19:23:00.000Z",
    publishedAt: "2020-05-11T19:23:00.000Z",
    title: "Bitcoin third halving completed",
    type: "onchain",
    summary:
      "Bitcoin completes its third programmatic halving, reducing the per-block subsidy from 12.5 to 6.25 BTC.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "neutral",
  },
  {
    id: "evt-2020-08-11-microstrategy",
    happenedAt: "2020-08-11T20:00:00.000Z",
    publishedAt: "2020-08-11T20:00:00.000Z",
    title: "MicroStrategy announces $250M Bitcoin treasury purchase",
    type: "corporate_action",
    summary:
      "MicroStrategy discloses an initial $250M purchase of Bitcoin as a primary treasury reserve asset.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "positive",
  },
  {
    id: "evt-2020-10-08-square",
    happenedAt: "2020-10-08T13:00:00.000Z",
    publishedAt: "2020-10-08T13:00:00.000Z",
    title: "Square allocates $50M to Bitcoin",
    type: "corporate_action",
    summary:
      "Square Inc. announces an investment of approximately $50M in Bitcoin, equal to about 1% of its total assets.",
    affectedSymbols: [SYMBOL],
    importance: 3,
    sentiment: "positive",
  },
  {
    id: "evt-2020-12-21-coinbase",
    happenedAt: "2020-12-17T13:00:00.000Z",
    publishedAt: "2020-12-17T13:00:00.000Z",
    title: "Bitcoin breaks above prior all-time high",
    type: "price_event",
    summary:
      "Bitcoin trades above its 2017 all-time high for the first time, drawing renewed mainstream attention.",
    affectedSymbols: [SYMBOL],
    importance: 3,
    sentiment: "positive",
  },
  {
    id: "evt-2021-02-08-tesla",
    happenedAt: "2021-02-08T13:30:00.000Z",
    publishedAt: "2021-02-08T13:30:00.000Z",
    title: "Tesla discloses $1.5B Bitcoin purchase",
    type: "corporate_action",
    summary:
      "Tesla files an SEC update disclosing $1.5B in Bitcoin holdings and plans to begin accepting BTC as payment.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "positive",
  },
  {
    id: "evt-2021-04-14-coinbase",
    happenedAt: "2021-04-14T13:30:00.000Z",
    publishedAt: "2021-04-14T13:30:00.000Z",
    title: "Coinbase direct listing on Nasdaq",
    type: "corporate_action",
    summary:
      "Coinbase Global lists on Nasdaq via direct listing, marking the first major US crypto exchange to go public.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "positive",
  },
  {
    id: "evt-2021-05-12-tesla-reverse",
    happenedAt: "2021-05-12T22:00:00.000Z",
    publishedAt: "2021-05-12T22:00:00.000Z",
    title: "Tesla suspends Bitcoin payments citing energy concerns",
    type: "corporate_action",
    summary:
      "Tesla announces a suspension of Bitcoin as a payment method, citing fossil-fuel use in mining.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
  },
  {
    id: "evt-2021-05-19-china-ban",
    happenedAt: "2021-05-18T08:00:00.000Z",
    publishedAt: "2021-05-18T08:00:00.000Z",
    title: "Chinese financial associations restate crypto ban",
    type: "regulation",
    summary:
      "Three Chinese financial industry associations issue a joint statement reiterating restrictions on crypto-related services.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
  },
  {
    id: "evt-2021-06-09-elsalvador-law",
    happenedAt: "2021-06-09T06:00:00.000Z",
    publishedAt: "2021-06-09T06:00:00.000Z",
    title: "El Salvador legislature passes Bitcoin Law",
    type: "regulation",
    summary:
      "The Legislative Assembly of El Salvador passes a law recognizing Bitcoin as legal tender, with implementation scheduled within 90 days.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "positive",
  },
  {
    id: "evt-2021-09-07-elsalvador",
    happenedAt: "2021-09-07T06:00:00.000Z",
    publishedAt: "2021-09-07T06:00:00.000Z",
    title: "El Salvador Bitcoin Law takes effect",
    type: "regulation",
    summary:
      "El Salvador's Bitcoin Law enters into force, making BTC legal tender alongside the US dollar.",
    affectedSymbols: [SYMBOL],
    importance: 3,
    sentiment: "positive",
  },
  {
    id: "evt-2021-10-19-bitoetf",
    happenedAt: "2021-10-19T13:30:00.000Z",
    publishedAt: "2021-10-19T13:30:00.000Z",
    title: "First US Bitcoin futures ETF (BITO) begins trading",
    type: "regulation",
    summary:
      "ProShares' BITO begins trading on NYSE Arca as the first US Bitcoin-linked ETF.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "positive",
  },
  {
    id: "evt-2021-11-10-cpi",
    happenedAt: "2021-11-10T13:30:00.000Z",
    publishedAt: "2021-11-10T13:30:00.000Z",
    title: "US October CPI prints 6.2% year over year",
    type: "macro",
    summary:
      "US Bureau of Labor Statistics reports October CPI at 6.2% YoY, the highest reading in three decades.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "mixed",
  },
];

function buildIndicators(candles: Candle[]): IndicatorSnapshot[] {
  const indicators: IndicatorSnapshot[] = [];
  const window = 20;
  for (let i = 0; i < candles.length; i++) {
    if (i + 1 < window) continue;
    const slice = candles.slice(i + 1 - window, i + 1);
    const sma = slice.reduce((s, c) => s + c.close, 0) / window;
    indicators.push({
      symbol: SYMBOL,
      name: "SMA20",
      time: candles[i].closeTime,
      availableAt: candles[i].closeTime,
      value: round2(sma),
      parameters: { window },
    });
  }
  return indicators;
}

function buildBenchmarks(candles: Candle[]): BenchmarkPoint[] {
  return candles.map((c) => ({
    symbol: SYMBOL,
    time: c.closeTime,
    value: c.close,
  }));
}

const candles = buildCandles();
const indicators = buildIndicators(candles);
const benchmarks = buildBenchmarks(candles);

export const btc20202021Scenario = assembleScenario({
  scenario: meta,
  instruments,
  candles,
  events,
  indicators,
  benchmarks,
  broker,
});

export const scenarioCatalogEntry = {
  id: meta.id,
  title: meta.title,
  subtitle: meta.subtitle ?? "",
  isSampleData: meta.isSampleData ?? false,
};
