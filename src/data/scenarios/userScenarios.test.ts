import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioPackage } from "../../types";
import {
  scenarioDataVersionsEqual,
  scenarioReplayContractDataVersion,
} from "./dataVersions";
import {
  getScenario,
  isUserScenario,
  listScenarios,
  registerUserScenario,
  removeUserScenario,
  scenarioRegistry,
} from ".";

function userScenario(id = "user-scenario"): ScenarioPackage {
  return {
    meta: {
      id,
      title: "User Scenario",
      assetClass: "equity",
      symbols: ["TEST"],
      startTime: "2024-01-01T00:00:00.000Z",
      endTime: "2024-01-02T00:00:00.000Z",
      baseCurrency: "USD",
      initialCash: 10_000,
      defaultGranularity: "1d",
      difficulty: "beginner",
      tags: ["custom"],
      supportedModes: ["explorer", "professional"],
      benchmarkSymbol: "TEST",
      dataVersion: `${id}-data-v1`,
      license: "Licensed for local use",
      dataSources: ["User import"],
    },
    instruments: [
      {
        symbol: "TEST",
        name: "Test Asset",
        assetClass: "equity",
        currency: "USD",
        timezone: "UTC",
      },
    ],
    candles: [
      {
        symbol: "TEST",
        openTime: "2024-01-01T00:00:00.000Z",
        closeTime: "2024-01-01T23:59:59.999Z",
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 1_000,
      },
      {
        symbol: "TEST",
        openTime: "2024-01-02T00:00:00.000Z",
        closeTime: "2024-01-02T23:59:59.999Z",
        open: 102,
        high: 108,
        low: 101,
        close: 106,
        volume: 1_000,
      },
    ],
    events: [],
    indicators: [],
    benchmarks: [
      { symbol: "TEST", time: "2024-01-01T23:59:59.999Z", value: 102 },
      { symbol: "TEST", time: "2024-01-02T23:59:59.999Z", value: 106 },
    ],
    broker: {
      baseCurrency: "USD",
      commissionRateBps: 0,
      fixedFee: 0,
      spreadBps: 2,
      slippageModel: "fixed_bps",
      slippageBps: 1,
      allowFractional: true,
      allowShort: false,
      maxLeverage: 1,
    },
  };
}

describe("user scenario registry", () => {
  beforeEach(() => {
    window.localStorage.clear();
    for (const id of Object.keys(scenarioRegistry)) {
      if (isUserScenario(id)) removeUserScenario(id);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates, registers, persists, and removes a user scenario", () => {
    const candidate = userScenario();
    const result = registerUserScenario(candidate);
    expect(result).toMatchObject({ ok: true, persisted: true });
    candidate.candles[0].close = 9_999;
    const registered = getScenario("user-scenario")!;
    expect(registered.candles[0].close).toBe(102);
    expect(registered.meta.title).toBe("User Scenario");
    expect(result.scenario).toBe(registered);
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered.meta)).toBe(true);
    expect(Object.isFrozen(registered.candles)).toBe(true);
    expect(Object.isFrozen(registered.candles[0])).toBe(true);
    expect(() => {
      registered.candles[0].close = 8_888;
    }).toThrow(TypeError);
    expect(() => {
      registered.meta.title = "Mutated through registration result";
    }).toThrow(TypeError);
    expect(() => {
      registered.candles.push({ ...registered.candles[0] });
    }).toThrow(TypeError);
    expect(
      listScenarios().find(({ meta }) => meta.id === registered.meta.id),
    ).toBe(registered);
    expect(scenarioReplayContractDataVersion(registered)).toBe(
      registered.meta.dataVersion,
    );
    expect(isUserScenario("user-scenario")).toBe(true);
    const persisted = JSON.parse(
      window.localStorage.getItem("market-time-machine.user-scenarios.v1")!,
    ) as ScenarioPackage[];
    expect(persisted[0]).toMatchObject({
      meta: {
        id: "user-scenario",
        dataVersion: result.scenario?.meta.dataVersion,
      },
    });
    expect(removeUserScenario("user-scenario")).toMatchObject({
      ok: true,
      persisted: true,
    });
    expect(getScenario("user-scenario")).toBeUndefined();
    expect(
      window.localStorage.getItem("market-time-machine.user-scenarios.v1"),
    ).toBeNull();
  });

  it("exposes a read-only public registry without blocking private registration", () => {
    const first = registerUserScenario(userScenario("read-only-registry"));
    expect(first).toMatchObject({ ok: true, persisted: true });
    const registered = first.scenario!;

    expect(
      Reflect.set(
        scenarioRegistry,
        "injected-scenario",
        userScenario("injected-scenario"),
      ),
    ).toBe(false);
    expect(Reflect.deleteProperty(scenarioRegistry, registered.meta.id)).toBe(
      false,
    );
    expect(
      Reflect.defineProperty(scenarioRegistry, registered.meta.id, {
        configurable: true,
        enumerable: true,
        value: userScenario(registered.meta.id),
        writable: true,
      }),
    ).toBe(false);
    expect(Reflect.setPrototypeOf(scenarioRegistry, {})).toBe(false);
    expect(Reflect.preventExtensions(scenarioRegistry)).toBe(false);
    expect(getScenario("injected-scenario")).toBeUndefined();
    expect(getScenario(registered.meta.id)).toBe(registered);

    expect(
      registerUserScenario(userScenario("privately-registered")),
    ).toMatchObject({ ok: true, persisted: true });
    expect(getScenario("privately-registered")).toBeDefined();
  });

  it("reports a transient removal when browser storage cannot be updated", () => {
    registerUserScenario(userScenario("user-one"));
    registerUserScenario(userScenario("user-two"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("storage unavailable");
    });

    const result = removeUserScenario("user-one");

    expect(result).toMatchObject({ ok: true, persisted: false });
    expect(result.message).toMatch(/may return after reload/i);
    expect(getScenario("user-one")).toBeUndefined();
    expect(
      window.localStorage.getItem("market-time-machine.user-scenarios.v1"),
    ).toContain("user-one");
  });

  it.each([undefined, "", "   "])(
    "rejects an imported scenario without a stable data version (%s)",
    (dataVersion) => {
      const candidate = userScenario("unversioned-user-scenario");
      candidate.meta.dataVersion = dataVersion;
      const storedBefore = window.localStorage.getItem(
        "market-time-machine.user-scenarios.v1",
      );

      const result = registerUserScenario(candidate);

      expect(result).toMatchObject({ ok: false, persisted: false });
      expect(result.message).toMatch(/non-empty meta\.dataVersion/i);
      expect(getScenario(candidate.meta.id)).toBeUndefined();
      expect(
        window.localStorage.getItem("market-time-machine.user-scenarios.v1"),
      ).toBe(storedBefore);
    },
  );

  it("rejects same-id replacement without changing the registry or storage", () => {
    const original = userScenario("stable-user-scenario");
    const registered = registerUserScenario(original);
    expect(registered).toMatchObject({
      ok: true,
      persisted: true,
    });
    expect(registered.scenario?.meta.dataVersion).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(registered.scenario).not.toBe(original);
    const storedBefore = window.localStorage.getItem(
      "market-time-machine.user-scenarios.v1",
    );
    const replacement = userScenario(original.meta.id);
    replacement.meta.title = "Silently replaced scenario";
    replacement.meta.dataVersion = "stable-user-scenario-data-v2";

    const result = registerUserScenario(replacement);

    expect(result).toMatchObject({ ok: false, persisted: false });
    expect(result.message).toMatch(/remove it before importing a replacement/i);
    expect(getScenario(original.meta.id)).toBe(registered.scenario);
    expect(getScenario(original.meta.id)?.meta).toMatchObject({
      title: "User Scenario",
      dataVersion: registered.scenario?.meta.dataVersion,
    });
    expect(
      window.localStorage.getItem("market-time-machine.user-scenarios.v1"),
    ).toBe(storedBefore);
  });

  it("derives a new identity when content changes under the same author version", () => {
    const id = "content-addressed-user-scenario";
    const original = userScenario(id);
    const first = registerUserScenario(original);
    const firstVersion = first.scenario?.meta.dataVersion;
    expect(firstVersion).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(removeUserScenario(id)).toMatchObject({ ok: true });

    const changed = userScenario(id);
    changed.candles[1] = {
      ...changed.candles[1],
      high: 109,
      close: 107,
    };
    changed.benchmarks[1] = { ...changed.benchmarks[1], value: 107 };
    expect(changed.meta.dataVersion).toBe(original.meta.dataVersion);

    const second = registerUserScenario(changed);
    const secondVersion = second.scenario?.meta.dataVersion;
    expect(second).toMatchObject({ ok: true, persisted: true });
    expect(secondVersion).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(secondVersion).not.toBe(firstVersion);
    expect(scenarioDataVersionsEqual(id, firstVersion, secondVersion)).toBe(
      false,
    );
  });

  it("does not activate a legacy unversioned scenario from browser storage", async () => {
    const legacy = userScenario("legacy-unversioned-user-scenario");
    delete legacy.meta.dataVersion;
    const serialized = JSON.stringify([legacy]);
    window.localStorage.setItem(
      "market-time-machine.user-scenarios.v1",
      serialized,
    );
    vi.resetModules();

    const freshRegistry = await import(".");

    expect(freshRegistry.getScenario(legacy.meta.id)).toBeUndefined();
    expect(freshRegistry.isUserScenario(legacy.meta.id)).toBe(false);
    expect(
      window.localStorage.getItem("market-time-machine.user-scenarios.v1"),
    ).toBe(serialized);
  });

  it("normalizes a stored author version to the app-derived identity", async () => {
    const stored = userScenario("stored-content-addressed-scenario");
    const authorVersion = stored.meta.dataVersion;
    window.localStorage.setItem(
      "market-time-machine.user-scenarios.v1",
      JSON.stringify([stored]),
    );
    vi.resetModules();

    const freshRegistry = await import(".");
    const restored = freshRegistry.getScenario(stored.meta.id);

    expect(restored?.meta.dataVersion).toBe(
      scenarioReplayContractDataVersion(stored),
    );
    expect(restored?.meta.dataVersion).not.toBe(authorVersion);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored?.broker)).toBe(true);
    expect(() => {
      restored!.broker.spreadBps += 1;
    }).toThrow(TypeError);
    expect(scenarioReplayContractDataVersion(restored!)).toBe(
      restored?.meta.dataVersion,
    );
  });

  it("drops every ambiguous duplicate stored id without bricking startup", async () => {
    const first = userScenario("duplicate-stored-scenario");
    const second = userScenario(first.meta.id);
    second.meta.title = "Conflicting duplicate";
    window.localStorage.setItem(
      "market-time-machine.user-scenarios.v1",
      JSON.stringify([first, second]),
    );
    vi.resetModules();

    const freshRegistry = await import(".");

    expect(freshRegistry.getScenario(first.meta.id)).toBeUndefined();
    expect(freshRegistry.isUserScenario(first.meta.id)).toBe(false);
  });

  it("rejects malformed packages and bundled id replacement", () => {
    expect(registerUserScenario({ nope: true })).toMatchObject({ ok: false });
    expect(registerUserScenario(userScenario("btc-2020-2021"))).toMatchObject({
      ok: false,
      persisted: false,
    });
  });
});
