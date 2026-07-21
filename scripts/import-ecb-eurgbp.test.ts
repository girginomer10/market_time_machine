import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  apiUrlFor,
  fetchEcbCsvText,
  main,
  parseEcbCsv,
  sourcePayload,
  validateDateRange,
} from "./import-ecb-eurgbp.mjs";

const CSV = [
  "KEY,TIME_PERIOD,OBS_VALUE,TITLE_COMPL",
  'EXR.D.GBP.EUR.SP00.A,2016-03-02,0.7741,"ECB reference, daily"',
  'EXR.D.GBP.EUR.SP00.A,2016-03-01,0.778,"ECB reference, daily"',
].join("\n");

describe("import-ecb-eurgbp", () => {
  it("validates real ordered calendar dates", () => {
    expect(() => validateDateRange("2016-03-01", "2016-09-30")).not.toThrow();
    expect(() => validateDateRange("2016-02-30", "2016-09-30")).toThrow(
      "valid YYYY-MM-DD",
    );
    expect(() => validateDateRange("2016-10-01", "2016-09-30")).toThrow(
      "on or before",
    );
  });

  it.each([
    "07/13/2026 00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-07-13T24:00:00Z",
    "2026-07-13T00:00:60Z",
    "2026-07-13T00:00:00",
    "2026-07-13T00:00:00+24:00",
    "2026-07-13T00:00:00+14:01",
  ])("rejects invalid retrievedAt timestamp %s before fetching", async (value) => {
    const fetchImpl = vi.fn();
    await expect(
      main([`--retrieved-at=${value}`], { fetchImpl, log: vi.fn() }),
    ).rejects.toThrow("valid ISO timestamp");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses quoted ECB CSV rows and sorts observations deterministically", () => {
    expect(
      parseEcbCsv(CSV, { start: "2016-03-01", end: "2016-03-02" }),
    ).toEqual([
      { date: "2016-03-01", value: 0.778 },
      { date: "2016-03-02", value: 0.7741 },
    ]);
  });

  it.each([
    {
      name: "missing columns",
      csv: "DATE,VALUE\n2016-03-01,0.7\n2016-03-02,0.8",
      error: "missing KEY, TIME_PERIOD, or OBS_VALUE",
    },
    {
      name: "non-positive values",
      csv: "KEY,TIME_PERIOD,OBS_VALUE\nEXR.D.GBP.EUR.SP00.A,2016-03-01,0\nEXR.D.GBP.EUR.SP00.A,2016-03-02,0.8",
      error: "Invalid ECB observation",
    },
    {
      name: "duplicate dates",
      csv: "KEY,TIME_PERIOD,OBS_VALUE\nEXR.D.GBP.EUR.SP00.A,2016-03-01,0.7\nEXR.D.GBP.EUR.SP00.A,2016-03-01,0.8",
      error: "duplicate observation date",
    },
    {
      name: "out-of-range records",
      csv: "KEY,TIME_PERIOD,OBS_VALUE\nEXR.D.GBP.EUR.SP00.A,2016-02-29,0.7\nEXR.D.GBP.EUR.SP00.A,2016-03-01,0.8",
      error: "falls outside",
    },
    {
      name: "unterminated quoted values",
      csv: 'KEY,TIME_PERIOD,OBS_VALUE,TITLE\nEXR.D.GBP.EUR.SP00.A,2016-03-01,0.7,"broken\nEXR.D.GBP.EUR.SP00.A,2016-03-02,0.8,ok',
      error: "unterminated CSV quote",
    },
    {
      name: "malformed column counts",
      csv: "KEY,TIME_PERIOD,OBS_VALUE\nEXR.D.GBP.EUR.SP00.A,2016-03-01,0.7,extra\nEXR.D.GBP.EUR.SP00.A,2016-03-02,0.8",
      error: "4 columns; expected 3",
    },
    {
      name: "a different ECB series",
      csv: "KEY,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,2016-03-01,1.1\nEXR.D.USD.EUR.SP00.A,2016-03-02,1.2",
      error: "unexpected series key EXR.D.USD.EUR.SP00.A",
    },
  ])("rejects $name", ({ csv, error }) => {
    expect(() =>
      parseEcbCsv(csv, { start: "2016-03-01", end: "2016-03-02" }),
    ).toThrow(error);
  });

  it("times out stalled requests", async () => {
    const fetchImpl = vi.fn(
      (_url: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    await expect(
      fetchEcbCsvText("https://example.test/ecb.csv", {
        fetchImpl,
        timeoutMs: 5,
      }),
    ).rejects.toThrow("timed out after 5 ms");
  });

  it("builds a content-addressed payload independent of retrieval time", () => {
    const observations = [{ date: "2016-03-01", value: 0.778 }];
    const first = sourcePayload({
      apiUrl: apiUrlFor("2016-03-01", "2016-03-02"),
      retrievedAt: "2026-07-13T00:00:00.000Z",
      observations,
    });
    const second = sourcePayload({
      apiUrl: apiUrlFor("2016-03-01", "2016-03-02"),
      retrievedAt: "2026-07-16T00:00:00.000Z",
      observations,
    });

    expect(first.contentSha256).toBe(second.contentSha256);
    expect(first.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(
      sourcePayload({
        apiUrl: apiUrlFor("2016-03-01", "2016-03-02"),
        retrievedAt: "2026-07-13T03:00:00+03:00",
        observations,
      }).retrievedAt,
    ).toBe("2026-07-13T00:00:00.000Z");
  });

  it("matches the committed snapshot content identity", async () => {
    const snapshot = JSON.parse(
      await readFile(
        "src/data/scenarios/eurgbp-brexit-2016/ecb-eurgbp.json",
        "utf8",
      ),
    );
    expect(snapshot.contentSha256).toBe(
      sourcePayload({
        apiUrl: snapshot.apiUrl,
        retrievedAt: snapshot.retrievedAt,
        observations: snapshot.observations,
      }).contentSha256,
    );
  });

  it("writes a reproducible snapshot and requires force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mtm-ecb-eurgbp-"));
    const output = join(dir, "ecb-eurgbp.json");
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => CSV,
    }));
    const args = [
      "--start=2016-03-01",
      "--end=2016-03-02",
      `--output=${output}`,
      "--retrieved-at=2026-07-13T00:00:00.000Z",
    ];

    await main(args, { fetchImpl, log: vi.fn() });
    const written = JSON.parse(await readFile(output, "utf8"));
    expect(written).toMatchObject({
      seriesKey: "D.GBP.EUR.SP00.A",
      observationCount: 2,
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      observations: [
        { date: "2016-03-01", value: 0.778 },
        { date: "2016-03-02", value: 0.7741 },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("D.GBP.EUR.SP00.A"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await expect(main(args, { fetchImpl, log: vi.fn() })).rejects.toThrow(
      "--force=true",
    );
  });
});
