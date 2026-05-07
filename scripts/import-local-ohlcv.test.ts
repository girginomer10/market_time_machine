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
});
