import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import ReplayChart from "../components/chart/ReplayChart";
import ConfirmationDialog from "../components/common/ConfirmationDialog";
import ReplayControls from "../components/replay/ReplayControls";
import EventTimeline from "../components/timeline/EventTimeline";
import TradePanel from "../components/trade/TradePanel";
import TradeHistory from "../components/journal/TradeHistory";
import DecisionJournal from "../components/journal/DecisionJournal";
import AuditTrail from "../components/audit/AuditTrail";
import RunHistory from "../components/history/RunHistory";
import PostGameReport from "../components/report/PostGameReport";
import ScenarioLibrary from "../components/scenario/ScenarioLibrary";
import ActiveDrillBanner from "../components/practice/ActiveDrillBanner";
import EventCheckpointDialog from "../components/practice/EventCheckpointDialog";
import {
  defaultScenarioId,
  getScenario,
  isUserScenario,
  listScenarios,
  registerUserScenario,
  removeUserScenario,
} from "../data/scenarios";
import {
  buildCompletedRun,
  type CompletedRun,
} from "../domain/history/runHistory";
import {
  derivePracticeLedgerEntry,
  type PracticeLedgerEntry,
} from "../domain/history/practiceLedger";
import {
  exportPracticeArchive,
  mergePracticeArchive,
  parsePracticeArchive,
} from "../domain/history/practiceArchive";
import {
  clearPracticeArchiveAtomically,
  discardDamagedPracticeArchiveAtomically,
  inspectStoredPracticeArchiveDamage,
  loadStoredPracticeArchiveData,
  persistPracticeArchiveAtomically,
  recordCompletedPracticeRunAtomically,
  removePracticeArchiveRunAtomically,
  withPracticeArchiveMutationLock,
} from "../domain/history/practiceArchiveStorage";
import {
  LEGACY_PRACTICE_LEDGER_STORAGE_KEY,
  LEGACY_RUN_HISTORY_STORAGE_KEY,
  PRACTICE_ARCHIVE_STORAGE_KEY,
} from "../domain/history/practiceArchiveEnvelope";
import {
  buildPracticeCoachPlan,
} from "../domain/coaching/practiceCoach";
import {
  getDrillForScenario,
  listAvailableDrills,
} from "../data/practice/drills";
import { listBuiltInPracticeTracks } from "../data/practice/tracks";
import { scenarioDataVersionsEqual } from "../data/scenarios/dataVersions";
import {
  buildEvidenceProfile,
  previousComparablePracticeScore,
  type ValidatedPracticeSchedule,
  type ValidatedSourceScenario,
} from "../domain/practice/evidenceProfile";
import { practiceTrackProgress } from "../domain/practice/tracks";
import {
  buildDrillCheckpointSchedule,
  drillCheckpointScheduleFingerprint,
  drillRubricFingerprint,
} from "../domain/practice/drills";
import { brokerConfigFingerprint } from "../domain/broker/executionModels";
import { eventCoverageSummary } from "../domain/scenario/eventCoverage";
import {
  archivedPracticeContextMatchesCurrentDrill,
  selectSnapshot,
  useSessionStore,
  type ActiveDrillSessionIdentity,
  type PracticeStartContext,
  type SessionState,
} from "../store/sessionStore";
import type {
  Candle,
  DrillDefinition,
  ReplayStatus,
  ScenarioMode,
  ScenarioPackage,
} from "../types";
import { formatCurrency, formatNumber, formatPct } from "../utils/format";
import { scenarioModeLabel } from "../utils/scenarioMode";

const ZERO_EPSILON = 0.0000001;
const MAX_LOCAL_IMPORT_BYTES = 25 * 1024 * 1024;

type PendingConfirmation =
  | { kind: "reset" }
  | { kind: "clear-history" }
  | { kind: "discard-damaged-archive" }
  | { kind: "remove-run"; run: CompletedRun }
  | { kind: "remove-scenario"; scenarioId: string; title: string }
  | { kind: "restore-session"; serialized: string; fileName: string }
  | {
      kind: "start";
      scenarioId: string;
      title: string;
      mode: ScenarioMode;
      drillId?: string;
      replayContext?: PracticeStartContext;
      startNotice?: string;
    };

function confirmationCopy(pending: PendingConfirmation): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  switch (pending.kind) {
    case "reset":
      return {
        title: "Reset this replay?",
        description:
          "Orders, fills, journal notes, and replay progress in this session will be cleared.",
        confirmLabel: "Reset replay",
      };
    case "clear-history":
      return {
        title: "Clear completed replay history?",
        description:
          "Saved reports, compact practice evidence, and progress comparisons will be removed from this browser. Export first if you want a copy.",
        confirmLabel: "Clear history",
      };
    case "discard-damaged-archive":
      return {
        title: "Remove damaged local history?",
        description:
          "The unreadable practice archive and any superseded legacy copies will be removed from this browser. Download the damaged bytes first if you may need forensic recovery.",
        confirmLabel: "Remove damaged history",
      };
    case "remove-run":
      return {
        title: `Remove ${pending.run.scenarioTitle}?`,
        description:
          "This completed report and its compact practice evidence will both be permanently removed from this browser.",
        confirmLabel: "Remove completed replay",
      };
    case "remove-scenario":
      return {
        title: `Remove ${pending.title}?`,
        description:
          "This imported lab will be removed from this browser. Existing report history stays available, but replaying it will require importing the scenario again.",
        confirmLabel: "Remove imported lab",
      };
    case "restore-session":
      return {
        title: "Restore this session backup?",
        description: `Restoring ${pending.fileName} will replace the active replay, including its orders, fills, journal, and unsaved progress.`,
        confirmLabel: "Restore session",
      };
    case "start":
      return {
        title: `Start ${pending.title}?`,
        description:
          "The active orders, fills, journal notes, report, and replay progress will be cleared before this new lab starts.",
        confirmLabel: "Start new replay",
      };
  }
}

function toneFor(value: number): "pos" | "neg" | "neutral" {
  if (value > ZERO_EPSILON) return "pos";
  if (value < -ZERO_EPSILON) return "neg";
  return "neutral";
}

function formatSignedPct(value: number): string {
  const formatted = formatPct(value);
  if (Math.abs(value) <= ZERO_EPSILON || formatted === "—") return formatted;
  return value > 0 ? `+${formatted}` : formatted;
}

function formatReplayDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function currentCandle(candles: Candle[]): Candle | undefined {
  return candles[candles.length - 1];
}

function sessionHasMeaningfulProgress(
  state: Pick<
    SessionState,
    | "currentIndex"
    | "fills"
    | "orders"
    | "journal"
    | "auditEvents"
    | "status"
    | "initialDrillPlan"
    | "drillCheckpointResponses"
    | "drillRuleViolations"
  >,
): boolean {
  return (
    state.currentIndex > 0 ||
    state.fills.length > 0 ||
    state.orders.length > 0 ||
    state.journal.length > 0 ||
    state.auditEvents.length > 0 ||
    state.initialDrillPlan !== undefined ||
    state.drillCheckpointResponses.length > 0 ||
    state.drillRuleViolations.length > 0 ||
    state.status === "finished"
  );
}

function pricePrecisionForScenario(scenarioId: string): number {
  const candidate = getScenario(scenarioId);
  const primary = candidate?.meta.symbols[0];
  const instrument = candidate?.instruments.find(
    (entry) => entry.symbol === primary,
  );
  return decimalPlacesForTickSize(instrument?.tickSize);
}

function archivedDrillIdentity(
  definition: Readonly<DrillDefinition>,
  scenarioDataVersion: string | null,
): ActiveDrillSessionIdentity {
  return {
    scenarioDataVersion,
    drillId: definition.id,
    competencyId: definition.competencyId,
    definitionVersion: definition.definitionVersion,
    rubricVersion: definition.rubricVersion,
    definitionSnapshot: {
      ...definition,
      initialPlanRule: {
        ...definition.initialPlanRule,
        requiredFields: [...definition.initialPlanRule.requiredFields],
      },
      checkpointRule: {
        ...definition.checkpointRule,
        actions: [...definition.checkpointRule.actions],
      },
      rubric: {
        weights: { ...definition.rubric.weights },
        violationPenalty: definition.rubric.violationPenalty,
      },
    },
  };
}

function readInitialPracticeArchive() {
  try {
    return {
      damage: inspectStoredPracticeArchiveDamage(),
      archive: loadStoredPracticeArchiveData(undefined, {
        // Render validated legacy evidence immediately, but defer the
        // canonical migration write until the cross-tab lock is held.
        migrateLegacy: false,
      }),
      readError: undefined,
    };
  } catch (error) {
    return {
      damage: { damaged: false } as const,
      archive: { runs: [], ledger: [] },
      readError:
        error instanceof Error
          ? error.message
          : "Browser practice history could not be read safely.",
    };
  }
}

export default function App() {
  const scenario = useSessionStore((s) => s.scenario);
  const primarySymbol = useSessionStore((s) => s.primarySymbol);
  const runInstanceId = useSessionStore((s) => s.runInstanceId);
  const status = useSessionStore((s) => s.status);
  const fills = useSessionStore((s) => s.fills);
  const orders = useSessionStore((s) => s.orders);
  const journal = useSessionStore((s) => s.journal);
  const report = useSessionStore((s) => s.report);
  const mode = useSessionStore((s) => s.mode);
  const broker = useSessionStore((s) => s.broker);
  const brokerMode = useSessionStore((s) => s.brokerMode);
  const activeDrillId = useSessionStore((s) => s.activeDrillId);
  const initialDrillPlan = useSessionStore((s) => s.initialDrillPlan);
  const drillCheckpointResponses = useSessionStore(
    (s) => s.drillCheckpointResponses,
  );
  const drillRuleViolations = useSessionStore((s) => s.drillRuleViolations);
  const persistenceHealth = useSessionStore((s) => s.persistenceHealth);
  const pendingDrillCheckpoint = useSessionStore(
    (s) => s.pendingDrillCheckpoint,
  );
  const play = useSessionStore((s) => s.play);
  const pause = useSessionStore((s) => s.pause);
  const reset = useSessionStore((s) => s.resetScenario);
  const selectScenario = useSessionStore((s) => s.selectScenario);
  const startReplay = useSessionStore((s) => s.startReplay);
  const startPractice = useSessionStore((s) => s.startPractice);
  const submitDrillCheckpoint = useSessionStore(
    (s) => s.submitDrillCheckpoint,
  );
  const cancelOrder = useSessionStore((s) => s.cancelOrder);
  const updatePendingOrder = useSessionStore((s) => s.updatePendingOrder);
  const addJournalNote = useSessionStore((s) => s.addJournalNote);
  const exportSession = useSessionStore((s) => s.exportSession);
  const importSession = useSessionStore((s) => s.importSession);
  const clearSavedSession = useSessionStore((s) => s.clearSavedSession);
  const totalReplaySteps = useSessionStore((s) => s.primaryCandlesLength);
  const snapshot = useSessionStore(selectSnapshot);

  const [reportOpen, setReportOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(
    () => status === "finished" || !isRestrictedScenarioMode(mode),
  );
  const [libraryCanClose, setLibraryCanClose] = useState(false);
  const [scenarios, setScenarios] = useState(() => listScenarios());
  const [initialPracticeArchive] = useState(readInitialPracticeArchive);
  const [runHistory, setRunHistory] = useState<CompletedRun[]>(
    initialPracticeArchive.archive.runs,
  );
  const [practiceLedger, setPracticeLedger] = useState<PracticeLedgerEntry[]>(
    initialPracticeArchive.archive.ledger,
  );
  const [historicalRun, setHistoricalRun] = useState<CompletedRun>();
  const [hoveredEventId, setHoveredEventId] = useState<string | undefined>();
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation>();
  const [pendingConfirmationBusy, setPendingConfirmationBusy] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string>();
  const [labNotice, setLabNotice] = useState<string>();
  const [scenarioMessage, setScenarioMessage] = useState<{
    kind: "status" | "error";
    text: string;
  }>();
  const [archiveMessage, setArchiveMessage] = useState<string | undefined>(
    initialPracticeArchive.readError,
  );
  const [reportArchiveWarning, setReportArchiveWarning] = useState<string>();
  const [reportArchiveSaving, setReportArchiveSaving] = useState(false);
  const [damagedArchiveBytes, setDamagedArchiveBytes] = useState<
    string | undefined
  >(
    initialPracticeArchive.damage.damaged
      ? initialPracticeArchive.damage.serialized
      : undefined,
  );
  const brandButtonRef = useRef<HTMLButtonElement | null>(null);
  const reportSaveAttemptRef = useRef(0);
  const primaryInstrument = scenario.instruments.find(
    (instrument) => instrument.symbol === primarySymbol,
  );
  const primaryPricePrecision = decimalPlacesForTickSize(
    primaryInstrument?.tickSize,
  );
  const practicePlan = useMemo(
    () => buildPracticeCoachPlan(runHistory, scenarios, practiceLedger),
    [practiceLedger, runHistory, scenarios],
  );
  const drillCatalog = useMemo(
    () => listAvailableDrills(scenarios),
    [scenarios],
  );
  const practiceTrackCatalog = useMemo(
    () => listBuiltInPracticeTracks(),
    [],
  );
  const validatedSourceScenarios = useMemo(() => {
    const byVersion = new Map<string, ValidatedSourceScenario>();
    for (const track of practiceTrackCatalog) {
      for (const unit of track.units) {
        if (
          unit.status !== "validated" ||
          !unit.evidenceScope.sourceReviewed ||
          unit.scenario.dataVersion === null
        ) {
          continue;
        }
        const source = {
          scenarioId: unit.scenario.id,
          dataVersion: unit.scenario.dataVersion,
          dataFidelity: unit.scenario.dataFidelity,
          sampleData: false,
          sourceReviewed: true,
        } satisfies ValidatedSourceScenario;
        byVersion.set(`${source.scenarioId}:${source.dataVersion}`, source);
      }
    }
    return [...byVersion.values()];
  }, [practiceTrackCatalog]);
  const validatedPracticeSchedules = useMemo(
    () =>
      drillCatalog.flatMap((definition): ValidatedPracticeSchedule[] => {
        const matchingScenario = scenarios.find(
          (candidate) => candidate.meta.id === definition.scenarioId,
        );
        if (!matchingScenario) return [];
        return [
          {
            scenarioId: matchingScenario.meta.id,
            dataVersion: matchingScenario.meta.dataVersion ?? null,
            drillId: definition.id,
            definitionVersion: definition.definitionVersion,
            rubricVersion: definition.rubricVersion,
            rubricFingerprint: drillRubricFingerprint(definition.rubric),
            checkpointScheduleFingerprint:
              drillCheckpointScheduleFingerprint(
                buildDrillCheckpointSchedule(definition, matchingScenario),
              ),
            mode: definition.mode,
          },
        ];
      }),
    [drillCatalog, scenarios],
  );
  const evidenceProfile = useMemo(
    () =>
      buildEvidenceProfile(
        practiceLedger,
        validatedSourceScenarios,
        validatedPracticeSchedules,
      ),
    [
      practiceLedger,
      validatedPracticeSchedules,
      validatedSourceScenarios,
    ],
  );
  const practiceTrackProgressEntries = useMemo(
    () =>
      practiceTrackCatalog.map((track) =>
        practiceTrackProgress(track, practiceLedger),
      ),
    [practiceLedger, practiceTrackCatalog],
  );
  const activeDrill = useMemo(
    () =>
      activeDrillId
        ? getDrillForScenario(activeDrillId, scenario)
        : undefined,
    [activeDrillId, scenario],
  );

  useEffect(() => {
    if (report && !libraryOpen) setReportOpen(true);
  }, [libraryOpen, report]);

  useEffect(() => {
    let cancelled = false;
    void withPracticeArchiveMutationLock(() =>
      loadStoredPracticeArchiveData(),
    )
      .then((stored) => {
        if (cancelled) return;
        setRunHistory(stored.runs);
        setPracticeLedger(stored.ledger);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setArchiveMessage(
          error instanceof Error
            ? error.message
            : "Legacy practice history could not be migrated safely.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshPracticeArchive = useCallback(async (): Promise<void> => {
    try {
      const refreshed = await withPracticeArchiveMutationLock(() => ({
        damage: inspectStoredPracticeArchiveDamage(),
        archive: loadStoredPracticeArchiveData(undefined, {
          migrateLegacy: false,
        }),
      }));
      setRunHistory(refreshed.archive.runs);
      setPracticeLedger(refreshed.archive.ledger);
      setDamagedArchiveBytes(
        refreshed.damage.damaged ? refreshed.damage.serialized : undefined,
      );
      setArchiveMessage(undefined);
    } catch (error) {
      setArchiveMessage(
        error instanceof Error
          ? error.message
          : "Browser practice history could not be refreshed safely.",
      );
    }
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key !== null &&
        event.key !== PRACTICE_ARCHIVE_STORAGE_KEY &&
        event.key !== LEGACY_RUN_HISTORY_STORAGE_KEY &&
        event.key !== LEGACY_PRACTICE_LEDGER_STORAGE_KEY
      ) {
        return;
      }
      void refreshPracticeArchive();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [refreshPracticeArchive]);

  const saveCurrentReport = useCallback(async (): Promise<boolean> => {
    if (!report) return false;
    const attempt = reportSaveAttemptRef.current + 1;
    reportSaveAttemptRef.current = attempt;
    setReportArchiveSaving(true);
    try {
      const recorded = await withPracticeArchiveMutationLock(() =>
        recordCompletedPracticeRunAtomically({
          report,
          runInstanceId,
          mode,
          brokerMode,
          brokerFingerprint: brokerConfigFingerprint(broker),
          currency: scenario.meta.baseCurrency,
          pricePrecision: primaryPricePrecision,
        }),
      );
      setRunHistory(recorded.runs);
      setPracticeLedger(recorded.ledger);
      if (reportSaveAttemptRef.current === attempt) {
        setArchiveMessage(undefined);
        setReportArchiveWarning(undefined);
      }
      return true;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Completed replay could not be saved.";
      if (reportSaveAttemptRef.current === attempt) {
        setArchiveMessage(message);
        setReportArchiveWarning(message);
      }
      return false;
    } finally {
      if (reportSaveAttemptRef.current === attempt) {
        setReportArchiveSaving(false);
      }
    }
  }, [
    broker,
    brokerMode,
    mode,
    primaryPricePrecision,
    report,
    runInstanceId,
    scenario.meta.baseCurrency,
  ]);

  useEffect(() => {
    if (report) void saveCurrentReport();
  }, [report, saveCurrentReport]);

  const tradablePrice = snapshot.tradablePrices.find(
    (price) => price.symbol === primarySymbol,
  );
  const currency = scenario.meta.baseCurrency;
  const auditEvents = useMemo(
    () => snapshot.auditEvents ?? [],
    [snapshot.auditEvents],
  );
  const riskEventCount = auditEvents.filter(
    (event) =>
      event.type === "margin_call" ||
      event.type === "forced_liquidation" ||
      event.type === "borrow_cost",
  ).length;
  const progressPct =
    totalReplaySteps > 0
      ? Math.min(100, ((snapshot.currentIndex + 1) / totalReplaySteps) * 100)
      : 0;
  const portfolioReturn =
    scenario.meta.initialCash > 0
      ? snapshot.portfolio.totalValue / scenario.meta.initialCash - 1
      : 0;
  const visibleCandle = currentCandle(snapshot.visibleCandles);
  const currentCandleReturn =
    visibleCandle && visibleCandle.open > 0
      ? visibleCandle.close / visibleCandle.open - 1
      : 0;
  const workingOrderCount = orders.filter(
    (order) =>
      order.status === "pending" || order.status === "partially_filled",
  ).length;
  const sessionHasProgress = sessionHasMeaningfulProgress({
    currentIndex: snapshot.currentIndex,
    fills,
    orders,
    journal,
    auditEvents,
    status,
    initialDrillPlan,
    drillCheckpointResponses,
    drillRuleViolations,
  });
  const restrictedReplay =
    status !== "finished" && isRestrictedScenarioMode(mode);
  const restrictedAssetTokens = useMemo(
    () => assetMaskTokens(scenario),
    [scenario],
  );
  const restrictedSymbolLabel = useCallback(
    (symbol: string): string =>
      hiddenAssetLabel(symbol, primarySymbol, scenario.meta.symbols),
    [primarySymbol, scenario.meta.symbols],
  );
  const displayActiveDrill = useMemo(
    () =>
      activeDrill && restrictedReplay
        ? {
            ...activeDrill,
            title: "Guided practice drill",
            description:
              "Follow the versioned plan and checkpoint rules without revealing the hidden lab identity.",
            primarySymbol: "Primary asset",
          }
        : activeDrill,
    [activeDrill, restrictedReplay],
  );
  useEffect(() => {
    if (restrictedReplay) setLibraryOpen(false);
  }, [restrictedReplay]);
  const visibleEventsChronological = useMemo(
    () =>
      [...snapshot.visibleEvents].sort((a, b) => {
        const aTime = Date.parse(a.publishedAt);
        const bTime = Date.parse(b.publishedAt);
        if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
          return aTime - bTime;
        }
        return a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id);
      }),
    [snapshot.visibleEvents],
  );
  const displayEventsChronological = useMemo(
    () =>
      restrictedReplay
        ? visibleEventsChronological.map((event) => ({
            ...event,
            title: maskAssetText(event.title, restrictedAssetTokens),
            summary: maskAssetText(event.summary, restrictedAssetTokens),
            affectedSymbols: event.affectedSymbols.map(restrictedSymbolLabel),
            source: event.source
              ? maskAssetText(event.source, restrictedAssetTokens)
              : undefined,
            sourceUrl: undefined,
          }))
        : visibleEventsChronological,
    [
      restrictedAssetTokens,
      restrictedReplay,
      restrictedSymbolLabel,
      visibleEventsChronological,
    ],
  );
  const displayFills = useMemo(
    () =>
      restrictedReplay
        ? fills.map((fill) => ({
            ...fill,
            symbol: restrictedSymbolLabel(fill.symbol),
          }))
        : fills,
    [fills, restrictedReplay, restrictedSymbolLabel],
  );
  const displayOrders = useMemo(
    () =>
      restrictedReplay
        ? orders.map((order) => ({
            ...order,
            symbol: restrictedSymbolLabel(order.symbol),
            note: order.note
              ? maskAssetText(order.note, restrictedAssetTokens)
              : undefined,
          }))
        : orders,
    [orders, restrictedAssetTokens, restrictedReplay, restrictedSymbolLabel],
  );
  const displayJournal = useMemo(
    () =>
      restrictedReplay
        ? journal.map((entry) => ({
            ...entry,
            symbol: entry.symbol
              ? restrictedSymbolLabel(entry.symbol)
              : undefined,
            note: maskAssetText(entry.note, restrictedAssetTokens),
          }))
        : journal,
    [journal, restrictedAssetTokens, restrictedReplay, restrictedSymbolLabel],
  );
  const displayAuditEvents = useMemo(
    () =>
      restrictedReplay
        ? auditEvents.map((event) => ({
            ...event,
            symbol: event.symbol
              ? restrictedSymbolLabel(event.symbol)
              : undefined,
            message: maskAssetText(event.message, restrictedAssetTokens),
          }))
        : auditEvents,
    [
      auditEvents,
      restrictedAssetTokens,
      restrictedReplay,
      restrictedSymbolLabel,
    ],
  );
  const scenarioEventCoverage = useMemo(
    () =>
      eventCoverageSummary(
        status === "finished" ? scenario.events : snapshot.visibleEvents,
      ),
    [scenario.events, snapshot.visibleEvents, status],
  );
  const eventNumbers = useMemo(() => {
    const map = new Map<string, number>();
    visibleEventsChronological.forEach((event, index) => {
      map.set(event.id, index + 1);
    });
    return map;
  }, [visibleEventsChronological]);

  const togglePlay = () => {
    if (status === "playing") pause();
    else if (status !== "finished") play();
  };

  const resetSession = () => {
    if (reportArchiveSaving) {
      setArchiveMessage(
        "Wait for the completed replay to finish saving before replacing it.",
      );
      return;
    }
    setReportOpen(false);
    setLibraryOpen(false);
    setLibraryCanClose(false);
    setPendingConfirmation(undefined);
    setSessionMessage(undefined);
    setLabNotice(undefined);
    setReportArchiveWarning(undefined);
    reset();
    setSessionEpoch((epoch) => epoch + 1);
  };

  const startScenario = (
    scenarioId: string,
    nextMode: ScenarioMode,
    drillId?: string,
    replayContext?: PracticeStartContext,
    startNotice?: string,
  ) => {
    if (reportArchiveSaving) {
      setScenarioMessage({
        kind: "error",
        text: "Wait for the completed replay to finish saving before starting another replay.",
      });
      setLibraryOpen(true);
      return;
    }
    setReportOpen(false);
    setLibraryOpen(false);
    setLibraryCanClose(false);
    setPendingConfirmation(undefined);
    setSessionMessage(undefined);
    setReportArchiveWarning(undefined);
    const result = drillId
      ? startPractice(scenarioId, drillId, replayContext)
      : startReplay(scenarioId, nextMode, replayContext);
    if (!result.ok) {
      setScenarioMessage({
        kind: "error",
        text:
          result.message ??
          (drillId
            ? "Unable to start this practice drill."
            : "Unable to start this replay."),
      });
      setLibraryOpen(true);
      return;
    }
    setLabNotice(startNotice);
    setSessionEpoch((epoch) => epoch + 1);
  };

  const requestReset = () => {
    if (status === "playing") pause();
    if (sessionHasProgress) setPendingConfirmation({ kind: "reset" });
    else resetSession();
  };

  const requestStart = (
    scenarioId: string,
    nextMode: ScenarioMode,
    drillId?: string,
    replayContext?: PracticeStartContext,
    concealConfirmationIdentity = false,
    startNotice?: string,
  ) => {
    const candidate = scenarios.find(
      (candidate) => candidate.meta.id === scenarioId,
    );
    if (!candidate) {
      setScenarioMessage({
        kind: "error",
        text: "That scenario is no longer available in this browser. Restore or import it before replaying this run.",
      });
      return;
    }
    if (
      replayContext &&
      !candidate.meta.supportedModes.includes(nextMode)
    ) {
      setScenarioMessage({
        kind: "error",
        text: "That archived replay mode is no longer available for the current scenario package.",
      });
      return;
    }
    const resolvedMode = candidate.meta.supportedModes.includes(nextMode)
      ? nextMode
      : (candidate.meta.supportedModes[0] ?? "explorer");
    const title = concealConfirmationIdentity
      ? `surprise ${scenarioModeLabel(resolvedMode)}`
      : candidate.meta.title;
    const definition = drillId
      ? getDrillForScenario(drillId, candidate)
      : undefined;
    if (
      drillId &&
      (!definition || definition.scenarioId !== candidate.meta.id)
    ) {
      setScenarioMessage({
        kind: "error",
        text: "That versioned practice drill is not available for this scenario.",
      });
      return;
    }
    if (
      replayContext &&
      !scenarioDataVersionsEqual(
        candidate.meta.id,
        candidate.meta.dataVersion,
        replayContext.scenarioDataVersion,
      )
    ) {
      setScenarioMessage({
        kind: "error",
        text: "That prepared replay context no longer matches the current scenario data. Review the saved run or coach assignment again before starting.",
      });
      return;
    }
    if (status === "playing") pause();
    if (sessionHasProgress) {
      setPendingConfirmation({
        kind: "start",
        scenarioId,
        title,
        mode: resolvedMode,
        drillId,
        replayContext,
        startNotice,
      });
    } else {
      startScenario(
        scenarioId,
        definition?.mode ?? resolvedMode,
        drillId,
        replayContext,
        startNotice,
      );
    }
  };

  const requestSurpriseStart = (nextMode: "blind" | "challenge") => {
    const candidates = scenarios.filter(
      (candidate) =>
        !isUserScenario(candidate.meta.id) &&
        candidate.meta.supportedModes.includes(nextMode),
    );
    if (candidates.length === 0) {
      setScenarioMessage({
        kind: "error",
        text: `No bundled lab supports ${scenarioModeLabel(nextMode)}. Imported packages are not eligible for identity-masked surprise selection.`,
      });
      return;
    }
    const randomIndex = Math.min(
      candidates.length - 1,
      Math.floor(Math.random() * candidates.length),
    );
    requestStart(
      candidates[randomIndex].meta.id,
      nextMode,
      undefined,
      undefined,
      true,
    );
  };

  const applyRestoredSession = (serialized: string): void => {
    const result = importSession(serialized);
    if (result.ok) {
      setReportOpen(false);
      setLibraryCanClose(false);
      setSessionEpoch((epoch) => epoch + 1);
      setSessionMessage("Saved session restored.");
    } else {
      setSessionMessage(result.message ?? "Unable to restore this session.");
    }
  };

  const confirmPendingAction = async (): Promise<void> => {
    const pending = pendingConfirmation;
    if (!pending || pendingConfirmationBusy) return;
    switch (pending.kind) {
      case "reset":
        resetSession();
        break;
      case "start":
        startScenario(
          pending.scenarioId,
          pending.mode,
          pending.drillId,
          pending.replayContext,
          pending.startNotice,
        );
        break;
      case "clear-history":
        setPendingConfirmationBusy(true);
        try {
          const cleared = await withPracticeArchiveMutationLock(() =>
            clearPracticeArchiveAtomically(),
          );
          setRunHistory(cleared.runs);
          setPracticeLedger(cleared.ledger);
          setHistoricalRun(undefined);
          setArchiveMessage("Practice history was cleared from this browser.");
        } catch (error) {
          setArchiveMessage(
            error instanceof Error
              ? error.message
              : "Practice history could not be cleared.",
          );
        }
        setPendingConfirmationBusy(false);
        setPendingConfirmation(undefined);
        break;
      case "discard-damaged-archive":
        setPendingConfirmationBusy(true);
        try {
          const cleared = await withPracticeArchiveMutationLock(() =>
            discardDamagedPracticeArchiveAtomically(),
          );
          setRunHistory(cleared.runs);
          setPracticeLedger(cleared.ledger);
          setHistoricalRun(undefined);
          setDamagedArchiveBytes(undefined);
          setArchiveMessage(
            "Damaged local history was removed. New replays and archive imports can now be saved.",
          );
        } catch (error) {
          setArchiveMessage(
            error instanceof Error
              ? error.message
              : "Damaged local history could not be removed.",
          );
        }
        setPendingConfirmationBusy(false);
        setPendingConfirmation(undefined);
        break;
      case "remove-run":
        setPendingConfirmationBusy(true);
        await removeArchivedRun(pending.run);
        setPendingConfirmationBusy(false);
        setPendingConfirmation(undefined);
        break;
      case "remove-scenario": {
        const removal = removeUserScenario(pending.scenarioId);
        if (!removal.ok) {
          setScenarioMessage({
            kind: "error",
            text: removal.message,
          });
        } else {
          if (scenario.meta.id === pending.scenarioId) {
            selectScenario(defaultScenarioId);
            setSessionEpoch((epoch) => epoch + 1);
          }
          setScenarios(listScenarios());
          setScenarioMessage({
            kind: "status",
            text: removal.persisted
              ? `${pending.title} was removed from this browser.`
              : `${pending.title} was removed for this visit, but browser storage could not be updated; it may return after reload.`,
          });
        }
        setPendingConfirmation(undefined);
        break;
      }
      case "restore-session":
        applyRestoredSession(pending.serialized);
        setPendingConfirmation(undefined);
        break;
    }
  };

  const openLibrary = () => {
    if (restrictedReplay) return;
    if (reportArchiveSaving || reportArchiveWarning) {
      setArchiveMessage(
        "Save the completed replay or download its recovery archive before leaving the report.",
      );
      return;
    }
    if (status === "playing") pause();
    setReportOpen(false);
    setLibraryCanClose(true);
    setLibraryOpen(true);
  };

  const continueSession = () => {
    setLibraryCanClose(false);
    setLibraryOpen(false);
    setReportOpen(Boolean(report));
  };

  const chooseNextPractice = () => {
    if (reportArchiveSaving || reportArchiveWarning) {
      setArchiveMessage(
        "Save the completed replay or download its recovery archive before choosing another practice.",
      );
      return;
    }
    setReportOpen(false);
    setHistoricalRun(undefined);
    setLibraryCanClose(false);
    setLibraryOpen(true);
  };

  const downloadSession = () => {
    const serialized = exportSession();
    const blob = new Blob([serialized], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${scenario.meta.id}-session.json`;
    link.click();
    URL.revokeObjectURL(url);
    setSessionMessage("Session file exported.");
  };

  const downloadRunHistory = async () => {
    if (reportArchiveSaving) {
      setArchiveMessage(
        "Wait for the completed replay to finish saving before exporting practice history.",
      );
      return;
    }
    try {
      const current = await withPracticeArchiveMutationLock(() =>
        loadStoredPracticeArchiveData(undefined, { migrateLegacy: false }),
      );
      setRunHistory(current.runs);
      setPracticeLedger(current.ledger);
      const serialized = exportPracticeArchive(current.runs, current.ledger);
      const blob = new Blob([serialized], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "market-time-machine-practice-archive-v2.json";
      link.click();
      URL.revokeObjectURL(url);
      setScenarioMessage({
        kind: "status",
        text: "Practice archive exported with recent reports and compact evidence.",
      });
    } catch (error) {
      setArchiveMessage(
        error instanceof Error
          ? error.message
          : "Practice archive could not be exported safely.",
      );
    }
  };

  const downloadCurrentRecoveryArchive = () => {
    if (!report) return;
    try {
      const run = buildCompletedRun({
        report,
        runInstanceId,
        mode,
        brokerMode,
        brokerFingerprint: brokerConfigFingerprint(broker),
        currency,
        pricePrecision: primaryPricePrecision,
      });
      const ledgerEntry = derivePracticeLedgerEntry(
        run,
        run.report.practiceAssessment,
      );
      const serialized = exportPracticeArchive([run], [ledgerEntry]);
      const blob = new Blob([serialized], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "market-time-machine-practice-recovery-v2.json";
      link.click();
      URL.revokeObjectURL(url);
      setReportArchiveWarning(undefined);
      setArchiveMessage(
        "Importable recovery archive downloaded. You can now leave this report without losing the completed replay.",
      );
    } catch (error) {
      setArchiveMessage(
        error instanceof Error
          ? error.message
          : "Recovery archive could not be created.",
      );
    }
  };

  const downloadDamagedArchive = () => {
    if (damagedArchiveBytes === undefined) return;
    const blob = new Blob([damagedArchiveBytes], {
      type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "market-time-machine-damaged-practice-archive.txt";
    link.click();
    URL.revokeObjectURL(url);
    setArchiveMessage("Damaged archive bytes downloaded without modification.");
  };

  const importPracticeArchive = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_LOCAL_IMPORT_BYTES) {
      setArchiveMessage("Practice archive is larger than the 25 MB import limit.");
      return;
    }
    try {
      const imported = parsePracticeArchive(await file.text());
      const { saved, merged } = await withPracticeArchiveMutationLock(() => {
        const current = loadStoredPracticeArchiveData();
        const mergedArchive = mergePracticeArchive(current, imported);
        return {
          saved: persistPracticeArchiveAtomically(mergedArchive),
          merged: mergedArchive,
        };
      });
      const { runs: savedRuns, ledger: savedLedger } = saved;
      setRunHistory(savedRuns);
      setPracticeLedger(savedLedger);
      const conflictNote =
        merged.conflictCount > 0
          ? ` ${merged.conflictCount} conflicting item${merged.conflictCount === 1 ? " was" : "s were"} kept unchanged.`
          : "";
      setArchiveMessage(
        `Imported ${merged.addedRunIds.length} report${merged.addedRunIds.length === 1 ? "" : "s"} and ${merged.addedLedgerIds.length} compact evidence entr${merged.addedLedgerIds.length === 1 ? "y" : "ies"}.${conflictNote}`,
      );
    } catch (error) {
      setArchiveMessage(
        error instanceof Error
          ? error.message
          : "Unable to import this practice archive.",
      );
    }
  };

  const removeArchivedRun = async (run: CompletedRun): Promise<void> => {
    try {
      const result = await withPracticeArchiveMutationLock(() =>
        removePracticeArchiveRunAtomically(run.id),
      );
      setRunHistory(result.runs);
      setPracticeLedger(result.ledger);
      if (historicalRun?.id === run.id) setHistoricalRun(undefined);
      setArchiveMessage(
        result.removedRunCount > 0 || result.removedLedgerCount > 0
          ? `${run.scenarioTitle} was removed from practice history.`
          : "That completed replay was already absent from browser storage.",
      );
    } catch (error) {
      setArchiveMessage(
        error instanceof Error
          ? error.message
          : "Completed replay could not be removed.",
      );
    }
  };

  const replayArchivedRun = (run: CompletedRun) => {
    const scenarioDataVersion = run.report.provenance?.dataVersion ?? null;
    const replayContext: PracticeStartContext | undefined =
      run.brokerFingerprint && scenarioDataVersion !== null
        ? {
            scenarioDataVersion,
            brokerMode: run.brokerMode,
            brokerFingerprint: run.brokerFingerprint,
          }
        : undefined;
    const archivedDefinition = run.report.practiceDrill?.definition;
    const archivedAssessment = run.report.practiceAssessment;
    const retainedExactPracticeContext =
      replayContext &&
      archivedDefinition &&
      archivedAssessment?.checkpointScheduleFingerprint &&
      archivedAssessment.drillId === archivedDefinition.id
        ? {
            ...replayContext,
            drillIdentity: archivedDrillIdentity(
              archivedDefinition,
              scenarioDataVersion,
            ),
            checkpointScheduleFingerprint:
              archivedAssessment.checkpointScheduleFingerprint,
          }
        : undefined;
    const exactPracticeContext =
      retainedExactPracticeContext &&
      archivedDefinition &&
      archivedPracticeContextMatchesCurrentDrill(
        run.scenarioId,
        archivedDefinition.id,
        retainedExactPracticeContext,
      )
        ? retainedExactPracticeContext
        : undefined;
    const startNotice = retainedExactPracticeContext && !exactPracticeContext
      ? "The archived drill definition or checkpoint schedule has changed. A fresh unassessed replay started with the archived scenario and broker identity; it will not count as an exact drill repeat."
      : archivedAssessment && !retainedExactPracticeContext
        ? "This archived practice does not retain a complete exact drill identity. A fresh unassessed replay started instead of silently substituting a newer drill."
        : !replayContext
          ? "This legacy run does not retain an exact data-and-broker identity. The replay uses the current scenario package and scenario broker settings, so it is a fresh unassessed context rather than an exact repeat."
          : undefined;
    requestStart(
      run.scenarioId,
      run.mode,
      exactPracticeContext ? archivedDefinition?.id : undefined,
      exactPracticeContext ?? replayContext,
      false,
      startNotice,
    );
  };

  const requestRemoveScenario = (scenarioId: string, title: string) => {
    if (scenario.meta.id === scenarioId && sessionHasProgress) {
      setScenarioMessage({
        kind: "error",
        text: "Finish or replace the active replay before removing its imported scenario.",
      });
      return;
    }
    setPendingConfirmation({ kind: "remove-scenario", scenarioId, title });
  };

  const restoreSession = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_LOCAL_IMPORT_BYTES) {
      setSessionMessage("Session file is larger than the 25 MB restore limit.");
      return;
    }
    try {
      const serialized = await file.text();
      if (sessionHasMeaningfulProgress(useSessionStore.getState())) {
        setPendingConfirmation({
          kind: "restore-session",
          serialized,
          fileName: file.name || "this backup",
        });
      } else {
        applyRestoredSession(serialized);
      }
    } catch {
      setSessionMessage("Unable to read this session file.");
    }
  };

  const importUserScenario = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_LOCAL_IMPORT_BYTES) {
      setScenarioMessage({
        kind: "error",
        text: "Scenario package is larger than the 25 MB local import limit.",
      });
      return;
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(await file.text());
    } catch {
      setScenarioMessage({
        kind: "error",
        text: "Scenario package is not valid JSON. Choose an exported scenario package, not a session backup.",
      });
      return;
    }
    const result = registerUserScenario(candidate);
    if (!result.ok) {
      setScenarioMessage({
        kind: "error",
        text: result.message ?? "Unable to add this scenario package.",
      });
      return;
    }
    setScenarios(listScenarios());
    const warningSummary = result.warnings?.length
      ? ` ${result.warnings.length} quality warning${result.warnings.length === 1 ? "" : "s"} should be reviewed before sharing.`
      : "";
    setScenarioMessage({
      kind: "status",
      text: `${result.message ?? "Scenario added."}${warningSummary}`,
    });
  };

  const pendingDialogCopy = pendingConfirmation
    ? confirmationCopy(pendingConfirmation)
    : undefined;
  const librarySessionMessage = [persistenceHealth?.message, sessionMessage]
    .filter((message, index, messages): message is string =>
      Boolean(message) && messages.indexOf(message) === index,
    )
    .join(" ") || undefined;
  const pendingDialog = pendingDialogCopy ? (
    <ConfirmationDialog
      {...pendingDialogCopy}
      busy={pendingConfirmationBusy}
      onConfirm={() => {
        void confirmPendingAction();
      }}
      onCancel={() => {
        if (!pendingConfirmationBusy) setPendingConfirmation(undefined);
      }}
    />
  ) : null;

  if (libraryOpen) {
    return (
      <>
        <ScenarioLibrary
          scenarios={scenarios}
          activeScenario={scenario}
          activeMode={mode}
          activeStatus={status}
          activeProgressPct={progressPct}
          activeDrillId={activeDrillId}
          hasActiveSession={sessionHasProgress}
          hideActiveIdentity={restrictedReplay}
          history={
            <RunHistory
                runs={runHistory}
                archiveBusy={reportArchiveSaving}
                hasArchiveData={
                  runHistory.length > 0 || practiceLedger.length > 0
                }
                archiveDamaged={damagedArchiveBytes !== undefined}
                onViewReport={setHistoricalRun}
                onReplay={(run) => {
                  setHistoricalRun(undefined);
                  replayArchivedRun(run);
                }}
                onRemove={(run) =>
                  setPendingConfirmation({ kind: "remove-run", run })
                }
                onExport={downloadRunHistory}
                onExportDamaged={downloadDamagedArchive}
                onImport={importPracticeArchive}
                importMessage={archiveMessage}
                onClear={() =>
                  setPendingConfirmation({ kind: "clear-history" })
                }
                onDiscardDamaged={() =>
                  setPendingConfirmation({ kind: "discard-damaged-archive" })
                }
              />
          }
          practicePlan={practicePlan}
          drills={drillCatalog}
          evidenceProfile={evidenceProfile}
          practiceTracks={practiceTrackCatalog}
          practiceTrackProgress={practiceTrackProgressEntries}
          sessionMessage={librarySessionMessage}
          scenarioMessage={scenarioMessage?.text}
          scenarioMessageKind={scenarioMessage?.kind}
          userScenarioIds={scenarios
            .filter((candidate) => isUserScenario(candidate.meta.id))
            .map((candidate) => candidate.meta.id)}
          onContinue={continueSession}
          onStart={requestStart}
          onStartSurprise={requestSurpriseStart}
          onClose={
            libraryCanClose
              ? () => {
                  setLibraryCanClose(false);
                  setLibraryOpen(false);
                  window.requestAnimationFrame(() => brandButtonRef.current?.focus());
                }
              : undefined
          }
          onExport={downloadSession}
          onRestore={restoreSession}
          onImportScenario={importUserScenario}
          onRemoveScenario={requestRemoveScenario}
          onViewPracticeSource={(runId) => {
            const source = runHistory.find((run) => run.id === runId);
            if (source) setHistoricalRun(source);
          }}
          onClearSavedSession={() => {
            const result = clearSavedSession();
            setSessionMessage(
              result.ok
                ? "Browser save cleared for this session. The active in-memory replay remains open until you replace or close it."
                : (result.message ?? "Browser save could not be cleared."),
            );
          }}
        />
        {historicalRun ? (
          <PostGameReport
            report={historicalRun.report}
            previousComparablePracticeScore={previousComparablePracticeScore(
              historicalRun.id,
              historicalRun.report,
              historicalRun.mode,
              historicalRun.brokerMode,
              historicalRun.brokerFingerprint,
              practiceLedger,
            )}
            currency={
              historicalRun.currency ??
              getScenario(historicalRun.scenarioId)?.meta.baseCurrency ??
              "USD"
            }
            pricePrecision={
              historicalRun.pricePrecision ??
              pricePrecisionForScenario(historicalRun.scenarioId)
            }
            onClose={() => setHistoricalRun(undefined)}
            onReset={() => {
              const run = historicalRun;
              setHistoricalRun(undefined);
              replayArchivedRun(run);
            }}
          />
        ) : null}
        {pendingDialog}
      </>
    );
  }

  return (
    <div className={restrictedReplay ? "app-shell restricted-replay" : "app-shell"}>
      <header className="app-header">
        <div className="header-left">
          <button
            className="brand"
            onClick={openLibrary}
            aria-label={
              restrictedReplay
                ? "Scenario switch locked during local challenge"
                : "Open scenario library"
            }
            disabled={restrictedReplay}
            ref={brandButtonRef}
          >
            <div className="brand-mark" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle
                  cx="11"
                  cy="11"
                  r="9.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <path
                  d="M11 4.2v7l4.6 2.4"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="brand-text">
              <div className="brand-name">Market Time Machine</div>
              <div className="brand-tagline">Financial History Lab</div>
            </div>
            <span className="brand-caret">Library</span>
          </button>
          <div className="scenario-meta">
            <div className="scenario-eyebrow">Replaying</div>
            <div className="scenario-title">
              {restrictedReplay
                ? mode === "blind"
                  ? "Blind replay"
                  : "Local challenge"
                : scenario.meta.title}
            </div>
            <div className="scenario-subtitle">
              {restrictedReplay
                ? "Scenario title, asset label, and ending stay hidden until completion. Local self-test; bundled future data is not technically protected."
                : scenario.meta.subtitle}
            </div>
          </div>
        </div>

        <div className="header-center">
          <HeaderStat
            label="Replay date"
            value={formatReplayDate(snapshot.currentTime)}
          >
            {restrictedReplay ? null : (
              <div className="header-mini-progress">
                <span style={{ width: `${progressPct}%` }} />
              </div>
            )}
          </HeaderStat>
          <div className="header-divider" />
          <HeaderStat
            label="Portfolio value"
            value={formatCurrency(snapshot.portfolio.totalValue, currency)}
            tone={toneFor(portfolioReturn)}
            sub={`${formatSignedPct(portfolioReturn)} from ${formatCurrency(
              scenario.meta.initialCash,
              currency,
            )}`}
          />
          <StatusPill status={status} />
        </div>

        <div className="header-right">
          {scenario.meta.isSampleData && !restrictedReplay ? (
            <span className="header-badge">Sample data</span>
          ) : null}
          <span className="header-badge broker">
            Broker · {brokerModeLabel(brokerMode)}
          </span>
          <span className="header-badge">Mode · {scenarioModeLabel(mode)}</span>
          {displayActiveDrill ? (
            <span
              className="header-badge drill"
              title={displayActiveDrill.title}
            >
              Drill · {displayActiveDrill.title}
            </span>
          ) : null}
          {status === "finished" ? (
            <button className="btn primary" onClick={() => setReportOpen(true)}>
              View report
            </button>
          ) : (
            <button className="btn primary" onClick={togglePlay}>
              {status === "playing"
                ? "Pause replay"
                : status === "idle"
                  ? "Start replay"
                  : "Resume replay"}
            </button>
          )}
        </div>
      </header>

      {persistenceHealth ? (
        <div
          className={`global-session-notice ${persistenceHealth.kind}`}
          role={persistenceHealth.kind === "error" ? "alert" : "status"}
        >
          {persistenceHealth.message}
        </div>
      ) : null}
      {labNotice ? (
        <div className="global-session-notice" role="status">
          {labNotice}
        </div>
      ) : null}

      {displayActiveDrill ? (
        <div className="active-drill-slot">
          <ActiveDrillBanner
            definition={displayActiveDrill}
            stage={
              status === "finished"
                ? "review"
                : initialDrillPlan
                  ? "execute"
                  : "plan"
            }
            answeredCheckpointCount={drillCheckpointResponses.length}
            initialPlan={initialDrillPlan}
          />
        </div>
      ) : null}

      <main className="app-grid">
        <section className="panel chart-panel">
          <div className="chart-head">
            <div className="chart-head-left">
              <div className="instrument-block">
                <span className="instrument-symbol">
                  {restrictedReplay ? "Primary asset" : primarySymbol}
                </span>
                <span className="instrument-name">
                  {restrictedReplay
                    ? "Asset label hidden until completion"
                    : primaryInstrument?.name ?? scenario.meta.assetClass}
                </span>
              </div>
              <div className="price-block">
                <span className="price">
                  {visibleCandle
                    ? formatNumber(
                        visibleCandle.close,
                        primaryPricePrecision,
                        primaryPricePrecision,
                      )
                    : "—"}
                </span>
                <span className={`price-change ${toneFor(currentCandleReturn)}`}>
                  {formatSignedPct(currentCandleReturn)}
                  <small> today</small>
                </span>
              </div>
            </div>
            <div className="chart-head-right">
              <span>
                Step {snapshot.currentIndex + 1}
                {restrictedReplay
                  ? " · ending hidden"
                  : ` of ${totalReplaySteps} · future hidden`}
              </span>
              <span className="firewall-chip">Information firewall active</span>
            </div>
          </div>
          <div className="panel-body">
            <ReplayChart
              candles={snapshot.visibleCandles}
              events={displayEventsChronological}
              indicators={snapshot.visibleIndicators}
              fills={displayFills}
              orders={
                snapshot.workingOrders ? displayOrders.filter((order) =>
                  snapshot.workingOrders?.some((working) => working.id === order.id),
                ) : displayOrders
              }
              eventNumbers={eventNumbers}
              hoveredEventId={hoveredEventId}
              onHoverEvent={setHoveredEventId}
            />
            <ReplayControls onRequestReset={requestReset} />
          </div>
        </section>

        <section className="right-rail">
          <TradePanel
            key={`${scenario.meta.id}:${sessionEpoch}`}
            draftKey={`${runInstanceId}:${sessionEpoch}`}
            tradablePrice={tradablePrice}
            tickSize={primaryInstrument?.tickSize}
            pricePrecision={primaryPricePrecision}
            currency={currency}
            cash={snapshot.portfolio.cash}
            positionsValue={snapshot.portfolio.positionsValue}
            totalValue={snapshot.portfolio.totalValue}
            realizedPnl={snapshot.portfolio.realizedPnl}
            unrealizedPnl={snapshot.portfolio.unrealizedPnl}
            initialCash={scenario.meta.initialCash}
            margin={snapshot.margin}
            risk={snapshot.risk}
          />
        </section>

        <section className="bottom-grid">
          <div className="panel panel-flex">
            <div className="panel-head">
              <span className="panel-title">Event timeline</span>
              <span className="panel-meta">
                {snapshot.visibleEvents.length} visible ·{" "}
                {scenarioEventCoverage.label} · future hidden
              </span>
            </div>
            <div className="panel-body scrollable">
              <EventTimeline
                events={displayEventsChronological}
                eventNumbers={eventNumbers}
                hoveredEventId={hoveredEventId}
                onHoverEvent={setHoveredEventId}
              />
            </div>
          </div>
          <div className="panel panel-flex">
            <div className="panel-head">
              <span className="panel-title">Trades and orders</span>
              <span className="panel-meta">
                {fills.length} filled ·{" "}
                {workingOrderCount} working
              </span>
            </div>
            <div className="panel-body scrollable">
              <TradeHistory
                key={`${scenario.meta.id}:${sessionEpoch}`}
                fills={displayFills}
                orders={displayOrders}
                journal={displayJournal}
                currency={currency}
                pricePrecision={primaryPricePrecision}
                onCancelOrder={
                  status === "finished" ? undefined : cancelOrder
                }
                onUpdateOrder={
                  status === "finished" ? undefined : updatePendingOrder
                }
              />
            </div>
          </div>
          <div className="panel panel-flex">
            <div className="panel-head">
              <span className="panel-title">Replay audit</span>
              <span className="panel-meta">
                {auditEvents.length} events · {riskEventCount} risk
              </span>
            </div>
            <div className="panel-body scrollable">
              <AuditTrail events={displayAuditEvents} />
            </div>
          </div>
          <div className="panel panel-flex">
            <div className="panel-head">
              <span className="panel-title">Decision journal</span>
              <span className="panel-meta">
                {journal.length} {journal.length === 1 ? "entry" : "entries"}
              </span>
            </div>
            <div className="panel-body scrollable">
              <DecisionJournal
                key={`${scenario.meta.id}:${sessionEpoch}`}
                draftKey={`${runInstanceId}:${sessionEpoch}`}
                entries={displayJournal}
                status={status}
                onAdd={addJournalNote}
              />
            </div>
          </div>
        </section>
      </main>

      {displayActiveDrill && pendingDrillCheckpoint ? (
        <EventCheckpointDialog
          definition={displayActiveDrill}
          checkpoint={pendingDrillCheckpoint}
          visibleEvents={displayEventsChronological}
          onSubmit={(action, reflection, linkedEventIds) => {
            submitDrillCheckpoint(action, reflection, linkedEventIds);
          }}
        />
      ) : null}

      {report && reportOpen ? (
        <PostGameReport
          report={report}
          archiveWarning={reportArchiveWarning}
          archiveSaving={reportArchiveSaving}
          onRetryArchive={() => {
            void saveCurrentReport();
          }}
          onDownloadRecoveryArchive={downloadCurrentRecoveryArchive}
          previousComparablePracticeScore={previousComparablePracticeScore(
            runInstanceId,
            report,
            mode,
            brokerMode,
            brokerConfigFingerprint(broker),
            practiceLedger,
          )}
          currency={currency}
          pricePrecision={primaryPricePrecision}
          onClose={() => setReportOpen(false)}
          onReset={resetSession}
          onChooseNextPractice={chooseNextPractice}
        />
      ) : null}
      {pendingDialog}
    </div>
  );
}

function HeaderStat({
  label,
  value,
  tone,
  sub,
  children,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "neutral";
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <div className="header-stat">
      <span className="header-stat-label">{label}</span>
      <span className={`header-stat-value ${tone ?? ""}`}>{value}</span>
      {sub ? <span className={`header-stat-sub ${tone ?? ""}`}>{sub}</span> : null}
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: ReplayStatus }) {
  const label =
    status === "finished"
      ? "Complete"
      : status === "playing"
        ? "Playing"
        : status === "paused"
          ? "Paused"
          : "Ready";
  return (
    <span className={`status-pill ${status}`}>
      <span />
      {label}
    </span>
  );
}

function brokerModeLabel(mode: string): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function isRestrictedScenarioMode(mode: ScenarioMode): boolean {
  return mode === "blind" || mode === "challenge";
}

function decimalPlacesForTickSize(tickSize?: number): number {
  if (!tickSize || !Number.isFinite(tickSize) || tickSize <= 0) return 2;
  const [coefficient, exponentText] = tickSize.toString().toLowerCase().split("e");
  const coefficientDecimals = coefficient.split(".")[1]?.length ?? 0;
  const exponent = exponentText ? Number(exponentText) : 0;
  return Math.min(8, Math.max(0, coefficientDecimals - exponent));
}

function maskAssetText(
  value: string,
  tokens: readonly string[],
): string {
  return tokens.reduce(
      (masked, token) =>
        masked.replace(new RegExp(escapeRegExp(token), "gi"), "primary asset"),
      value,
    );
}

function assetMaskTokens(scenario: ScenarioPackage): string[] {
  const tokens = new Set<string>();
  const add = (value: string | undefined) => {
    const normalized = value?.trim();
    if (normalized && normalized.length >= 3) tokens.add(normalized);
  };
  for (const symbol of scenario.meta.symbols) add(symbol);
  for (const instrument of scenario.instruments) {
    add(instrument.symbol);
    add(instrument.name);
    add(instrument.exchange);
    add(instrument.currency);
    for (const fragment of instrument.name.split(/[^\p{L}\p{N}]+/u)) {
      add(fragment);
    }
  }
  return [...tokens].sort(
    (left, right) => right.length - left.length || left.localeCompare(right),
  );
}

function hiddenAssetLabel(
  symbol: string,
  primarySymbol: string,
  scenarioSymbols: readonly string[],
): string {
  if (symbol === primarySymbol) return "Primary asset";
  const index = scenarioSymbols.indexOf(symbol);
  return index >= 0 ? `Hidden asset ${index + 1}` : "Hidden asset";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
