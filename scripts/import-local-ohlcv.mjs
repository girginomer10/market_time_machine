#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));

if (!args.input || !args.symbol) {
  throw new Error(
    "Usage: npm run import:ohlcv -- --input=path.csv --symbol=SPY --title=\"SPY Local\" --license=\"Licensed local use\"",
  );
}

const inputPath = resolve(process.cwd(), args.input);
const symbol = String(args.symbol).toUpperCase();
const id = slug(args.id ?? `local-${symbol}`);
const outDir = resolve(process.cwd(), args.out ?? `src/data/scenarios/${id}`);
const title = args.title ?? `${symbol} Local OHLCV Replay`;
const license =
  args.license ??
  "Local user-provided data; redistribution rights are not asserted by this repository.";
const generatedAt = new Date().toISOString();
const sourceName = args.source ?? basename(inputPath);
const priceAdjustment = args.adjustment ?? "raw";

const raw = await readFile(inputPath, "utf8");
const records = inputPath.endsWith(".json") ? parseJson(raw) : parseCsv(raw);
if (records.length < 2) {
  throw new Error("Need at least two OHLCV rows to build a replay scenario.");
}

const candles = records.map((record) => normalizeRecord(record, symbol));
const startTime = candles[0].openTime;
const endTime = candles[candles.length - 1].closeTime;
const benchmarks = candles.map((candle) => ({
  symbol,
  time: candle.closeTime,
  value: candle.close,
}));

const scenarioSource = renderScenario({
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
});
const readme = renderReadme({
  title,
  generatedAt,
  sourceName,
  rowCount: candles.length,
  license,
});

await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, "index.ts"), scenarioSource);
await writeFile(resolve(outDir, "README.md"), readme);

console.log(`Generated local OHLCV scenario with ${candles.length} candles at ${outDir}`);
console.log("Generated local-* scenario folders are gitignored by default.");

function parseArgs(rawArgs) {
  const parsed = {};
  for (const arg of rawArgs) {
    if (!arg.startsWith("--")) continue;
    const [key, ...valueParts] = arg.slice(2).split("=");
    parsed[key] = valueParts.join("=");
  }
  return parsed;
}

function parseCsv(csv) {
  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  const headers = splitCsvLine(headerLine).map((header) =>
    header.trim().toLowerCase(),
  );
  return lines
    .filter((line) => line.trim())
    .map((line) => {
      const values = splitCsvLine(line);
      return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function parseJson(json) {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error("JSON OHLCV input must be an array of row objects.");
  }
  return parsed;
}

function normalizeRecord(record, symbol) {
  const openTime = iso(record.openTime ?? record.open_time ?? record.date);
  const closeTime = iso(
    record.closeTime ??
      record.close_time ??
      record.timestamp ??
      record.date,
    true,
  );
  const open = finiteNumber(record.open, "open");
  const high = finiteNumber(record.high, "high");
  const low = finiteNumber(record.low, "low");
  const close = finiteNumber(record.close, "close");
  const volume = Number(record.volume ?? 0);
  if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
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
    adjustedClose: close,
    volume: Number.isFinite(volume) ? Math.max(0, volume) : 0,
    source: sourceName,
  };
}

function iso(value, close = false) {
  if (!value) throw new Error("OHLCV row is missing a time/date value.");
  const text = String(value);
  if (text.includes("T")) return new Date(text).toISOString();
  return `${text}T${close ? "23:59:59.000" : "00:00:00.000"}Z`;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`OHLCV row has invalid ${label}: ${value}`);
  }
  return Math.round(number * 1_000_000) / 1_000_000;
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function renderScenario({
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
}) {
  return `import type {
  BenchmarkPoint,
  Candle,
  CorporateAction,
  IndicatorSnapshot,
  Instrument,
  MarketEvent,
} from "../../../types";
import type { BrokerConfig, ScenarioMeta } from "../../../types/scenario";
import { assembleScenario } from "../../../domain/scenario/loader";

const SYMBOL = "${symbol}";

const meta: ScenarioMeta = {
  id: "${id}",
  title: ${JSON.stringify(title)},
  subtitle: "Locally generated from user-provided licensed OHLCV data.",
  assetClass: "etf",
  symbols: [SYMBOL],
  startTime: "${startTime}",
  endTime: "${endTime}",
  baseCurrency: "USD",
  initialCash: 10_000,
  defaultGranularity: "1d",
  difficulty: "intermediate",
  tags: ["local", "user_import", "ohlcv"],
  supportedModes: ["explorer", "professional", "challenge"],
  benchmarkSymbol: SYMBOL,
  license: ${JSON.stringify(license)},
  dataSources: [${JSON.stringify(sourceName)}],
  dataVersion: "local-${generatedAt.slice(0, 10)}",
  sourceManifest: [${JSON.stringify(sourceName)}],
  generatedAt: "${generatedAt}",
  priceAdjustment: "${priceAdjustment}",
  marketCalendarId: "always-open-local",
  isSampleData: false,
  description:
    "Local scenario generated from user-provided OHLCV data. Keep generated files local unless redistribution rights are explicit.",
};

const instruments: Instrument[] = [
  {
    symbol: SYMBOL,
    name: ${JSON.stringify(title)},
    assetClass: "etf",
    currency: "USD",
    timezone: "UTC",
    allowFractional: true,
    tickSize: 0.01,
  },
];

const broker: BrokerConfig = {
  baseCurrency: "USD",
  commissionRateBps: 5,
  fixedFee: 0,
  spreadBps: 5,
  slippageModel: "volume_based",
  slippageBps: 3,
  allowFractional: true,
  allowShort: true,
  maxLeverage: 2,
  maxParticipationRate: 0.1,
  partialFillPolicy: "volume_limited",
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
  marketCalendar: {
    id: "always-open-local",
    timezone: "UTC",
    sessions: [
      { dayOfWeek: 0, open: "00:00", close: "23:59" },
      { dayOfWeek: 1, open: "00:00", close: "23:59" },
      { dayOfWeek: 2, open: "00:00", close: "23:59" },
      { dayOfWeek: 3, open: "00:00", close: "23:59" },
      { dayOfWeek: 4, open: "00:00", close: "23:59" },
      { dayOfWeek: 5, open: "00:00", close: "23:59" },
      { dayOfWeek: 6, open: "00:00", close: "23:59" },
    ],
  },
  corporateActions,
});
`;
}

function camel(value) {
  return value.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function renderReadme({ title, generatedAt, sourceName, rowCount, license }) {
  return `# ${title}

Generated at: ${generatedAt}

Source manifest:

- ${sourceName}

Rows imported: ${rowCount}

License / terms note:

${license}

This directory is ignored by git because local OHLCV imports may contain
restricted or proprietary data. Do not publish generated files or bundles unless
you have explicit redistribution rights.
`;
}
