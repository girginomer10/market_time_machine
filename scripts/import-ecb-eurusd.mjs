import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_OUTPUT =
  "src/data/scenarios/eurusd-covid-liquidity-2020/ecb-eurusd.json";
export const DEFAULT_START = "2020-02-03";
export const DEFAULT_END = "2020-06-30";
export const SERIES_KEY = "D.USD.EUR.SP00.A";
export const API_ROOT = "https://data-api.ecb.europa.eu/service/data/EXR";
export const DEFAULT_TIMEOUT_MS = 30_000;

export function argumentsFor(argv) {
  return Object.fromEntries(
    argv.map((argument) => {
      const [key, ...value] = argument.replace(/^--/, "").split("=");
      return [key, value.join("=") || "true"];
    }),
  );
}

export function csvRow(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("ECB response contains an unterminated CSV quote.");
  values.push(value);
  return values;
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateDateRange(start, end) {
  if (!isIsoDate(start) || !isIsoDate(end)) {
    throw new Error("--start and --end must be valid YYYY-MM-DD dates.");
  }
  if (start > end) throw new Error("--start must be on or before --end.");
}

export function parseEcbCsv(csv, { start, end }) {
  const lines = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = csvRow(lines.shift() ?? "");
  const dateIndex = headers.indexOf("TIME_PERIOD");
  const valueIndex = headers.indexOf("OBS_VALUE");
  if (dateIndex < 0 || valueIndex < 0) {
    throw new Error("ECB response is missing TIME_PERIOD or OBS_VALUE.");
  }

  const seenDates = new Set();
  const observations = lines.filter(Boolean).map((line, index) => {
    const row = csvRow(line);
    const date = row[dateIndex];
    const rawValue = row[valueIndex];
    const value = Number(rawValue);
    if (!isIsoDate(date) || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `Invalid ECB observation on CSV row ${index + 2}: ${date} ${rawValue}`,
      );
    }
    if (date < start || date > end) {
      throw new Error(`ECB observation ${date} falls outside ${start}..${end}.`);
    }
    if (seenDates.has(date)) {
      throw new Error(`ECB response contains duplicate observation date ${date}.`);
    }
    seenDates.add(date);
    return { date, value };
  });

  observations.sort((left, right) => left.date.localeCompare(right.date));
  if (observations.length < 2) {
    throw new Error("ECB response did not contain enough observations.");
  }
  return observations;
}

export function apiUrlFor(start, end) {
  return `${API_ROOT}/${SERIES_KEY}?startPeriod=${start}&endPeriod=${end}&format=csvdata`;
}

export async function fetchEcbCsvText(
  url,
  { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "text/csv" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ECB API returned ${response.status} ${response.statusText}.`);
    }
    return await response.text();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`ECB API request timed out after ${timeoutMs} ms.`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function sourcePayload({ apiUrl, retrievedAt, observations }) {
  return {
    seriesKey: SERIES_KEY,
    title: "US dollar/Euro ECB reference exchange rate",
    apiUrl,
    licenseUrl:
      "https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html",
    retrievedAt,
    observationCount: observations.length,
    observations,
  };
}

export async function main(
  argv = process.argv.slice(2),
  {
    fetchImpl = fetch,
    now = () => new Date(),
    log = console.log,
  } = {},
) {
  const options = argumentsFor(argv);
  const start = options.start ?? DEFAULT_START;
  const end = options.end ?? DEFAULT_END;
  const output = resolve(options.output ?? DEFAULT_OUTPUT);
  const force = options.force === "true";
  const retrievedAt = options["retrieved-at"] ?? now().toISOString();

  validateDateRange(start, end);
  if (!Number.isFinite(Date.parse(retrievedAt))) {
    throw new Error("--retrieved-at must be a valid ISO timestamp.");
  }
  if ((await exists(output)) && !force) {
    throw new Error(
      `Output already exists: ${output}. Pass --force=true to replace it.`,
    );
  }

  const apiUrl = apiUrlFor(start, end);
  const csv = await fetchEcbCsvText(apiUrl, { fetchImpl });
  const observations = parseEcbCsv(csv, { start, end });
  const payload = sourcePayload({ apiUrl, retrievedAt, observations });
  const temporary = `${output}.tmp`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  try {
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  log(`Wrote ${observations.length} ECB observations to ${output}`);
  return { output, observations, payload };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
