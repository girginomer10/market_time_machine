import type {
  BenchmarkPoint,
  Candle,
  MarketEvent,
  ScenarioPackage,
} from "../../../types";
import sourceData from "./ecb-eurgbp.json";

const SYMBOL = "EURGBP";

const candles: Candle[] = sourceData.observations.map((observation) => ({
  symbol: SYMBOL,
  openTime: `${observation.date}T00:00:00.000Z`,
  closeTime: `${observation.date}T15:00:00.000Z`,
  open: observation.value,
  high: observation.value,
  low: observation.value,
  close: observation.value,
  volume: 0,
  source: "ECB EXR D.GBP.EUR.SP00.A",
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
    id: "evt-2016-06-16-boe-hold",
    happenedAt: "2016-06-16T11:00:00.000Z",
    publishedAt: "2016-06-16T11:00:00.000Z",
    title: "Bank of England holds Bank Rate before the referendum",
    type: "central_bank",
    summary:
      "The Monetary Policy Committee keeps Bank Rate at 0.5% and says the referendum is the most significant risk to its forecast.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "mixed",
    source: "Bank of England",
    sourceUrl:
      "https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2016/mpc-june-2016",
  },
  {
    id: "evt-2016-06-24-referendum-result",
    happenedAt: "2016-06-24T06:00:00.000Z",
    publishedAt: "2016-06-24T06:00:00.000Z",
    title: "United Kingdom votes to leave the European Union",
    type: "geopolitical",
    summary:
      "The official referendum outcome records a vote to leave the European Union.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "negative",
    source: "UK Government",
    sourceUrl: "https://www.gov.uk/government/topical-events/eu-referendum",
  },
  {
    id: "evt-2016-06-24-boe-statement",
    happenedAt: "2016-06-24T07:00:00.000Z",
    publishedAt: "2016-06-24T07:00:00.000Z",
    title: "Bank of England says contingency plans are in place",
    type: "central_bank",
    summary:
      "Governor Mark Carney says the Bank has prepared for the referendum result and can provide substantial liquidity in foreign currency if required.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "Bank of England",
    sourceUrl:
      "https://www.bankofengland.co.uk/-/media/boe/files/news/2016/june/statement-from-the-governor-of-the-boe-following-the-eu-referendum-result",
  },
  {
    id: "evt-2016-07-05-fpc-buffer",
    happenedAt: "2016-07-05T09:30:00.000Z",
    publishedAt: "2016-07-05T09:30:00.000Z",
    title: "Financial Policy Committee releases bank capital buffer",
    type: "central_bank",
    summary:
      "The Financial Policy Committee reduces the UK countercyclical capital buffer rate from 0.5% to 0% with immediate effect.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "positive",
    source: "Bank of England",
    sourceUrl:
      "https://www.bankofengland.co.uk/financial-stability-report/2016/july-2016",
  },
  {
    id: "evt-2016-07-14-boe-hold",
    happenedAt: "2016-07-14T11:00:00.000Z",
    publishedAt: "2016-07-14T11:00:00.000Z",
    title: "Bank of England holds Bank Rate at 0.5%",
    type: "central_bank",
    summary:
      "The Monetary Policy Committee votes 8-1 to keep Bank Rate unchanged and says most members expect policy to be loosened in August.",
    affectedSymbols: [SYMBOL],
    importance: 4,
    sentiment: "mixed",
    source: "Bank of England",
    sourceUrl:
      "https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2016/mpc-july-2016",
  },
  {
    id: "evt-2016-08-04-boe-easing",
    happenedAt: "2016-08-04T11:00:00.000Z",
    publishedAt: "2016-08-04T11:00:00.000Z",
    title: "Bank of England cuts Bank Rate and expands asset purchases",
    type: "central_bank",
    summary:
      "The Monetary Policy Committee cuts Bank Rate to 0.25%, introduces a Term Funding Scheme, and expands government and corporate bond purchases.",
    affectedSymbols: [SYMBOL],
    importance: 5,
    sentiment: "mixed",
    source: "Bank of England",
    sourceUrl:
      "https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2016/mpc-august-2016",
  },
  {
    id: "evt-2016-09-15-boe-hold",
    happenedAt: "2016-09-15T11:00:00.000Z",
    publishedAt: "2016-09-15T11:00:00.000Z",
    title: "Bank of England keeps its August policy package in place",
    type: "central_bank",
    summary:
      "The Monetary Policy Committee holds Bank Rate at 0.25% and continues the government and corporate bond purchase programmes.",
    affectedSymbols: [SYMBOL],
    importance: 3,
    sentiment: "neutral",
    source: "Bank of England",
    sourceUrl:
      "https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2016/mpc-september-2016",
  },
];

export const eurGbpBrexit2016Scenario: ScenarioPackage = {
  meta: {
    id: "eurgbp-brexit-2016",
    title: "Brexit Referendum: EUR/GBP 2016",
    subtitle:
      "Navigate sterling uncertainty from the referendum vote through the Bank of England response.",
    description:
      "A short beginner replay built from the ECB's observed daily pound-sterling/euro reference rate and official UK policy events.",
    assetClass: "fx",
    symbols: [SYMBOL],
    startTime: "2016-03-01T15:00:00.000Z",
    endTime: "2016-09-30T15:00:00.000Z",
    baseCurrency: "GBP",
    initialCash: 10_000,
    defaultGranularity: "1d",
    difficulty: "beginner",
    tags: ["geopolitical", "currency_crisis", "central_bank", "volatility"],
    supportedModes: ["explorer", "professional", "blind", "challenge"],
    benchmarkSymbol: SYMBOL,
    license: "ECB statistics — free reuse with source attribution",
    dataSources: [
      sourceData.apiUrl,
      "https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html",
      "Official UK Government referendum publications",
      "Official Bank of England policy publications",
    ],
    dataVersion: `ECB EXR ${sourceData.seriesKey}; retrieved ${sourceData.retrievedAt}`,
    sourceManifest: [
      "src/data/scenarios/eurgbp-brexit-2016/ecb-eurgbp.json",
      "scripts/import-ecb-eurgbp.mjs",
    ],
    generatedAt: sourceData.retrievedAt,
    priceAdjustment: "raw",
    isSampleData: false,
    estimatedMinutes: 8,
    mission:
      "Protect a GBP-denominated portfolio while deciding whether and when to hold euro exposure through referendum uncertainty.",
    learningObjectives: [
      "Separate a political outcome from the policy response that follows it.",
      "Plan risk before a binary event instead of reacting after the move.",
      "Compare active timing with simply holding EUR/GBP through the period.",
    ],
    dataFidelity: "mixed",
    observedFields: [
      "Daily EUR/GBP ECB reference rate (the published GBP-per-EUR observation)",
    ],
    derivedFields: [
      "Open, high, and low repeat the single daily reference observation",
      "Volume is unavailable and set to zero",
    ],
  },
  instruments: [
    {
      symbol: SYMBOL,
      name: "Euro / Pound Sterling ECB reference rate",
      assetClass: "fx",
      exchange: "ECB reference rate",
      currency: "GBP",
      timezone: "Europe/London",
      tickSize: 0.00001,
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
    baseCurrency: "GBP",
    commissionRateBps: 0,
    fixedFee: 0,
    spreadBps: 5,
    slippageModel: "fixed_bps",
    slippageBps: 2,
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
