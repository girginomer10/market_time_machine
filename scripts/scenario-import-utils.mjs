import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open as openFile,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";

const FRED_LOCAL_SCENARIO_DIRECTORY = "sp500-covid-2020-fred";
const OUTPUT_LOCK_SUFFIX = ".market-time-machine-import.lock";
const OUTPUT_LOCK_TAKEOVER_SUFFIX = ".takeover";
const OUTPUT_TRANSACTION_DIRECTORY =
  ".market-time-machine-import.transaction";
const OUTPUT_TRANSACTION_VERSION = 1;
const OUTPUT_LOCK_VERSION = 1;
const DEFAULT_STALE_LOCK_MS = 5 * 60 * 1_000;
const PROCESS_STARTED_AT_MS = Date.now() - process.uptime() * 1_000;
const TRANSACTION_ENTRY_NAMES = new Set([
  "README.md.next",
  "README.md.previous",
  "committed",
  "index.ts.next",
  "index.ts.previous",
  "manifest.json",
  "manifest.json.tmp",
]);
const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  "EBADF",
  "EINVAL",
  "EISDIR",
  "ENOTSUP",
  "EPERM",
]);

function calendarDayIsValid(year, month, day) {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

/**
 * Parses an extended ISO-8601 timestamp without relying on Date.parse's
 * implementation-defined fallbacks. Datetimes must include either `Z` or an
 * explicit numeric UTC offset, and are returned in canonical UTC form.
 */
export function canonicalZonedIsoTimestamp(value, label = "Timestamp") {
  const text = typeof value === "string" ? value.trim() : "";
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      text,
    );
  if (!match) {
    throw new Error(
      `${label} must be a valid ISO timestamp with an explicit Z or numeric UTC offset.`,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3));
  const offsetHour = match[8] === "Z" ? 0 : Number(match[10]);
  const offsetMinute = match[8] === "Z" ? 0 : Number(match[11]);

  if (
    !calendarDayIsValid(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    throw new Error(
      `${label} must be a valid ISO timestamp with an explicit Z or numeric UTC offset.`,
    );
  }

  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millisecond);
  const offsetSign = match[9] === "+" ? 1 : match[9] === "-" ? -1 : 0;
  const offsetMs =
    offsetSign * (offsetHour * 60 + offsetMinute) * 60 * 1_000;
  const utcMs = local.getTime() - offsetMs;
  if (!Number.isFinite(utcMs)) {
    throw new Error(
      `${label} must be a valid ISO timestamp with an explicit Z or numeric UTC offset.`,
    );
  }
  return new Date(utcMs).toISOString();
}

async function syncRegularFile(path) {
  const handle = await openFile(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await openFile(path, "r");
    await handle.sync();
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        UNSUPPORTED_DIRECTORY_SYNC_CODES.has(error.code)
      )
    ) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function durableWriteFile(path, contents, options, writer = writeFile) {
  await writer(path, contents, options);
  await syncRegularFile(path);
  await syncDirectory(dirname(path));
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Content identity cannot include a non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`Unsupported content identity value: ${typeof value}.`);
}

export function contentSha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function sha256DataVersion(value) {
  return `sha256:${contentSha256(value)}`;
}

function containsPath(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function prospectiveRealPath(path) {
  const missingParts = [];
  let current = resolve(path);

  while (true) {
    try {
      await lstat(current);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        const parent = dirname(current);
        if (parent === current) throw error;
        missingParts.unshift(basename(current));
        current = parent;
        continue;
      }
      throw error;
    }

    const resolvedExistingPath = await realpath(current);
    return resolve(resolvedExistingPath, ...missingParts);
  }
}

function isAllowedDevelopmentScenario(
  outDir,
  scenariosRoot,
  allowedDirectoryNames,
  allowedDirectoryPrefixes,
) {
  const scenarioPath = relative(scenariosRoot, outDir);
  const scenarioParts = scenarioPath.split(/[\\/]/).filter(Boolean);
  return (
    scenarioPath !== "" &&
    !scenarioPath.startsWith("..") &&
    !isAbsolute(scenarioPath) &&
    scenarioParts.length === 1 &&
    (allowedDirectoryNames.includes(scenarioParts[0]) ||
      allowedDirectoryPrefixes.some((prefix) =>
        scenarioParts[0].startsWith(prefix),
      ))
  );
}

function isUnsafeOutputDirectory(
  outDir,
  { repoRoot, sourceRoot, publicRoot, distRoot, scenariosRoot },
  allowedDirectoryNames,
  allowedDirectoryPrefixes,
) {
  const isAllowedScenario = isAllowedDevelopmentScenario(
    outDir,
    scenariosRoot,
    allowedDirectoryNames,
    allowedDirectoryPrefixes,
  );
  return (
    containsPath(outDir, scenariosRoot) ||
    containsPath(outDir, repoRoot) ||
    containsPath(publicRoot, outDir) ||
    containsPath(distRoot, outDir) ||
    (containsPath(sourceRoot, outDir) && !isAllowedScenario)
  );
}

/**
 * Validates both the requested path and its real, symlink-resolved target.
 * Existing symlink components are resolved even when the final directory does
 * not exist. The returned canonical path should be used for the actual write so
 * an existing output symlink cannot be retargeted after validation.
 */
export async function assertSafeScenarioOutputDirectory(
  outDir,
  {
    repoRoot = resolve(process.cwd()),
    scenariosRoot = resolve(repoRoot, "src/data/scenarios"),
    allowedDirectoryNames = [FRED_LOCAL_SCENARIO_DIRECTORY],
    allowedDirectoryPrefixes = ["local-"],
  } = {},
) {
  const requestedOutDir = resolve(outDir);
  const lexicalRoots = {
    repoRoot: resolve(repoRoot),
    sourceRoot: resolve(repoRoot, "src"),
    publicRoot: resolve(repoRoot, "public"),
    distRoot: resolve(repoRoot, "dist"),
    scenariosRoot: resolve(scenariosRoot),
  };

  let realOutDir;
  let realRoots;
  try {
    [realOutDir, realRoots] = await Promise.all([
      prospectiveRealPath(requestedOutDir),
      Promise.all(
        Object.entries(lexicalRoots).map(async ([key, path]) => [
          key,
          await prospectiveRealPath(path),
        ]),
      ).then(Object.fromEntries),
    ]);
  } catch (error) {
    throw new Error(
      `Refusing unsafe output directory: ${requestedOutDir}. Its real target could not be resolved safely.`,
      { cause: error },
    );
  }

  if (
    isUnsafeOutputDirectory(
      requestedOutDir,
      lexicalRoots,
      allowedDirectoryNames,
      allowedDirectoryPrefixes,
    ) ||
    isUnsafeOutputDirectory(
      realOutDir,
      realRoots,
      allowedDirectoryNames,
      allowedDirectoryPrefixes,
    )
  ) {
    throw new Error(`Refusing unsafe output directory: ${requestedOutDir}`);
  }

  return realOutDir;
}

async function outputFileState(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile()) {
      throw new Error(`Refusing to replace non-file output: ${path}`);
    }
    return { exists: true };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { exists: false };
    }
    throw error;
  }
}

/**
 * Publishes one generated file from a unique sibling temp path. Non-force
 * publication uses a hard link so concurrent writers cannot replace the winner
 * after both observed a missing target. Force publication uses one atomic
 * rename and leaves the previous target untouched if that rename fails.
 */
export async function writeAtomicOutputFile(
  output,
  contents,
  force = false,
  {
    linkFile = link,
    renameFile = rename,
    writeOutputFile = writeFile,
  } = {},
) {
  const resolvedOutput = resolve(output);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  await syncDirectory(dirname(resolvedOutput));
  const outputState = await outputFileState(resolvedOutput);
  if (!force && outputState.exists) {
    throw new Error(
      `Output already exists: ${resolvedOutput}. Pass --force=true to replace it.`,
    );
  }

  const suffix = `${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const temporary = `${resolvedOutput}.tmp-${suffix}`;
  try {
    await durableWriteFile(temporary, contents, "utf8", writeOutputFile);
    if (force) {
      await renameFile(temporary, resolvedOutput);
    } else {
      await linkFile(temporary, resolvedOutput);
    }
    await syncRegularFile(resolvedOutput);
    await syncDirectory(dirname(resolvedOutput));
  } catch (error) {
    if (
      !force &&
      error &&
      typeof error === "object" &&
      error.code === "EEXIST"
    ) {
      throw new Error(
        `Output already exists: ${resolvedOutput}. Pass --force=true to replace it.`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
    await syncDirectory(dirname(resolvedOutput));
  }
}

function defaultProcessIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") {
      return false;
    }
    return true;
  }
}

function validLockMetadata(value) {
  return (
    value &&
    typeof value === "object" &&
    value.version === OUTPUT_LOCK_VERSION &&
    typeof value.token === "string" &&
    value.token.length > 0 &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    Number.isFinite(value.createdAtMs) &&
    Number.isFinite(value.processStartedAtMs)
  );
}

function sameLockSnapshot(left, right) {
  return (
    left?.lockText === right?.lockText &&
    left?.info.dev === right?.info.dev &&
    left?.info.ino === right?.info.ino &&
    left?.info.size === right?.info.size &&
    left?.info.mtimeMs === right?.info.mtimeMs
  );
}

async function existingLockSnapshot(
  lockPath,
  { now, isProcessAlive, staleLockMs },
) {
  let before;
  try {
    before = await lstat(lockPath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { status: "missing" };
    }
    throw error;
  }
  if (!before.isFile()) {
    throw new Error(`Refusing non-file scenario output lock: ${lockPath}`);
  }

  let lockText;
  try {
    lockText = await readFile(lockPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { status: "missing" };
    }
    throw error;
  }
  let after;
  try {
    after = await lstat(lockPath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { status: "missing" };
    }
    throw error;
  }
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    return { status: "changed" };
  }

  const snapshot = { info: after, lockText };
  let metadata;
  try {
    metadata = JSON.parse(lockText);
  } catch {
    return {
      ...snapshot,
      status: now() - after.mtimeMs >= staleLockMs ? "stale" : "active",
    };
  }
  if (!validLockMetadata(metadata)) {
    return {
      ...snapshot,
      status: now() - after.mtimeMs >= staleLockMs ? "stale" : "active",
    };
  }
  if (
    metadata.pid === process.pid &&
    metadata.processStartedAtMs < PROCESS_STARTED_AT_MS - 1_000
  ) {
    return { ...snapshot, metadata, status: "stale" };
  }
  return {
    ...snapshot,
    metadata,
    status: (await isProcessAlive(metadata.pid)) ? "active" : "stale",
  };
}

async function releaseTakeoverGuard({ handle, guardPath, token }) {
  const errors = [];
  try {
    await handle.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    const metadata = JSON.parse(await readFile(guardPath, "utf8"));
    if (!validLockMetadata(metadata) || metadata.token !== token) {
      throw new Error(
        `Scenario output lock takeover ownership changed at ${guardPath}.`,
      );
    }
    await rm(guardPath);
    await syncDirectory(dirname(guardPath));
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `Scenario output lock takeover guard could not be released at ${guardPath}.`,
    );
  }
}

async function reclaimStaleOutputLock(
  lockPath,
  observed,
  token,
  lockOptions,
) {
  const snapshotHash = createHash("sha256")
    .update(observed.lockText)
    .digest("hex")
    .slice(0, 24);
  const guardPath = `${lockPath}${OUTPUT_LOCK_TAKEOVER_SUFFIX}-${snapshotHash}`;
  let guardHandle;
  try {
    guardHandle = await openFile(guardPath, "wx");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      return "busy";
    }
    throw error;
  }

  const guardMetadata = {
    version: OUTPUT_LOCK_VERSION,
    token,
    pid: process.pid,
    createdAtMs: lockOptions.now(),
    processStartedAtMs: PROCESS_STARTED_AT_MS,
  };
  try {
    await guardHandle.writeFile(`${JSON.stringify(guardMetadata)}\n`, "utf8");
    await guardHandle.sync();
    await syncDirectory(dirname(guardPath));

    // The first stale observation is only advisory. Re-read both status and
    // file identity while holding the exclusive takeover guard so another
    // contender can never move a newly-created live lock.
    const fresh = await existingLockSnapshot(lockPath, lockOptions);
    if (fresh.status === "missing" || fresh.status === "changed") {
      return "retry";
    }
    if (fresh.status === "active") return "active";
    if (!sameLockSnapshot(observed, fresh)) return "retry";

    const abandonedPath = `${lockPath}.abandoned-${token}`;
    try {
      await rename(lockPath, abandonedPath);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return "retry";
      }
      throw error;
    }
    const movedText = await readFile(abandonedPath, "utf8");
    if (movedText !== fresh.lockText) {
      try {
        await link(abandonedPath, lockPath);
        await syncDirectory(dirname(lockPath));
        await rm(abandonedPath);
      } catch (restoreError) {
        throw new AggregateError(
          [restoreError],
          `Scenario output lock changed during guarded takeover at ${lockPath}; the moved lock was preserved at ${abandonedPath}.`,
        );
      }
      return "retry";
    }
    await rm(abandonedPath);
    await syncDirectory(dirname(lockPath));
    return "reclaimed";
  } finally {
    await releaseTakeoverGuard({
      handle: guardHandle,
      guardPath,
      token,
    });
  }
}

async function acquireOutputLock(
  outDir,
  openLockFile,
  { now, isProcessAlive, staleLockMs },
) {
  const lockPath = `${outDir}${OUTPUT_LOCK_SUFFIX}`;
  const token = randomUUID();
  const metadata = {
    version: OUTPUT_LOCK_VERSION,
    token,
    pid: process.pid,
    createdAtMs: now(),
    processStartedAtMs: PROCESS_STARTED_AT_MS,
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    let handle;
    try {
      handle = await openLockFile(lockPath, "wx");
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "EEXIST")) {
        throw error;
      }
      const lockOptions = {
        now,
        isProcessAlive,
        staleLockMs,
      };
      const observed = await existingLockSnapshot(lockPath, lockOptions);
      if (observed.status === "missing" || observed.status === "changed") {
        continue;
      }
      if (observed.status === "active") {
        throw new Error(
          `Output is currently being generated at ${outDir}; wait for that import to finish.`,
          { cause: error },
        );
      }

      const takeover = await reclaimStaleOutputLock(
        lockPath,
        observed,
        `${token}-${attempt}`,
        lockOptions,
      );
      if (takeover === "active") {
        throw new Error(
          `Output is currently being generated at ${outDir}; wait for that import to finish.`,
          { cause: error },
        );
      }
      if (takeover === "busy") {
        throw new Error(
          `A stale output lock is already being reclaimed at ${outDir}; retry after that import finishes.`,
          { cause: error },
        );
      }
      continue;
    }

    try {
      await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
      await handle.sync();
      await syncDirectory(dirname(lockPath));
    } catch (error) {
      const cleanupErrors = [];
      try {
        await handle.close();
      } catch (closeError) {
        cleanupErrors.push(closeError);
      }
      try {
        await rm(lockPath, { force: true });
        await syncDirectory(dirname(lockPath));
      } catch (removeError) {
        cleanupErrors.push(removeError);
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          `Scenario output lock could not be initialized at ${outDir}.`,
        );
      }
      throw error;
    }
    return { handle, lockPath, token };
  }

  throw new Error(`Could not safely acquire scenario output lock at ${outDir}.`);
}

async function releaseOutputLock({ handle, lockPath, token }) {
  const errors = [];
  try {
    await handle.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    const metadata = JSON.parse(await readFile(lockPath, "utf8"));
    if (!validLockMetadata(metadata) || metadata.token !== token) {
      throw new Error(`Scenario output lock ownership changed at ${lockPath}.`);
    }
    await rm(lockPath);
    await syncDirectory(dirname(lockPath));
  } catch (error) {
    errors.push(error);
  }
  return errors;
}

async function withExclusiveOutputLock(
  outDir,
  operation,
  openLockFile,
  lockOptions,
) {
  await mkdir(dirname(outDir), { recursive: true });
  await syncDirectory(dirname(outDir));
  const lock = await acquireOutputLock(outDir, openLockFile, lockOptions);

  let result;
  let operationError;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }
  const releaseErrors = await releaseOutputLock(lock);

  if (operationError && releaseErrors.length > 0) {
    throw new AggregateError(
      [operationError, ...releaseErrors],
      `Scenario output failed and its lock could not be released at ${outDir}.`,
    );
  }
  if (operationError) throw operationError;
  if (releaseErrors.length > 0) {
    throw new AggregateError(
      releaseErrors,
      `Scenario output completed but its lock could not be released at ${outDir}.`,
    );
  }
  return result;
}

function transactionPathsForDirectory(directory) {
  return {
    directory,
    manifest: resolve(directory, "manifest.json"),
    manifestTemp: resolve(directory, "manifest.json.tmp"),
    committed: resolve(directory, "committed"),
    indexNext: resolve(directory, "index.ts.next"),
    readmeNext: resolve(directory, "README.md.next"),
    indexPrevious: resolve(directory, "index.ts.previous"),
    readmePrevious: resolve(directory, "README.md.previous"),
  };
}

function transactionPaths(outDir) {
  return transactionPathsForDirectory(
    resolve(outDir, OUTPUT_TRANSACTION_DIRECTORY),
  );
}

function preparingTransactionPaths(outDir, token) {
  return transactionPathsForDirectory(
    resolve(outDir, `${OUTPUT_TRANSACTION_DIRECTORY}.preparing-${token}`),
  );
}

function fileContentSha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function fileSha256(path) {
  return fileContentSha256(await readFile(path));
}

function validTransactionManifest(value) {
  return (
    value &&
    typeof value === "object" &&
    value.version === OUTPUT_TRANSACTION_VERSION &&
    typeof value.hadIndex === "boolean" &&
    typeof value.hadReadme === "boolean" &&
    (value.hadIndex
      ? /^[a-f0-9]{64}$/.test(value.previousIndexSha256)
      : value.previousIndexSha256 === null) &&
    (value.hadReadme
      ? /^[a-f0-9]{64}$/.test(value.previousReadmeSha256)
      : value.previousReadmeSha256 === null) &&
    /^[a-f0-9]{64}$/.test(value.nextIndexSha256) &&
    /^[a-f0-9]{64}$/.test(value.nextReadmeSha256)
  );
}

async function regularFileHash(path) {
  const state = await outputFileState(path);
  return state.exists ? fileSha256(path) : null;
}

async function restoreTransactionEntry({
  target,
  backup,
  hadPrevious,
  previousSha256,
  nextSha256,
}) {
  const [targetHash, backupHash] = await Promise.all([
    regularFileHash(target),
    regularFileHash(backup),
  ]);
  if (hadPrevious) {
    if (backupHash !== null) {
      if (backupHash !== previousSha256) {
        throw new Error(`Refusing corrupt scenario output backup: ${backup}`);
      }
      if (targetHash !== null && targetHash !== nextSha256) {
        throw new Error(
          `Refusing to overwrite an unexpected scenario output during recovery: ${target}`,
        );
      }
      if (targetHash !== null) await rm(target);
      await rename(backup, target);
      await syncRegularFile(target);
      await Promise.all([
        syncDirectory(dirname(target)),
        syncDirectory(dirname(backup)),
      ]);
      return;
    }
    if (targetHash !== previousSha256) {
      throw new Error(
        `Scenario output recovery is missing its previous file: ${target}`,
      );
    }
    return;
  }

  if (backupHash !== null) {
    throw new Error(
      `Scenario output recovery found an unexpected previous file: ${backup}`,
    );
  }
  if (targetHash !== null && targetHash !== nextSha256) {
    throw new Error(
      `Refusing to overwrite an unexpected scenario output during recovery: ${target}`,
    );
  }
  if (targetHash === nextSha256) {
    await rm(target);
    await syncDirectory(dirname(target));
  }
}

async function recoverInterruptedScenarioPublication(outDir) {
  const paths = transactionPaths(outDir);
  let directoryInfo;
  try {
    directoryInfo = await lstat(paths.directory);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
  if (!directoryInfo.isDirectory()) {
    throw new Error(
      `Refusing invalid scenario output transaction path: ${paths.directory}`,
    );
  }

  let manifestText;
  try {
    manifestText = await readFile(paths.manifest, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw new Error(
        `Scenario output transaction directory has no manifest at ${paths.directory}; its contents were preserved for manual inspection.`,
        { cause: error },
      );
    }
    throw error;
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    throw new Error(
      `Scenario output transaction manifest is corrupt at ${paths.manifest}.`,
      { cause: error },
    );
  }
  if (!validTransactionManifest(manifest)) {
    throw new Error(
      `Scenario output transaction manifest is invalid at ${paths.manifest}.`,
    );
  }
  const unexpectedEntries = (await readdir(paths.directory)).filter(
    (entry) => !TRANSACTION_ENTRY_NAMES.has(entry),
  );
  if (unexpectedEntries.length > 0) {
    throw new Error(
      `Scenario output transaction contains unexpected entries at ${paths.directory}; its contents were preserved for manual inspection.`,
    );
  }

  const committed = (await outputFileState(paths.committed)).exists;
  if (committed) {
    const [indexHash, readmeHash] = await Promise.all([
      regularFileHash(resolve(outDir, "index.ts")),
      regularFileHash(resolve(outDir, "README.md")),
    ]);
    if (
      indexHash === manifest.nextIndexSha256 &&
      readmeHash === manifest.nextReadmeSha256
    ) {
      await rm(paths.directory, { recursive: true, force: true });
      await syncDirectory(outDir);
      return;
    }
  }

  await restoreTransactionEntry({
    target: resolve(outDir, "index.ts"),
    backup: paths.indexPrevious,
    hadPrevious: manifest.hadIndex,
    previousSha256: manifest.previousIndexSha256,
    nextSha256: manifest.nextIndexSha256,
  });
  await restoreTransactionEntry({
    target: resolve(outDir, "README.md"),
    backup: paths.readmePrevious,
    hadPrevious: manifest.hadReadme,
    previousSha256: manifest.previousReadmeSha256,
    nextSha256: manifest.nextReadmeSha256,
  });
  await rm(paths.directory, { recursive: true, force: true });
  await syncDirectory(outDir);
}

async function writeStagedPair(paths, scenarioSource, readme, writeOutputFile) {
  const results = await Promise.allSettled([
    durableWriteFile(paths.indexNext, scenarioSource, "utf8", writeOutputFile),
    durableWriteFile(paths.readmeNext, readme, "utf8", writeOutputFile),
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  await syncDirectory(paths.directory);
}

async function writeTransactionManifest(paths, manifest) {
  await durableWriteFile(
    paths.manifestTemp,
    `${JSON.stringify(manifest)}\n`,
    "utf8",
  );
  await rename(paths.manifestTemp, paths.manifest);
  await syncRegularFile(paths.manifest);
  await syncDirectory(paths.directory);
}

/**
 * Publishes index.ts and README.md as a recoverable pair. The lock records its
 * owner so a later process can reclaim an abandoned lock. A durable transaction
 * directory lets the next importer either finalize a committed pair or restore
 * the exact previous pair after an interruption at any backup/install step.
 */
export async function writeScenarioOutputFiles(
  outDir,
  scenarioSource,
  readme,
  force = false,
  {
    isProcessAlive = defaultProcessIsAlive,
    linkFile = link,
    now = Date.now,
    openLockFile = openFile,
    renameFile = rename,
    staleLockMs = DEFAULT_STALE_LOCK_MS,
    writeOutputFile = writeFile,
  } = {},
) {
  const resolvedOutDir = resolve(outDir);
  return withExclusiveOutputLock(
    resolvedOutDir,
    async () => {
      await mkdir(resolvedOutDir, { recursive: true });
      await Promise.all([
        syncDirectory(dirname(resolvedOutDir)),
        syncDirectory(resolvedOutDir),
      ]);
      await recoverInterruptedScenarioPublication(resolvedOutDir);

      const indexPath = resolve(resolvedOutDir, "index.ts");
      const readmePath = resolve(resolvedOutDir, "README.md");
      const [indexState, readmeState] = await Promise.all([
        outputFileState(indexPath),
        outputFileState(readmePath),
      ]);
      if (!force && (indexState.exists || readmeState.exists)) {
        throw new Error(
          `Output already exists at ${resolvedOutDir}; pass --force=true to replace it.`,
        );
      }

      const manifest = {
        version: OUTPUT_TRANSACTION_VERSION,
        hadIndex: indexState.exists,
        hadReadme: readmeState.exists,
        previousIndexSha256: indexState.exists
          ? await fileSha256(indexPath)
          : null,
        previousReadmeSha256: readmeState.exists
          ? await fileSha256(readmePath)
          : null,
        nextIndexSha256: fileContentSha256(scenarioSource),
        nextReadmeSha256: fileContentSha256(readme),
      };
      const paths = transactionPaths(resolvedOutDir);
      const preparation = preparingTransactionPaths(
        resolvedOutDir,
        randomUUID(),
      );
      await mkdir(preparation.directory);
      await syncDirectory(resolvedOutDir);
      let activated = false;
      let committed = false;

      try {
        await writeStagedPair(
          preparation,
          scenarioSource,
          readme,
          writeOutputFile,
        );
        await writeTransactionManifest(preparation, manifest);
        await rename(preparation.directory, paths.directory);
        activated = true;
        await syncDirectory(resolvedOutDir);
        if (force) {
          if (indexState.exists) {
            await renameFile(indexPath, paths.indexPrevious);
          }
          if (readmeState.exists) {
            await renameFile(readmePath, paths.readmePrevious);
          }
          await Promise.all([
            syncDirectory(paths.directory),
            syncDirectory(resolvedOutDir),
          ]);
          await renameFile(paths.indexNext, indexPath);
          await renameFile(paths.readmeNext, readmePath);
        } else {
          await linkFile(paths.indexNext, indexPath);
          await linkFile(paths.readmeNext, readmePath);
        }
        await Promise.all([
          syncRegularFile(indexPath),
          syncRegularFile(readmePath),
          syncDirectory(paths.directory),
          syncDirectory(resolvedOutDir),
        ]);
        await durableWriteFile(paths.committed, "committed\n", {
          flag: "wx",
        });
        committed = true;
        await rm(paths.directory, { recursive: true, force: true });
        await syncDirectory(resolvedOutDir);
      } catch (error) {
        const publicationError =
          !force &&
          error &&
          typeof error === "object" &&
          error.code === "EEXIST"
            ? new Error(
                `Output already exists at ${resolvedOutDir}; pass --force=true to replace it.`,
                { cause: error },
              )
            : error;
        if (!activated) {
          await rm(preparation.directory, { recursive: true, force: true });
          await syncDirectory(resolvedOutDir);
          throw publicationError;
        }
        try {
          await recoverInterruptedScenarioPublication(resolvedOutDir);
        } catch (recoveryError) {
          throw new AggregateError(
            [publicationError, recoveryError],
            `Scenario output failed and recovery was incomplete at ${resolvedOutDir}.`,
          );
        }
        if (!committed) throw publicationError;
      }
    },
    openLockFile,
    { now, isProcessAlive, staleLockMs },
  );
}
