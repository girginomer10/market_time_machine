import type {
  BenchmarkPoint,
  Candle,
  IndicatorSnapshot,
  Instrument,
  MarketEvent,
} from "../../../types";
import type { BrokerConfig, ScenarioMeta } from "../../../types/scenario";
import { assembleScenario } from "../../../domain/scenario/loader";

const SYMBOL = "SPY";

const meta: ScenarioMeta = {
  id: "sp500-covid-2020",
  title: "S&P 500 COVID Crash & Recovery",
  subtitle:
    "Trade the 2020 U.S. equity panic and policy response through a SPY proxy.",
  assetClass: "etf",
  symbols: [SYMBOL],
  startTime: "2020-01-02T14:30:00.000Z",
  endTime: "2020-12-31T21:00:00.000Z",
  baseCurrency: "USD",
  initialCash: 10_000,
  defaultGranularity: "1d",
  difficulty: "intermediate",
  tags: ["equity", "crash", "policy_response", "covid", "recovery"],
  supportedModes: ["explorer", "professional", "challenge"],
  benchmarkSymbol: SYMBOL,
  license: "CC-BY-4.0 (sample data)",
  dataSources: [
    "Synthetic deterministic sample prices shaped to the publicly documented U.S. equity 2020 path; raw licensed S&P DJI or ETF market data is not redistributed.",
    "Official event sources: CDC, WHO, Federal Reserve, NYSE, White House archive, U.S. Treasury, BEA, BLS, NBER, Pfizer/BioNTech.",
  ],
  isSampleData: true,
  description:
    "Sample/demo U.S. equity scenario for practicing decisions during the COVID shock, circuit-breaker halts, emergency monetary policy, fiscal support, macro data releases, and vaccine news. Prices are synthetic and should not be used for trading decisions.",
};

const instruments: Instrument[] = [
  {
    symbol: SYMBOL,
    name: "SPDR S&P 500 ETF Trust proxy",
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
  spreadBps: 2,
  slippageModel: "fixed_bps",
  slippageBps: 1,
  allowFractional: true,
  allowShort: true,
  maxLeverage: 2,
  marginCallPolicy: "reject_new_orders",
  borrowRateBps: 300,
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
  { date: "2020-01-02", price: 324.87 },
  { date: "2020-02-19", price: 338.34 },
  { date: "2020-03-09", price: 274.23 },
  { date: "2020-03-12", price: 248.11 },
  { date: "2020-03-23", price: 222.95 },
  { date: "2020-04-29", price: 293.21 },
  { date: "2020-06-08", price: 323.2 },
  { date: "2020-09-02", price: 357.7 },
  { date: "2020-10-30", price: 326.54 },
  { date: "2020-11-09", price: 354.56 },
  { date: "2020-12-31", price: 373.88 },
];

function buildCandles(): Candle[] {
  const start = Date.UTC(2020, 0, 2);
  const end = Date.UTC(2020, 11, 31);
  const candles: Candle[] = [];
  const rng = mulberry32(0x50_59_20_20);
  let prevClose = anchors[0].price;

  for (let t = start; t <= end; t += DAY_MS) {
    const date = new Date(t);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;

    const iso = date.toISOString().slice(0, 10);
    const target = interpolateAnchors(iso);
    const regime = volatilityRegime(iso);
    const overnightNoise = (rng() - 0.5) * target * 0.006 * regime;
    const drift = target - prevClose;
    const open = Math.max(20, prevClose + overnightNoise);
    const intradayNoise = (rng() - 0.5) * target * 0.012 * regime;
    const close = Math.max(20, open + drift * 0.72 + intradayNoise);
    const directionalRange = Math.abs(close - open);
    const range =
      directionalRange + Math.max(target * 0.008 * regime * (0.7 + rng()), 0.2);
    const high = Math.max(open, close) + range * (0.25 + rng() * 0.35);
    const low = Math.min(open, close) - range * (0.25 + rng() * 0.35);
    const volume =
      45_000_000 +
      rng() * 25_000_000 +
      regime * 28_000_000 +
      Math.abs(close - open) * 5_000_000;
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
  const isDst = iso >= "2020-03-09" && iso < "2020-11-02";
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
  const stress = gaussian(dayMs, Date.parse("2020-03-16T00:00:00Z"), 18);
  const autumn = gaussian(dayMs, Date.parse("2020-10-30T00:00:00Z"), 15);
  const vaccine = gaussian(dayMs, Date.parse("2020-11-09T00:00:00Z"), 7);
  return 1 + stress * 3.6 + autumn * 0.9 + vaccine * 0.7;
}

function gaussian(dayMs: number, centerMs: number, widthDays: number): number {
  const days = (dayMs - centerMs) / DAY_MS;
  return Math.exp(-(days * days) / (2 * widthDays * widthDays));
}

const events: MarketEvent[] = [
  {
    id: "evt-2020-01-21-first-us-case",
    happenedAt: "2020-01-21T17:00:00.000Z",
    publishedAt: "2020-01-21T17:00:00.000Z",
    title: "CDC confirms first U.S. coronavirus case",
    type: "news",
    summary:
      "CDC confirms a first travel-related U.S. case of the novel coronavirus in Washington state and says the situation is rapidly evolving.",
    affectedSymbols: [SYMBOL],
    importance: 3,
    sentiment: "negative",
    source: "CDC Newsroom",
    sourceUrl:
      "https://archive.cdc.gov/www_cdc_gov/media/releases/2020/p0121-novel-coronavirus-travel-case.html",
  },
  {
    id: "evt-2020-01-30-who-pheic",
    happenedAt: "2020-01-30T20:30:00.000Z",
    publishedAt: "2020-01-30T20:30:00.000Z",
    title: "WHO declares a public health emergency",
    type: "macro",
    summary:
      "WHO declares the novel coronavirus outbreak a Public Health Emergency of International Concern.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "negative",
    source: "WHO IHR Emergency Committee",
    sourceUrl: "https://www.who.int/groups/covid-19-ihr-emergency-committee",
  },
  {
    id: "evt-2020-03-03-fed-emergency-cut",
    happenedAt: "2020-03-03T15:00:00.000Z",
    publishedAt: "2020-03-03T15:00:00.000Z",
    title: "Federal Reserve makes emergency rate cut",
    type: "central_bank",
    summary:
      "The FOMC lowers the federal funds target range by 50 basis points to 1.00-1.25%, citing evolving coronavirus risks.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "Federal Reserve press release",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20200303a.htm",
  },
  {
    id: "evt-2020-03-09-circuit-breaker",
    happenedAt: "2020-03-09T13:34:00.000Z",
    publishedAt: "2020-03-09T13:34:00.000Z",
    title: "First modern market-wide circuit breaker halt",
    type: "price_event",
    summary:
      "The S&P 500 crosses the 7% Level 1 market-wide circuit breaker threshold shortly after the open, pausing U.S. equity trading for 15 minutes.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "NYSE market structure review",
    sourceUrl: "https://www.nyse.com/article/assessing-nyse-model-performance",
  },
  {
    id: "evt-2020-03-11-who-pandemic",
    happenedAt: "2020-03-11T16:30:00.000Z",
    publishedAt: "2020-03-11T16:30:00.000Z",
    title: "WHO characterizes COVID-19 as a pandemic",
    type: "macro",
    summary:
      "WHO says COVID-19 can be characterized as a pandemic and calls for urgent, aggressive action by countries.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "WHO Director-General remarks",
    sourceUrl:
      "https://www.who.int/news-room/speeches/item/who-director-general-s-opening-remarks-at-the-media-briefing-on-covid-19---11-march-2020",
  },
  {
    id: "evt-2020-03-13-us-national-emergency",
    happenedAt: "2020-03-13T19:00:00.000Z",
    publishedAt: "2020-03-13T19:00:00.000Z",
    title: "U.S. declares national emergency",
    type: "regulation",
    summary:
      "The White House issues a proclamation declaring that the COVID-19 outbreak constitutes a national emergency in the United States.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "White House archive",
    sourceUrl:
      "https://trumpwhitehouse.archives.gov/presidential-actions/proclamation-declaring-national-emergency-concerning-novel-coronavirus-disease-covid-19-outbreak/",
  },
  {
    id: "evt-2020-03-15-fed-zero-qe",
    happenedAt: "2020-03-15T21:00:00.000Z",
    publishedAt: "2020-03-15T21:00:00.000Z",
    title: "Federal Reserve cuts rates to 0-0.25%",
    type: "central_bank",
    summary:
      "The FOMC lowers the target range to 0-0.25% and announces Treasury and agency mortgage-backed securities purchases.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "Federal Reserve FOMC statement",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20200315a.htm",
  },
  {
    id: "evt-2020-03-18-circuit-breaker",
    happenedAt: "2020-03-18T16:56:17.000Z",
    publishedAt: "2020-03-18T16:56:17.000Z",
    title: "Fourth March circuit breaker halt",
    type: "price_event",
    summary:
      "U.S. equity markets halt after the S&P 500 reaches the 7% Level 1 market-wide circuit breaker threshold during the trading day.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "NYSE MWCB Working Group report",
    sourceUrl:
      "https://www.nyse.com/publicdocs/nyse/markets/nyse/Report_of_the_Market-Wide_Circuit_Breaker_Working_Group.pdf",
  },
  {
    id: "evt-2020-03-23-fed-credit-measures",
    happenedAt: "2020-03-23T12:00:00.000Z",
    publishedAt: "2020-03-23T12:00:00.000Z",
    title: "Federal Reserve announces extensive support measures",
    type: "central_bank",
    summary:
      "The Federal Reserve announces Treasury and agency mortgage-backed securities purchases in amounts needed to support smooth market functioning.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "positive",
    source: "Federal Reserve press release",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20200323b.htm",
  },
  {
    id: "evt-2020-03-27-cares-act",
    happenedAt: "2020-03-27T20:30:00.000Z",
    publishedAt: "2020-03-27T20:30:00.000Z",
    title: "CARES Act signed into law",
    type: "regulation",
    summary:
      "The Coronavirus Aid, Relief, and Economic Security Act becomes law, establishing large-scale economic relief programs.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "positive",
    source: "U.S. Treasury",
    sourceUrl:
      "https://home.treasury.gov/policy-issues/coronavirus/about-the-cares-act",
  },
  {
    id: "evt-2020-04-29-q1-gdp",
    happenedAt: "2020-03-31T20:00:00.000Z",
    publishedAt: "2020-04-29T12:30:00.000Z",
    title: "BEA releases Q1 GDP advance estimate",
    type: "macro",
    summary:
      "BEA reports that real U.S. GDP decreased at a 4.8% annual rate in the first quarter of 2020.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "negative",
    source: "U.S. Bureau of Economic Analysis",
    sourceUrl:
      "https://www.bea.gov/news/2020/gross-domestic-product-1st-quarter-2020-advance-estimate",
  },
  {
    id: "evt-2020-05-08-april-jobs",
    happenedAt: "2020-04-30T20:00:00.000Z",
    publishedAt: "2020-05-08T12:30:00.000Z",
    title: "April jobs report shows 14.7% unemployment",
    type: "macro",
    summary:
      "BLS reports that total nonfarm payroll employment fell by 20.5 million in April and the unemployment rate rose to 14.7%.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "U.S. Bureau of Labor Statistics",
    sourceUrl: "https://www.bls.gov/news.release/archives/empsit_05082020.htm",
  },
  {
    id: "evt-2020-06-08-nber-recession",
    happenedAt: "2020-02-29T21:00:00.000Z",
    publishedAt: "2020-06-08T17:00:00.000Z",
    title: "NBER dates U.S. business cycle peak to February",
    type: "macro",
    summary:
      "NBER's Business Cycle Dating Committee determines that monthly U.S. economic activity peaked in February 2020.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "negative",
    source: "NBER Business Cycle Dating Committee",
    sourceUrl:
      "https://www.nber.org/news/business-cycle-dating-committee-announcement-june-8-2020",
  },
  {
    id: "evt-2020-11-09-pfizer-interim",
    happenedAt: "2020-11-08T23:00:00.000Z",
    publishedAt: "2020-11-09T12:00:00.000Z",
    title: "Pfizer and BioNTech report positive interim vaccine data",
    type: "corporate_action",
    summary:
      "Pfizer and BioNTech announce that their COVID-19 vaccine candidate showed efficacy above 90% in a first interim Phase 3 analysis.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "positive",
    source: "Pfizer press release",
    sourceUrl:
      "https://www.pfizer.com/news/press-release/press-release-detail/pfizer-and-biontech-announce-vaccine-candidate-against",
  },
  {
    id: "evt-2020-12-11-pfizer-eua",
    happenedAt: "2020-12-12T04:12:00.000Z",
    publishedAt: "2020-12-12T04:12:00.000Z",
    title: "Pfizer and BioNTech announce U.S. vaccine authorization",
    type: "regulation",
    summary:
      "Pfizer and BioNTech announce that FDA has authorized emergency use of their COVID-19 mRNA vaccine for individuals 16 years of age or older.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "positive",
    source: "Pfizer press release",
    sourceUrl:
      "https://www.pfizer.com/news/press-release/press-release-detail/pfizer-and-biontech-celebrate-historic-first-authorization",
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

export const sp500Covid2020Scenario = assembleScenario({
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
