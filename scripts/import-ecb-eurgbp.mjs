import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_OUTPUT = "src/data/scenarios/eurgbp-brexit-2016/ecb-eurgbp.json";
const DEFAULT_START = "2016-03-01";
const DEFAULT_END = "2016-09-30";
const SERIES_KEY = "D.GBP.EUR.SP00.A";
const API_ROOT = "https://data-api.ecb.europa.eu/service/data/EXR";

function argumentsFor(argv) {
  return Object.fromEntries(
    argv.map((argument) => {
      const [key, ...value] = argument.replace(/^--/, "").split("=");
      return [key, value.join("=") || "true"];
    }),
  );
}

function csvRow(line) {
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
  values.push(value);
  return values;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const options = argumentsFor(process.argv.slice(2));
const start = options.start ?? DEFAULT_START;
const end = options.end ?? DEFAULT_END;
const output = resolve(options.output ?? DEFAULT_OUTPUT);
const force = options.force === "true";
const retrievedAt = options["retrieved-at"] ?? new Date().toISOString();

if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
  throw new Error("--start and --end must use YYYY-MM-DD.");
}
if ((await exists(output)) && !force) {
  throw new Error(`Output already exists: ${output}. Pass --force=true to replace it.`);
}

const apiUrl = `${API_ROOT}/${SERIES_KEY}?startPeriod=${start}&endPeriod=${end}&format=csvdata`;
const response = await fetch(apiUrl, {
  headers: { accept: "text/csv" },
});
if (!response.ok) {
  throw new Error(`ECB API returned ${response.status} ${response.statusText}.`);
}
const csv = await response.text();
const lines = csv.trim().split(/\r?\n/);
const headers = csvRow(lines.shift() ?? "");
const dateIndex = headers.indexOf("TIME_PERIOD");
const valueIndex = headers.indexOf("OBS_VALUE");
if (dateIndex < 0 || valueIndex < 0) {
  throw new Error("ECB response is missing TIME_PERIOD or OBS_VALUE.");
}
const observations = lines.map((line) => {
  const row = csvRow(line);
  const date = row[dateIndex];
  const value = Number(row[valueIndex]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ECB observation: ${date} ${row[valueIndex]}`);
  }
  return { date, value };
});
if (observations.length < 2) {
  throw new Error("ECB response did not contain enough observations.");
}

const payload = {
  seriesKey: SERIES_KEY,
  title: "Pound sterling/Euro ECB reference exchange rate",
  apiUrl,
  licenseUrl:
    "https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html",
  retrievedAt,
  observationCount: observations.length,
  observations,
};
const temporary = `${output}.tmp`;
await mkdir(dirname(output), { recursive: true });
await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
try {
  await rename(temporary, output);
} catch (error) {
  await rm(temporary, { force: true });
  throw error;
}
console.log(`Wrote ${observations.length} ECB observations to ${output}`);
