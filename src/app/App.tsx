import {
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
  clearRunHistory,
  loadRunHistory,
  recordCompletedRun,
  removeCompletedRun,
  type CompletedRun,
} from "../domain/history/runHistory";
import {
  clearPracticeLedger,
  loadPracticeLedger,
  persistPracticeLedger,
  reconcilePracticeLedger,
  recordPracticeLedgerEntry,
  removePracticeLedgerEntry,
  type PracticeLedgerEntry,
} from "../domain/history/practiceLedger";
import {
  exportPracticeArchive,
  mergePracticeArchive,
  parsePracticeArchive,
} from "../domain/history/practiceArchive";
import { persistPracticeArchiveAtomically } from "../domain/history/practiceArchiveStorage";
import { buildPracticeCoachPlan } from "../domain/coaching/practiceCoach";
import {
  getDrillForScenario,
  listAvailableDrills,
} from "../data/practice/drills";
import { listBuiltInPracticeTracks } from "../data/practice/tracks";
import {
  buildEvidenceProfile,
  type ValidatedSourceScenario,
} from "../domain/practice/evidenceProfile";
import { practiceTrackProgress } from "../domain/practice/tracks";
import { eventCoverageSummary } from "../domain/scenario/eventCoverage";
import { selectSnapshot, useSessionStore } from "../store/sessionStore";
import type {
  Candle,
  ReplayStatus,
  ReportPayload,
  ScenarioMode,
} from "../types";
import { formatCurrency, formatNumber, formatPct } from "../utils/format";
import { scenarioModeLabel } from "../utils/scenarioMode";

const ZERO_EPSILON = 0.0000001;
const MAX_LOCAL_IMPORT_BYTES = 25 * 1024 * 1024;

type PendingConfirmation =
  | { kind: "reset" }
  | { kind: "clear-history" }
  | { kind: "remove-scenario"; scenarioId: string; title: string }
  | {
      kind: "start";
      scenarioId: string;
      title: string;
      mode: ScenarioMode;
      drillId?: string;
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
    case "remove-scenario":
      return {
        title: `Remove ${pending.title}?`,
        description:
          "This imported lab will be removed from this browser. Existing report history stays available, but replaying it will require importing the scenario again.",
        confirmLabel: "Remove imported lab",
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

function pricePrecisionForScenario(scenarioId: string): number {
  const candidate = getScenario(scenarioId);
  const primary = candidate?.meta.symbols[0];
  const instrument = candidate?.instruments.find(
    (entry) => entry.symbol === primary,
  );
  return decimalPlacesForTickSize(instrument?.tickSize);
}

function previousComparablePracticeScore(
  currentRunId: string,
  report: ReportPayload,
  mode: ScenarioMode,
  brokerMode: CompletedRun["brokerMode"],
  ledger: readonly PracticeLedgerEntry[],
): number | undefined {
  const assessment = report.practiceAssessment;
  if (!assessment) return undefined;
  return [...ledger]
    .filter(
      (entry) =>
        entry.id !== currentRunId &&
        entry.runId !== currentRunId &&
        entry.runInstanceId !== currentRunId &&
        entry.scenarioId === report.scenarioId &&
        (entry.scenarioDataVersion ?? null) ===
          (report.provenance?.dataVersion ?? null) &&
        entry.mode === mode &&
        entry.brokerMode === brokerMode &&
        entry.assessment?.drillId === assessment.drillId &&
        entry.assessment.definitionVersion === assessment.definitionVersion &&
        entry.assessment.rubricVersion === assessment.rubricVersion &&
        entry.assessment.overallScore !== undefined,
    )
    .sort(
      (left, right) =>
        Date.parse(right.completedAt) - Date.parse(left.completedAt) ||
        right.id.localeCompare(left.id),
    )[0]?.assessment?.overallScore;
}

export default function App() {
  const scenario = useSessionStore((s) => s.scenario);
  const runInstanceId = useSessionStore((s) => s.runInstanceId);
  const status = useSessionStore((s) => s.status);
  const fills = useSessionStore((s) => s.fills);
  const orders = useSessionStore((s) => s.orders);
  const journal = useSessionStore((s) => s.journal);
  const report = useSessionStore((s) => s.report);
  const mode = useSessionStore((s) => s.mode);
  const brokerMode = useSessionStore((s) => s.brokerMode);
  const activeDrillId = useSessionStore((s) => s.activeDrillId);
  const initialDrillPlan = useSessionStore((s) => s.initialDrillPlan);
  const drillCheckpointResponses = useSessionStore(
    (s) => s.drillCheckpointResponses,
  );
  const pendingDrillCheckpoint = useSessionStore(
    (s) => s.pendingDrillCheckpoint,
  );
  const play = useSessionStore((s) => s.play);
  const pause = useSessionStore((s) => s.pause);
  const reset = useSessionStore((s) => s.resetScenario);
  const selectScenario = useSessionStore((s) => s.selectScenario);
  const startPractice = useSessionStore((s) => s.startPractice);
  const submitDrillCheckpoint = useSessionStore(
    (s) => s.submitDrillCheckpoint,
  );
  const setScenarioMode = useSessionStore((s) => s.setScenarioMode);
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
  const [runHistory, setRunHistory] = useState<CompletedRun[]>(() =>
    loadRunHistory(),
  );
  const [practiceLedger, setPracticeLedger] = useState<PracticeLedgerEntry[]>(
    () =>
      persistPracticeLedger(
        reconcilePracticeLedger(loadPracticeLedger(), loadRunHistory()),
      ),
  );
  const [historicalRun, setHistoricalRun] = useState<CompletedRun>();
  const [hoveredEventId, setHoveredEventId] = useState<string | undefined>();
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation>();
  const [sessionMessage, setSessionMessage] = useState<string>();
  const [scenarioMessage, setScenarioMessage] = useState<{
    kind: "status" | "error";
    text: string;
  }>();
  const [archiveMessage, setArchiveMessage] = useState<string>();
  const brandButtonRef = useRef<HTMLButtonElement | null>(null);
  const primarySymbol = scenario.meta.symbols[0];
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
        } satisfies ValidatedSourceScenario;
        byVersion.set(`${source.scenarioId}:${source.dataVersion}`, source);
      }
    }
    return [...byVersion.values()];
  }, [practiceTrackCatalog]);
  const evidenceProfile = useMemo(
    () => buildEvidenceProfile(practiceLedger, validatedSourceScenarios),
    [practiceLedger, validatedSourceScenarios],
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
    if (!report) return;
    const recorded = recordCompletedRun({
      report,
      runInstanceId,
      mode,
      brokerMode,
      currency: scenario.meta.baseCurrency,
      pricePrecision: primaryPricePrecision,
    });
    setRunHistory(recorded.history);
    setPracticeLedger(
      recordPracticeLedgerEntry(recorded.run, report.practiceAssessment),
    );
  }, [
    brokerMode,
    mode,
    primaryPricePrecision,
    report,
    runInstanceId,
    scenario.meta.baseCurrency,
  ]);

  const tradablePrice = snapshot.tradablePrices[0];
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
  const sessionHasProgress =
    snapshot.currentIndex > 0 ||
    fills.length > 0 ||
    orders.length > 0 ||
    journal.length > 0 ||
    auditEvents.length > 0 ||
    status === "finished";
  const restrictedReplay =
    status !== "finished" && isRestrictedScenarioMode(mode);
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
            title: maskAssetText(
              event.title,
              primarySymbol,
              primaryInstrument?.name,
            ),
            summary: maskAssetText(
              event.summary,
              primarySymbol,
              primaryInstrument?.name,
            ),
            affectedSymbols: event.affectedSymbols.map((symbol) =>
              symbol === primarySymbol ? "Primary asset" : symbol,
            ),
            source: event.source
              ? maskAssetText(
                  event.source,
                  primarySymbol,
                  primaryInstrument?.name,
                )
              : undefined,
            sourceUrl: undefined,
          }))
        : visibleEventsChronological,
    [
      primaryInstrument?.name,
      primarySymbol,
      restrictedReplay,
      visibleEventsChronological,
    ],
  );
  const displayFills = useMemo(
    () =>
      restrictedReplay
        ? fills.map((fill) => ({ ...fill, symbol: "Primary asset" }))
        : fills,
    [fills, restrictedReplay],
  );
  const displayOrders = useMemo(
    () =>
      restrictedReplay
        ? orders.map((order) => ({
            ...order,
            symbol: "Primary asset",
            note: order.note
              ? maskAssetText(
                  order.note,
                  primarySymbol,
                  primaryInstrument?.name,
                )
              : undefined,
          }))
        : orders,
    [orders, primaryInstrument?.name, primarySymbol, restrictedReplay],
  );
  const displayJournal = useMemo(
    () =>
      restrictedReplay
        ? journal.map((entry) => ({
            ...entry,
            symbol: entry.symbol ? "Primary asset" : undefined,
            note: maskAssetText(
              entry.note,
              primarySymbol,
              primaryInstrument?.name,
            ),
          }))
        : journal,
    [journal, primaryInstrument?.name, primarySymbol, restrictedReplay],
  );
  const displayAuditEvents = useMemo(
    () =>
      restrictedReplay
        ? auditEvents.map((event) => ({
            ...event,
            symbol: event.symbol ? "Primary asset" : undefined,
            message: maskAssetText(
              event.message,
              primarySymbol,
              primaryInstrument?.name,
            ),
          }))
        : auditEvents,
    [auditEvents, primaryInstrument?.name, primarySymbol, restrictedReplay],
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
    setReportOpen(false);
    setLibraryOpen(false);
    setLibraryCanClose(false);
    setPendingConfirmation(undefined);
    setSessionMessage(undefined);
    reset();
    setSessionEpoch((epoch) => epoch + 1);
  };

  const startScenario = (
    scenarioId: string,
    nextMode: ScenarioMode,
    drillId?: string,
  ) => {
    setReportOpen(false);
    setLibraryOpen(false);
    setLibraryCanClose(false);
    setPendingConfirmation(undefined);
    setSessionMessage(undefined);
    if (drillId) {
      const result = startPractice(scenarioId, drillId);
      if (!result.ok) {
        setScenarioMessage({
          kind: "error",
          text: result.message ?? "Unable to start this practice drill.",
        });
        setLibraryOpen(true);
        return;
      }
    } else {
      selectScenario(scenarioId);
      setScenarioMode(nextMode);
    }
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
    const title = candidate.meta.title;
    const resolvedMode = candidate.meta.supportedModes.includes(nextMode)
      ? nextMode
      : (candidate.meta.supportedModes[0] ?? "explorer");
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
    if (status === "playing") pause();
    if (sessionHasProgress) {
      setPendingConfirmation({
        kind: "start",
        scenarioId,
        title,
        mode: resolvedMode,
        drillId,
      });
    } else {
      startScenario(scenarioId, definition?.mode ?? resolvedMode, drillId);
    }
  };

  const confirmPendingAction = () => {
    if (!pendingConfirmation) return;
    switch (pendingConfirmation.kind) {
      case "reset":
        resetSession();
        break;
      case "start":
        startScenario(
          pendingConfirmation.scenarioId,
          pendingConfirmation.mode,
          pendingConfirmation.drillId,
        );
        break;
      case "clear-history":
        clearRunHistory();
        clearPracticeLedger();
        setRunHistory([]);
        setPracticeLedger([]);
        setHistoricalRun(undefined);
        setPendingConfirmation(undefined);
        break;
      case "remove-scenario": {
        const removed = removeUserScenario(pendingConfirmation.scenarioId);
        if (!removed) {
          setScenarioMessage({
            kind: "error",
            text: "That imported scenario is no longer available in this browser.",
          });
        } else {
          if (scenario.meta.id === pendingConfirmation.scenarioId) {
            selectScenario(defaultScenarioId);
            setSessionEpoch((epoch) => epoch + 1);
          }
          setScenarios(listScenarios());
          setScenarioMessage({
            kind: "status",
            text: `${pendingConfirmation.title} was removed from this browser.`,
          });
        }
        setPendingConfirmation(undefined);
        break;
      }
    }
  };

  const openLibrary = () => {
    if (restrictedReplay) return;
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

  const downloadRunHistory = () => {
    const serialized = exportPracticeArchive(runHistory, practiceLedger);
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
      const merged = mergePracticeArchive(
        { runs: runHistory, ledger: practiceLedger },
        imported,
      );
      const { runs: savedRuns, ledger: savedLedger } =
        persistPracticeArchiveAtomically(merged);
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
      const result = importSession(await file.text());
      if (result.ok) {
        setReportOpen(false);
        setLibraryCanClose(false);
        setSessionEpoch((epoch) => epoch + 1);
        setSessionMessage("Saved session restored.");
      } else {
        setSessionMessage(result.message ?? "Unable to restore this session.");
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
  const pendingDialog = pendingDialogCopy ? (
    <ConfirmationDialog
      {...pendingDialogCopy}
      onConfirm={confirmPendingAction}
      onCancel={() => setPendingConfirmation(undefined)}
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
                hasArchiveData={
                  runHistory.length > 0 || practiceLedger.length > 0
                }
                onViewReport={setHistoricalRun}
                onReplay={(run) => {
                  setHistoricalRun(undefined);
                  requestStart(
                    run.scenarioId,
                    run.mode,
                    run.report.practiceAssessment?.drillId,
                  );
                }}
                onRemove={(run) => {
                  setRunHistory(removeCompletedRun(run.id));
                  setPracticeLedger(removePracticeLedgerEntry(run.id));
                }}
                onExport={downloadRunHistory}
                onImport={importPracticeArchive}
                importMessage={archiveMessage}
                onClear={() =>
                  setPendingConfirmation({ kind: "clear-history" })
                }
              />
          }
          practicePlan={practicePlan}
          drills={drillCatalog}
          evidenceProfile={evidenceProfile}
          practiceTracks={practiceTrackCatalog}
          practiceTrackProgress={practiceTrackProgressEntries}
          sessionMessage={sessionMessage}
          scenarioMessage={scenarioMessage?.text}
          scenarioMessageKind={scenarioMessage?.kind}
          userScenarioIds={scenarios
            .filter((candidate) => isUserScenario(candidate.meta.id))
            .map((candidate) => candidate.meta.id)}
          onContinue={continueSession}
          onStart={requestStart}
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
            clearSavedSession();
            setSessionMessage("Browser save cleared for this session.");
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
              requestStart(
                run.scenarioId,
                run.mode,
                run.report.practiceAssessment?.drillId,
              );
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
                ? "Scenario title, asset label, and ending stay hidden until completion. Local anti-cheat mode."
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
          onSubmit={(action, reflection) => {
            submitDrillCheckpoint(action, reflection);
          }}
        />
      ) : null}

      {report && reportOpen ? (
        <PostGameReport
          report={report}
          previousComparablePracticeScore={previousComparablePracticeScore(
            runInstanceId,
            report,
            mode,
            brokerMode,
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
  primarySymbol: string,
  instrumentName?: string,
): string {
  return [primarySymbol, instrumentName]
    .filter((token): token is string => Boolean(token))
    .reduce(
      (masked, token) =>
        masked.replace(new RegExp(escapeRegExp(token), "gi"), "primary asset"),
      value,
    );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
