import { useEffect, useState } from "react";
import ReplayChart from "../components/chart/ReplayChart";
import ReplayControls from "../components/replay/ReplayControls";
import EventTimeline from "../components/timeline/EventTimeline";
import TradePanel from "../components/trade/TradePanel";
import TradeHistory from "../components/journal/TradeHistory";
import PostGameReport from "../components/report/PostGameReport";
import { selectSnapshot, useSessionStore } from "../store/sessionStore";
import { formatTime } from "../utils/format";

export default function App() {
  const scenario = useSessionStore((s) => s.scenario);
  const status = useSessionStore((s) => s.status);
  const fills = useSessionStore((s) => s.fills);
  const orders = useSessionStore((s) => s.orders);
  const journal = useSessionStore((s) => s.journal);
  const report = useSessionStore((s) => s.report);
  const reset = useSessionStore((s) => s.resetScenario);
  const snapshot = useSessionStore(selectSnapshot);

  const [reportOpen, setReportOpen] = useState(false);
  useEffect(() => {
    if (report) setReportOpen(true);
  }, [report]);

  const tradablePrice = snapshot.tradablePrices[0];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            M
          </div>
          <div>
            <div className="brand-name">Market Time Machine</div>
            <div className="brand-tagline">Financial History Lab · Open Source</div>
          </div>
        </div>
        <div className="scenario-meta">
          <div className="scenario-title">
            <strong>{scenario.meta.title}</strong>
            <span>{scenario.meta.subtitle}</span>
          </div>
          <span className="tag">
            {scenario.meta.assetClass} · {scenario.meta.defaultGranularity}
          </span>
          <span className="tag">{scenario.meta.difficulty}</span>
          {scenario.meta.isSampleData ? (
            <span className="tag warn">Sample data</span>
          ) : null}
          <span className="tag live">
            {status === "playing"
              ? "live replay"
              : status === "finished"
                ? "scenario complete"
                : "ready"}
          </span>
          <div className="replay-clock" aria-live="polite">
            replay clock {formatTime(snapshot.currentTime)}
          </div>
        </div>
      </header>

      <main className="app-grid">
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Replay chart</span>
            <span className="panel-sub">
              {snapshot.visibleCandles.length} / {scenario.candles.filter((c) => c.symbol === scenario.meta.symbols[0]).length} candles · daily
            </span>
          </div>
          <div className="panel-body">
            <ReplayChart candles={snapshot.visibleCandles} />
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

        <section className="bottom-grid" style={{ gridColumn: "1 / -1" }}>
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Event timeline</span>
              <span className="panel-sub">
                {snapshot.visibleEvents.length} visible
              </span>
            </div>
            <div className="panel-body scrollable">
              <EventTimeline events={snapshot.visibleEvents} />
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Trade history</span>
              <span className="panel-sub">{fills.length} fills</span>
            </div>
            <div className="panel-body scrollable">
              <TradeHistory fills={fills} orders={orders} journal={journal} />
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Decision journal</span>
              <span className="panel-sub">{journal.length} notes</span>
            </div>
            <div className="panel-body scrollable">
              {journal.length === 0 ? (
                <div className="empty-state">
                  Your decision notes appear here. Attach one to every trade.
                </div>
              ) : (
                <div className="list">
                  {[...journal]
                    .sort((a, b) => b.time.localeCompare(a.time))
                    .map((note) => (
                      <div className="list-item" key={note.id}>
                        <div className="row">
                          <strong>{note.symbol ?? "general"}</strong>
                          <span className="panel-sub">
                            {note.time.slice(0, 10)}
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
