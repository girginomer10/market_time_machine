import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReplayChart from "../components/chart/ReplayChart";
import ReplayControls from "../components/replay/ReplayControls";
import EventTimeline from "../components/timeline/EventTimeline";
import TradePanel from "../components/trade/TradePanel";
import TradeHistory from "../components/journal/TradeHistory";
import PostGameReport from "../components/report/PostGameReport";
import { listScenarios } from "../data/scenarios";
import { selectSnapshot, useSessionStore } from "../store/sessionStore";
import type { Candle, ReplayStatus } from "../types";
import { formatCurrency, formatNumber, formatPct } from "../utils/format";

const ZERO_EPSILON = 0.0000001;

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
  const brokerMode = useSessionStore((s) => s.brokerMode);
  const play = useSessionStore((s) => s.play);
  const pause = useSessionStore((s) => s.pause);
  const reset = useSessionStore((s) => s.resetScenario);
  const selectScenario = useSessionStore((s) => s.selectScenario);
  const cancelOrder = useSessionStore((s) => s.cancelOrder);
  const updatePendingOrder = useSessionStore((s) => s.updatePendingOrder);
  const snapshot = useSessionStore(selectSnapshot);

  const [reportOpen, setReportOpen] = useState(false);
  const [scenarioMenuOpen, setScenarioMenuOpen] = useState(false);
  const [hoveredEventId, setHoveredEventId] = useState<string | undefined>();

  useEffect(() => {
    if (report) setReportOpen(true);
  }, [report]);

  const tradablePrice = snapshot.tradablePrices[0];
  const primarySymbol = scenario.meta.symbols[0];
  const primaryInstrument = scenario.instruments.find(
    (instrument) => instrument.symbol === primarySymbol,
  );
  const totalCandles = scenario.candles.filter(
    (candle) => candle.symbol === primarySymbol,
  ).length;
  const progressPct =
    totalCandles > 0 ? ((snapshot.currentIndex + 1) / totalCandles) * 100 : 0;
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
  const visibleEventsChronological = useMemo(
    () =>
      [...snapshot.visibleEvents].sort((a, b) =>
        a.publishedAt.localeCompare(b.publishedAt),
      ),
    [snapshot.visibleEvents],
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <button
            className="brand"
            onClick={() => setScenarioMenuOpen((open) => !open)}
            aria-label="Switch scenario"
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
            <div className="scenario-title">{scenario.meta.title}</div>
            <div className="scenario-subtitle">{scenario.meta.subtitle}</div>
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
                    onClick={() => {
                      if (candidate.meta.id !== scenario.meta.id) {
                        selectScenario(candidate.meta.id);
                      }
                      setScenarioMenuOpen(false);
                    }}
                  >
                    <span>{candidate.meta.title}</span>
                    <small>{candidate.meta.subtitle}</small>
                  </button>
                ))}
                {scenarios.length <= 1 ? (
                  <div className="scenario-menu-note">
                    More scenarios coming. Switching resets the lab.
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        <div className="header-center">
          <HeaderStat
            label="Replay date"
            value={formatReplayDate(snapshot.currentTime)}
          >
            <div className="header-mini-progress">
              <span style={{ width: `${progressPct}%` }} />
            </div>
          </HeaderStat>
          <div className="header-divider" />
          <HeaderStat
            label="Portfolio value"
            value={formatCurrency(snapshot.portfolio.totalValue)}
            tone={toneFor(portfolioReturn)}
            sub={`${formatSignedPct(portfolioReturn)} from ${formatCurrency(
              scenario.meta.initialCash,
            )}`}
          />
          <StatusPill status={status} />
        </div>

        <div className="header-right">
          {scenario.meta.isSampleData ? (
            <span className="header-badge">Sample data</span>
          ) : null}
          <span className="header-badge broker">
            Broker · {brokerModeLabel(brokerMode)}
          </span>
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
                <span className="instrument-symbol">{primarySymbol}</span>
                <span className="instrument-name">
                  {primaryInstrument?.name ?? scenario.meta.assetClass}
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
                Day {snapshot.currentIndex + 1} of {totalCandles} · future
                hidden
              </span>
              <span className="firewall-chip">Information firewall active</span>
            </div>
          </div>
          <div className="panel-body">
            <ReplayChart
              candles={snapshot.visibleCandles}
              events={visibleEventsChronological}
              eventNumbers={eventNumbers}
              hoveredEventId={hoveredEventId}
              onHoverEvent={setHoveredEventId}
            />
            <ReplayControls />
          </div>
        </section>

        <section className="right-rail">
          <TradePanel
            tradablePrice={tradablePrice}
            cash={snapshot.portfolio.cash}
            positionsValue={snapshot.portfolio.positionsValue}
            totalValue={snapshot.portfolio.totalValue}
            realizedPnl={snapshot.portfolio.realizedPnl}
            unrealizedPnl={snapshot.portfolio.unrealizedPnl}
            initialCash={scenario.meta.initialCash}
          />
        </section>

        <section className="bottom-grid">
          <div className="panel panel-flex">
            <div className="panel-head">
              <span className="panel-title">Event timeline</span>
              <span className="panel-meta">
                {snapshot.visibleEvents.length} visible · future hidden
              </span>
            </div>
            <div className="panel-body scrollable">
              <EventTimeline
                events={visibleEventsChronological}
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
                {orders.filter((order) => order.status === "pending").length}{" "}
                working
              </span>
            </div>
            <div className="panel-body scrollable">
              <TradeHistory
                fills={fills}
                orders={orders}
                journal={journal}
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
              <span className="panel-title">Decision journal</span>
              <span className="panel-meta">
                {journal.length} {journal.length === 1 ? "entry" : "entries"}
              </span>
            </div>
            <div className="panel-body scrollable">
              {journal.length === 0 ? (
                <div className="empty-state journal-empty">
                  Write what you see and why you are acting on it. Read it back
                  at the end.
                </div>
              ) : (
                <div className="list">
                  {[...journal]
                    .sort((a, b) => b.time.localeCompare(a.time))
                    .map((note) => (
                      <div className="list-item journal-entry" key={note.id}>
                        <div className="row">
                          <strong>{note.symbol ?? "General"}</strong>
                          <span className="panel-meta">
                            {formatReplayDate(note.time)}
                          </span>
                        </div>
                        <div className="row subtle">
                          <span>{note.note}</span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {report && reportOpen ? (
        <PostGameReport
          report={report}
          onClose={() => setReportOpen(false)}
          onReset={() => {
            setReportOpen(false);
            reset();
          }}
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
