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
import PostGameReport from "../components/report/PostGameReport";
import { listScenarios } from "../data/scenarios";
import { eventCoverageSummary } from "../domain/scenario/eventCoverage";
import { selectSnapshot, useSessionStore } from "../store/sessionStore";
import type { Candle, ReplayStatus, ScenarioMode } from "../types";
import { formatCurrency, formatNumber, formatPct } from "../utils/format";

const ZERO_EPSILON = 0.0000001;

type PendingConfirmation =
  | { kind: "reset" }
  | { kind: "scenario"; scenarioId: string; title: string };

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

export default function App() {
  const scenario = useSessionStore((s) => s.scenario);
  const status = useSessionStore((s) => s.status);
  const fills = useSessionStore((s) => s.fills);
  const orders = useSessionStore((s) => s.orders);
  const journal = useSessionStore((s) => s.journal);
  const report = useSessionStore((s) => s.report);
  const mode = useSessionStore((s) => s.mode);
  const brokerMode = useSessionStore((s) => s.brokerMode);
  const play = useSessionStore((s) => s.play);
  const pause = useSessionStore((s) => s.pause);
  const reset = useSessionStore((s) => s.resetScenario);
  const selectScenario = useSessionStore((s) => s.selectScenario);
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
  const [scenarioMenuOpen, setScenarioMenuOpen] = useState(false);
  const [hoveredEventId, setHoveredEventId] = useState<string | undefined>();
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation>();
  const [sessionMessage, setSessionMessage] = useState<string>();
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (report) setReportOpen(true);
  }, [report]);

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
  const primarySymbol = scenario.meta.symbols[0];
  const primaryInstrument = scenario.instruments.find(
    (instrument) => instrument.symbol === primarySymbol,
  );
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
  const scenarios = listScenarios();
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
  useEffect(() => {
    if (restrictedReplay) setScenarioMenuOpen(false);
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
    setScenarioMenuOpen(false);
    setPendingConfirmation(undefined);
    setSessionMessage(undefined);
    reset();
    setSessionEpoch((epoch) => epoch + 1);
  };

  const switchScenario = (scenarioId: string) => {
    setReportOpen(false);
    setScenarioMenuOpen(false);
    setPendingConfirmation(undefined);
    setSessionMessage(undefined);
    selectScenario(scenarioId);
    setSessionEpoch((epoch) => epoch + 1);
  };

  const requestReset = () => {
    if (status === "playing") pause();
    if (sessionHasProgress) setPendingConfirmation({ kind: "reset" });
    else resetSession();
  };

  const requestScenario = (scenarioId: string, title: string) => {
    if (scenarioId === scenario.meta.id) {
      setScenarioMenuOpen(false);
      return;
    }
    if (status === "playing") pause();
    if (sessionHasProgress) {
      setScenarioMenuOpen(false);
      setPendingConfirmation({ kind: "scenario", scenarioId, title });
    } else {
      switchScenario(scenarioId);
    }
  };

  const confirmPendingAction = () => {
    if (!pendingConfirmation) return;
    if (pendingConfirmation.kind === "reset") resetSession();
    else switchScenario(pendingConfirmation.scenarioId);
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

  const restoreSession = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const result = importSession(await file.text());
    if (result.ok) {
      setScenarioMenuOpen(false);
      setReportOpen(Boolean(useSessionStore.getState().report));
      setSessionEpoch((epoch) => epoch + 1);
      setSessionMessage("Saved session restored.");
    } else {
      setSessionMessage(result.message ?? "Unable to restore this session.");
    }
  };

  return (
    <div className={restrictedReplay ? "app-shell restricted-replay" : "app-shell"}>
      <header className="app-header">
        <div className="header-left">
          <button
            className="brand"
            onClick={() => {
              if (!restrictedReplay) setScenarioMenuOpen((open) => !open);
            }}
            aria-label={
              restrictedReplay
                ? "Scenario switch locked during local challenge"
                : "Switch scenario"
            }
            disabled={restrictedReplay}
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
            <span className="brand-caret">v</span>
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
          {scenarioMenuOpen ? (
            <>
              <button
                className="menu-scrim"
                aria-label="Close scenario menu"
                onClick={() => setScenarioMenuOpen(false)}
              />
              <div className="scenario-menu">
                <div className="scenario-menu-title">Switch scenario</div>
                {scenarios.map((candidate) => (
                  <button
                    key={candidate.meta.id}
                    className={
                      candidate.meta.id === scenario.meta.id
                        ? "scenario-menu-row active"
                        : "scenario-menu-row"
                    }
                    onClick={() =>
                      requestScenario(candidate.meta.id, candidate.meta.title)
                    }
                  >
                    <span>{candidate.meta.title}</span>
                    <small>{candidate.meta.subtitle}</small>
                    <span className="scenario-menu-facts">
                      <i>{candidate.meta.assetClass}</i>
                      <i>{candidate.meta.difficulty}</i>
                      <i>{candidate.meta.defaultGranularity}</i>
                      <i>
                        {formatReplayDate(candidate.meta.startTime)} –{" "}
                        {formatReplayDate(candidate.meta.endTime)}
                      </i>
                    </span>
                  </button>
                ))}
                <div className="scenario-menu-section">
                  <div className="scenario-menu-title">Learning mode</div>
                  <div className="mode-grid" role="radiogroup" aria-label="Learning mode">
                    {scenario.meta.supportedModes.map((candidateMode) => (
                      <button
                        key={candidateMode}
                        className={mode === candidateMode ? "mode-pill active" : "mode-pill"}
                        type="button"
                        role="radio"
                        aria-checked={mode === candidateMode}
                        onClick={() => {
                          setScenarioMode(candidateMode);
                          if (isRestrictedScenarioMode(candidateMode)) {
                            setScenarioMenuOpen(false);
                          }
                        }}
                        disabled={fills.length > 0 || workingOrderCount > 0}
                        title={modeDescription(candidateMode)}
                      >
                        <span>{modeLabel(candidateMode)}</span>
                        <small>{modeDescription(candidateMode)}</small>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="scenario-menu-section session-tools">
                  <div className="scenario-menu-title">Session file</div>
                  <div>
                    <button className="btn" type="button" onClick={downloadSession}>
                      Export
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => importInputRef.current?.click()}
                    >
                      Restore
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        clearSavedSession();
                        setSessionMessage("Browser save cleared for this session.");
                      }}
                    >
                      Clear browser save
                    </button>
                    <input
                      ref={importInputRef}
                      className="visually-hidden"
                      type="file"
                      accept="application/json,.json"
                      onChange={restoreSession}
                      aria-label="Restore session file"
                    />
                  </div>
                  {sessionMessage ? (
                    <p className="session-message" role="status">
                      {sessionMessage}
                    </p>
                  ) : null}
                </div>
                <div className="scenario-menu-note">
                  {sessionHasProgress
                    ? "Switching scenarios will reset this lab after confirmation."
                    : "Choose a scenario and mode before trading starts."}
                </div>
              </div>
            </>
          ) : null}
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
          <span className="header-badge">Mode · {modeLabel(mode)}</span>
          {status === "finished" ? (
            <button className="btn primary" onClick={() => setReportOpen(true)}>
              View report
            </button>
          ) : (
            <button className="btn primary" onClick={togglePlay}>
              {status === "playing" ? "Pause replay" : "Resume replay"}
            </button>
          )}
        </div>
      </header>

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
                  {visibleCandle ? formatNumber(visibleCandle.close, 2) : "—"}
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

      {report && reportOpen ? (
        <PostGameReport
          report={report}
          currency={currency}
          onClose={() => setReportOpen(false)}
          onReset={resetSession}
        />
      ) : null}
      {pendingConfirmation ? (
        <ConfirmationDialog
          title={
            pendingConfirmation.kind === "reset"
              ? "Reset this replay?"
              : `Switch to ${pendingConfirmation.title}?`
          }
          description={
            pendingConfirmation.kind === "reset"
              ? "Orders, fills, journal notes, and replay progress in this session will be cleared."
              : "The current orders, fills, journal notes, and replay progress will be cleared before the new scenario opens."
          }
          confirmLabel={
            pendingConfirmation.kind === "reset"
              ? "Reset replay"
              : "Switch scenario"
          }
          onConfirm={confirmPendingAction}
          onCancel={() => setPendingConfirmation(undefined)}
        />
      ) : null}
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

function modeLabel(mode: ScenarioMode): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function modeDescription(mode: ScenarioMode): string {
  switch (mode) {
    case "explorer":
      return "Guided replay with flexible broker assumptions.";
    case "professional":
      return "Scenario broker rules with full research context.";
    case "blind":
      return "Limited context and no shortcut to the ending.";
    case "challenge":
      return "Locked assumptions and a complete replay required.";
  }
}

function isRestrictedScenarioMode(mode: ScenarioMode): boolean {
  return mode === "blind" || mode === "challenge";
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
