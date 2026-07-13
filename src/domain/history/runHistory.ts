import type {
  ReportPayload,
  ReportScore,
  ScenarioMode,
} from "../../types";
import type { BrokerMode } from "../../store/sessionStore";

export const RUN_HISTORY_STORAGE_KEY = "market-time-machine.run-history.v1";
export const MAX_SAVED_RUNS = 12;

export type CompletedRun = {
  id: string;
  completedAt: string;
  scenarioId: string;
  scenarioTitle: string;
  currency?: string;
  pricePrecision?: number;
  mode: ScenarioMode;
  brokerMode: BrokerMode;
  sampleData: boolean;
  totalReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
  maxDrawdown: number;
  scoreStatus: ReportScore["status"] | "unavailable";
  score?: number;
  executionCount: number;
  closedTradeCount: number;
  journalEntryCount: number;
  journalCoverage?: number;
  report: ReportPayload;
};

export type RunHistoryStats = {
  completedRuns: number;
  scenariosCompleted: number;
  journaledRuns: number;
  bestScore?: number;
  averageScore?: number;
};

export type RunComparison = {
  previous?: CompletedRun;
  returnDelta?: number;
  excessReturnDelta?: number;
  drawdownDelta?: number;
  scoreDelta?: number;
};

type HistoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type RecordCompletedRunInput = {
  report: ReportPayload;
  mode: ScenarioMode;
  brokerMode: BrokerMode;
  currency?: string;
  pricePrecision?: number;
  completedAt?: string;
};

function browserStorage(): HistoryStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isScenarioMode(value: unknown): value is ScenarioMode {
  return ["explorer", "professional", "blind", "challenge"].includes(
    String(value),
  );
}

function isBrokerMode(value: unknown): value is BrokerMode {
  return ["scenario", "ideal", "realistic", "harsh"].includes(String(value));
}

function isReportPayload(value: unknown): value is ReportPayload {
  if (!isRecord(value) || !isRecord(value.metrics)) return false;
  return (
    typeof value.scenarioId === "string" &&
    typeof value.scenarioTitle === "string" &&
    (value.currency === undefined || typeof value.currency === "string") &&
    (value.pricePrecision === undefined ||
      (Number.isInteger(value.pricePrecision) &&
        Number(value.pricePrecision) >= 0 &&
        Number(value.pricePrecision) <= 8)) &&
    isFiniteNumber(value.metrics.totalReturn) &&
    isFiniteNumber(value.metrics.benchmarkReturn) &&
    isFiniteNumber(value.metrics.excessReturn) &&
    isFiniteNumber(value.metrics.maxDrawdown) &&
    Array.isArray(value.equityCurve) &&
    Array.isArray(value.behavioralFlags)
  );
}

function isCompletedRun(value: unknown): value is CompletedRun {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.completedAt === "string" &&
    Number.isFinite(Date.parse(value.completedAt)) &&
    typeof value.scenarioId === "string" &&
    typeof value.scenarioTitle === "string" &&
    isScenarioMode(value.mode) &&
    isBrokerMode(value.brokerMode) &&
    typeof value.sampleData === "boolean" &&
    isFiniteNumber(value.totalReturn) &&
    isFiniteNumber(value.benchmarkReturn) &&
    isFiniteNumber(value.excessReturn) &&
    isFiniteNumber(value.maxDrawdown) &&
    ["scored", "insufficient_evidence", "unavailable"].includes(
      String(value.scoreStatus),
    ) &&
    (value.score === undefined || isFiniteNumber(value.score)) &&
    Number.isInteger(value.executionCount) &&
    Number.isInteger(value.closedTradeCount) &&
    Number.isInteger(value.journalEntryCount) &&
    (value.journalCoverage === undefined ||
      isFiniteNumber(value.journalCoverage)) &&
    isReportPayload(value.report)
  );
}

function downsampleReport(report: ReportPayload): ReportPayload {
  const maxEquityPoints = 240;
  const points = report.equityCurve;
  const equityCurve =
    points.length <= maxEquityPoints
      ? points
      : points.filter(
          (_point, index) =>
            index === 0 ||
            index === points.length - 1 ||
            index % Math.ceil(points.length / maxEquityPoints) === 0,
        );

  return {
    ...report,
    equityCurve,
    auditEvents: report.auditEvents?.slice(-250),
    orders: report.orders?.slice(-250),
    fills: report.fills?.slice(-250),
    journal: report.journal?.slice(-250),
    decisionReplay: report.decisionReplay?.map((point) => ({
      ...point,
      auditEvents: point.auditEvents.slice(-20),
    })),
  };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function runFingerprint(report: ReportPayload, mode: ScenarioMode): string {
  const fillIds = report.fills?.map((fill) => fill.id).join(",") ?? "";
  const journalIds = report.journal?.map((entry) => entry.id).join(",") ?? "";
  const orderIds = report.orders?.map((order) => order.id).join(",") ?? "";
  return stableHash(
    [
      report.scenarioId,
      mode,
      report.metrics.finalEquity,
      report.metrics.totalReturn,
      report.metrics.excessReturn,
      fillIds,
      journalIds,
      orderIds,
    ].join("|"),
  );
}

export function loadRunHistory(
  storage: HistoryStorage | undefined = browserStorage(),
): CompletedRun[] {
  if (!storage) return [];
  try {
    const serialized = storage.getItem(RUN_HISTORY_STORAGE_KEY);
    if (!serialized) return [];
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCompletedRun).slice(0, MAX_SAVED_RUNS);
  } catch {
    return [];
  }
}

function persistRunHistory(
  runs: CompletedRun[],
  storage: HistoryStorage | undefined,
): CompletedRun[] {
  if (!storage) return runs.slice(0, MAX_SAVED_RUNS);
  let retained = runs.slice(0, MAX_SAVED_RUNS);
  while (retained.length > 0) {
    try {
      storage.setItem(RUN_HISTORY_STORAGE_KEY, JSON.stringify(retained));
      return retained;
    } catch {
      retained = retained.slice(0, -1);
    }
  }
  try {
    storage.removeItem(RUN_HISTORY_STORAGE_KEY);
  } catch {
    // Storage may be disabled or full. The completed report remains in memory.
  }
  return [];
}

export function recordCompletedRun(
  input: RecordCompletedRunInput,
  storage: HistoryStorage | undefined = browserStorage(),
): { run: CompletedRun; history: CompletedRun[]; added: boolean } {
  const existing = loadRunHistory(storage);
  const id = `${input.report.scenarioId}-${runFingerprint(input.report, input.mode)}`;
  const duplicate = existing.find((run) => run.id === id);
  if (duplicate) return { run: duplicate, history: existing, added: false };

  const run: CompletedRun = {
    id,
    completedAt: input.completedAt ?? new Date().toISOString(),
    scenarioId: input.report.scenarioId,
    scenarioTitle: input.report.scenarioTitle,
    currency: input.currency,
    pricePrecision: input.pricePrecision,
    mode: input.mode,
    brokerMode: input.brokerMode,
    sampleData: input.report.provenance?.isSampleData ?? true,
    totalReturn: input.report.metrics.totalReturn,
    benchmarkReturn: input.report.metrics.benchmarkReturn,
    excessReturn: input.report.metrics.excessReturn,
    maxDrawdown: input.report.metrics.maxDrawdown,
    scoreStatus: input.report.score?.status ?? "unavailable",
    score: input.report.score?.overall,
    executionCount:
      input.report.executionQuality?.totalFills ??
      input.report.fills?.length ??
      input.report.totalTrades,
    closedTradeCount:
      input.report.closedTradeCount ?? input.report.tradeOutcomes?.length ?? 0,
    journalEntryCount: input.report.journal?.length ?? 0,
    journalCoverage: input.report.journalQuality?.coverageRate,
    report: downsampleReport(input.report),
  };
  const history = persistRunHistory([run, ...existing], storage);
  return { run, history, added: history.some((entry) => entry.id === id) };
}

export function removeCompletedRun(
  id: string,
  storage: HistoryStorage | undefined = browserStorage(),
): CompletedRun[] {
  return persistRunHistory(
    loadRunHistory(storage).filter((run) => run.id !== id),
    storage,
  );
}

export function clearRunHistory(
  storage: HistoryStorage | undefined = browserStorage(),
): void {
  try {
    storage?.removeItem(RUN_HISTORY_STORAGE_KEY);
  } catch {
    // Clearing history is best effort when browser storage is unavailable.
  }
}

export function runHistoryStats(runs: CompletedRun[]): RunHistoryStats {
  const scores = runs
    .map((run) => run.score)
    .filter((score): score is number => score !== undefined);
  return {
    completedRuns: runs.length,
    scenariosCompleted: new Set(runs.map((run) => run.scenarioId)).size,
    journaledRuns: runs.filter((run) => run.journalEntryCount > 0).length,
    bestScore: scores.length > 0 ? Math.max(...scores) : undefined,
    averageScore:
      scores.length > 0
        ? scores.reduce((sum, score) => sum + score, 0) / scores.length
        : undefined,
  };
}

export function compareRunWithPrevious(
  run: CompletedRun,
  history: CompletedRun[],
): RunComparison {
  const currentIndex = history.findIndex((entry) => entry.id === run.id);
  const candidates = currentIndex >= 0 ? history.slice(currentIndex + 1) : history;
  const previous = candidates.find(
    (entry) => entry.scenarioId === run.scenarioId,
  );
  if (!previous) return {};
  return {
    previous,
    returnDelta: run.totalReturn - previous.totalReturn,
    excessReturnDelta: run.excessReturn - previous.excessReturn,
    drawdownDelta: run.maxDrawdown - previous.maxDrawdown,
    scoreDelta:
      run.score !== undefined && previous.score !== undefined
        ? run.score - previous.score
        : undefined,
  };
}

export function exportRunHistory(runs: CompletedRun[]): string {
  return JSON.stringify(
    {
      format: "market-time-machine-run-history",
      version: 1,
      exportedAt: new Date().toISOString(),
      runs,
    },
    null,
    2,
  );
}
