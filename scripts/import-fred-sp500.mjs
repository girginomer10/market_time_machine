#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const DEFAULT_START = "2020-01-02";
const DEFAULT_END = "2020-12-31";
const DEFAULT_OUT = "src/data/scenarios/sp500-covid-2020-fred";
const SERIES_ID = "SP500";

const args = parseArgs(process.argv.slice(2));
const start = args.start ?? DEFAULT_START;
const end = args.end ?? DEFAULT_END;
const outDir = resolve(process.cwd(), args.out ?? DEFAULT_OUT);
const generatedAt = new Date().toISOString();

const fredUrl = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
fredUrl.searchParams.set("id", SERIES_ID);
fredUrl.searchParams.set("cosd", start);
fredUrl.searchParams.set("coed", end);

const response = await fetch(fredUrl);
if (!response.ok) {
  throw new Error(
    `FRED request failed with HTTP ${response.status}: ${response.statusText}`,
  );
}

const records = parseFredCsv(await response.text());
if (records.length < 2) {
  throw new Error(
    `FRED returned ${records.length} usable ${SERIES_ID} observations for ${start} to ${end}.`,
  );
}

const candles = buildCloseOnlyCandles(records);
const firstDate = records[0].date;
const lastDate = records[records.length - 1].date;
const sourceUrl = fredUrl.toString();
const scenarioSource = renderScenario({
  candles,
  generatedAt,
  sourceUrl,
  startDate: firstDate,
  endDate: lastDate,
});
const readme = renderReadme({
  generatedAt,
  sourceUrl,
  startDate: firstDate,
  endDate: lastDate,
  observationCount: records.length,
});

await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, "index.ts"), scenarioSource);
await writeFile(resolve(outDir, "README.md"), readme);

console.log(
  `Generated local FRED scenario with ${records.length} observations at ${outDir}`,
);
console.log(
  "The generated files are gitignored. Run `npm run dev` and switch to the FRED Local scenario.",
);

function parseArgs(rawArgs) {
  const parsed = {};
  for (const arg of rawArgs) {
    if (!arg.startsWith("--")) continue;
    const [key, value = ""] = arg.slice(2).split("=");
    if (key) parsed[key] = value;
  }
  return parsed;
}

function parseFredCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const rows = [];
  for (const line of lines.slice(1)) {
    const [date, rawValue] = line.split(",");
    if (!date || !rawValue || rawValue === ".") continue;
    const close = Number(rawValue);
    if (!Number.isFinite(close)) continue;
    rows.push({ date, close: round2(close) });
  }
  return rows;
}

function buildCloseOnlyCandles(records) {
  let previousClose = records[0].close;
  return records.map((record, index) => {
    const open = index === 0 ? record.close : previousClose;
    const close = record.close;
    const { openTime, closeTime } = marketSessionTimes(record.date);
    previousClose = close;
    return {
      symbol: SERIES_ID,
      openTime,
      closeTime,
      open: round2(open),
      high: round2(Math.max(open, close)),
      low: round2(Math.min(open, close)),
      close,
      adjustedClose: close,
      volume: 0,
      source: "FRED:SP500",
    };
  });
}

function marketSessionTimes(isoDate) {
  const isDst = isoDate >= "2020-03-09" && isoDate < "2020-11-02";
  return {
    openTime: `${isoDate}T${isDst ? "13:30" : "14:30"}:00.000Z`,
    closeTime: `${isoDate}T${isDst ? "20:00" : "21:00"}:00.000Z`,
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function renderScenario({
  candles,
  generatedAt,
  sourceUrl,
  startDate,
  endDate,
}) {
  const openTime = candles[0].openTime;
  const closeTime = candles[candles.length - 1].closeTime;
  return `import type {
  BenchmarkPoint,
  Candle,
  IndicatorSnapshot,
  Instrument,
  MarketEvent,
} from "../../../types";
import type { BrokerConfig, ScenarioMeta } from "../../../types/scenario";
import { assembleScenario } from "../../../domain/scenario/loader";
import { sp500Covid2020Scenario } from "../sp500-covid-2020";

const SYMBOL = "${SERIES_ID}";
const GENERATED_AT = "${generatedAt}";
const SOURCE_URL = "${sourceUrl}";

const meta: ScenarioMeta = {
  id: "sp500-covid-2020-fred",
  title: "S&P 500 COVID Crash & Recovery (FRED Local)",
  subtitle:
    "Locally generated from FRED SP500 closes; replay candles use derived OHLC and zero volume.",
  assetClass: "index",
  symbols: [SYMBOL],
  startTime: "${openTime}",
  endTime: "${closeTime}",
  baseCurrency: "USD",
  initialCash: 10_000,
  defaultGranularity: "1d",
  difficulty: "intermediate",
  tags: ["equity", "index", "crash", "policy_response", "covid", "fred"],
  supportedModes: ["explorer", "professional", "challenge"],
  benchmarkSymbol: SYMBOL,
  license:
    "Local generated data - FRED and S&P Dow Jones Indices source terms apply; do not redistribute without permission.",
  dataSources: [
    "Generated locally from FRED series SP500 for ${startDate} to ${endDate}.",
    "Source URL: " + SOURCE_URL,
    "FRED SP500 closes are copyright S&P Dow Jones Indices LLC; generated data should remain local unless separately licensed.",
    "Only close values are source observations. Open/high/low are derived from adjacent closes and volume is set to 0.",
    "Generated at " + GENERATED_AT,
  ],
  isSampleData: true,
  description:
    "Local close-only S&P 500 replay generated from FRED. Useful for broad timing and information-firewall practice; not suitable for intraday OHLC, volume, or limit-order realism.",
};

const instruments: Instrument[] = [
  {
    symbol: SYMBOL,
    name: "S&P 500 Price Index (FRED local close-only)",
    assetClass: "index",
    exchange: "FRED / S&P Dow Jones Indices",
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
  spreadBps: 1,
  slippageModel: "fixed_bps",
  slippageBps: 1,
  allowFractional: true,
  allowShort: true,
  maxLeverage: 2,
  marginCallPolicy: "reject_new_orders",
  borrowRateBps: 300,
};

const candles: Candle[] = ${JSON.stringify(candles, null, 2)};

const events: MarketEvent[] = sp500Covid2020Scenario.events.map((event) => ({
  ...event,
  affectedSymbols: [SYMBOL],
}));

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function buildIndicators(sourceCandles: Candle[]): IndicatorSnapshot[] {
  const indicators: IndicatorSnapshot[] = [];
  const smaWindow = 20;
  const volWindow = 10;

  for (let i = 0; i < sourceCandles.length; i++) {
    if (i + 1 >= smaWindow) {
      const slice = sourceCandles.slice(i + 1 - smaWindow, i + 1);
      const sma = slice.reduce((s, c) => s + c.close, 0) / smaWindow;
      indicators.push({
        symbol: SYMBOL,
        name: "SMA20",
        time: sourceCandles[i].closeTime,
        availableAt: sourceCandles[i].closeTime,
        value: round2(sma),
        parameters: { window: smaWindow },
      });
    }

    if (i + 1 >= volWindow) {
      const slice = sourceCandles.slice(i + 1 - volWindow, i + 1);
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
        time: sourceCandles[i].closeTime,
        availableAt: sourceCandles[i].closeTime,
        value: round2(Math.sqrt(variance) * Math.sqrt(252) * 100),
        parameters: { window: volWindow, annualized: true, unit: "percent" },
      });
    }
  }

  return indicators;
}

function buildBenchmarks(sourceCandles: Candle[]): BenchmarkPoint[] {
  return sourceCandles.map((c) => ({
    symbol: SYMBOL,
    time: c.closeTime,
    value: c.close,
  }));
}

const indicators = buildIndicators(candles);
const benchmarks = buildBenchmarks(candles);

export const sp500Covid2020FredScenario = assembleScenario({
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
`;
}

function renderReadme({
  generatedAt,
  sourceUrl,
  startDate,
  endDate,
  observationCount,
}) {
  return `# S&P 500 COVID Crash & Recovery (FRED Local)

Generated at: ${generatedAt}

Source: ${sourceUrl}

Range: ${startDate} to ${endDate}

Observations: ${observationCount}

This local scenario is generated from FRED series SP500. The FRED SP500 page
states that S&P 500 data is copyright S&P Dow Jones Indices LLC and that
reproduction requires prior written permission from S&P. Keep generated files
local unless you have separate redistribution rights.

If you build the app while this scenario exists, the production bundle will
include the generated data. Do not publish that bundle unless your use complies
with the upstream terms.

Only close values are source observations. Open, high, and low are derived from
adjacent closes so the replay engine can use the existing candle model. Volume
is set to 0. This is useful for broad timing practice, not for intraday or
limit-order realism.
`;
}
