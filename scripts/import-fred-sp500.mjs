#!/usr/bin/env node

import {
  access,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_START = "2020-01-02";
export const DEFAULT_END = "2020-12-31";
export const DEFAULT_OUT = "src/data/scenarios/sp500-covid-2020-fred";
export const SERIES_ID = "SP500";
export const DEFAULT_TIMEOUT_MS = 15_000;

const NEW_YORK_TIME = new Intl.DateTimeFormat("en-US-u-ca-iso8601", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export async function main(
  rawArgs = process.argv.slice(2),
  { fetchImpl = globalThis.fetch, now = () => new Date() } = {},
) {
  const args = parseArgs(rawArgs);
  const start = args.start ?? DEFAULT_START;
  const end = args.end ?? DEFAULT_END;
  validateDateRange(start, end);

  const scenariosRoot = resolve(process.cwd(), "src/data/scenarios");
  const defaultOutDir = resolve(process.cwd(), DEFAULT_OUT);
  const outDir = resolve(process.cwd(), args.out ?? DEFAULT_OUT);
  assertSafeOutputDirectory(outDir, scenariosRoot);
  const force = parseBoolean(args.force ?? "false", "force");
  const timeoutMs = args.timeoutMs
    ? positiveInteger(args.timeoutMs, "timeoutMs")
    : DEFAULT_TIMEOUT_MS;
  const generatedAt = now().toISOString();

  const fredUrl = buildFredUrl(start, end);
  const responseText = await fetchFredCsvText(fredUrl, {
    fetchImpl,
    timeoutMs,
  });
  const records = parseFredCsv(responseText);
  if (records.length < 2) {
    throw new Error(
      `FRED returned ${records.length} usable ${SERIES_ID} observations for ${start} to ${end}.`,
    );
  }
  for (const record of records) {
    if (record.date < start || record.date > end) {
      throw new Error(
        `FRED returned an observation outside the requested range: ${record.date}`,
      );
    }
  }

  const candles = buildCloseOnlyCandles(records);
  const identity = scenarioIdentity(start, end);
  const sourceUrl = fredUrl.toString();
  const scenarioSource = renderScenario({
    candles,
    generatedAt,
    sourceUrl,
    requestedStartDate: start,
    requestedEndDate: end,
    observationStartDate: records[0].date,
    observationEndDate: records[records.length - 1].date,
    ...identity,
  });
  const readme = renderReadme({
    generatedAt,
    sourceUrl,
    requestedStartDate: start,
    requestedEndDate: end,
    observationStartDate: records[0].date,
    observationEndDate: records[records.length - 1].date,
    observationCount: records.length,
    title: identity.title,
  });

  await writeOutputFiles(outDir, scenarioSource, readme, force);

  console.log(
    `Generated local FRED scenario with ${records.length} observations at ${outDir}`,
  );
  if (outDir === defaultOutDir) {
    console.log(
      "The default src/data/scenarios/sp500-covid-2020-fred output is gitignored.",
    );
  } else {
    console.warn(
      "Custom output paths may be git-visible. Verify git status and upstream redistribution rights before committing or publishing.",
    );
  }

  return { outDir, records, candles, ...identity };
}

export function parseArgs(rawArgs) {
  const parsed = {};
  for (const arg of rawArgs) {
    if (!arg.startsWith("--")) continue;
    const [key, ...valueParts] = arg.slice(2).split("=");
    if (!key) continue;
    parsed[key] = valueParts.length > 0 ? valueParts.join("=") : "true";
  }
  return parsed;
}

export function validateDateRange(start, end) {
  validateIsoDate(start, "start");
  validateIsoDate(end, "end");
  if (start >= end) {
    throw new Error(`Invalid date range: start ${start} must be before end ${end}.`);
  }
}

export function buildFredUrl(start, end) {
  validateDateRange(start, end);
  const fredUrl = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  fredUrl.searchParams.set("id", SERIES_ID);
  fredUrl.searchParams.set("cosd", start);
  fredUrl.searchParams.set("coed", end);
  return fredUrl;
}

export async function fetchFredCsvText(
  url,
  { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("This Node.js runtime does not provide fetch().");
  }
  const validatedTimeout = positiveInteger(timeoutMs, "timeoutMs");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), validatedTimeout);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `FRED request failed with HTTP ${response.status}: ${response.statusText}`,
      );
    }
    return await response.text();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`FRED request timed out after ${validatedTimeout} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseFredCsv(csv) {
  const text = String(csv).replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("FRED returned an empty CSV response.");

  const lines = text.split(/\r?\n/);
  const headers = splitCsvLine(lines[0]).map((header) =>
    header.trim().toUpperCase(),
  );
  if (new Set(headers).size !== headers.length) {
    throw new Error("FRED CSV headers must be unique.");
  }
  const dateIndex = headers.findIndex(
    (header) => header === "DATE" || header === "OBSERVATION_DATE",
  );
  const valueIndex = headers.indexOf(SERIES_ID);
  if (dateIndex < 0 || valueIndex < 0) {
    throw new Error(
      `FRED CSV must contain DATE (or observation_date) and ${SERIES_ID} columns.`,
    );
  }

  const rows = [];
  const seenDates = new Set();
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
    if (!lines[rowIndex].trim()) continue;
    const values = splitCsvLine(lines[rowIndex]);
    if (values.length !== headers.length) {
      throw new Error(
        `FRED CSV row ${rowIndex + 1} has ${values.length} columns; expected ${headers.length}.`,
      );
    }
    const date = values[dateIndex].trim();
    validateIsoDate(date, `row ${rowIndex + 1} date`);
    if (seenDates.has(date)) {
      throw new Error(`FRED CSV contains duplicate observation date: ${date}`);
    }
    seenDates.add(date);

    const rawValue = values[valueIndex].trim();
    if (!rawValue || rawValue === ".") continue;
    const close = Number(rawValue);
    if (!Number.isFinite(close) || close <= 0) {
      throw new Error(
        `FRED CSV row ${rowIndex + 1} has invalid ${SERIES_ID} value: ${rawValue}`,
      );
    }
    const roundedClose = round2(close);
    if (!Number.isFinite(roundedClose) || roundedClose <= 0) {
      throw new Error(
        `FRED CSV row ${rowIndex + 1} has invalid ${SERIES_ID} value after rounding: ${rawValue}`,
      );
    }
    rows.push({ date, close: roundedClose });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (quoted) throw new Error("FRED CSV row contains an unterminated quote.");
  values.push(current);
  return values;
}

export function buildCloseOnlyCandles(records) {
  if (records.length === 0) return [];
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  let previousClose = sorted[0].close;
  return sorted.map((record, index) => {
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

export function marketSessionTimes(isoDate) {
  validateIsoDate(isoDate, "market session date");
  return {
    openTime: localDateTimeInNewYork(isoDate, 9, 30),
    closeTime: localDateTimeInNewYork(isoDate, 16, 0),
  };
}

export function scenarioIdentity(start, end) {
  validateDateRange(start, end);
  if (start === DEFAULT_START && end === DEFAULT_END) {
    return {
      id: "sp500-covid-2020-fred",
      title: "S&P 500 COVID Crash & Recovery (FRED Local)",
      tags: [
        "equity",
        "index",
        "crash",
        "policy_response",
        "covid",
        "fred",
        "local",
      ],
    };
  }
  return {
    id: `sp500-fred-${start}-to-${end}`,
    title: `S&P 500 FRED Replay (${start} to ${end})`,
    tags: ["equity", "index", "fred", "local"],
  };
}

function localDateTimeInNewYork(isoDate, hour, minute) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const desiredWallTime = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = desiredWallTime;

  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = Object.fromEntries(
      NEW_YORK_TIME.formatToParts(new Date(candidate))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const renderedWallTime = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const adjustment = desiredWallTime - renderedWallTime;
    candidate += adjustment;
    if (adjustment === 0) return new Date(candidate).toISOString();
  }

  throw new Error(`Could not resolve New York market time for ${isoDate}.`);
}

function validateIsoDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${label}: expected YYYY-MM-DD, received ${value}.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Invalid ${label}: ${value}.`);
  }
  return value;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

function parseBoolean(value, label) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${label} must be true or false.`);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function assertSafeOutputDirectory(outDir, scenariosRoot) {
  if (
    containsPath(outDir, scenariosRoot) ||
    containsPath(outDir, resolve(process.cwd()))
  ) {
    throw new Error(`Refusing unsafe output directory: ${outDir}`);
  }
}

function containsPath(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeOutputFiles(
  outDir,
  scenarioSource,
  readme,
  force = false,
) {
  await mkdir(outDir, { recursive: true });
  const indexPath = resolve(outDir, "index.ts");
  const readmePath = resolve(outDir, "README.md");
  if (!force && ((await exists(indexPath)) || (await exists(readmePath)))) {
    throw new Error(
      `Output already exists at ${outDir}; pass --force=true to replace it.`,
    );
  }

  const suffix = `.tmp-${process.pid}-${Date.now()}`;
  const indexTemp = `${indexPath}${suffix}`;
  const readmeTemp = `${readmePath}${suffix}`;
  try {
    await Promise.all([
      writeFile(indexTemp, scenarioSource, "utf8"),
      writeFile(readmeTemp, readme, "utf8"),
    ]);
    await rename(indexTemp, indexPath);
    await rename(readmeTemp, readmePath);
  } finally {
    await Promise.all([
      rm(indexTemp, { force: true }),
      rm(readmeTemp, { force: true }),
    ]);
  }
}

export function renderScenario({
  candles,
  generatedAt,
  sourceUrl,
  requestedStartDate,
  requestedEndDate,
  observationStartDate,
  observationEndDate,
  id,
  title,
  tags,
}) {
  if (!Array.isArray(candles) || candles.length < 2) {
    throw new Error("At least two candles are required to render a scenario.");
  }
  const openTime = candles[0].openTime;
  const closeTime = candles[candles.length - 1].closeTime;
  const exportName = `${camel(id)}Scenario`;
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

const SYMBOL = ${JSON.stringify(SERIES_ID)};
const GENERATED_AT = ${JSON.stringify(generatedAt)};
const SOURCE_URL = ${JSON.stringify(sourceUrl)};
const REQUESTED_EVENT_START = ${JSON.stringify(`${requestedStartDate}T00:00:00.000Z`)};
const REQUESTED_EVENT_END = ${JSON.stringify(`${requestedEndDate}T23:59:59.999Z`)};

const meta: ScenarioMeta = {
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(title)},
  subtitle:
    "Locally generated from FRED SP500 closes; replay candles use derived OHLC and zero volume.",
  assetClass: "index",
  symbols: [SYMBOL],
  startTime: ${JSON.stringify(openTime)},
  endTime: ${JSON.stringify(closeTime)},
  baseCurrency: "USD",
  initialCash: 10_000,
  defaultGranularity: "1d",
  difficulty: "intermediate",
  tags: ${JSON.stringify(tags)},
  supportedModes: ["explorer", "professional", "challenge"],
  benchmarkSymbol: SYMBOL,
  license:
    "Local generated data - FRED and S&P Dow Jones Indices source terms apply; do not redistribute without permission.",
  dataSources: [
    ${JSON.stringify(`Generated locally from FRED series ${SERIES_ID}; requested ${requestedStartDate} to ${requestedEndDate}, observations ${observationStartDate} to ${observationEndDate}.`)},
    "Source URL: " + SOURCE_URL,
    "FRED SP500 closes are copyright S&P Dow Jones Indices LLC; generated data should remain local unless separately licensed.",
    "Only close values are source observations. Open/high/low are derived from adjacent closes and volume is set to 0.",
    "Generated at " + GENERATED_AT,
  ],
  dataVersion: ${JSON.stringify(`local-${generatedAt.slice(0, 10)}`)},
  sourceManifest: ["FRED:SP500"],
  generatedAt: GENERATED_AT,
  priceAdjustment: "raw",
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

const events: MarketEvent[] = sp500Covid2020Scenario.events
  .filter(
    (event) =>
      event.publishedAt >= REQUESTED_EVENT_START &&
      event.publishedAt <= REQUESTED_EVENT_END,
  )
  .map((event) => ({
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

    if (i >= volWindow) {
      const slice = sourceCandles.slice(i - volWindow, i + 1);
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

export const ${exportName} = assembleScenario({
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

function camel(value) {
  return value.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

export function renderReadme({
  generatedAt,
  sourceUrl,
  requestedStartDate,
  requestedEndDate,
  observationStartDate,
  observationEndDate,
  observationCount,
  title,
}) {
  return `# ${title}

Generated at: ${generatedAt}

Source: ${sourceUrl}

Requested range: ${requestedStartDate} to ${requestedEndDate}

Observation range: ${observationStartDate} to ${observationEndDate}

Observations: ${observationCount}

This local scenario is generated from FRED series SP500. The FRED SP500 page
states that S&P 500 data is copyright S&P Dow Jones Indices LLC and that
reproduction requires prior written permission from S&P. Keep generated files
local unless you have separate redistribution rights.

The default src/data/scenarios/sp500-covid-2020-fred output directory is ignored
by git. Custom output paths may be git-visible. In either case, a production
bundle built while this scenario exists includes the generated data; do not
publish it unless your use complies with the upstream terms.

Only close values are source observations. Open, high, and low are derived from
adjacent closes so the replay engine can use the existing candle model. Volume
is set to 0. This is useful for broad timing practice, not for intraday or
limit-order realism. Because part of each OHLC candle is derived rather than a
source observation, the generated scenario sets isSampleData to true and is
shown as Sample data in the app.
`;
}

const invokedAsScript =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
