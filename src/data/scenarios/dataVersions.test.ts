import { describe, expect, it } from "vitest";
import type { ScenarioPackage } from "../../types";
import { eventDisciplineEurGbpV1 } from "../practice/drills";
import { eurGbpBrexit2016Scenario } from "./eurgbp-brexit-2016";
import { eurUsdCovidLiquidity2020Scenario } from "./eurusd-covid-liquidity-2020";
import {
  BTC_2020_2021_DATA_VERSION,
  EURGBP_BREXIT_2016_DATA_VERSION,
  EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION,
  LEGACY_EURGBP_BREXIT_2016_DATA_VERSION,
  LEGACY_EURGBP_BREXIT_2016_OBSERVATION_DATA_VERSION,
  LEGACY_EURGBP_BREXIT_2016_REPLAY_CONTRACT_DATA_VERSION,
  LEGACY_EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION,
  LEGACY_EURUSD_COVID_LIQUIDITY_2020_OBSERVATION_DATA_VERSION,
  LEGACY_EURUSD_COVID_LIQUIDITY_2020_REPLAY_CONTRACT_DATA_VERSION,
  canonicalScenarioDataVersion,
  scenarioReplayContractDataVersion,
  scenarioDataVersionsEqual,
  serializeScenarioReplayContract,
} from "./dataVersions";

async function replayContractDataVersion(
  scenario: ScenarioPackage,
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serializeScenarioReplayContract(scenario)),
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

describe("built-in scenario replay-contract versions", () => {
  it("pins each ECB version to the canonical payload of its actual scenario", async () => {
    expect(scenarioReplayContractDataVersion(eurGbpBrexit2016Scenario)).toBe(
      await replayContractDataVersion(eurGbpBrexit2016Scenario),
    );
    expect(
      scenarioReplayContractDataVersion(eurUsdCovidLiquidity2020Scenario),
    ).toBe(await replayContractDataVersion(eurUsdCovidLiquidity2020Scenario));
    expect(await replayContractDataVersion(eurGbpBrexit2016Scenario)).toBe(
      EURGBP_BREXIT_2016_DATA_VERSION,
    );
    expect(
      await replayContractDataVersion(eurUsdCovidLiquidity2020Scenario),
    ).toBe(EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION);
  });

  it("changes for every scenario-owned replay-contract layer", async () => {
    const baseline = await replayContractDataVersion(eurGbpBrexit2016Scenario);
    const firstInstrument = eurGbpBrexit2016Scenario.instruments[0];
    const firstCandle = eurGbpBrexit2016Scenario.candles[0];
    const firstEvent = eurGbpBrexit2016Scenario.events[0];
    const firstBenchmark = eurGbpBrexit2016Scenario.benchmarks[0];
    const variants: Array<[string, ScenarioPackage]> = [
      [
        "meta",
        {
          ...eurGbpBrexit2016Scenario,
          meta: {
            ...eurGbpBrexit2016Scenario.meta,
            initialCash: eurGbpBrexit2016Scenario.meta.initialCash + 1,
          },
        },
      ],
      [
        "instruments",
        {
          ...eurGbpBrexit2016Scenario,
          instruments: [
            {
              ...firstInstrument,
              tickSize: (firstInstrument.tickSize ?? 0) + 0.01,
            },
            ...eurGbpBrexit2016Scenario.instruments.slice(1),
          ],
        },
      ],
      [
        "candles",
        {
          ...eurGbpBrexit2016Scenario,
          candles: [
            { ...firstCandle, close: firstCandle.close + 0.01 },
            ...eurGbpBrexit2016Scenario.candles.slice(1),
          ],
        },
      ],
      [
        "events",
        {
          ...eurGbpBrexit2016Scenario,
          events: [
            { ...firstEvent, publishedAt: "2016-06-16T12:00:00.000Z" },
            ...eurGbpBrexit2016Scenario.events.slice(1),
          ],
        },
      ],
      [
        "indicators",
        {
          ...eurGbpBrexit2016Scenario,
          indicators: [
            {
              symbol: "EURGBP",
              name: "contract-test",
              time: "2016-03-01T15:00:00.000Z",
              availableAt: "2016-03-01T15:00:00.000Z",
              value: 1,
            },
          ],
        },
      ],
      [
        "benchmarks",
        {
          ...eurGbpBrexit2016Scenario,
          benchmarks: [
            { ...firstBenchmark, value: firstBenchmark.value + 0.01 },
            ...eurGbpBrexit2016Scenario.benchmarks.slice(1),
          ],
        },
      ],
      [
        "broker",
        {
          ...eurGbpBrexit2016Scenario,
          broker: {
            ...eurGbpBrexit2016Scenario.broker,
            spreadBps: eurGbpBrexit2016Scenario.broker.spreadBps + 1,
          },
        },
      ],
      [
        "market calendar",
        {
          ...eurGbpBrexit2016Scenario,
          marketCalendar: {
            id: "contract-test-calendar",
            timezone: "Europe/London",
            sessions: [{ dayOfWeek: 1, open: "08:00", close: "16:30" }],
          },
        },
      ],
      [
        "corporate actions",
        {
          ...eurGbpBrexit2016Scenario,
          corporateActions: [
            {
              symbol: "EURGBP",
              type: "dividend",
              effectiveAt: "2016-06-16T15:00:00.000Z",
              amount: 0.01,
              currency: "GBP",
            },
          ],
        },
      ],
    ];

    for (const [layer, scenario] of variants) {
      expect(await replayContractDataVersion(scenario), layer).not.toBe(baseline);
    }
  });

  it("ignores only the recursive identity and retrieval timestamp", async () => {
    expect(
      await replayContractDataVersion({
        ...eurGbpBrexit2016Scenario,
        meta: {
          ...eurGbpBrexit2016Scenario.meta,
          dataVersion: "some-other-identity",
          generatedAt: "2099-01-01T00:00:00.000Z",
        },
      }),
    ).toBe(await replayContractDataVersion(eurGbpBrexit2016Scenario));
  });

  it("includes scenario-authored drill content when it is present", () => {
    const authoredDrill = {
      ...eventDisciplineEurGbpV1,
      id: "authored-contract-drill-v1",
      title: "Authored contract drill",
    };
    const withAuthoredDrill: ScenarioPackage = {
      ...eurGbpBrexit2016Scenario,
      drills: [authoredDrill],
    };
    const changedAuthoredDrill: ScenarioPackage = {
      ...withAuthoredDrill,
      drills: [
        {
          ...authoredDrill,
          rubric: {
            ...authoredDrill.rubric,
            violationPenalty: authoredDrill.rubric.violationPenalty + 1,
          },
        },
      ],
    };

    expect(scenarioReplayContractDataVersion(withAuthoredDrill)).not.toBe(
      scenarioReplayContractDataVersion(changedAuthoredDrill),
    );
    expect(scenarioReplayContractDataVersion(eurGbpBrexit2016Scenario)).toBe(
      EURGBP_BREXIT_2016_DATA_VERSION,
    );
  });

  it("canonicalizes object keys while preserving replay array order", () => {
    const { baseCurrency, ...brokerWithoutBaseCurrency } =
      eurGbpBrexit2016Scenario.broker;
    const reorderedBroker: ScenarioPackage = {
      ...eurGbpBrexit2016Scenario,
      broker: { ...brokerWithoutBaseCurrency, baseCurrency },
    };
    expect(serializeScenarioReplayContract(reorderedBroker)).toBe(
      serializeScenarioReplayContract(eurGbpBrexit2016Scenario),
    );
    expect(
      serializeScenarioReplayContract({
        ...eurGbpBrexit2016Scenario,
        events: [...eurGbpBrexit2016Scenario.events].reverse(),
      }),
    ).not.toBe(serializeScenarioReplayContract(eurGbpBrexit2016Scenario));
  });
});

describe("built-in scenario data-version migrations", () => {
  it("canonicalizes every explicitly reviewed ECB transition", () => {
    for (const legacy of [
      LEGACY_EURGBP_BREXIT_2016_REPLAY_CONTRACT_DATA_VERSION,
      LEGACY_EURGBP_BREXIT_2016_OBSERVATION_DATA_VERSION,
      LEGACY_EURGBP_BREXIT_2016_DATA_VERSION,
    ]) {
      expect(canonicalScenarioDataVersion("eurgbp-brexit-2016", legacy)).toBe(
        EURGBP_BREXIT_2016_DATA_VERSION,
      );
    }
    for (const legacy of [
      LEGACY_EURUSD_COVID_LIQUIDITY_2020_REPLAY_CONTRACT_DATA_VERSION,
      LEGACY_EURUSD_COVID_LIQUIDITY_2020_OBSERVATION_DATA_VERSION,
      LEGACY_EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION,
    ]) {
      expect(
        canonicalScenarioDataVersion("eurusd-covid-liquidity-2020", legacy),
      ).toBe(EURUSD_COVID_LIQUIDITY_2020_DATA_VERSION);
    }
    expect(canonicalScenarioDataVersion("btc-2020-2021", null)).toBeNull();
    expect(
      scenarioDataVersionsEqual(
        "btc-2020-2021",
        "synthetic-btc-2020-2021-v1",
        BTC_2020_2021_DATA_VERSION,
      ),
    ).toBe(false);
  });

  it("keeps unknown scenario versions non-equivalent and fail-closed", () => {
    expect(
      canonicalScenarioDataVersion("eurgbp-brexit-2016", "unknown-version"),
    ).toBe("unknown-version");
    expect(canonicalScenarioDataVersion("user-scenario", null)).toBeNull();
    expect(
      scenarioDataVersionsEqual(
        "eurgbp-brexit-2016",
        LEGACY_EURGBP_BREXIT_2016_OBSERVATION_DATA_VERSION,
        EURGBP_BREXIT_2016_DATA_VERSION,
      ),
    ).toBe(true);
    expect(
      scenarioDataVersionsEqual(
        "eurgbp-brexit-2016",
        "unknown-version",
        EURGBP_BREXIT_2016_DATA_VERSION,
      ),
    ).toBe(false);
  });
});
