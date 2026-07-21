import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeScenarioOutputDirectory,
  contentSha256,
  sha256DataVersion,
  writeAtomicOutputFile,
  writeScenarioOutputFiles,
} from "./scenario-import-utils.mjs";

const transactionDirectoryName =
  ".market-time-machine-import.transaction";
const lockSuffix = ".market-time-machine-import.lock";

function rawSha256(contents: string) {
  return createHash("sha256").update(contents).digest("hex");
}

function transactionManifest(
  oldIndex: string | null,
  oldReadme: string | null,
  nextIndex: string,
  nextReadme: string,
) {
  return {
    version: 1,
    hadIndex: oldIndex !== null,
    hadReadme: oldReadme !== null,
    previousIndexSha256: oldIndex === null ? null : rawSha256(oldIndex),
    previousReadmeSha256: oldReadme === null ? null : rawSha256(oldReadme),
    nextIndexSha256: rawSha256(nextIndex),
    nextReadmeSha256: rawSha256(nextReadme),
  };
}

describe("scenario-import-utils", () => {
  it("builds canonical content identities independent of object key order", () => {
    const left = contentSha256({ b: [2, { y: true, x: "value" }], a: 1 });
    const right = contentSha256({ a: 1, b: [2, { x: "value", y: true }] });

    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256DataVersion({ a: 1 })).toBe(`sha256:${contentSha256({ a: 1 })}`);
    expect(contentSha256({ a: 2 })).not.toBe(left);
  });

  it("atomically chooses one concurrent single-file writer without overwrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mtm-single-output-"));
    const output = join(directory, "snapshot.json");

    const results = await Promise.allSettled([
      writeAtomicOutputFile(output, "writer A"),
      writeAtomicOutputFile(output, "writer B"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(["writer A", "writer B"]).toContain(await readFile(output, "utf8"));
    expect(await readdir(directory)).toEqual(["snapshot.json"]);

    await expect(writeAtomicOutputFile(output, "writer C")).rejects.toThrow(
      "--force=true",
    );
    await writeAtomicOutputFile(output, "writer C", true);
    await expect(readFile(output, "utf8")).resolves.toBe("writer C");
  });

  it("writes both scenario files and requires force before replacement", async () => {
    const out = await mkdtemp(join(tmpdir(), "mtm-paired-output-"));

    await writeScenarioOutputFiles(out, "new index", "new readme");
    await expect(
      writeScenarioOutputFiles(out, "other index", "other readme"),
    ).rejects.toThrow("--force=true");
    await writeScenarioOutputFiles(out, "other index", "other readme", true);

    await expect(readFile(join(out, "index.ts"), "utf8")).resolves.toBe(
      "other index",
    );
    await expect(readFile(join(out, "README.md"), "utf8")).resolves.toBe(
      "other readme",
    );
  });

  it("serializes concurrent no-force writers without overwriting or mixing their pairs", async () => {
    const parent = await mkdtemp(join(tmpdir(), "mtm-paired-concurrent-"));
    const out = join(parent, "scenario");
    let releaseFirstWrite = () => {};
    const firstWriteCanFinish = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let firstWriteStarted = () => {};
    const firstWriteDidStart = new Promise<void>((resolve) => {
      firstWriteStarted = resolve;
    });
    let writeCount = 0;
    const writeOutputFile = async (...args: Parameters<typeof writeFile>) => {
      writeCount += 1;
      if (writeCount === 1) {
        firstWriteStarted();
        await firstWriteCanFinish;
      }
      return writeFile(...args);
    };

    const first = writeScenarioOutputFiles(
      out,
      "writer A index",
      "writer A readme",
      false,
      { writeOutputFile },
    );
    await firstWriteDidStart;
    await expect(
      writeScenarioOutputFiles(
        out,
        "writer B index",
        "writer B readme",
      ),
    ).rejects.toThrow("currently being generated");
    releaseFirstWrite();
    await first;

    await expect(readFile(join(out, "index.ts"), "utf8")).resolves.toBe(
      "writer A index",
    );
    await expect(readFile(join(out, "README.md"), "utf8")).resolves.toBe(
      "writer A readme",
    );
    expect((await readdir(out)).sort()).toEqual(["README.md", "index.ts"]);
    expect(await readdir(parent)).toEqual(["scenario"]);
  });

  it("reclaims a lock whose recorded owner process is no longer alive", async () => {
    const parent = await mkdtemp(join(tmpdir(), "mtm-paired-stale-lock-"));
    const out = join(parent, "scenario");
    const lockPath = `${out}${lockSuffix}`;
    await writeFile(
      lockPath,
      `${JSON.stringify({
        version: 1,
        token: "abandoned-import",
        pid: 424_242,
        createdAtMs: 1,
        processStartedAtMs: 1,
      })}\n`,
      "utf8",
    );

    await writeScenarioOutputFiles(out, "recovered index", "recovered readme", false, {
      isProcessAlive: (pid: number) => {
        expect(pid).toBe(424_242);
        return false;
      },
    });

    await expect(readFile(join(out, "index.ts"), "utf8")).resolves.toBe(
      "recovered index",
    );
    await expect(readFile(join(out, "README.md"), "utf8")).resolves.toBe(
      "recovered readme",
    );
    expect(await readdir(parent)).toEqual(["scenario"]);
  });

  it("never lets a second stale-lock observer move the first contender's fresh lock", async () => {
    const parent = await mkdtemp(join(tmpdir(), "mtm-paired-stale-race-"));
    const out = join(parent, "scenario");
    const lockPath = `${out}${lockSuffix}`;
    await writeFile(
      lockPath,
      `${JSON.stringify({
        version: 1,
        token: "abandoned-import",
        pid: 424_242,
        createdAtMs: 1,
        processStartedAtMs: 1,
      })}\n`,
      "utf8",
    );

    let firstStaleCheckStarted = () => {};
    const firstStaleCheckDidStart = new Promise<void>((resolve) => {
      firstStaleCheckStarted = resolve;
    });
    let secondStaleCheckStarted = () => {};
    const secondStaleCheckDidStart = new Promise<void>((resolve) => {
      secondStaleCheckStarted = resolve;
    });
    let firstWriteStarted = () => {};
    const firstWriteDidStart = new Promise<void>((resolve) => {
      firstWriteStarted = resolve;
    });
    let releaseFirstWrite = () => {};
    const firstWriteCanFinish = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let staleCheckCount = 0;
    const isProcessAlive = async (pid: number) => {
      if (pid === process.pid) return true;
      expect(pid).toBe(424_242);
      staleCheckCount += 1;
      if (staleCheckCount === 1) {
        firstStaleCheckStarted();
        await secondStaleCheckDidStart;
      } else if (staleCheckCount === 2) {
        secondStaleCheckStarted();
        await firstWriteDidStart;
      }
      return false;
    };
    let writeCount = 0;
    const writeOutputFile = async (...args: Parameters<typeof writeFile>) => {
      writeCount += 1;
      if (writeCount <= 2) {
        firstWriteStarted();
        await firstWriteCanFinish;
      }
      return writeFile(...args);
    };

    const first = writeScenarioOutputFiles(
      out,
      "writer A index",
      "writer A readme",
      false,
      { isProcessAlive, writeOutputFile },
    );
    await firstStaleCheckDidStart;
    const second = writeScenarioOutputFiles(
      out,
      "writer B index",
      "writer B readme",
      false,
      { isProcessAlive, writeOutputFile },
    );

    await expect(second).rejects.toThrow("currently being generated");
    releaseFirstWrite();
    await expect(first).resolves.toBeUndefined();
    await expect(readFile(join(out, "index.ts"), "utf8")).resolves.toBe(
      "writer A index",
    );
    await expect(readFile(join(out, "README.md"), "utf8")).resolves.toBe(
      "writer A readme",
    );
    expect((await readdir(out)).sort()).toEqual(["README.md", "index.ts"]);
    expect(await readdir(parent)).toEqual(["scenario"]);
  });

  it.each([
    { name: "has no manifest", manifest: null, error: "has no manifest" },
    {
      name: "has an invalid manifest",
      manifest: { version: 1, unrelated: true },
      error: "manifest is invalid",
    },
  ])(
    "fails closed and preserves arbitrary transaction contents when the directory $name",
    async ({ manifest, error }) => {
      const out = await mkdtemp(join(tmpdir(), "mtm-paired-foreign-tx-"));
      const transaction = join(out, transactionDirectoryName);
      const arbitraryDirectory = join(transaction, "user-subdir");
      await mkdir(arbitraryDirectory, { recursive: true });
      await writeFile(
        join(arbitraryDirectory, "important.txt"),
        "do not delete",
        "utf8",
      );
      if (manifest !== null) {
        await writeFile(
          join(transaction, "manifest.json"),
          JSON.stringify(manifest),
          "utf8",
        );
      }

      await expect(
        writeScenarioOutputFiles(out, "new index", "new readme", true),
      ).rejects.toThrow(error);
      await expect(
        readFile(join(arbitraryDirectory, "important.txt"), "utf8"),
      ).resolves.toBe("do not delete");
      expect(await readdir(transaction)).toContain("user-subdir");
    },
  );

  it("preserves unexpected contents even beside a structurally valid transaction manifest", async () => {
    const out = await mkdtemp(join(tmpdir(), "mtm-paired-foreign-valid-tx-"));
    const transaction = join(out, transactionDirectoryName);
    const arbitraryDirectory = join(transaction, "user-subdir");
    await mkdir(arbitraryDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        join(transaction, "manifest.json"),
        JSON.stringify(
          transactionManifest(null, null, "next index", "next readme"),
        ),
        "utf8",
      ),
      writeFile(
        join(arbitraryDirectory, "important.txt"),
        "do not delete",
        "utf8",
      ),
    ]);

    await expect(
      writeScenarioOutputFiles(out, "new index", "new readme", true),
    ).rejects.toThrow("unexpected entries");
    await expect(
      readFile(join(arbitraryDirectory, "important.txt"), "utf8"),
    ).resolves.toBe("do not delete");
  });

  it("restores an exact previous pair after interruption between backup and install", async () => {
    const out = await mkdtemp(join(tmpdir(), "mtm-paired-interrupted-"));
    const transaction = join(out, transactionDirectoryName);
    const oldIndex = "old index";
    const oldReadme = "old readme";
    const interruptedIndex = "interrupted new index";
    const interruptedReadme = "interrupted new readme";
    await Promise.all([
      writeFile(join(out, "index.ts"), oldIndex, "utf8"),
      writeFile(join(out, "README.md"), oldReadme, "utf8"),
      mkdir(transaction),
    ]);
    await writeFile(
      join(transaction, "manifest.json"),
      JSON.stringify(
        transactionManifest(
          oldIndex,
          oldReadme,
          interruptedIndex,
          interruptedReadme,
        ),
      ),
      "utf8",
    );
    await Promise.all([
      rename(join(out, "index.ts"), join(transaction, "index.ts.previous")),
      rename(join(out, "README.md"), join(transaction, "README.md.previous")),
    ]);
    await Promise.all([
      writeFile(join(out, "index.ts"), interruptedIndex, "utf8"),
      writeFile(
        join(transaction, "README.md.next"),
        interruptedReadme,
        "utf8",
      ),
    ]);

    await expect(
      writeScenarioOutputFiles(out, "unused index", "unused readme", true, {
        writeOutputFile: async () => {
          throw new Error("stop after deterministic recovery");
        },
      }),
    ).rejects.toThrow("stop after deterministic recovery");

    await expect(readFile(join(out, "index.ts"), "utf8")).resolves.toBe(
      oldIndex,
    );
    await expect(readFile(join(out, "README.md"), "utf8")).resolves.toBe(
      oldReadme,
    );
    expect((await readdir(out)).sort()).toEqual(["README.md", "index.ts"]);
  });

  it("finalizes a fully installed pair when interruption leaves a commit marker", async () => {
    const out = await mkdtemp(join(tmpdir(), "mtm-paired-committed-"));
    const transaction = join(out, transactionDirectoryName);
    const oldIndex = "old index";
    const oldReadme = "old readme";
    const committedIndex = "committed index";
    const committedReadme = "committed readme";
    await mkdir(transaction);
    await Promise.all([
      writeFile(join(out, "index.ts"), committedIndex, "utf8"),
      writeFile(join(out, "README.md"), committedReadme, "utf8"),
      writeFile(join(transaction, "index.ts.previous"), oldIndex, "utf8"),
      writeFile(join(transaction, "README.md.previous"), oldReadme, "utf8"),
      writeFile(
        join(transaction, "manifest.json"),
        JSON.stringify(
          transactionManifest(
            oldIndex,
            oldReadme,
            committedIndex,
            committedReadme,
          ),
        ),
        "utf8",
      ),
      writeFile(join(transaction, "committed"), "committed\n", "utf8"),
    ]);

    await expect(
      writeScenarioOutputFiles(out, "other index", "other readme"),
    ).rejects.toThrow("--force=true");

    await expect(readFile(join(out, "index.ts"), "utf8")).resolves.toBe(
      committedIndex,
    );
    await expect(readFile(join(out, "README.md"), "utf8")).resolves.toBe(
      committedReadme,
    );
    expect((await readdir(out)).sort()).toEqual(["README.md", "index.ts"]);
  });

  it("removes the first no-force target if publishing the second target fails", async () => {
    const parent = await mkdtemp(join(tmpdir(), "mtm-paired-link-failure-"));
    const out = join(parent, "scenario");
    const linkFile = async (from: string, to: string) => {
      if (to.endsWith("README.md")) {
        throw new Error("simulated second link failure");
      }
      await link(from, to);
    };

    await expect(
      writeScenarioOutputFiles(out, "new index", "new readme", false, {
        linkFile,
      }),
    ).rejects.toThrow("simulated second link failure");

    expect(await readdir(out)).toEqual([]);
    expect(await readdir(parent)).toEqual(["scenario"]);
  });

  it("restores the previous pair when the second install rename fails", async () => {
    const out = await mkdtemp(join(tmpdir(), "mtm-paired-rollback-"));
    await writeFile(join(out, "index.ts"), "old index", "utf8");
    await writeFile(join(out, "README.md"), "old readme", "utf8");

    const renameFile = async (from: string, to: string) => {
      if (from.endsWith("README.md.next") && to.endsWith("README.md")) {
        throw new Error("simulated second rename failure");
      }
      await rename(from, to);
    };

    await expect(
      writeScenarioOutputFiles(out, "new index", "new readme", true, {
        renameFile,
      }),
    ).rejects.toThrow("simulated second rename failure");
    await expect(readFile(join(out, "index.ts"), "utf8")).resolves.toBe(
      "old index",
    );
    await expect(readFile(join(out, "README.md"), "utf8")).resolves.toBe(
      "old readme",
    );
    expect((await readdir(out)).sort()).toEqual(["README.md", "index.ts"]);
  });

  it("resolves existing symlink targets and components before applying output policy", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "mtm-safe-output-repo-"));
    const scenariosRoot = join(repoRoot, "src/data/scenarios");
    const sourceComponents = join(repoRoot, "src/components");
    const publicRoot = join(repoRoot, "public");
    const distRoot = join(repoRoot, "dist");
    await Promise.all([
      mkdir(scenariosRoot, { recursive: true }),
      mkdir(sourceComponents, { recursive: true }),
      mkdir(publicRoot, { recursive: true }),
      mkdir(distRoot, { recursive: true }),
    ]);
    const links = await mkdtemp(join(tmpdir(), "mtm-safe-output-links-"));

    for (const [name, target] of [
      ["repo-link", repoRoot],
      ["public-link", publicRoot],
      ["dist-link", distRoot],
      ["source-link", sourceComponents],
    ]) {
      const outputLink = join(links, name);
      await symlink(target, outputLink, "dir");
      await expect(
        assertSafeScenarioOutputDirectory(outputLink, {
          repoRoot,
          scenariosRoot,
        }),
      ).rejects.toThrow("Refusing unsafe output directory");
    }

    const sourceAncestorLink = join(links, "source-ancestor-link");
    await symlink(join(repoRoot, "src"), sourceAncestorLink, "dir");
    await expect(
      assertSafeScenarioOutputDirectory(
        join(sourceAncestorLink, "components/new-output"),
        { repoRoot, scenariosRoot },
      ),
    ).rejects.toThrow("Refusing unsafe output directory");
  });

  it("keeps valid new local scenario and external output paths usable", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "mtm-safe-valid-repo-"));
    const scenariosRoot = join(repoRoot, "src/data/scenarios");
    await Promise.all([
      mkdir(scenariosRoot, { recursive: true }),
      mkdir(join(repoRoot, "public"), { recursive: true }),
      mkdir(join(repoRoot, "dist"), { recursive: true }),
    ]);
    const externalRoot = await mkdtemp(join(tmpdir(), "mtm-safe-valid-out-"));
    const localOutput = join(scenariosRoot, "local-new-market");
    const fredOutput = join(scenariosRoot, "sp500-covid-2020-fred");
    const customOutput = join(externalRoot, "new-output");
    const realRepoRoot = await realpath(repoRoot);
    const realExternalRoot = await realpath(externalRoot);

    await expect(
      assertSafeScenarioOutputDirectory(localOutput, {
        repoRoot,
        scenariosRoot,
      }),
    ).resolves.toBe(
      join(realRepoRoot, "src/data/scenarios/local-new-market"),
    );
    await expect(
      assertSafeScenarioOutputDirectory(fredOutput, {
        repoRoot,
        scenariosRoot,
      }),
    ).resolves.toBe(
      join(realRepoRoot, "src/data/scenarios/sp500-covid-2020-fred"),
    );
    await expect(
      assertSafeScenarioOutputDirectory(customOutput, {
        repoRoot,
        scenariosRoot,
      }),
    ).resolves.toBe(join(realExternalRoot, "new-output"));
  });
});
