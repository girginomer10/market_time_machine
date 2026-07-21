#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  assertSafeScenarioOutputDirectory,
  canonicalZonedIsoTimestamp,
  sha256DataVersion,
  writeScenarioOutputFiles,
} from "./scenario-import-utils.mjs";

const ASSET_CLASSES = new Set([
  "crypto",
  "equity",
  "index",
  "fx",
  "commodity",
  "rates",
  "etf",
]);
const GRANULARITIES = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
const PRICE_ADJUSTMENTS = new Set(["raw", "split_adjusted", "total_return"]);
const LOCAL_LICENSED_DATA_MARKER = "MTM_LOCAL_LICENSED_DATA";

export async function main(rawArgs = process.argv.slice(2)) {
  const args = parseArgs(rawArgs);
  if (!args.input || !args.symbol) {
    throw new Error(
      "Usage: npm run import:ohlcv -- --input=path.csv --symbol=SPY --title=\"SPY Local\" --license=\"Licensed local use\"",
    );
  }

  const inputPath = resolve(process.cwd(), args.input);
  const symbol = normalizeSymbol(args.symbol);
  const id = normalizeScenarioId(args.id ?? `local-${symbol}`);
  const scenariosRoot = resolve(process.cwd(), "src/data/scenarios");
  const defaultOutDir = resolve(scenariosRoot, id);
  const outDir = resolve(process.cwd(), args.out ?? defaultOutDir);
  const safeOutDir = await assertSafeScenarioOutputDirectory(outDir, {
    scenariosRoot,
  });
  const title = args.title ?? `${symbol} Local OHLCV Replay`;
  const license =
    args.license ??
    "Local user-provided data; redistribution rights are not asserted by this repository.";
  const generatedAt = new Date().toISOString();
  const sourceName = args.source ?? basename(inputPath);
  const priceAdjustment = validateChoice(
    args.adjustment ?? "raw",
    PRICE_ADJUSTMENTS,
    "adjustment",
  );
  const assetClass = validateChoice(
    args.assetClass ?? "etf",
    ASSET_CLASSES,
    "assetClass",
  );
  const tickSize = args.tickSize !== undefined
    ? positiveOptionNumber(args.tickSize, "tickSize")
    : assetClass === "fx"
      ? 0.0001
      : 0.01;
  const granularity = validateChoice(
    args.granularity ?? "1d",
    GRANULARITIES,
    "granularity",
  );
  const currency = normalizeCurrency(args.currency ?? "USD");
  const timezone = normalizeTimezone(args.timezone?.trim() || "UTC");
  const initialCash = args.initialCash
    ? positiveNumber(args.initialCash, "initialCash")
    : 10_000;

  const raw = await readFile(inputPath, "utf8");
  const records = inputPath.toLowerCase().endsWith(".json")
    ? parseJson(raw)
    : parseCsv(raw);
  const candles = records
    .map((record, index) => normalizeRecord(record, symbol, sourceName, index))
    .sort((a, b) => a.closeTime.localeCompare(b.closeTime));
  validateCandles(candles);
  if (candles.length < 2) {
    throw new Error("Need at least two OHLCV rows to build a replay scenario.");
  }

  const benchmarks = candles.map((candle) => ({
    symbol,
    time: candle.closeTime,
    value: candle.close,
  }));
  const dataVersion = localScenarioDataVersion({
    id,
    title,
    symbol,
    candles,
    benchmarks,
    sourceName,
    license,
    priceAdjustment,
    assetClass,
    tickSize,
    granularity,
    currency,
    timezone,
    initialCash,
  });
  const scenarioSource = renderScenario({
    id,
    title,
    symbol,
    candles,
    benchmarks,
    startTime: candles[0].openTime,
    endTime: candles[candles.length - 1].closeTime,
    generatedAt,
    sourceName,
    license,
    priceAdjustment,
    assetClass,
    tickSize,
    granularity,
    currency,
    timezone,
    initialCash,
    dataVersion,
  });
  const readme = renderReadme({
    title,
    generatedAt,
    sourceName,
    rowCount: candles.length,
    license,
    tickSize,
  });

  await writeScenarioOutputFiles(
    safeOutDir,
    scenarioSource,
    readme,
    args.force === "true",
  );
  console.log(
    `Generated local OHLCV scenario with ${candles.length} candles at ${outDir}`,
  );
  if (outDir === defaultOutDir && id.startsWith("local-")) {
    console.log("This default src/data/scenarios/local-* output is gitignored.");
  } else {
    console.warn(
      "Custom output paths may be git-visible. Verify git status and redistribution rights before committing or publishing.",
    );
  }
  return { outDir, id, candles, dataVersion, tickSize };
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

export function parseCsv(csv) {
  const lines = String(csv).replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length === 0 || !lines[0].trim()) return [];
  const headers = splitCsvLine(lines[0]).map((header) =>
    header.trim().toLowerCase(),
  );
  if (new Set(headers).size !== headers.length) {
    throw new Error("CSV headers must be unique.");
  }
  return lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line, rowIndex) => {
      const values = splitCsvLine(line);
      if (values.length !== headers.length) {
        throw new Error(
          `CSV row ${rowIndex + 2} has ${values.length} columns; expected ${headers.length}.`,
        );
      }
      return Object.fromEntries(
        headers.map((header, index) => [header, values[index]]),
      );
    });
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
  if (quoted) throw new Error("CSV row contains an unterminated quoted value.");
  values.push(current);
  return values;
}

export function parseJson(json) {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error("JSON OHLCV input must be an array of row objects.");
  }
  return parsed;
}

export function normalizeRecord(record, symbol, sourceName, rowIndex = 0) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`OHLCV row ${rowIndex + 1} must be an object.`);
  }
  const openTime = iso(
    record.openTime ??
      record.opentime ??
      record.open_time ??
      record.timestamp ??
      record.date,
  );
  const closeTime = iso(
    record.closeTime ??
      record.closetime ??
      record.close_time ??
      record.timestamp ??
      record.date,
    true,
  );
  if (Date.parse(closeTime) <= Date.parse(openTime)) {
    throw new Error(`OHLCV row ${rowIndex + 1} closes before it opens.`);
  }
  const open = positiveNumber(record.open, "open");
  const high = positiveNumber(record.high, "high");
  const low = positiveNumber(record.low, "low");
  const close = positiveNumber(record.close, "close");
  const adjustedValue =
    record.adjustedClose ?? record.adjustedclose ?? record.adjusted_close;
  const adjustedClose =
    adjustedValue === undefined || adjustedValue === ""
      ? close
      : positiveNumber(adjustedValue, "adjustedClose");
  const volumeValue = record.volume;
  const volume =
    volumeValue === undefined || volumeValue === ""
      ? 0
      : nonNegativeNumber(volumeValue, "volume");
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
    throw new Error(`OHLC values do not bracket open/close for ${openTime}.`);
  }
  return {
    symbol,
    openTime,
    closeTime,
    open,
    high,
    low,
    close,
    adjustedClose,
    volume,
    source: sourceName,
  };
}

export function validateCandles(candles) {
  const closeTimes = new Set();
  let previous;
  for (const candle of candles) {
    if (closeTimes.has(candle.closeTime)) {
      throw new Error(`Duplicate OHLCV close time: ${candle.closeTime}`);
    }
    closeTimes.add(candle.closeTime);
    if (
      previous &&
      Date.parse(candle.openTime) < Date.parse(previous.closeTime)
    ) {
      throw new Error(
        `OHLCV candles overlap at ${previous.closeTime} and ${candle.openTime}.`,
      );
    }
    previous = candle;
  }
}

export function iso(value, close = false) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error("OHLCV row is missing a time/date value.");
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(`${text}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== text
    ) {
      throw new Error(`Invalid OHLCV date: ${text}`);
    }
    return `${text}T${close ? "23:59:59.999" : "00:00:00.000"}Z`;
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new Error(
      `OHLCV timestamp must include an explicit Z or numeric UTC offset: ${text}`,
    );
  }
  return canonicalZonedIsoTimestamp(text, "OHLCV timestamp");
}

export function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`OHLCV row has invalid ${label}: ${value}`);
  }
  if (number > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `OHLCV row has invalid ${label} outside the safe numeric range: ${value}`,
    );
  }
  return number;
}

function nonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`OHLCV row has invalid ${label}: ${value}`);
  }
  if (number > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `OHLCV row has invalid ${label} outside the safe numeric range: ${value}`,
    );
  }
  return number;
}

function positiveOptionNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
  if (number > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${label} must be within the safe numeric range.`);
  }
  return number;
}

export function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeScenarioId(value) {
  const normalized = slug(value);
  if (!normalized) throw new Error("Scenario id must contain a letter or number.");
  return normalized.startsWith("local-") ? normalized : `local-${normalized}`;
}

function normalizeSymbol(value) {
  const symbol = String(value).trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._:/-]{0,31}$/.test(symbol)) {
    throw new Error(`Invalid symbol: ${value}`);
  }
  return symbol;
}

function normalizeCurrency(value) {
  const currency = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3,8}$/.test(currency)) {
    throw new Error(`Invalid currency: ${value}`);
  }
  return currency;
}

function normalizeTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw new Error(`Invalid timezone: ${value}`);
  }
  return value;
}

function validateChoice(value, choices, label) {
  if (!choices.has(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

export function localScenarioDataVersion(input) {
  return sha256DataVersion({
    schema: "market-time-machine-local-ohlcv-v3",
    ...input,
  });
}

export function renderScenario({
  id,
  title,
  symbol,
  candles,
  benchmarks,
  startTime,
  endTime,
  generatedAt,
  sourceName,
  license,
  priceAdjustment,
  assetClass,
  tickSize,
  granularity,
  currency,
  timezone,
  initialCash,
  dataVersion,
}) {
  const hasUsableVolume = candles.every((candle) => candle.volume > 0);
  return `/* ${LOCAL_LICENSED_DATA_MARKER}: generated from user-provided market data. */
import type {
  BenchmarkPoint,
  Candle,
  CorporateAction,
  IndicatorSnapshot,
  Instrument,
  MarketEvent,
} from "../../../types";
import type { BrokerConfig, ScenarioMeta } from "../../../types/scenario";
import { assembleScenario } from "../../../domain/scenario/loader";

const SYMBOL = ${JSON.stringify(symbol)};
export const LOCAL_LICENSED_DATA_BOUNDARY = ${JSON.stringify(LOCAL_LICENSED_DATA_MARKER)};

const meta: ScenarioMeta = {
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(title)},
  subtitle: "Locally generated from user-provided licensed OHLCV data.",
  assetClass: ${JSON.stringify(assetClass)},
  symbols: [SYMBOL],
  startTime: ${JSON.stringify(startTime)},
  endTime: ${JSON.stringify(endTime)},
  baseCurrency: ${JSON.stringify(currency)},
  initialCash: ${initialCash},
  defaultGranularity: ${JSON.stringify(granularity)},
  difficulty: "intermediate",
  tags: ["local", "user_import", "ohlcv"],
  supportedModes: ["explorer", "professional", "challenge"],
  benchmarkSymbol: SYMBOL,
  license: ${JSON.stringify(license)},
  dataSources: [${JSON.stringify(sourceName)}],
  dataVersion: ${JSON.stringify(dataVersion)},
  sourceManifest: [${JSON.stringify(sourceName)}],
  generatedAt: ${JSON.stringify(generatedAt)},
  priceAdjustment: ${JSON.stringify(priceAdjustment)},
  isSampleData: false,
  description:
    "Local scenario generated from user-provided OHLCV data. Keep generated files local unless redistribution rights are explicit.",
};

const instruments: Instrument[] = [
  {
    symbol: SYMBOL,
    name: ${JSON.stringify(title)},
    assetClass: ${JSON.stringify(assetClass)},
    currency: ${JSON.stringify(currency)},
    timezone: ${JSON.stringify(timezone)},
    allowFractional: true,
    tickSize: ${tickSize},
  },
];

const broker: BrokerConfig = {
  baseCurrency: ${JSON.stringify(currency)},
  commissionRateBps: 5,
  fixedFee: 0,
  spreadBps: 5,
  slippageModel: ${JSON.stringify(hasUsableVolume ? "volume_based" : "fixed_bps")},
  slippageBps: 3,
  allowFractional: true,
  allowShort: true,
  maxLeverage: 2,
${hasUsableVolume ? '  maxParticipationRate: 0.1,\n  partialFillPolicy: "volume_limited",' : '  partialFillPolicy: "disabled",'}
  stopFillPolicy: "gap_open",
  marketHoursEnforced: false,
  marginCallPolicy: "reject_new_orders",
  borrowRateBps: 300,
};

const candles: Candle[] = ${JSON.stringify(candles, null, 2)};
const events: MarketEvent[] = [];
const indicators: IndicatorSnapshot[] = [];
const benchmarks: BenchmarkPoint[] = ${JSON.stringify(benchmarks, null, 2)};
const corporateActions: CorporateAction[] = [];

export const ${camel(id)}Scenario = assembleScenario({
  scenario: meta,
  instruments,
  candles,
  events,
  indicators,
  benchmarks,
  broker,
  corporateActions,
});
`;
}

function camel(value) {
  return value.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

export function renderReadme({
  title,
  generatedAt,
  sourceName,
  rowCount,
  license,
  tickSize,
}) {
  return `<!-- ${LOCAL_LICENSED_DATA_MARKER} -->
# ${title}

Generated at: ${generatedAt}

Source manifest:

- ${sourceName}

Rows imported: ${rowCount}

Tick size: ${tickSize}

License / terms note:

${license}

Default src/data/scenarios/local-* output directories are ignored by git because
local OHLCV imports may contain restricted or proprietary data. Custom output
paths may not be ignored. Verify git status and do not publish generated files or
bundles unless you have explicit redistribution rights.
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
