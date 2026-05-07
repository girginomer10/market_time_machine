import type { EquityPoint, ReportPayload, TradeOutcome } from "../../types";
import { formatCurrency, formatNumber, formatPct } from "../../utils/format";

const ZERO_EPSILON = 0.0000001;

type Props = {
  report: ReportPayload;
  onClose: () => void;
  onReset: () => void;
};

function toneFor(value: number): "pos" | "neg" | "neutral" {
  if (value > ZERO_EPSILON) return "pos";
  if (value < -ZERO_EPSILON) return "neg";
  return "neutral";
}

function signedPct(value: number): string {
  const formatted = formatPct(value);
  if (Math.abs(value) <= ZERO_EPSILON || formatted === "—") return formatted;
  return value > 0 ? `+${formatted}` : formatted;
}

export default function PostGameReport({ report, onClose, onReset }: Props) {
  const m = report.metrics;
  const verdict = verdictFor(m.excessReturn, report.totalTrades);
  const rights = buildRights(report);
  const watchItems = buildWatchItems(report);

  return (
    <div className="report-overlay" role="dialog" aria-modal>
      <div className="report-card">
        <div className="report-head">
          <div>
            <div className="report-eyebrow">Decision-quality review</div>
            <h2>{report.scenarioTitle}</h2>
            <p>Benchmark comparison, risk, and behavior after the replay ended.</p>
          </div>
          <button className="btn" onClick={onClose} aria-label="Close report">
            Close
          </button>
        </div>

        <div className="verdict">
          <span className={`verdict-badge ${verdict.tone}`}>
            {verdict.label}
          </span>
          <p>{verdict.text}</p>
        </div>

        <section className="report-summary">
          <ReportStat
            label="Your return"
            value={signedPct(m.totalReturn)}
            tone={toneFor(m.totalReturn)}
            sub={formatCurrency(m.finalEquity - m.initialEquity)}
          />
          <ReportStat
            label="Benchmark"
            value={signedPct(m.benchmarkReturn)}
            tone={toneFor(m.benchmarkReturn)}
            sub="Buy and hold"
          />
          <ReportStat
            label="Alpha"
            value={signedPct(m.excessReturn)}
            tone={toneFor(m.excessReturn)}
            sub="vs. benchmark"
          />
          <ReportStat
            label="Max drawdown"
            value={signedPct(-m.maxDrawdown)}
            tone={m.maxDrawdown > ZERO_EPSILON ? "neg" : "neutral"}
            sub="Peak to trough"
          />
        </section>

        <EquityCurve points={report.equityCurve} />

        <section className="report-section">
          <h3>What you got right</h3>
          {rights.length === 0 ? (
            <div className="empty-state">
              Nothing notable crossed the positive-signal threshold in this run.
            </div>
          ) : (
            <ul className="narrative-list">
              {rights.map((item) => (
                <li className="good" key={item}>
                  {item}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="report-section">
          <h3>What to watch</h3>
          {watchItems.length === 0 ? (
            <div className="empty-state">
              No major behavioral pattern crossed the detector thresholds.
            </div>
          ) : (
            <ul className="narrative-list">
              {watchItems.map((item) => (
                <li className="warn" key={item}>
                  {item}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="report-section split">
          <DecisionCard title="Best decision" trade={report.bestTrade} positive />
          <DecisionCard title="Worst decision" trade={report.worstTrade} />
        </section>

        <section className="report-section">
          <h3>By the numbers</h3>
          <div className="numbers-grid">
            <NumberCell label="Closed trades" value={`${report.totalTrades}`} />
            <NumberCell
              label="Win rate"
              value={report.totalTrades > 0 ? formatPct(m.winRate) : "—"}
            />
            <NumberCell
              label="Profit factor"
              value={
                m.profitFactor !== undefined
                  ? formatNumber(m.profitFactor, 2)
                  : "—"
              }
            />
            <NumberCell
              label="Fees and spread"
              value={formatCurrency(m.feesPaid)}
            />
            <NumberCell
              label="Slippage"
              value={formatCurrency(m.slippagePaid)}
            />
            <NumberCell
              label="Exposure time"
              value={formatPct(m.exposureTime)}
            />
            <NumberCell
              label="Sharpe"
              value={m.sharpe !== undefined ? formatNumber(m.sharpe, 2) : "—"}
            />
            <NumberCell
              label="Sortino"
              value={m.sortino !== undefined ? formatNumber(m.sortino, 2) : "—"}
            />
            <NumberCell
              label="Journal signals"
              value={`${report.behavioralFlags.length}`}
            />
          </div>
        </section>

        {report.executionQuality ? (
          <section className="report-section">
            <h3>Execution quality</h3>
            <div className="numbers-grid">
              <NumberCell
                label="Partial fills"
                value={`${report.executionQuality.partialFillCount}`}
              />
              <NumberCell
                label="Rejected orders"
                value={`${report.executionQuality.rejectedOrderCount}`}
              />
              <NumberCell
                label="Expired orders"
                value={`${report.executionQuality.expiredOrderCount}`}
              />
              <NumberCell
                label="Liquidations"
                value={`${report.executionQuality.forcedLiquidationCount}`}
              />
              <NumberCell
                label="Margin events"
                value={`${report.executionQuality.marginEventCount}`}
              />
              <NumberCell
                label="Borrow cost"
                value={formatCurrency(report.executionQuality.borrowCostPaid)}
              />
              <NumberCell
                label="Avg participation"
                value={
                  report.executionQuality.averageLiquidityParticipation !== undefined
                    ? formatPct(report.executionQuality.averageLiquidityParticipation)
                    : "—"
                }
              />
              <NumberCell
                label="Audit events"
                value={`${report.auditSummary?.totalEvents ?? 0}`}
              />
            </div>
          </section>
        ) : null}

        <div className="report-foot">
          <p>
            History rhymes; it does not repeat. Replay with another broker model
            or thesis to test how robust the reasoning is.
          </p>
          <div>
            <button className="btn" onClick={onClose}>
              Return to lab
            </button>
            <button className="btn primary" onClick={onReset}>
              Replay scenario
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function verdictFor(excessReturn: number, totalTrades: number) {
  if (totalTrades === 0) {
    return {
      label: "Spectator",
      tone: "neutral",
      text:
        "You watched the scenario unfold without trading. That is still a decision, and the benchmark shows what passive exposure would have done.",
    };
  }
  if (excessReturn > 0.05) {
    return {
      label: "Outperformed",
      tone: "pos",
      text:
        "Your active decisions beat buy-and-hold in this run. The next question is whether the process is repeatable without knowing the ending.",
    };
  }
  if (excessReturn > -0.02) {
    return {
      label: "In line",
      tone: "neutral",
      text:
        "Your result stayed close to buy-and-hold. The trades added activity, but not a large amount of measured edge.",
    };
  }
  return {
    label: "Underperformed",
    tone: "neg",
    text:
      "Buy-and-hold beat your active decisions in this run. Review the trades and behavioral signals for the main sources of drag.",
  };
}

function buildRights(report: ReportPayload): string[] {
  const rights: string[] = [];
  const m = report.metrics;
  if (m.excessReturn > 0) {
    rights.push(
      `Active decisions added ${signedPct(m.excessReturn)} over the benchmark.`,
    );
  }
  if (m.maxDrawdown <= 0.08 && report.totalTrades > 0) {
    rights.push("Drawdown stayed under 8%, suggesting position sizing was controlled.");
  }
  if (m.winRate > 0.5 && report.totalTrades > 1) {
    rights.push(`Win rate reached ${formatPct(m.winRate)} across closed trades.`);
  }
  if (report.behavioralFlags.length === 0 && report.totalTrades > 0) {
    rights.push("No major behavioral detector crossed its threshold.");
  }
  return rights;
}

function buildWatchItems(report: ReportPayload): string[] {
  const items = report.behavioralFlags.slice(0, 4).map((flag) => {
    const impact =
      flag.estimatedImpact !== undefined
        ? ` Estimated impact: ${formatCurrency(flag.estimatedImpact)}.`
        : "";
    return `${behaviorLabel(flag.type)}: ${flag.evidence}${impact}`;
  });
  if (report.totalTrades > 0 && report.metrics.excessReturn < 0) {
    items.push(
      `Trading trailed the benchmark by ${signedPct(report.metrics.excessReturn)}.`,
    );
  }
  if (report.totalTrades === 0) {
    items.push("No trades were placed, so the report cannot evaluate execution behavior.");
  }
  return items;
}

function ReportStat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: "pos" | "neg" | "neutral";
  sub: string;
}) {
  return (
    <div className="report-stat">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}

function EquityCurve({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="equity-wrap empty-state">
        Equity curve needs at least two replay points.
      </div>
    );
  }
  const width = 720;
  const height = 130;
  const pad = 12;
  const values = points.flatMap((point) => [
    point.portfolioValue,
    point.benchmarkValue,
  ]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (index: number) =>
    pad + (index / (points.length - 1)) * (width - pad * 2);
  const y = (value: number) =>
    pad + ((max - value) / range) * (height - pad * 2);
  const pathFor = (key: "portfolioValue" | "benchmarkValue") =>
    points
      .map((point, index) =>
        `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(point[key]).toFixed(1)}`,
      )
      .join(" ");

  return (
    <section className="equity-wrap">
      <div className="equity-head">
        <span>Equity curve</span>
        <span>
          <i className="legend-you" /> You
          <i className="legend-benchmark" /> Buy and hold
        </span>
      </div>
      <svg
        className="equity-svg"
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Portfolio equity versus benchmark"
      >
        <line
          x1={pad}
          x2={width - pad}
          y1={y(points[0].portfolioValue)}
          y2={y(points[0].portfolioValue)}
          stroke="var(--border)"
          strokeDasharray="2 4"
        />
        <path
          d={pathFor("benchmarkValue")}
          fill="none"
          stroke="var(--text-mute)"
          strokeWidth="1.3"
        />
        <path
          d={pathFor("portfolioValue")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.8"
        />
      </svg>
    </section>
  );
}

function DecisionCard({
  title,
  trade,
  positive,
}: {
  title: string;
  trade?: TradeOutcome;
  positive?: boolean;
}) {
  return (
    <div className="decision-card">
      <h3>{title}</h3>
      {trade ? (
        <>
          <span className="decision-meta">
            {trade.fill.side} {formatNumber(trade.fill.quantity, 6)}{" "}
            {trade.fill.symbol} at {formatCurrency(trade.fill.price)}
          </span>
          <strong className={toneFor(trade.realizedPnl)}>
            {formatCurrency(trade.realizedPnl)}
          </strong>
          <p>
            {positive
              ? "This closed trade contributed positively to the session."
              : "This closed trade was the largest realized drag in the session."}
          </p>
        </>
      ) : (
        <div className="empty-state">
          {positive ? "No closed winner." : "No closed loser."}
        </div>
      )}
    </div>
  );
}

function NumberCell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="number-cell">
      <span>{label}</span>
      <strong>{value}</strong>
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
