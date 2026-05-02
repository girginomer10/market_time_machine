import type { ReportPayload } from "../../types/reporting";
import { formatCurrency, formatNumber, formatPct } from "../../utils/format";

type Props = {
  report: ReportPayload;
  onClose: () => void;
  onReset: () => void;
};

export default function PostGameReport({ report, onClose, onReset }: Props) {
  const m = report.metrics;
  const verdict =
    m.excessReturn > 0
      ? "You outperformed the buy-and-hold benchmark."
      : m.excessReturn < 0
        ? "Buy-and-hold beat your decisions in this scenario."
        : "Your performance matched buy-and-hold.";

  return (
    <div className="report-overlay" role="dialog" aria-modal>
      <div className="report-card">
        <div className="report-head">
          <div>
            <div className="panel-title">Scenario report</div>
            <h2 style={{ margin: 0 }}>{report.scenarioTitle}</h2>
            <div className="panel-sub" style={{ marginTop: 4 }}>
              {verdict}
            </div>
          </div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="report-body">
          <section className="report-metric-grid">
            <Metric
              label="Total return"
              value={formatPct(m.totalReturn)}
              tone={m.totalReturn >= 0 ? "pos" : "neg"}
            />
            <Metric
              label="Benchmark return"
              value={formatPct(m.benchmarkReturn)}
            />
            <Metric
              label="Excess return"
              value={formatPct(m.excessReturn)}
              tone={m.excessReturn >= 0 ? "pos" : "neg"}
            />
            <Metric label="Max drawdown" value={formatPct(-m.maxDrawdown)} tone="neg" />
            <Metric label="Annualized volatility" value={formatPct(m.volatility)} />
            <Metric
              label="Sharpe (annualized)"
              value={m.sharpe !== undefined ? formatNumber(m.sharpe, 2) : "—"}
            />
            <Metric
              label="Sortino (annualized)"
              value={m.sortino !== undefined ? formatNumber(m.sortino, 2) : "—"}
            />
            <Metric
              label="Win rate"
              value={
                m.winRate > 0 || report.totalTrades > 0
                  ? formatPct(m.winRate)
                  : "—"
              }
            />
            <Metric label="Trades" value={`${report.totalTrades}`} />
            <Metric label="Turnover" value={formatCurrency(m.turnover)} />
            <Metric label="Fees + spread" value={formatCurrency(m.feesPaid)} />
            <Metric
              label="Slippage"
              value={formatCurrency(m.slippagePaid)}
            />
            <Metric label="Exposure time" value={formatPct(m.exposureTime)} />
            <Metric
              label="Final equity"
              value={formatCurrency(m.finalEquity)}
              tone={m.finalEquity >= m.initialEquity ? "pos" : "neg"}
            />
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="report-trade-card">
              <strong>Behavioral signals</strong>
              {report.behavioralFlags.length === 0 ? (
                <span>No major behavioral pattern crossed the detector thresholds.</span>
              ) : (
                <div className="behavior-list">
                  {report.behavioralFlags.slice(0, 4).map((flag) => (
                    <div className="behavior-card" key={flag.id}>
                      <div className="behavior-head">
                        <span>{behaviorLabel(flag.type)}</span>
                        <span className="severity" aria-label={`severity ${flag.severity} of 5`}>
                          {Array.from({ length: 5 }, (_, i) => (
                            <span
                              key={i}
                              className={i < flag.severity ? "on" : ""}
                            />
                          ))}
                        </span>
                      </div>
                      <span>{flag.evidence}</span>
                      {flag.estimatedImpact !== undefined ? (
                        <span className="panel-sub">
                          estimated impact {formatCurrency(flag.estimatedImpact)}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {report.bestTrade ? (
              <div className="report-trade-card pos">
                <strong>Best closed trade</strong>
                <span>
                  {report.bestTrade.fill.side.toUpperCase()}{" "}
                  {formatNumber(report.bestTrade.fill.quantity, 6)}{" "}
                  {report.bestTrade.fill.symbol} at{" "}
                  {formatCurrency(report.bestTrade.fill.price)} on{" "}
                  {report.bestTrade.fill.time.slice(0, 10)}
                </span>
                <span>
                  realized {formatCurrency(report.bestTrade.realizedPnl)} ·{" "}
                  contribution {formatPct(report.bestTrade.contributionPct)}
                </span>
              </div>
            ) : (
              <div className="report-trade-card">
                <strong>Best closed trade</strong>
                <span>No closed trade with positive P/L recorded.</span>
              </div>
            )}
            {report.worstTrade ? (
              <div className="report-trade-card neg">
                <strong>Worst closed trade</strong>
                <span>
                  {report.worstTrade.fill.side.toUpperCase()}{" "}
                  {formatNumber(report.worstTrade.fill.quantity, 6)}{" "}
                  {report.worstTrade.fill.symbol} at{" "}
                  {formatCurrency(report.worstTrade.fill.price)} on{" "}
                  {report.worstTrade.fill.time.slice(0, 10)}
                </span>
                <span>
                  realized {formatCurrency(report.worstTrade.realizedPnl)} ·{" "}
                  contribution {formatPct(report.worstTrade.contributionPct)}
                </span>
              </div>
            ) : (
              <div className="report-trade-card">
                <strong>Worst closed trade</strong>
                <span>No closed trade with negative P/L recorded.</span>
              </div>
            )}
            <div className="report-trade-card">
              <strong>Reading the report</strong>
              <span>
                Returns reward decisions made under genuine uncertainty.
                Compare yourself against the buy-and-hold benchmark and notice
                how much of your result came from timing versus exposure.
              </span>
            </div>
          </section>
        </div>
        <div className="report-foot">
          <button className="btn" onClick={onClose}>
            Review session
          </button>
          <button className="btn primary" onClick={onReset}>
            Replay scenario
          </button>
        </div>
      </div>
    </div>
  );
}

function behaviorLabel(type: string): string {
  switch (type) {
    case "panic_sell":
      return "Panic sell";
    case "fomo_buy":
      return "FOMO buy";
    case "early_profit_take":
      return "Early profit taking";
    case "overtrading":
      return "Overtrading";
    case "dip_catching":
      return "Dip catching";
    case "holding_loser":
      return "Holding loser";
    case "news_overreaction":
      return "News overreaction";
    case "excessive_leverage":
      return "Excessive leverage";
    default:
      return "Behavioral signal";
  }
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className={`metric-value${tone ? ` ${tone}` : ""}`}>{value}</span>
    </div>
  );
}
