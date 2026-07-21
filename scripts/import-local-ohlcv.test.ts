import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { iso, localScenarioDataVersion } from "./import-local-ohlcv.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

describe("import-local-ohlcv", () => {
  it("requires an explicit zone for timestamps while preserving date-only input", () => {
    expect(iso("2020-01-02")).toBe("2020-01-02T00:00:00.000Z");
    expect(iso("2020-01-02", true)).toBe("2020-01-02T23:59:59.999Z");
    expect(iso("2020-01-02T12:30:00Z")).toBe(
      "2020-01-02T12:30:00.000Z",
    );
    expect(iso("2020-01-02T12:30:00+03:00")).toBe(
      "2020-01-02T09:30:00.000Z",
    );
    expect(() => iso("2020-01-02T12:30:00")).toThrow(
      "must include an explicit Z or numeric UTC offset",
    );
    expect(() => iso("2020-01-02 12:30:00")).toThrow(
      "must include an explicit Z or numeric UTC offset",
    );
  });

  it.each([
    "01/02/2020T12:30:00Z",
    "2020-02-30T12:30:00Z",
    "2020-01-02T24:00:00Z",
    "2020-01-02T12:60:00Z",
    "2020-01-02T12:30:60Z",
    "2020-01-02T12:30:00+24:00",
    "2020-01-02T12:30:00+14:01",
    "2020-01-02T12:30:00+0300",
  ])("rejects non-canonical or impossible timestamp %s", (timestamp) => {
    expect(() => iso(timestamp)).toThrow();
  });

  it("normalizes zoned and date-only timestamps identically across host timezones", async () => {
    const moduleUrl = pathToFileURL(
      join(repoRoot, "scripts/import-local-ohlcv.mjs"),
    ).href;
    const probe = `
      const { iso } = await import(${JSON.stringify(moduleUrl)});
      const result = {
        date: iso("2020-01-02", true),
        utc: iso("2020-01-02T12:30:00Z"),
        offset: iso("2020-01-02T12:30:00+03:00"),
      };
      try {
        iso("2020-01-02T12:30:00");
        result.zoneLess = "accepted";
      } catch (error) {
        result.zoneLess = error.message;
      }
      process.stdout.write(JSON.stringify(result));
    `;
    const outputs = await Promise.all(
      ["UTC", "America/Los_Angeles", "Asia/Tokyo"].map((timezone) =>
        execFileAsync(
          process.execPath,
          ["--input-type=module", "--eval", probe],
          {
            cwd: repoRoot,
            env: { ...process.env, TZ: timezone },
          },
        ).then(({ stdout }) => stdout),
      ),
    );

    expect(new Set(outputs).size).toBe(1);
    expect(JSON.parse(outputs[0])).toEqual({
      date: "2020-01-02T23:59:59.999Z",
      utc: "2020-01-02T12:30:00.000Z",
      offset: "2020-01-02T09:30:00.000Z",
      zoneLess: expect.stringContaining(
        "must include an explicit Z or numeric UTC offset",
      ),
    });
  });

  it("uses content-addressed versions that change with normalized input", () => {
    const input = {
      id: "local-spy",
      title: "SPY Local",
      symbol: "SPY",
      tickSize: 0.01,
      candles: [{ closeTime: "2020-01-02T23:59:59.999Z", close: 101 }],
    };

    expect(localScenarioDataVersion(input)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(localScenarioDataVersion(input)).toBe(localScenarioDataVersion(input));
    expect(
      localScenarioDataVersion({
        ...input,
        candles: [{ closeTime: "2020-01-02T23:59:59.999Z", close: 102 }],
      }),
    ).not.toBe(localScenarioDataVersion(input));
    expect(
      localScenarioDataVersion({ ...input, tickSize: 0.0001 }),
    ).not.toBe(localScenarioDataVersion(input));
  });

  it("generates a gitignored local scenario from licensed CSV input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mtm-ohlcv-"));
    const input = join(dir, "prices.csv");
    const out = join(dir, "local-spy");
    await writeFile(
      input,
      [
        "date,open,high,low,close,volume",
        "2020-01-02,100,102,99,101,1000",
        "2020-01-03,101,103,100,102,1200",
      ].join("\n"),
    );

    await execFileAsync(
      "node",
      [
        "scripts/import-local-ohlcv.mjs",
        `--input=${input}`,
        "--symbol=SPY",
        "--title=SPY Licensed Local",
        "--license=Test fixture license",
        `--out=${out}`,
      ],
      { cwd: repoRoot },
    );

    const source = await readFile(join(out, "index.ts"), "utf8");
    const readme = await readFile(join(out, "README.md"), "utf8");
    expect(source).toContain('id: "local-spy"');
    expect(source).toContain('sourceManifest: ["prices.csv"]');
    expect(source).toContain(
      'export const LOCAL_LICENSED_DATA_BOUNDARY = "MTM_LOCAL_LICENSED_DATA"',
    );
    expect(source).toContain('priceAdjustment: "raw"');
    expect(source).toContain("MTM_LOCAL_LICENSED_DATA");
    expect(source).toContain("tickSize: 0.01");
    expect(source).toMatch(/dataVersion: "sha256:[a-f0-9]{64}"/);
    expect(readme).toContain("Test fixture license");
  });

  it("accepts documented camelCase CSV timestamps and defaults FX tick size", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mtm-ohlcv-fx-"));
    const input = join(dir, "prices.csv");
    const out = join(dir, "local-eurusd");
    await writeFile(
      input,
      [
        "\uFEFFopenTime,closeTime,open,high,low,close,adjustedClose,volume",
        "2020-01-02T08:00:00.000Z,2020-01-02T17:00:00.000Z,1.1,1.12,1.09,1.11,1.105,1000",
        "2020-01-03T08:00:00.000Z,2020-01-03T17:00:00.000Z,1.11,1.13,1.1,1.12,1.115,1200",
      ].join("\n"),
    );

    await execFileAsync(
      "node",
      [
        "scripts/import-local-ohlcv.mjs",
        `--input=${input}`,
        "--symbol=EURUSD",
        "--assetClass=fx",
        `--out=${out}`,
      ],
      { cwd: repoRoot },
    );

    const source = await readFile(join(out, "index.ts"), "utf8");
    expect(source).toContain("tickSize: 0.0001");
    expect(source).toContain('"openTime": "2020-01-02T08:00:00.000Z"');
    expect(source).toContain('"adjustedClose": 1.105');
  });

  it("validates a custom tick size and binds it into generated output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mtm-ohlcv-tick-"));
    const input = join(dir, "prices.csv");
    const out = join(dir, "local-eurusd");
    await writeFile(
      input,
      [
        "date,open,high,low,close",
        "2020-01-02,1.1,1.12,1.09,1.11",
        "2020-01-03,1.11,1.13,1.1,1.12",
      ].join("\n"),
    );
    const command = [
      "scripts/import-local-ohlcv.mjs",
      `--input=${input}`,
      "--symbol=EURUSD",
      "--assetClass=fx",
      "--tickSize=0.00001",
      `--out=${out}`,
    ];

    await execFileAsync("node", command, { cwd: repoRoot });
    const source = await readFile(join(out, "index.ts"), "utf8");
    expect(source).toContain("tickSize: 0.00001");
    await expect(
      execFileAsync("node", [...command, "--force=true", "--tickSize=0"], {
        cwd: repoRoot,
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("tickSize must be a positive finite number"),
    });
  });

  it("preserves sub-micro crypto prices and tick sizes without fixed-six-decimal rounding", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mtm-ohlcv-micro-price-"));
    const input = join(dir, "prices.csv");
    const out = join(dir, "local-micro-crypto");
    await writeFile(
      input,
      [
        "date,open,high,low,close,volume",
        "2024-01-02,0.00000012,0.00000015,0.00000011,0.00000014,0.0000004",
        "2024-01-03,0.00000014,0.00000016,0.00000013,0.00000015,0.0000005",
      ].join("\n"),
    );

    const command = [
      "scripts/import-local-ohlcv.mjs",
      `--input=${input}`,
      "--symbol=MICRO",
      "--assetClass=crypto",
      "--tickSize=0.00000001",
      `--out=${out}`,
    ];
    await execFileAsync("node", command, { cwd: repoRoot });

    const source = await readFile(join(out, "index.ts"), "utf8");
    expect(source).toContain("tickSize: 1e-8");
    expect(source).toContain('"open": 1.2e-7');
    expect(source).toContain('"close": 1.4e-7');
    expect(source).toContain('"volume": 4e-7');
    expect(source).toMatch(/dataVersion: "sha256:[a-f0-9]{64}"/);

    await execFileAsync("node", [...command, "--force=true"], {
      cwd: repoRoot,
    });
    const regeneratedSource = await readFile(join(out, "index.ts"), "utf8");
    expect(regeneratedSource.match(/dataVersion: "sha256:[a-f0-9]{64}"/)?.[0])
      .toBe(source.match(/dataVersion: "sha256:[a-f0-9]{64}"/)?.[0]);
  });

  it("sorts rows before deriving scenario range metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mtm-ohlcv-sort-"));
    const input = join(dir, "prices.csv");
    const out = join(dir, "local-spy");
    await writeFile(
      input,
      [
        "date,open,high,low,close,volume",
        "2020-01-03,101,103,100,102,1200",
        "2020-01-02,100,102,99,101,1000",
      ].join("\n"),
    );
    await execFileAsync(
      "node",
      [
        "scripts/import-local-ohlcv.mjs",
        `--input=${input}`,
        "--symbol=SPY",
        `--out=${out}`,
      ],
      { cwd: repoRoot },
    );
    const source = await readFile(join(out, "index.ts"), "utf8");
    expect(source).toContain('startTime: "2020-01-02T00:00:00.000Z"');
    expect(source.indexOf('"openTime": "2020-01-02')).toBeLessThan(
      source.indexOf('"openTime": "2020-01-03'),
    );
  });

  it("uses fillable fixed slippage when volume is unavailable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mtm-ohlcv-no-volume-"));
    const input = join(dir, "prices.csv");
    const out = join(dir, "local-spy");
    await writeFile(
      input,
      [
        "date,open,high,low,close",
        "2020-01-02,100,102,99,101",
        "2020-01-03,101,103,100,102",
      ].join("\n"),
    );

    await execFileAsync(
      "node",
      [
        "scripts/import-local-ohlcv.mjs",
        `--input=${input}`,
        "--symbol=SPY",
        `--out=${out}`,
      ],
      { cwd: repoRoot },
    );
    const source = await readFile(join(out, "index.ts"), "utf8");
    expect(source).toContain('slippageModel: "fixed_bps"');
    expect(source).toContain('partialFillPolicy: "disabled"');
    expect(source).not.toContain("maxParticipationRate");
  });

  it.each([
    {
      name: "non-positive prices",
      row: "2020-01-02,0,2,0,1,1000",
      error: "invalid open",
    },
    {
      name: "invalid dates",
      row: "2020-13-40,1,2,1,2,1000",
      error: "Invalid OHLCV date",
    },
    {
      name: "prices outside the safe numeric range",
      row: "2020-01-02,1e308,1e308,1e308,1e308,1000",
      error: "invalid open outside the safe numeric range",
    },
    {
      name: "volume outside the safe numeric range",
      row: "2020-01-02,1,2,1,2,1e308",
      error: "invalid volume outside the safe numeric range",
    },
  ])("rejects $name", async ({ row, error }) => {
    const dir = await mkdtemp(join(tmpdir(), "mtm-ohlcv-invalid-"));
    const input = join(dir, "prices.csv");
    await writeFile(
      input,
      ["date,open,high,low,close,volume", row, "2020-01-03,2,3,1,2,1000"].join(
        "\n",
      ),
    );
    await expect(
      execFileAsync(
        "node",
        [
          "scripts/import-local-ohlcv.mjs",
          `--input=${input}`,
          "--symbol=SPY",
          `--out=${join(dir, "out")}`,
        ],
        { cwd: repoRoot },
      ),
    ).rejects.toMatchObject({ stderr: expect.stringContaining(error) });
  });

  it("rejects duplicate close times", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mtm-ohlcv-duplicate-"));
    const input = join(dir, "prices.csv");
    await writeFile(
      input,
      [
        "date,open,high,low,close,volume",
        "2020-01-02,100,102,99,101,1000",
        "2020-01-02,101,103,100,102,1200",
      ].join("\n"),
    );
    await expect(
      execFileAsync(
        "node",
        [
          "scripts/import-local-ohlcv.mjs",
          `--input=${input}`,
          "--symbol=SPY",
          `--out=${join(dir, "out")}`,
        ],
        { cwd: repoRoot },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Duplicate OHLCV close time"),
    });
  });

  it("rejects an empty id before it can target the registry directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mtm-ohlcv-id-"));
    const input = join(dir, "prices.csv");
    await writeFile(
      input,
      [
        "date,open,high,low,close,volume",
        "2020-01-02,100,102,99,101,1000",
        "2020-01-03,101,103,100,102,1200",
      ].join("\n"),
    );
    await expect(
      execFileAsync(
        "node",
        [
          "scripts/import-local-ohlcv.mjs",
          `--input=${input}`,
          "--symbol=SPY",
          "--id=!!!",
        ],
        { cwd: repoRoot },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Scenario id must contain a letter or number",
      ),
    });
  });

  it("rejects invalid timezones and unsafe parent output directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mtm-ohlcv-safety-"));
    const input = join(dir, "prices.csv");
    await writeFile(
      input,
      [
        "date,open,high,low,close,volume",
        "2020-01-02,100,102,99,101,1000",
        "2020-01-03,101,103,100,102,1200",
      ].join("\n"),
    );
    const baseCommand = [
      "scripts/import-local-ohlcv.mjs",
      `--input=${input}`,
      "--symbol=SPY",
    ];

    await expect(
      execFileAsync(
        "node",
        [...baseCommand, "--timezone=Not/A_Timezone", `--out=${join(dir, "out")}`],
        { cwd: repoRoot },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Invalid timezone"),
    });
    await expect(
      execFileAsync("node", [...baseCommand, "--out=src/data"], {
        cwd: repoRoot,
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Refusing unsafe output directory"),
    });
    for (const unsafeOutput of [
      "public/local-spy",
      "dist/local-spy",
      "src/components/local-spy",
      "src/data/scenarios/eurgbp-brexit-2016",
    ]) {
      await expect(
        execFileAsync("node", [...baseCommand, `--out=${unsafeOutput}`], {
          cwd: repoRoot,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("Refusing unsafe output directory"),
      });
    }
  });

  it("requires force before replacing an existing generated scenario", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mtm-ohlcv-force-"));
    const input = join(dir, "prices.csv");
    const out = join(dir, "local-spy");
    await writeFile(
      input,
      [
        "date,open,high,low,close,volume",
        "2020-01-02,100,102,99,101,1000",
        "2020-01-03,101,103,100,102,1200",
      ].join("\n"),
    );
    const command = [
      "scripts/import-local-ohlcv.mjs",
      `--input=${input}`,
      "--symbol=SPY",
      `--out=${out}`,
    ];
    await execFileAsync("node", command, { cwd: repoRoot });
    await expect(execFileAsync("node", command, { cwd: repoRoot })).rejects.toMatchObject({
      stderr: expect.stringContaining("--force=true"),
    });
    await expect(
      execFileAsync("node", [...command, "--force=true"], { cwd: repoRoot }),
    ).resolves.toBeTruthy();
  });
});
