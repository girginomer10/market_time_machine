import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  apiUrlFor,
  main,
  parseEcbCsv,
  sourcePayload,
  validateDateRange,
} from "./import-ecb-eurusd.mjs";

const CSV = [
  "KEY,TIME_PERIOD,OBS_VALUE,TITLE_COMPL",
  'EXR.D.USD.EUR.SP00.A,2020-02-04,1.1048,"ECB reference, daily"',
  'EXR.D.USD.EUR.SP00.A,2020-02-03,1.1066,"ECB reference, daily"',
].join("\n");

describe("import-ecb-eurusd", () => {
  it("validates real ordered calendar dates", () => {
    expect(() => validateDateRange("2020-02-03", "2020-06-30")).not.toThrow();
    expect(() => validateDateRange("2020-02-30", "2020-06-30")).toThrow(
      "valid YYYY-MM-DD",
    );
    expect(() => validateDateRange("2020-07-01", "2020-06-30")).toThrow(
      "on or before",
    );
  });

  it("parses quoted ECB CSV rows and sorts observations deterministically", () => {
    expect(
      parseEcbCsv(CSV, { start: "2020-02-03", end: "2020-02-04" }),
    ).toEqual([
      { date: "2020-02-03", value: 1.1066 },
      { date: "2020-02-04", value: 1.1048 },
    ]);
  });

  it.each([
    {
      name: "missing columns",
      csv: "DATE,VALUE\n2020-02-03,1.1\n2020-02-04,1.2",
      error: "missing TIME_PERIOD or OBS_VALUE",
    },
    {
      name: "non-positive values",
      csv: "TIME_PERIOD,OBS_VALUE\n2020-02-03,0\n2020-02-04,1.2",
      error: "Invalid ECB observation",
    },
    {
      name: "duplicate dates",
      csv: "TIME_PERIOD,OBS_VALUE\n2020-02-03,1.1\n2020-02-03,1.2",
      error: "duplicate observation date",
    },
    {
      name: "out-of-range records",
      csv: "TIME_PERIOD,OBS_VALUE\n2020-02-02,1.1\n2020-02-03,1.2",
      error: "falls outside",
    },
  ])("rejects $name", ({ csv, error }) => {
    expect(() =>
      parseEcbCsv(csv, { start: "2020-02-03", end: "2020-02-04" }),
    ).toThrow(error);
  });

  it("builds a stable attributed source payload", () => {
    expect(
      sourcePayload({
        apiUrl: apiUrlFor("2020-02-03", "2020-02-04"),
        retrievedAt: "2026-07-14T00:00:00.000Z",
        observations: [{ date: "2020-02-03", value: 1.1066 }],
      }),
    ).toMatchObject({
      seriesKey: "D.USD.EUR.SP00.A",
      title: "US dollar/Euro ECB reference exchange rate",
      retrievedAt: "2026-07-14T00:00:00.000Z",
      observationCount: 1,
      licenseUrl: expect.stringContaining("ecb.europa.eu"),
    });
  });

  it("writes a reproducible snapshot with mocked network data and requires force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mtm-ecb-eurusd-"));
    const output = join(dir, "ecb-eurusd.json");
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => CSV,
    }));
    const args = [
      "--start=2020-02-03",
      "--end=2020-02-04",
      `--output=${output}`,
      "--retrieved-at=2026-07-14T00:00:00.000Z",
    ];

    await main(args, { fetchImpl, log: vi.fn() });
    const written = JSON.parse(await readFile(output, "utf8"));
    expect(written).toMatchObject({
      seriesKey: "D.USD.EUR.SP00.A",
      observationCount: 2,
      observations: [
        { date: "2020-02-03", value: 1.1066 },
        { date: "2020-02-04", value: 1.1048 },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("D.USD.EUR.SP00.A"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await expect(main(args, { fetchImpl, log: vi.fn() })).rejects.toThrow(
      "--force=true",
    );
  });
});
