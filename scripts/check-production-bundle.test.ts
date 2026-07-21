import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProductionBundle } from "./check-production-bundle.mjs";

describe("check-production-bundle", () => {
  it("checks text assets regardless of their file extension", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mtm-bundle-text-"));
    await mkdir(join(directory, "nested"));
    await writeFile(
      join(directory, "nested", "licensed-data.ts"),
      'export const source = "FRED:SP500";\n',
      "utf8",
    );

    await expect(checkProductionBundle(directory)).rejects.toThrow(
      "local licensed-data marker (FRED:SP500)",
    );
  });

  it("recognizes the local OHLCV marker and ignores binary assets", async () => {
    const restricted = await mkdtemp(join(tmpdir(), "mtm-bundle-local-"));
    await writeFile(
      join(restricted, "README.md"),
      "<!-- MTM_LOCAL_LICENSED_DATA -->\n",
      "utf8",
    );
    await expect(checkProductionBundle(restricted)).rejects.toThrow(
      "local licensed-data marker (MTM_LOCAL_LICENSED_DATA)",
    );

    const safe = await mkdtemp(join(tmpdir(), "mtm-bundle-binary-"));
    await writeFile(join(safe, "icon.bin"), Buffer.from([0, 1, 2, 255]));
    await writeFile(join(safe, "app.custom"), "safe application text\n", "utf8");
    await expect(checkProductionBundle(safe)).resolves.toBeUndefined();
  });

  it("fails closed instead of skipping symbolic links", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mtm-bundle-link-"));
    const outside = await mkdtemp(join(tmpdir(), "mtm-bundle-outside-"));
    const restricted = join(outside, "restricted.js");
    await writeFile(restricted, 'export const source = "FRED:SP500";\n', "utf8");
    await symlink(restricted, join(directory, "linked.js"));

    await expect(checkProductionBundle(directory)).rejects.toThrow(
      "Production bundle contains a symbolic link",
    );
  });
});
