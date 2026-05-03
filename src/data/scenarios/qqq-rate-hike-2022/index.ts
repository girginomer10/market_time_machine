import type {
  BenchmarkPoint,
  Candle,
  IndicatorSnapshot,
  Instrument,
  MarketEvent,
} from "../../../types";
import type { BrokerConfig, ScenarioMeta } from "../../../types/scenario";
import { assembleScenario } from "../../../domain/scenario/loader";

const SYMBOL = "QQQ";

const meta: ScenarioMeta = {
  id: "qqq-rate-hike-2022",
  title: "Nasdaq 2022 Rate Shock",
  subtitle:
    "Replay the inflation and Fed tightening cycle through a QQQ growth-stock proxy.",
  assetClass: "etf",
  symbols: [SYMBOL],
  startTime: "2022-01-03T14:30:00.000Z",
  endTime: "2022-12-30T21:00:00.000Z",
  baseCurrency: "USD",
  initialCash: 10_000,
  defaultGranularity: "1d",
  difficulty: "advanced",
  tags: ["equity", "etf", "rate_shock", "inflation", "bear_market"],
  supportedModes: ["explorer", "professional", "challenge"],
  benchmarkSymbol: SYMBOL,
  license: "CC-BY-4.0 (sample data)",
  dataSources: [
    "Synthetic deterministic sample prices shaped to the publicly documented QQQ/Nasdaq 2022 tightening-cycle path; raw licensed ETF market data is not redistributed.",
    "Official event sources: Federal Reserve FOMC statements, Federal Reserve Chair Powell speech, and U.S. Bureau of Labor Statistics CPI releases.",
  ],
  isSampleData: true,
  description:
    "Sample/demo growth-equity scenario for practicing position sizing, rallies within drawdowns, inflation data reactions, and central-bank event risk. Prices are synthetic and should not be used for trading decisions.",
};

const instruments: Instrument[] = [
  {
    symbol: SYMBOL,
    name: "Invesco QQQ Trust proxy",
    assetClass: "etf",
    exchange: "Sample Nasdaq",
    currency: "USD",
    timezone: "America/New_York",
    allowFractional: true,
    tickSize: 0.01,
  },
];

const broker: BrokerConfig = {
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
  { date: "2022-01-03", price: 401.68 },
  { date: "2022-01-27", price: 341.3 },
  { date: "2022-03-16", price: 350.2 },
  { date: "2022-03-29", price: 371.4 },
  { date: "2022-05-20", price: 288.7 },
  { date: "2022-06-16", price: 269.4 },
  { date: "2022-08-15", price: 334.1 },
  { date: "2022-09-30", price: 267.1 },
  { date: "2022-10-13", price: 259.5 },
  { date: "2022-11-30", price: 293.6 },
  { date: "2022-12-28", price: 260.1 },
  { date: "2022-12-30", price: 266.3 },
];

const marketHolidays = new Set([
  "2022-01-17",
  "2022-02-21",
  "2022-04-15",
  "2022-05-30",
  "2022-06-20",
  "2022-07-04",
  "2022-09-05",
  "2022-11-24",
  "2022-12-26",
]);

function buildCandles(): Candle[] {
  const start = Date.UTC(2022, 0, 3);
  const end = Date.UTC(2022, 11, 30);
  const candles: Candle[] = [];
  const rng = mulberry32(0x22_22_20_22);
  let prevClose = anchors[0].price;

  for (let t = start; t <= end; t += DAY_MS) {
    const date = new Date(t);
    const iso = date.toISOString().slice(0, 10);
    if (
      date.getUTCDay() === 0 ||
      date.getUTCDay() === 6 ||
      marketHolidays.has(iso)
    ) {
      continue;
    }

    const target = interpolateAnchors(iso);
    const regime = volatilityRegime(iso);
    const overnightNoise = (rng() - 0.5) * target * 0.008 * regime;
    const drift = target - prevClose;
    const open = Math.max(20, prevClose + overnightNoise);
    const intradayNoise = (rng() - 0.5) * target * 0.015 * regime;
    const close = Math.max(20, open + drift * 0.68 + intradayNoise);
    const directionalRange = Math.abs(close - open);
    const range =
      directionalRange + Math.max(target * 0.01 * regime * (0.7 + rng()), 0.25);
    const high = Math.max(open, close) + range * (0.22 + rng() * 0.34);
    const low = Math.min(open, close) - range * (0.22 + rng() * 0.34);
    const volume =
      38_000_000 +
      rng() * 28_000_000 +
      regime * 12_000_000 +
      Math.abs(close - open) * 2_500_000;
    const { openTime, closeTime } = marketSessionTimes(iso);

    candles.push({
      symbol: SYMBOL,
      openTime,
      closeTime,
      open: round2(open),
      high: round2(high),
      low: round2(Math.max(low, 20)),
      close: round2(close),
      volume: round2(volume),
      source: "sample",
    });
    prevClose = close;
  }

  return candles;
}

function marketSessionTimes(iso: string): {
  openTime: string;
  closeTime: string;
} {
  const isDst = iso >= "2022-03-14" && iso < "2022-11-07";
  return {
    openTime: `${iso}T${isDst ? "13:30" : "14:30"}:00.000Z`,
    closeTime: `${iso}T${isDst ? "20:00" : "21:00"}:00.000Z`,
  };
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

function volatilityRegime(iso: string): number {
  const dayMs = Date.parse(`${iso}T00:00:00Z`);
  const winter = gaussian(dayMs, Date.parse("2022-01-24T00:00:00Z"), 15);
  const june = gaussian(dayMs, Date.parse("2022-06-13T00:00:00Z"), 18);
  const autumn = gaussian(dayMs, Date.parse("2022-09-21T00:00:00Z"), 25);
  return 1 + winter * 1.0 + june * 1.4 + autumn * 1.25;
}

function gaussian(dayMs: number, centerMs: number, widthDays: number): number {
  const days = (dayMs - centerMs) / DAY_MS;
  return Math.exp(-(days * days) / (2 * widthDays * widthDays));
}

const events: MarketEvent[] = [
  {
    id: "evt-2022-01-26-fed-soon",
    happenedAt: "2022-01-26T19:00:00.000Z",
    publishedAt: "2022-01-26T19:00:00.000Z",
    title: "Fed says rate increases will soon be appropriate",
    type: "central_bank",
    summary:
      "The FOMC keeps rates unchanged and says it expects it will soon be appropriate to raise the target range for the federal funds rate.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "negative",
    source: "Federal Reserve FOMC statement",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20220126a.htm",
  },
  {
    id: "evt-2022-02-10-jan-cpi",
    happenedAt: "2022-01-31T21:00:00.000Z",
    publishedAt: "2022-02-10T13:30:00.000Z",
    title: "January CPI rises 7.5% year over year",
    type: "macro",
    summary:
      "BLS reports that the all-items CPI increased 7.5% for the 12 months ending January 2022.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "negative",
    source: "U.S. Bureau of Labor Statistics",
    sourceUrl: "https://www.bls.gov/news.release/archives/cpi_02102022.htm",
  },
  {
    id: "evt-2022-03-16-fed-first-hike",
    happenedAt: "2022-03-16T18:00:00.000Z",
    publishedAt: "2022-03-16T18:00:00.000Z",
    title: "Fed raises rates for the first time in the cycle",
    type: "central_bank",
    summary:
      "The FOMC raises the federal funds target range to 0.25-0.50% and says ongoing increases will be appropriate.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "Federal Reserve FOMC statement",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20220316a.htm",
  },
  {
    id: "evt-2022-05-04-fed-50",
    happenedAt: "2022-05-04T18:00:00.000Z",
    publishedAt: "2022-05-04T18:00:00.000Z",
    title: "Fed raises rates by 50 basis points",
    type: "central_bank",
    summary:
      "The FOMC raises the target range to 0.75-1.00% and announces plans to begin reducing its securities holdings in June.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "Federal Reserve FOMC statement",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20220504a.htm",
  },
  {
    id: "evt-2022-06-10-may-cpi",
    happenedAt: "2022-05-31T20:00:00.000Z",
    publishedAt: "2022-06-10T12:30:00.000Z",
    title: "May CPI reaches 8.6% year over year",
    type: "macro",
    summary:
      "BLS reports that the all-items CPI increased 8.6% for the 12 months ending May 2022.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "U.S. Bureau of Labor Statistics",
    sourceUrl: "https://www.bls.gov/news.release/archives/cpi_06102022.htm",
  },
  {
    id: "evt-2022-06-15-fed-75",
    happenedAt: "2022-06-15T18:00:00.000Z",
    publishedAt: "2022-06-15T18:00:00.000Z",
    title: "Fed raises rates by 75 basis points",
    type: "central_bank",
    summary:
      "The FOMC raises the target range to 1.50-1.75% and says it is strongly committed to returning inflation to 2%.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "Federal Reserve FOMC statement",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20220615a.htm",
  },
  {
    id: "evt-2022-07-13-june-cpi",
    happenedAt: "2022-06-30T20:00:00.000Z",
    publishedAt: "2022-07-13T12:30:00.000Z",
    title: "June CPI reaches 9.1% year over year",
    type: "macro",
    summary:
      "BLS reports that the all-items CPI increased 9.1% for the 12 months ending June 2022.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "U.S. Bureau of Labor Statistics",
    sourceUrl: "https://www.bls.gov/news.release/archives/cpi_07132022.htm",
  },
  {
    id: "evt-2022-07-27-fed-75",
    happenedAt: "2022-07-27T18:00:00.000Z",
    publishedAt: "2022-07-27T18:00:00.000Z",
    title: "Fed makes second 75 basis point hike",
    type: "central_bank",
    summary:
      "The FOMC raises the target range to 2.25-2.50% and says recent indicators of spending and production have softened.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "Federal Reserve FOMC statement",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20220727a.htm",
  },
  {
    id: "evt-2022-08-26-powell-jackson-hole",
    happenedAt: "2022-08-26T14:00:00.000Z",
    publishedAt: "2022-08-26T14:00:00.000Z",
    title: "Powell discusses monetary policy and price stability",
    type: "central_bank",
    summary:
      "Chair Powell says restoring price stability will require using policy tools forcefully and that reducing inflation is likely to require below-trend growth.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "Federal Reserve speech",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/speech/powell20220826a.htm",
  },
  {
    id: "evt-2022-09-13-aug-cpi",
    happenedAt: "2022-08-31T20:00:00.000Z",
    publishedAt: "2022-09-13T12:30:00.000Z",
    title: "August CPI remains elevated",
    type: "macro",
    summary:
      "BLS reports that the all-items CPI increased 8.3% for the 12 months ending August 2022.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "U.S. Bureau of Labor Statistics",
    sourceUrl: "https://www.bls.gov/news.release/archives/cpi_09132022.htm",
  },
  {
    id: "evt-2022-09-21-fed-75",
    happenedAt: "2022-09-21T18:00:00.000Z",
    publishedAt: "2022-09-21T18:00:00.000Z",
    title: "Fed delivers third consecutive 75 basis point hike",
    type: "central_bank",
    summary:
      "The FOMC raises the target range to 3.00-3.25% and says ongoing increases will be appropriate.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "Federal Reserve FOMC statement",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20220921a.htm",
  },
  {
    id: "evt-2022-11-02-fed-75",
    happenedAt: "2022-11-02T18:00:00.000Z",
    publishedAt: "2022-11-02T18:00:00.000Z",
    title: "Fed raises rates by 75 basis points again",
    type: "central_bank",
    summary:
      "The FOMC raises the target range to 3.75-4.00% and says it will account for cumulative tightening and policy lags.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "Federal Reserve FOMC statement",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20221102a.htm",
  },
  {
    id: "evt-2022-11-10-oct-cpi",
    happenedAt: "2022-10-31T20:00:00.000Z",
    publishedAt: "2022-11-10T13:30:00.000Z",
    title: "October CPI rises 7.7% year over year",
    type: "macro",
    summary:
      "BLS reports that the all-items CPI increased 7.7% for the 12 months ending October 2022.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "positive",
    source: "U.S. Bureau of Labor Statistics",
    sourceUrl: "https://www.bls.gov/news.release/archives/cpi_11102022.htm",
  },
  {
    id: "evt-2022-12-14-fed-50",
    happenedAt: "2022-12-14T19:00:00.000Z",
    publishedAt: "2022-12-14T19:00:00.000Z",
    title: "Fed raises rates by 50 basis points",
    type: "central_bank",
    summary:
      "The FOMC raises the target range to 4.25-4.50% and says ongoing increases will be appropriate.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "Federal Reserve FOMC statement",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20221214a.htm",
  },
];

function buildIndicators(candles: Candle[]): IndicatorSnapshot[] {
  const indicators: IndicatorSnapshot[] = [];
  const smaWindow = 20;
  const volWindow = 10;

  for (let i = 0; i < candles.length; i++) {
    if (i + 1 >= smaWindow) {
      const slice = candles.slice(i + 1 - smaWindow, i + 1);
      const sma = slice.reduce((s, c) => s + c.close, 0) / smaWindow;
      indicators.push({
        symbol: SYMBOL,
        name: "SMA20",
        time: candles[i].closeTime,
        availableAt: candles[i].closeTime,
        value: round2(sma),
        parameters: { window: smaWindow },
      });
    }

    if (i + 1 >= volWindow) {
      const slice = candles.slice(i + 1 - volWindow, i + 1);
      const returns = [];
      for (let j = 1; j < slice.length; j++) {
        returns.push(slice[j].close / slice[j - 1].close - 1);
      }
      const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
      const variance =
        returns.reduce((s, r) => s + (r - mean) ** 2, 0) /
        Math.max(1, returns.length - 1);
      indicators.push({
        symbol: SYMBOL,
        name: "RealizedVolatility10",
        time: candles[i].closeTime,
        availableAt: candles[i].closeTime,
        value: round2(Math.sqrt(variance) * Math.sqrt(252) * 100),
        parameters: { window: volWindow, annualized: true, unit: "percent" },
      });
    }
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

export const qqqRateHike2022Scenario = assembleScenario({
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
