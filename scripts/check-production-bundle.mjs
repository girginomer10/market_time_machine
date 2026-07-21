import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

function moduleFilePath() {
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return undefined;
  }
}

const CURRENT_MODULE_PATH = moduleFilePath();
const DIST_DIR = CURRENT_MODULE_PATH
  ? resolve(dirname(CURRENT_MODULE_PATH), "../dist")
  : resolve(process.cwd(), "dist");
export const RESTRICTED_MARKERS = [
  "FRED:SP500",
  "S&P Dow Jones Indices",
  "MTM_LOCAL_LICENSED_DATA",
];
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Production bundle contains a symbolic link and cannot be verified safely: ${path}.`,
      );
    }
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(path)));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw new Error(
        `Production bundle contains an unsupported filesystem entry: ${path}.`,
      );
    }
  }
  return files;
}

function utf8Text(contents) {
  if (contents.includes(0)) return undefined;
  try {
    return UTF8_DECODER.decode(contents);
  } catch {
    return undefined;
  }
}

export async function checkProductionBundle(directory = DIST_DIR) {
  for (const file of await filesUnder(directory)) {
    const contents = utf8Text(await readFile(file));
    if (contents === undefined) continue;
    const marker = RESTRICTED_MARKERS.find((candidate) =>
      contents.includes(candidate),
    );
    if (marker) {
      throw new Error(
        `Production bundle contains a local licensed-data marker (${marker}) in ${file}.`,
      );
    }
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === CURRENT_MODULE_PATH) {
  await checkProductionBundle();
  console.log("Production bundle license boundary verified.");
}
