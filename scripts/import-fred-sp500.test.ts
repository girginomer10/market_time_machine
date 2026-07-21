import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildCloseOnlyCandles,
  fetchFredCsvText,
  fredImportedDataVersion,
  main,
  marketSessionTimes,
  parseFredCsv,
  renderScenario,
  scenarioIdentity,
  validateDateRange,
} from "./import-fred-sp500.mjs";

describe("import-fred-sp500", () => {
  it("validates strict, ordered date ranges", () => {
    expect(() => validateDateRange("2023-01-01", "2023-01-02")).not.toThrow();
    expect(() => validateDateRange("2023-02-29", "2023-03-01")).toThrow(
      "Invalid start",
    );
    expect(() => validateDateRange("2023-01-02", "2023-01-02")).toThrow(
      "must be before",
    );
    expect(() => validateDateRange("2023-01-03", "2023-01-02")).toThrow(
      "must be before",
    );
  });

  it("parses, validates, and sorts FRED observations", () => {
    const records = parseFredCsv(
      [
        "\uFEFFobservation_date,SP500",
        "2023-01-05,3808.1",
        "2023-01-03,3824.14",
        "2023-01-04,.",
      ].join("\n"),
    );

    expect(records).toEqual([
      { date: "2023-01-03", close: 3824.14 },
      { date: "2023-01-05", close: 3808.1 },
    ]);
  });

  it.each([
    {
      name: "non-positive observations",
      csv: "DATE,SP500\n2023-01-03,0",
      error: "invalid SP500 value",
    },
    {
      name: "invalid dates",
      csv: "DATE,SP500\n2023-02-29,3800",
      error: "Invalid row 2 date",
    },
    {
      name: "duplicate dates",
      csv: "DATE,SP500\n2023-01-03,3800\n2023-01-03,3801",
      error: "duplicate observation date",
    },
    {
      name: "malformed columns",
      csv: "DATE,SP500\n2023-01-03,3800,unexpected",
      error: "3 columns; expected 2",
    },
    {
      name: "values that overflow while rounding",
      csv: "DATE,SP500\n2023-01-03,1e308",
      error: "invalid SP500 value after rounding",
    },
  ])("rejects $name", ({ csv, error }) => {
    expect(() => parseFredCsv(csv)).toThrow(error);
  });

  it("resolves New York market hours for arbitrary years and DST states", () => {
    expect(marketSessionTimes("2023-01-03")).toEqual({
      openTime: "2023-01-03T14:30:00.000Z",
      closeTime: "2023-01-03T21:00:00.000Z",
    });
    expect(marketSessionTimes("2023-07-03")).toEqual({
      openTime: "2023-07-03T13:30:00.000Z",
      closeTime: "2023-07-03T20:00:00.000Z",
    });
    expect(marketSessionTimes("2031-12-15")).toEqual({
      openTime: "2031-12-15T14:30:00.000Z",
      closeTime: "2031-12-15T21:00:00.000Z",
    });
  });

  it("times out stalled FRED requests", async () => {
    const fetchImpl = vi.fn(
      (_url: URL, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    await expect(
      fetchFredCsvText(new URL("https://example.test/fred.csv"), {
        fetchImpl,
        timeoutMs: 5,
      }),
    ).rejects.toThrow("timed out after 5 ms");
  });

  it("renders truthful custom metadata, filtered events, and ten-return volatility", () => {
    const records = Array.from({ length: 12 }, (_, index) => ({
      date: `2023-01-${String(index + 2).padStart(2, "0")}`,
      close: 3_800 + index,
    }));
    const identity = scenarioIdentity("2023-01-02", "2023-01-31");
    const source = renderScenario({
      candles: buildCloseOnlyCandles(records),
      generatedAt: "2026-07-13T12:00:00.000Z",
      sourceUrl: "https://example.test/fred.csv",
      requestedStartDate: "2023-01-02",
      requestedEndDate: "2023-01-31",
      observationStartDate: "2023-01-02",
      observationEndDate: "2023-01-13",
      importedDataVersion: "sha256:fixture",
      ...identity,
    });

    expect(identity).toMatchObject({
      id: "sp500-fred-2023-01-02-to-2023-01-31",
      title: "S&P 500 FRED Replay (2023-01-02 to 2023-01-31)",
    });
    expect(source).toContain('isSampleData: true');
    expect(source).toContain('dataFidelity: "mixed"');
    expect(source).toContain('observedFields: ["FRED SP500 daily close observations"]');
    expect(source).toContain(
      "Open/close timestamps use regular 09:30-16:00 America/New_York sessions; exchange early-close exceptions are not modeled",
    );
    expect(source).toContain(
      'IMPORTED_DATA_VERSION + ";events:" + sp500Covid2020Scenario.meta.dataVersion',
    );
    expect(source).toContain("event.publishedAt >= REQUESTED_EVENT_START");
    expect(source).toContain("event.publishedAt <= REQUESTED_EVENT_END");
    expect(source).toContain("if (i >= volWindow)");
    expect(source).toContain("slice(i - volWindow, i + 1)");
  });

  it("uses normalized imported content instead of generation time for identity", () => {
    const candles = buildCloseOnlyCandles([
      { date: "2023-01-03", close: 3_800 },
      { date: "2023-01-04", close: 3_810 },
    ]);
    const input = {
      candles,
      requestedStartDate: "2023-01-03",
      requestedEndDate: "2023-01-04",
      scenarioId: "sp500-fred-2023-01-03-to-2023-01-04",
    };

    expect(fredImportedDataVersion(input)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fredImportedDataVersion(input)).toBe(fredImportedDataVersion(input));
    expect(
      fredImportedDataVersion({
        ...input,
        candles: candles.map((candle, index) =>
          index === 1 ? { ...candle, close: 3_811 } : candle,
        ),
      }),
    ).not.toBe(fredImportedDataVersion(input));
  });

  it("keeps the established identity only for the default COVID range", () => {
    expect(scenarioIdentity("2020-01-02", "2020-12-31")).toMatchObject({
      id: "sp500-covid-2020-fred",
      title: "S&P 500 COVID Crash & Recovery (FRED Local)",
    });
    expect(scenarioIdentity("2020-02-01", "2020-06-01").title).not.toContain(
      "COVID Crash & Recovery",
    );
  });

  it("generates custom output without network access and requires force to replace it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mtm-fred-"));
    const out = join(dir, "custom-fred");
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        [
          "DATE,SP500",
          "2023-07-05,3810.2",
          "2023-07-03,3800.1",
        ].join("\n"),
    }));
    const command = [
      "--start=2023-07-01",
      "--end=2023-07-06",
      `--out=${out}`,
    ];
    const dependencies = {
      fetchImpl,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    };

    await main(command, dependencies);
    const source = await readFile(join(out, "index.ts"), "utf8");
    const readme = await readFile(join(out, "README.md"), "utf8");
    expect(source).toContain('id: "sp500-fred-2023-07-01-to-2023-07-06"');
    expect(source).toContain('"openTime": "2023-07-03T13:30:00.000Z"');
    expect(readme).toContain("paths may be git-visible");
    expect(readme).toContain("lists observed versus derived fields in the app");
    expect(readme).toContain(
      "Exchange early-close exceptions are not modeled",
    );
    expect(readme).toContain("regular 09:30-16:00");
    expect(source).toMatch(/const IMPORTED_DATA_VERSION = "sha256:[a-f0-9]{64}"/);

    await expect(main(command, dependencies)).rejects.toThrow("--force=true");
    await expect(
      main([...command, "--force=true"], dependencies),
    ).resolves.toMatchObject({ outDir: out });
  });

  it("refuses a repository or scenario-registry root as output", async () => {
    await expect(
      main(["--out=.", "--start=2023-01-01", "--end=2023-02-01"], {
        fetchImpl: vi.fn(),
      }),
    ).rejects.toThrow("Refusing unsafe output directory");

    await expect(
      main(
        [
          "--out=src/data/scenarios",
          "--start=2023-01-01",
          "--end=2023-02-01",
        ],
        { fetchImpl: vi.fn() },
      ),
    ).rejects.toThrow("Refusing unsafe output directory");

    await expect(
      main(["--out=src/data", "--start=2023-01-01", "--end=2023-02-01"], {
        fetchImpl: vi.fn(),
      }),
    ).rejects.toThrow("Refusing unsafe output directory");

    for (const unsafeOutput of [
      "public/local-fred",
      "dist/local-fred",
      "src/components/local-fred",
      "src/data/scenarios/eurgbp-brexit-2016",
    ]) {
      await expect(
        main(
          [
            `--out=${unsafeOutput}`,
            "--start=2023-01-01",
            "--end=2023-02-01",
          ],
          { fetchImpl: vi.fn() },
        ),
      ).rejects.toThrow("Refusing unsafe output directory");
    }
  });
});
