import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildCloseOnlyCandles,
  fetchFredCsvText,
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
      ...identity,
    });

    expect(identity).toMatchObject({
      id: "sp500-fred-2023-01-02-to-2023-01-31",
      title: "S&P 500 FRED Replay (2023-01-02 to 2023-01-31)",
    });
    expect(source).toContain('isSampleData: true');
    expect(source).toContain("event.publishedAt >= REQUESTED_EVENT_START");
    expect(source).toContain("event.publishedAt <= REQUESTED_EVENT_END");
    expect(source).toContain("if (i >= volWindow)");
    expect(source).toContain("slice(i - volWindow, i + 1)");
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
    expect(readme).toContain(
      "Custom output paths may be git-visible",
    );
    expect(readme).toContain("shown as Sample data in the app");

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
  });
});
