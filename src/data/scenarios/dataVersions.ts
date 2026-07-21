import type { ScenarioPackage } from "../../types";

export const BTC_2020_2021_DATA_VERSION =
  "synthetic-btc-2020-2021-v2" as const;
export const SP500_COVID_2020_DATA_VERSION =
  "synthetic-sp500-covid-2020-v1" as const;
export const QQQ_RATE_HIKE_2022_DATA_VERSION =
  "synthetic-qqq-rate-hike-2022-v1" as const;
export const KRE_BANKING_CRISIS_2023_DATA_VERSION =
  "synthetic-kre-banking-crisis-2023-v1" as const;
export const EURGBP_BREXIT_2016_DATA_VERSION =
  "sha256:8486e780bbc0296ed3509c63d39789bd21b478b67de67e733add0b740ca81c8d" as const;
export const EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION =
  "sha256:ceaa7b41c420f374725f740fd909102b983c9ff1f7ca6463e4765c90dea334e5" as const;
/**
 * The first content-addressed ECB identities covered only normalized reference-
 * rate observations. They are retained solely as reviewed migration aliases;
 * current identities cover the complete replay contract below.
 */
export const LEGACY_EURGBP_BREXIT_2016_OBSERVATION_DATA_VERSION =
  "sha256:67affe6052df19864c846c4eb5d474af9a7f6965d3bb5df79fcf0627edc11d2d" as const;
export const LEGACY_EURUSD_COVID_LIQUIDITY_2020_OBSERVATION_DATA_VERSION =
  "sha256:3ce0c0483a1204994bdfbc44be48b5c4351e1e84fec9adefd2e6bf94b14587d9" as const;
export const LEGACY_EURGBP_BREXIT_2016_REPLAY_CONTRACT_DATA_VERSION =
  "sha256:38289534a70d09d862de6fbc1099a2083d3bce53f9754b7d1310f5003c8adc6e" as const;
export const LEGACY_EURUSD_COVID_LIQUIDITY_2020_REPLAY_CONTRACT_DATA_VERSION =
  "sha256:f87c1cc97fdb3bffc4daf18b3191f2c56daa5d9dfe2c5dee2f528f110938f63e" as const;
export const LEGACY_EURGBP_BREXIT_2016_DATA_VERSION =
  "ECB EXR D.GBP.EUR.SP00.A; retrieved 2026-07-13T00:00:00.000Z" as const;
export const LEGACY_EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION =
  "ECB EXR D.USD.EUR.SP00.A; retrieved 2026-07-14T00:00:00.000Z" as const;

export const SCENARIO_REPLAY_CONTRACT_SCHEMA =
  "market-time-machine-replay-contract-v1" as const;

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

/**
 * Canonical JSON removes object-key ordering as a source of version drift while
 * preserving array order, which can itself affect replay and display behavior.
 */
function canonicalizeReplayContract(value: unknown): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Scenario replay contracts require finite numbers.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeReplayContract);
  }
  if (typeof value === "object") {
    const canonical: { [key: string]: CanonicalValue } = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) {
        canonical[key] = canonicalizeReplayContract(child);
      }
    }
    return canonical;
  }
  throw new Error("Scenario replay contracts must be JSON-compatible.");
}

/**
 * Captures every scenario-owned input that can change replay, assessment,
 * evidence provenance, or the resulting report. `dataVersion` is excluded to
 * avoid a recursive identity and `generatedAt` is excluded because retrieval
 * time alone does not change replay content. Built-in drills retain their own
 * immutable identity; scenario-authored drills are included when present
 * because they are part of an imported package's portable replay contract.
 */
export function scenarioReplayContractPayload(scenario: ScenarioPackage) {
  const {
    dataVersion: _dataVersion,
    generatedAt: _generatedAt,
    ...replayMeta
  } = scenario.meta;
  return {
    schema: SCENARIO_REPLAY_CONTRACT_SCHEMA,
    meta: replayMeta,
    instruments: scenario.instruments,
    candles: scenario.candles,
    events: scenario.events,
    indicators: scenario.indicators,
    benchmarks: scenario.benchmarks,
    broker: scenario.broker,
    marketCalendar: scenario.marketCalendar ?? null,
    corporateActions: scenario.corporateActions ?? [],
    ...(scenario.drills === undefined ? {} : { drills: scenario.drills }),
  };
}

export function serializeScenarioReplayContract(
  scenario: ScenarioPackage,
): string {
  return JSON.stringify(
    canonicalizeReplayContract(scenarioReplayContractPayload(scenario)),
  );
}

const SHA_256_INITIAL_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f,
  0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const SHA_256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
  0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
  0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
  0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/**
 * Synchronous SHA-256 keeps scenario registration and module-time browser
 * storage recovery deterministic without relying on an asynchronous crypto
 * operation. The implementation operates on UTF-8 bytes and emits the same
 * lower-case digest as Web Crypto and Node's `createHash("sha256")`.
 */
function sha256Hex(value: string): string {
  const input = new TextEncoder().encode(value);
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;

  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(
    paddedLength - 8,
    Math.floor(bitLength / 0x1_0000_0000),
    false,
  );
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const state: number[] = [...SHA_256_INITIAL_STATE];
  const words = new Uint32Array(64);
  for (let blockOffset = 0; blockOffset < paddedLength; blockOffset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = paddedView.getUint32(blockOffset + index * 4, false);
    }
    for (let index = 16; index < words.length; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3);
      const sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10);
      words[index] =
        (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < words.length; index += 1) {
      const sigma1 =
        rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 =
        (h +
          sigma1 +
          choose +
          SHA_256_ROUND_CONSTANTS[index] +
          words[index]) >>>
        0;
      const sigma0 =
        rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}

/**
 * App-owned, content-addressed identity used for imported scenario restore
 * safety. Author-provided version labels are deliberately excluded from the
 * digest; the complete canonical replay contract is authoritative.
 */
export function scenarioReplayContractDataVersion(
  scenario: ScenarioPackage,
): string {
  return `sha256:${sha256Hex(serializeScenarioReplayContract(scenario))}`;
}

type ScenarioDataVersion = string | null | undefined;

const BUILT_IN_VERSION_MIGRATIONS: Record<
  string,
  { current: string; legacy: readonly (string | null)[] }
> = {
  "btc-2020-2021": {
    current: BTC_2020_2021_DATA_VERSION,
    // The v2 event timestamp changes when information becomes visible, so the
    // former missing/v1 identities are intentionally not migration aliases.
    legacy: [],
  },
  "sp500-covid-2020": {
    current: SP500_COVID_2020_DATA_VERSION,
    legacy: [null],
  },
  "qqq-rate-hike-2022": {
    current: QQQ_RATE_HIKE_2022_DATA_VERSION,
    legacy: [null],
  },
  "kre-banking-crisis-2023": {
    current: KRE_BANKING_CRISIS_2023_DATA_VERSION,
    legacy: [null],
  },
  "eurgbp-brexit-2016": {
    current: EURGBP_BREXIT_2016_DATA_VERSION,
    legacy: [
      LEGACY_EURGBP_BREXIT_2016_REPLAY_CONTRACT_DATA_VERSION,
      LEGACY_EURGBP_BREXIT_2016_OBSERVATION_DATA_VERSION,
      LEGACY_EURGBP_BREXIT_2016_DATA_VERSION,
    ],
  },
  "eurusd-covid-liquidity-2020": {
    current: EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION,
    legacy: [
      LEGACY_EURUSD_COVID_LIQUIDITY_2020_REPLAY_CONTRACT_DATA_VERSION,
      LEGACY_EURUSD_COVID_LIQUIDITY_2020_OBSERVATION_DATA_VERSION,
      LEGACY_EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION,
    ],
  },
};

/**
 * Canonicalizes only explicitly reviewed built-in version transitions. Unknown
 * scenario ids and unknown versions remain unchanged and therefore fail exact
 * restore/evidence checks.
 */
export function canonicalScenarioDataVersion(
  scenarioId: string,
  version: ScenarioDataVersion,
): string | null {
  const normalized = version ?? null;
  const migration = BUILT_IN_VERSION_MIGRATIONS[scenarioId];
  if (
    migration &&
    (normalized === migration.current || migration.legacy.includes(normalized))
  ) {
    return migration.current;
  }
  return normalized;
}

export function scenarioDataVersionsEqual(
  scenarioId: string,
  left: ScenarioDataVersion,
  right: ScenarioDataVersion,
): boolean {
  return (
    canonicalScenarioDataVersion(scenarioId, left) ===
    canonicalScenarioDataVersion(scenarioId, right)
  );
}
