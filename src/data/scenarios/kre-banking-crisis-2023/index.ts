import type {
  BenchmarkPoint,
  Candle,
  IndicatorSnapshot,
  Instrument,
  MarketEvent,
} from "../../../types";
import type { BrokerConfig, ScenarioMeta } from "../../../types/scenario";
import { assembleScenario } from "../../../domain/scenario/loader";

const SYMBOL = "KRE";

const meta: ScenarioMeta = {
  id: "kre-banking-crisis-2023",
  title: "Regional Banking Crisis 2023",
  subtitle:
    "Replay the SVB, Signature, and First Republic stress cycle through a regional-bank ETF proxy.",
  assetClass: "etf",
  symbols: [SYMBOL],
  startTime: "2023-03-01T14:30:00.000Z",
  endTime: "2023-06-30T20:00:00.000Z",
  baseCurrency: "USD",
  initialCash: 10_000,
  defaultGranularity: "1d",
  difficulty: "advanced",
  tags: ["equity", "etf", "banking", "liquidity_crisis", "rate_shock"],
  supportedModes: ["explorer", "professional", "challenge"],
  benchmarkSymbol: SYMBOL,
  license: "CC-BY-4.0 (sample data)",
  dataSources: [
    "Synthetic deterministic sample prices shaped to the publicly documented 2023 U.S. regional-bank stress path; raw licensed ETF market data is not redistributed.",
    "Official event sources: FDIC, Federal Reserve, Treasury/Fed/FDIC joint statement, OCC, and California DFPI.",
  ],
  isSampleData: true,
  description:
    "Sample/demo regional-bank scenario for practicing panic, liquidity, deposit-confidence, and policy-response decisions. Prices are synthetic and should not be used for trading decisions.",
};

const instruments: Instrument[] = [
  {
    symbol: SYMBOL,
    name: "SPDR S&P Regional Banking ETF proxy",
    assetClass: "etf",
    exchange: "Sample NYSE Arca",
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
  spreadBps: 5,
  slippageModel: "fixed_bps",
  slippageBps: 4,
  allowFractional: true,
  allowShort: true,
  maxLeverage: 2,
  marginCallPolicy: "reject_new_orders",
  borrowRateBps: 500,
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
  { date: "2023-03-01", price: 61.5 },
  { date: "2023-03-08", price: 59.2 },
  { date: "2023-03-10", price: 51.4 },
  { date: "2023-03-13", price: 43.8 },
  { date: "2023-03-17", price: 41.2 },
  { date: "2023-03-24", price: 38.1 },
  { date: "2023-03-27", price: 42.4 },
  { date: "2023-04-18", price: 44.1 },
  { date: "2023-04-25", price: 39.2 },
  { date: "2023-05-01", price: 37.3 },
  { date: "2023-05-04", price: 34.9 },
  { date: "2023-05-31", price: 39.7 },
  { date: "2023-06-14", price: 41.8 },
  { date: "2023-06-30", price: 42.9 },
];

const marketHolidays = new Set(["2023-04-07", "2023-05-29", "2023-06-19"]);

function buildCandles(): Candle[] {
  const start = Date.UTC(2023, 2, 1);
  const end = Date.UTC(2023, 5, 30);
  const candles: Candle[] = [];
  const rng = mulberry32(0x23_03_10_23);
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
    const overnightNoise = (rng() - 0.5) * target * 0.012 * regime;
    const drift = target - prevClose;
    const open = Math.max(5, prevClose + overnightNoise);
    const intradayNoise = (rng() - 0.5) * target * 0.02 * regime;
    const close = Math.max(5, open + drift * 0.74 + intradayNoise);
    const directionalRange = Math.abs(close - open);
    const range =
      directionalRange + Math.max(target * 0.014 * regime * (0.7 + rng()), 0.15);
    const high = Math.max(open, close) + range * (0.22 + rng() * 0.35);
    const low = Math.min(open, close) - range * (0.25 + rng() * 0.4);
    const volume =
      9_000_000 +
      rng() * 8_000_000 +
      regime * 12_000_000 +
      Math.abs(close - open) * 4_000_000;
    const { openTime, closeTime } = marketSessionTimes(iso);

    candles.push({
      symbol: SYMBOL,
      openTime,
      closeTime,
      open: round2(open),
      high: round2(high),
      low: round2(Math.max(low, 5)),
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
  const isDst = iso >= "2023-03-13" && iso < "2023-11-06";
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
  const svb = gaussian(dayMs, Date.parse("2023-03-13T00:00:00Z"), 8);
  const firstRepublic = gaussian(dayMs, Date.parse("2023-05-01T00:00:00Z"), 9);
  return 1 + svb * 3.4 + firstRepublic * 1.8;
}

function gaussian(dayMs: number, centerMs: number, widthDays: number): number {
  const days = (dayMs - centerMs) / DAY_MS;
  return Math.exp(-(days * days) / (2 * widthDays * widthDays));
}

const events: MarketEvent[] = [
  {
    id: "evt-2023-03-08-silvergate-liquidation",
    happenedAt: "2023-03-08T21:30:00.000Z",
    publishedAt: "2023-03-08T21:30:00.000Z",
    title: "Silvergate Bank announces voluntary liquidation",
    type: "corporate_action",
    summary:
      "Silvergate Capital says it intends to wind down operations and voluntarily liquidate Silvergate Bank in an orderly manner.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "negative",
    source: "California DFPI statement",
    sourceUrl:
      "https://dfpi.ca.gov/press_release/dfpi-statement-silvergate-bank-to-begin-voluntary-liquidation/",
  },
  {
    id: "evt-2023-03-10-svb-closed",
    happenedAt: "2023-03-10T16:15:00.000Z",
    publishedAt: "2023-03-10T16:15:00.000Z",
    title: "FDIC appointed receiver for Silicon Valley Bank",
    type: "regulation",
    summary:
      "California regulators close Silicon Valley Bank and appoint the FDIC as receiver; the FDIC creates a deposit insurance national bank for insured depositors.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "FDIC press release",
    sourceUrl: "https://www.fdic.gov/news/press-releases/2023/pr23016.html",
  },
  {
    id: "evt-2023-03-12-signature-closed",
    happenedAt: "2023-03-12T22:00:00.000Z",
    publishedAt: "2023-03-12T22:00:00.000Z",
    title: "FDIC establishes Signature Bridge Bank",
    type: "regulation",
    summary:
      "New York regulators close Signature Bank and appoint the FDIC as receiver; the FDIC establishes Signature Bridge Bank as successor.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "FDIC press release",
    sourceUrl: "https://www.fdic.gov/news/press-releases/2023/pr23018.html",
  },
  {
    id: "evt-2023-03-12-joint-depositor-statement",
    happenedAt: "2023-03-12T23:15:00.000Z",
    publishedAt: "2023-03-12T23:15:00.000Z",
    title: "Treasury, Fed, and FDIC issue joint depositor statement",
    type: "regulation",
    summary:
      "Treasury, the Federal Reserve, and the FDIC announce actions intended to protect depositors at Silicon Valley Bank and Signature Bank.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "Federal Reserve joint statement",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20230312b.htm",
  },
  {
    id: "evt-2023-03-12-btfp",
    happenedAt: "2023-03-12T23:15:00.000Z",
    publishedAt: "2023-03-12T23:15:00.000Z",
    title: "Federal Reserve announces Bank Term Funding Program",
    type: "central_bank",
    summary:
      "The Federal Reserve says it will make additional funding available to eligible depository institutions to help meet depositor needs.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "positive",
    source: "Federal Reserve press release",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20230312a.htm",
  },
  {
    id: "evt-2023-03-19-signature-flagstar",
    happenedAt: "2023-03-19T23:30:00.000Z",
    publishedAt: "2023-03-19T23:30:00.000Z",
    title: "Flagstar assumes deposits of Signature Bridge Bank",
    type: "corporate_action",
    summary:
      "The FDIC enters into a purchase and assumption agreement for substantially all deposits and certain loan portfolios of Signature Bridge Bank by Flagstar Bank.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "positive",
    source: "FDIC press release",
    sourceUrl: "https://www.fdic.gov/news/press-releases/2023/pr23021.html",
  },
  {
    id: "evt-2023-03-22-fed-hike-bank-system-note",
    happenedAt: "2023-03-22T18:00:00.000Z",
    publishedAt: "2023-03-22T18:00:00.000Z",
    title: "Fed raises rates and notes banking conditions",
    type: "central_bank",
    summary:
      "The FOMC raises the target range to 4.75-5.00% and says the U.S. banking system is sound and resilient while recent developments may tighten credit conditions.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "Federal Reserve FOMC statement",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20230322a.htm",
  },
  {
    id: "evt-2023-03-26-first-citizens-svb",
    happenedAt: "2023-03-26T23:00:00.000Z",
    publishedAt: "2023-03-26T23:00:00.000Z",
    title: "First-Citizens assumes SVB bridge bank deposits and loans",
    type: "corporate_action",
    summary:
      "The FDIC enters into a purchase and assumption agreement for all deposits and loans of Silicon Valley Bridge Bank by First-Citizens Bank & Trust Company.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "positive",
    source: "FDIC press release",
    sourceUrl: "https://www.fdic.gov/news/press-releases/2023/pr23023.html",
  },
  {
    id: "evt-2023-05-01-first-republic",
    happenedAt: "2023-05-01T07:00:00.000Z",
    publishedAt: "2023-05-01T07:00:00.000Z",
    title: "FDIC closes First Republic Bank and names JPMorgan acquirer",
    type: "regulation",
    summary:
      "California regulators close First Republic Bank and appoint the FDIC as receiver; JPMorgan Chase Bank assumes all deposits and substantially all assets.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "FDIC press release",
    sourceUrl: "https://www.fdic.gov/news/press-releases/2023/pr23034.html",
  },
  {
    id: "evt-2023-05-03-fed-hike",
    happenedAt: "2023-05-03T18:00:00.000Z",
    publishedAt: "2023-05-03T18:00:00.000Z",
    title: "Fed raises rates after First Republic resolution",
    type: "central_bank",
    summary:
      "The FOMC raises the target range to 5.00-5.25% and says tighter credit conditions are likely to weigh on economic activity, hiring, and inflation.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "mixed",
    source: "Federal Reserve FOMC statement",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20230503a.htm",
  },
  {
    id: "evt-2023-06-14-fed-hold",
    happenedAt: "2023-06-14T18:00:00.000Z",
    publishedAt: "2023-06-14T18:00:00.000Z",
    title: "Fed leaves rates unchanged",
    type: "central_bank",
    summary:
      "The FOMC maintains the target range at 5.00-5.25% and says holding the range steady allows time to assess additional information.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "mixed",
    source: "Federal Reserve FOMC statement",
    sourceUrl:
      "https://www.federalreserve.gov/monetarypolicy/fomcpresconf20230614.htm",
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

export const kreBankingCrisis2023Scenario = assembleScenario({
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
