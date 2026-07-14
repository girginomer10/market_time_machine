import type {
  BenchmarkPoint,
  Candle,
  MarketEvent,
  ScenarioPackage,
} from "../../../types";
import sourceData from "./ecb-eurusd.json";

const SYMBOL = "EURUSD";

const candles: Candle[] = sourceData.observations.map((observation) => ({
  symbol: SYMBOL,
  openTime: `${observation.date}T00:00:00.000Z`,
  closeTime: `${observation.date}T15:00:00.000Z`,
  open: observation.value,
  high: observation.value,
  low: observation.value,
  close: observation.value,
  volume: 0,
  source: "ECB EXR D.USD.EUR.SP00.A",
}));

const benchmarks: BenchmarkPoint[] = sourceData.observations.map(
  (observation) => ({
    symbol: SYMBOL,
    time: `${observation.date}T15:00:00.000Z`,
    value: observation.value,
  }),
);

const events: MarketEvent[] = [
  {
    id: "evt-2020-03-03-fed-emergency-cut",
    happenedAt: "2020-03-03T15:00:00.000Z",
    publishedAt: "2020-03-03T15:00:00.000Z",
    title: "Federal Reserve cuts its target range by 50 basis points",
    type: "central_bank",
    summary:
      "The Federal Open Market Committee lowers the federal funds target range to 1%–1.25% and says the coronavirus poses evolving risks to economic activity.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "Federal Reserve",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20200303a.htm",
  },
  {
    id: "evt-2020-03-11-who-pandemic",
    happenedAt: "2020-03-11T17:00:00.000Z",
    publishedAt: "2020-03-11T17:00:00.000Z",
    title: "WHO characterizes COVID-19 as a pandemic",
    type: "news",
    summary:
      "The World Health Organization says COVID-19 can be characterized as a pandemic and calls for urgent, aggressive action by all countries.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "World Health Organization",
    sourceUrl:
      "https://www.who.int/news-room/speeches/item/who-director-general-s-opening-remarks-at-the-media-briefing-on-covid-19---11-march-2020",
  },
  {
    id: "evt-2020-03-12-ecb-liquidity-package",
    happenedAt: "2020-03-12T12:45:00.000Z",
    publishedAt: "2020-03-12T12:45:00.000Z",
    title: "ECB announces a package of liquidity and purchase measures",
    type: "central_bank",
    summary:
      "The ECB keeps policy rates unchanged, adds temporary longer-term refinancing operations, eases TLTRO III terms, and adds a €120 billion asset-purchase envelope through 2020.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "European Central Bank",
    sourceUrl:
      "https://www.ecb.europa.eu/press/pr/date/2020/html/ecb.mp200312~8d3aec3ff2.en.html",
  },
  {
    id: "evt-2020-03-15-central-bank-dollar-swaps",
    happenedAt: "2020-03-15T21:00:00.000Z",
    publishedAt: "2020-03-15T21:00:00.000Z",
    title: "Major central banks enhance US dollar liquidity swap lines",
    type: "central_bank",
    summary:
      "The ECB, Federal Reserve, and four other central banks lower swap-line pricing and add weekly 84-day US dollar operations alongside existing one-week operations.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "European Central Bank",
    sourceUrl:
      "https://www.ecb.europa.eu/press/pr/date/2020/html/ecb.pr200315~1fab6a9f1f.en.html",
  },
  {
    id: "evt-2020-03-15-fed-zero-bound",
    happenedAt: "2020-03-15T21:00:00.000Z",
    publishedAt: "2020-03-15T21:00:00.000Z",
    title: "Federal Reserve lowers its target range to 0%–0.25%",
    type: "central_bank",
    summary:
      "The Federal Open Market Committee lowers the federal funds target range to 0%–0.25% and announces at least $500 billion of Treasury and $200 billion of agency mortgage-backed security purchases.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "Federal Reserve",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20200315a.htm",
  },
  {
    id: "evt-2020-03-18-ecb-pepp",
    happenedAt: "2020-03-18T23:59:00.000Z",
    publishedAt: "2020-03-18T23:59:00.000Z",
    title: "ECB launches the €750 billion Pandemic Emergency Purchase Programme",
    type: "central_bank",
    summary:
      "The ECB announces a temporary €750 billion purchase programme covering eligible private- and public-sector securities and expands collateral and commercial-paper support.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "positive",
    source: "European Central Bank",
    sourceUrl:
      "https://www.ecb.europa.eu/press/pr/date/2020/html/ecb.pr200318_1~3949d6f266.en.html",
  },
  {
    id: "evt-2020-03-23-fed-market-support",
    happenedAt: "2020-03-23T12:00:00.000Z",
    publishedAt: "2020-03-23T12:00:00.000Z",
    title: "Federal Reserve expands market and credit support",
    type: "central_bank",
    summary:
      "The Federal Reserve says it will purchase Treasury and agency mortgage-backed securities in the amounts needed for market functioning and announces facilities supporting up to $300 billion in new financing.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "positive",
    source: "Federal Reserve",
    sourceUrl:
      "https://www.federalreserve.gov/newsevents/pressreleases/monetary20200323b.htm",
  },
  {
    id: "evt-2020-04-30-ecb-peltro",
    happenedAt: "2020-04-30T11:45:00.000Z",
    publishedAt: "2020-04-30T11:45:00.000Z",
    title: "ECB eases targeted lending terms and adds pandemic refinancing operations",
    type: "central_bank",
    summary:
      "The ECB further eases TLTRO III conditions and announces seven pandemic emergency longer-term refinancing operations to support euro-area liquidity.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "positive",
    source: "European Central Bank",
    sourceUrl:
      "https://www.ecb.europa.eu/press/pr/date/2020/html/ecb.mp200430~1eaa128265.en.html",
  },
  {
    id: "evt-2020-06-04-ecb-pepp-expansion",
    happenedAt: "2020-06-04T11:45:00.000Z",
    publishedAt: "2020-06-04T11:45:00.000Z",
    title: "ECB expands and extends the pandemic purchase programme",
    type: "central_bank",
    summary:
      "The ECB increases the PEPP envelope by €600 billion to €1.35 trillion and extends net purchases to at least the end of June 2021.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "positive",
    source: "European Central Bank",
    sourceUrl:
      "https://www.ecb.europa.eu/press/pr/date/2020/html/ecb.mp200604~a307d3429c.en.html",
  },
];

export const eurUsdCovidLiquidity2020Scenario: ScenarioPackage = {
  meta: {
    id: "eurusd-covid-liquidity-2020",
    title: "COVID Liquidity Shock: EUR/USD 2020",
    subtitle:
      "Navigate a rapid sequence of pandemic, dollar-funding, Federal Reserve, and ECB decisions.",
    description:
      "An intermediate FX replay built from the ECB's observed daily US-dollar/euro reference rate and official WHO, Federal Reserve, and ECB publications.",
    assetClass: "fx",
    symbols: [SYMBOL],
    startTime: "2020-02-03T15:00:00.000Z",
    endTime: "2020-06-30T15:00:00.000Z",
    baseCurrency: "USD",
    initialCash: 10_000,
    defaultGranularity: "1d",
    difficulty: "intermediate",
    tags: ["liquidity_crisis", "central_bank", "pandemic", "volatility"],
    supportedModes: ["explorer", "professional", "blind", "challenge"],
    benchmarkSymbol: SYMBOL,
    license: "ECB statistics — free reuse with source attribution",
    dataSources: [
      sourceData.apiUrl,
      sourceData.licenseUrl,
      "Official World Health Organization COVID-19 publications",
      "Official Federal Reserve monetary-policy publications",
      "Official European Central Bank monetary-policy publications",
    ],
    dataVersion: `ECB EXR ${sourceData.seriesKey}; retrieved ${sourceData.retrievedAt}`,
    sourceManifest: [
      "src/data/scenarios/eurusd-covid-liquidity-2020/README.md",
      "src/data/scenarios/eurusd-covid-liquidity-2020/ecb-eurusd.json",
      "scripts/import-ecb-eurusd.mjs",
    ],
    generatedAt: sourceData.retrievedAt,
    priceAdjustment: "raw",
    isSampleData: false,
    estimatedMinutes: 10,
    mission:
      "Manage euro exposure against the US dollar while distinguishing pandemic news, dollar-funding stress, and successive central-bank liquidity responses.",
    learningObjectives: [
      "Separate public-health information from monetary and dollar-liquidity responses.",
      "Plan risk before major policy announcements instead of reacting to the next observed reference rate.",
      "Compare active EUR/USD timing with holding the observed reference-rate series.",
    ],
    dataFidelity: "mixed",
    observedFields: [
      "Daily EUR/USD ECB reference rate (the published US-dollars-per-euro observation)",
    ],
    derivedFields: [
      "Open, high, and low repeat the single daily reference observation",
      "Volume is unavailable and set to zero",
    ],
  },
  instruments: [
    {
      symbol: SYMBOL,
      name: "Euro / US Dollar ECB reference rate",
      assetClass: "fx",
      exchange: "ECB reference rate",
      currency: "USD",
      timezone: "Europe/Frankfurt",
      tickSize: 0.0001,
      lotSize: 0.01,
      allowFractional: true,
      tradable: true,
    },
  ],
  candles,
  events,
  indicators: [],
  benchmarks,
  broker: {
    baseCurrency: "USD",
    commissionRateBps: 0,
    fixedFee: 0,
    spreadBps: 3,
    slippageModel: "fixed_bps",
    slippageBps: 1,
    allowFractional: true,
    allowShort: true,
    maxLeverage: 3,
    partialFillPolicy: "disabled",
    stopFillPolicy: "gap_open",
    marketHoursEnforced: false,
    marginCallPolicy: "liquidate_on_threshold",
    borrowRateBps: 100,
  },
  corporateActions: [],
};
