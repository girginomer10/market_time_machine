import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

describe("import-local-ohlcv", () => {
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
    expect(source).toContain('priceAdjustment: "raw"');
    expect(readme).toContain("Test fixture license");
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
      name: "prices that overflow while rounding",
      row: "2020-01-02,1e308,1e308,1e308,1e308,1000",
      error: "invalid open after rounding",
    },
    {
      name: "volume that overflows while rounding",
      row: "2020-01-02,1,2,1,2,1e308",
      error: "invalid volume after rounding",
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
