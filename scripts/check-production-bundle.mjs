import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST_DIR = fileURLToPath(new URL("../dist/", import.meta.url));
const RESTRICTED_MARKERS = ["FRED:SP500", "S&P Dow Jones Indices"];
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".map"]);

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(path)));
    } else if (TEXT_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

for (const file of await filesUnder(DIST_DIR)) {
  const contents = await readFile(file, "utf8");
  const marker = RESTRICTED_MARKERS.find((candidate) =>
    contents.includes(candidate),
  );
  if (marker) {
    throw new Error(
      `Production bundle contains a local licensed-data marker (${marker}) in ${file}.`,
    );
  }
}

console.log("Production bundle license boundary verified.");
