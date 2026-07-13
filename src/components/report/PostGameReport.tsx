import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DecisionReplayPoint,
  EquityPoint,
  ReportPayload,
  TradeOutcome,
} from "../../types";
import { formatCurrency, formatNumber, formatPct } from "../../utils/format";

const ZERO_EPSILON = 0.0000001;

type Props = {
  report: ReportPayload;
  currency?: string;
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

export default function PostGameReport({
  report,
  currency = "USD",
  onClose,
  onReset,
}: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [shareMessage, setShareMessage] = useState<string>();
  const m = report.metrics;
  const closedTradeCount =
    report.closedTradeCount ?? report.tradeOutcomes?.length ?? report.totalTrades;
  const verdict = verdictFor(m.excessReturn, closedTradeCount);
  const rights = buildRights(report, closedTradeCount);
  const watchItems = buildWatchItems(report, closedTradeCount, currency);
  const summary = useMemo(
    () => reportSummary(report, closedTradeCount, currency),
    [closedTradeCount, currency, report],
  );

  useEffect(() => {
    const priorFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      priorFocus?.focus();
    };
  }, [onClose]);

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setShareMessage("Report summary copied.");
    } catch {
      setShareMessage("Clipboard access is unavailable in this browser.");
    }
  };

  const downloadReport = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${report.scenarioId}-report.json`;
    link.click();
    URL.revokeObjectURL(url);
    setShareMessage("Report file exported.");
  };

  return (
    <div className="report-overlay">
      <div
        className="report-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        aria-describedby="report-description"
        ref={dialogRef}
      >
        <div className="report-head">
          <div>
            <div className="report-eyebrow">Decision-quality review</div>
            <h2 id="report-title">{report.scenarioTitle}</h2>
            <p id="report-description">
              Benchmark comparison, risk, execution, and behavior after the
              replay ended.
            </p>
          </div>
          <div className="report-head-actions">
            <button className="btn" type="button" onClick={copySummary}>
              Copy summary
            </button>
            <button className="btn" type="button" onClick={downloadReport}>
              Export JSON
            </button>
            <button
              className="btn"
              type="button"
              onClick={onClose}
              aria-label="Close report"
              ref={closeRef}
            >
              Close
            </button>
          </div>
        </div>
        {shareMessage ? (
          <div className="report-share-message" role="status">
            {shareMessage}
          </div>
        ) : null}

        <div className="verdict">
          <span className={`verdict-badge ${verdict.tone}`}>
            {verdict.label}
          </span>
          <p>{verdict.text}</p>
        </div>

        <section className="report-summary" aria-label="Performance summary">
          <ReportStat
            label="Your return"
            value={signedPct(m.totalReturn)}
            tone={toneFor(m.totalReturn)}
            sub={formatCurrency(m.finalEquity - m.initialEquity, currency)}
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

        {report.score ? <ScoreSection score={report.score} /> : null}

        <EquityCurve points={report.equityCurve} />
        <DrawdownCurve points={report.equityCurve} />

        <section className="report-section report-two-column">
          <NarrativeSection
            title="What you got right"
            items={rights}
            tone="good"
            empty="Nothing notable crossed the positive-signal threshold in this run."
          />
          <NarrativeSection
            title="What to watch"
            items={watchItems}
            tone="warn"
            empty="No major behavioral pattern crossed the detector thresholds."
          />
        </section>

        <section className="report-section split">
          <DecisionCard
            title="Best decision"
            trade={report.bestTrade}
            replay={decisionReplayFor(report, report.bestTrade)}
            currency={currency}
            positive
          />
          <DecisionCard
            title="Worst decision"
            trade={report.worstTrade}
            replay={decisionReplayFor(report, report.worstTrade)}
            currency={currency}
          />
        </section>

        <section className="report-section">
          <h3>By the numbers</h3>
          <div className="numbers-grid">
            <NumberCell label="Closed trades" value={`${closedTradeCount}`} />
            <NumberCell
              label="Executions"
              value={`${report.executionQuality?.totalFills ?? report.fills?.length ?? report.totalTrades}`}
            />
            <NumberCell
              label="Win rate"
              value={closedTradeCount > 0 ? formatPct(m.winRate) : "—"}
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
              value={formatCurrency(m.feesPaid, currency)}
            />
            <NumberCell
              label="Slippage"
              value={formatCurrency(m.slippagePaid, currency)}
            />
            <NumberCell label="Exposure time" value={formatPct(m.exposureTime)} />
            <NumberCell
              label="Sharpe"
              value={m.sharpe !== undefined ? formatNumber(m.sharpe, 2) : "—"}
            />
            <NumberCell
              label="Sortino"
              value={m.sortino !== undefined ? formatNumber(m.sortino, 2) : "—"}
            />
          </div>
        </section>

        {report.journalQuality || report.decisionConsistency ? (
          <section className="report-section report-two-column assessment-grid">
            {report.journalQuality ? (
              <JournalQualityCard summary={report.journalQuality} />
            ) : null}
            {report.decisionConsistency ? (
              <DecisionConsistencyCard summary={report.decisionConsistency} />
            ) : null}
          </section>
        ) : null}

        {report.attribution ? (
          <section className="report-section">
            <h3>Performance attribution</h3>
            <div className="numbers-grid attribution-grid">
              <NumberCell
                label="Realized trade P/L"
                value={formatCurrency(report.attribution.realizedTradePnl, currency)}
              />
              <NumberCell
                label="Open and residual P/L"
                value={formatCurrency(
                  report.attribution.unrealizedAndResidualPnl,
                  currency,
                )}
              />
              <NumberCell
                label="Fees"
                value={formatCurrency(report.attribution.feesPaid, currency)}
              />
              <NumberCell
                label="Slippage"
                value={formatCurrency(report.attribution.slippagePaid, currency)}
              />
              <NumberCell
                label="Financing"
                value={formatCurrency(report.attribution.financingPaid, currency)}
              />
              <NumberCell
                label="Active P/L vs benchmark"
                value={formatCurrency(report.attribution.activePnl, currency)}
              />
            </div>
          </section>
        ) : null}

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
                value={formatCurrency(
                  report.executionQuality.borrowCostPaid,
                  currency,
                )}
              />
              <NumberCell
                label="Avg participation"
                value={
                  report.executionQuality.averageLiquidityParticipation !==
                  undefined
                    ? formatPct(
                        report.executionQuality.averageLiquidityParticipation,
                      )
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

        <section className="report-section">
          <h3>Next-replay recommendations</h3>
          {report.recommendations && report.recommendations.length > 0 ? (
            <div className="recommendation-list">
              {report.recommendations.map((recommendation) => (
                <article className="recommendation-card" key={recommendation.id}>
                  <div className="recommendation-head">
                    <span>Priority {recommendation.priority}</span>
                    <h4>{recommendation.title}</h4>
                  </div>
                  <p>{recommendation.rationale}</p>
                  <small>
                    <strong>Evidence:</strong> {recommendation.evidence}
                  </small>
                  <div className="recommendation-practice">
                    <strong>Practice next</strong>
                    <span>{recommendation.suggestedPractice}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              No tailored practice recommendation was generated for this run.
            </div>
          )}
        </section>

        {report.provenance ? (
          <ProvenanceSection provenance={report.provenance} />
        ) : null}

        <div className="report-foot">
          <p>
            History rhymes; it does not repeat. Replay with another broker model
            or thesis to test how robust the reasoning is.
          </p>
          <div>
            <button className="btn" type="button" onClick={onClose}>
              Return to lab
            </button>
            <button className="btn primary" type="button" onClick={onReset}>
              Replay scenario
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function verdictFor(excessReturn: number, closedTradeCount: number) {
  if (closedTradeCount === 0) {
    return {
      label: "Spectator",
      tone: "neutral",
      text:
        "You watched the scenario unfold without completing a trade. That is still a decision, and the benchmark shows what passive exposure would have done.",
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

function buildRights(report: ReportPayload, closedTradeCount: number): string[] {
  const rights: string[] = [];
  const m = report.metrics;
  if (closedTradeCount > 0 && m.excessReturn > 0) {
    rights.push(
      `Active decisions added ${signedPct(m.excessReturn)} over the benchmark.`,
    );
  }
  if (m.maxDrawdown <= 0.08 && closedTradeCount > 0) {
    rights.push("Drawdown stayed under 8%, suggesting position sizing was controlled.");
  }
  if (m.winRate > 0.5 && closedTradeCount > 1) {
    rights.push(`Win rate reached ${formatPct(m.winRate)} across closed trades.`);
  }
  if (report.behavioralFlags.length === 0 && closedTradeCount > 0) {
    rights.push("No major behavioral detector crossed its threshold.");
  }
  return rights;
}

function buildWatchItems(
  report: ReportPayload,
  closedTradeCount: number,
  currency: string,
): string[] {
  const items = report.behavioralFlags.slice(0, 4).map((flag) => {
    const impact =
      flag.estimatedImpact !== undefined
        ? ` Estimated impact: ${formatCurrency(flag.estimatedImpact, currency)}.`
        : "";
    return `${behaviorLabel(flag.type)}: ${flag.evidence}${impact}`;
  });
  if (closedTradeCount > 0 && report.metrics.excessReturn < 0) {
    items.push(
      `Trading trailed the benchmark by ${signedPct(report.metrics.excessReturn)}.`,
    );
  }
  if (closedTradeCount === 0) {
    items.push(
      "No trades were completed, so the report cannot evaluate round-trip execution behavior.",
    );
  }
  return items;
}

function reportSummary(
  report: ReportPayload,
  closedTradeCount: number,
  currency: string,
): string {
  const m = report.metrics;
  return [
    report.scenarioTitle,
    `Return: ${signedPct(m.totalReturn)}`,
    `Benchmark: ${signedPct(m.benchmarkReturn)}`,
    `Alpha: ${signedPct(m.excessReturn)}`,
    `Max drawdown: ${formatPct(m.maxDrawdown)}`,
    `Closed trades: ${closedTradeCount}`,
    `Final equity: ${formatCurrency(m.finalEquity, currency)}`,
    ...(report.score?.overall !== undefined
      ? [`Decision quality score: ${formatNumber(report.score.overall, 0)}/100`]
      : []),
  ].join("\n");
}

function decisionReplayFor(
  report: ReportPayload,
  trade: TradeOutcome | undefined,
): DecisionReplayPoint | undefined {
  if (!trade) return undefined;
  return report.decisionReplay?.find(
    (point) => point.fill.id === trade.fill.id,
  );
}

function ScoreSection({
  score,
}: {
  score: NonNullable<ReportPayload["score"]>;
}) {
  return (
    <section className="report-section score-section">
      <div className="score-head">
        <div>
          <h3>Decision quality score</h3>
          <p>{score.methodology}</p>
        </div>
        <div className={`score-overall ${score.status}`}>
          <strong>
            {score.overall !== undefined
              ? `${formatNumber(score.overall, 0)}/100`
              : "Not scored"}
          </strong>
          <span>{statusLabel(score.status)}</span>
        </div>
      </div>
      {score.reason ? <div className="score-reason">{score.reason}</div> : null}
      <div className="score-components">
        {score.components.map((component) => (
          <article className="score-component" key={component.id}>
            <div className="score-component-head">
              <strong>{component.label}</strong>
              <span>
                {formatPct(component.weight)} weight ·{" "}
                {component.score !== undefined
                  ? `${formatNumber(component.score, 0)}/100`
                  : "N/A"}
              </span>
            </div>
            <div
              className="score-meter"
              role="meter"
              aria-label={`${component.label} score`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={component.score}
              aria-valuetext={
                component.score !== undefined
                  ? `${formatNumber(component.score, 0)} out of 100`
                  : "Not applicable"
              }
            >
              <span style={{ width: `${component.score ?? 0}%` }} />
            </div>
            <p>{component.evidence}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function JournalQualityCard({
  summary,
}: {
  summary: NonNullable<ReportPayload["journalQuality"]>;
}) {
  return (
    <article className="assessment-card">
      <AssessmentHead
        title="Journal quality"
        status={summary.status}
        score={summary.score}
      />
      <div className="assessment-metrics">
        <NumberCell
          label="Decision coverage"
          value={formatPct(summary.coverageRate)}
        />
        <NumberCell label="Reason stated" value={formatPct(summary.reasonRate)} />
        <NumberCell label="Risk plan stated" value={formatPct(summary.riskPlanRate)} />
        <NumberCell
          label="Linked decisions"
          value={`${summary.linkedEntryCount}/${summary.executedDecisionCount}`}
        />
      </div>
      <EvidenceList evidence={summary.evidence} />
    </article>
  );
}

function DecisionConsistencyCard({
  summary,
}: {
  summary: NonNullable<ReportPayload["decisionConsistency"]>;
}) {
  return (
    <article className="assessment-card">
      <AssessmentHead
        title="Decision consistency"
        status={summary.status}
        score={summary.score}
      />
      <div className="assessment-metrics">
        <NumberCell
          label="Assessed decisions"
          value={`${summary.assessedDecisionCount}`}
        />
        <NumberCell
          label="Behavioral flags"
          value={`${summary.behavioralFlagCount}`}
        />
        <NumberCell
          label="Severe flags"
          value={`${summary.severeBehavioralFlagCount}`}
        />
        <NumberCell
          label="Forced liquidations"
          value={`${summary.forcedLiquidationCount}`}
        />
      </div>
      <EvidenceList evidence={summary.evidence} />
    </article>
  );
}

function AssessmentHead({
  title,
  status,
  score,
}: {
  title: string;
  status: string;
  score?: number;
}) {
  return (
    <div className="assessment-head">
      <div>
        <h3>{title}</h3>
        <span>{statusLabel(status)}</span>
      </div>
      <strong>{score !== undefined ? `${formatNumber(score, 0)}/100` : "N/A"}</strong>
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: string[] }) {
  if (evidence.length === 0) return null;
  return (
    <ul className="assessment-evidence">
      {evidence.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function ProvenanceSection({
  provenance,
}: {
  provenance: NonNullable<ReportPayload["provenance"]>;
}) {
  const details = [
    ["License", provenance.license],
    ["Data version", provenance.dataVersion],
    ["Price adjustment", provenance.priceAdjustment?.replaceAll("_", " ")],
    ["Market calendar", provenance.marketCalendarId],
    ["Generated", provenance.generatedAt ? dateTimeLabel(provenance.generatedAt) : undefined],
    ["Dataset", provenance.isSampleData ? "Sample data" : "Production dataset"],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <section className="report-section provenance-section">
      <h3>Data provenance</h3>
      <div className="provenance-grid">
        {details.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="provenance-sources">
        <div>
          <strong>Data sources</strong>
          <ul>
            {provenance.dataSources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        </div>
        {provenance.sourceManifest && provenance.sourceManifest.length > 0 ? (
          <div>
            <strong>Source manifest</strong>
            <ul>
              {provenance.sourceManifest.map((source) => (
                <li key={source}>{source}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function statusLabel(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function dateTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

function NarrativeSection({
  title,
  items,
  tone,
  empty,
}: {
  title: string;
  items: string[];
  tone: "good" | "warn";
  empty: string;
}) {
  return (
    <div className="narrative-column">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <div className="empty-state">{empty}</div>
      ) : (
        <ul className="narrative-list">
          {items.map((item) => (
            <li className={tone} key={item}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
      .map(
        (point, index) =>
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

function DrawdownCurve({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) return null;
  let peak = points[0].portfolioValue;
  const drawdowns = points.map((point) => {
    peak = Math.max(peak, point.portfolioValue);
    return peak > 0 ? point.portfolioValue / peak - 1 : 0;
  });
  const width = 720;
  const height = 80;
  const pad = 8;
  const min = Math.min(...drawdowns, -ZERO_EPSILON);
  const x = (index: number) =>
    pad + (index / (drawdowns.length - 1)) * (width - pad * 2);
  const y = (value: number) =>
    pad + ((0 - value) / (0 - min)) * (height - pad * 2);
  const path = drawdowns
    .map(
      (value, index) =>
        `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`,
    )
    .join(" ");
  return (
    <section className="equity-wrap drawdown-wrap">
      <div className="equity-head">
        <span>Drawdown path</span>
        <span>Peak-relative portfolio decline</span>
      </div>
      <svg
        className="drawdown-svg"
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Portfolio drawdown over the replay"
      >
        <path d={`${path} L${x(drawdowns.length - 1)} ${pad} L${pad} ${pad} Z`} fill="rgba(242, 106, 111, 0.12)" />
        <path d={path} fill="none" stroke="var(--neg)" strokeWidth="1.7" />
      </svg>
    </section>
  );
}

function DecisionCard({
  title,
  trade,
  replay,
  currency,
  positive,
}: {
  title: string;
  trade?: TradeOutcome;
  replay?: DecisionReplayPoint;
  currency: string;
  positive?: boolean;
}) {
  return (
    <div className="decision-card">
      <h3>{title}</h3>
      {trade ? (
        <>
          <span className="decision-meta">
            {trade.fill.side} {formatNumber(trade.fill.quantity, 6)}{" "}
            {trade.fill.symbol} at {formatCurrency(trade.fill.price, currency)}
          </span>
          <strong className={toneFor(trade.realizedPnl)}>
            {formatCurrency(trade.realizedPnl, currency)}
          </strong>
          <p>
            {positive
              ? "This closed trade contributed positively to the session."
              : "This closed trade was the largest realized drag in the session."}
          </p>
          {replay?.journalEntry ? (
            <blockquote>{replay.journalEntry.note}</blockquote>
          ) : null}
          {replay?.auditEvents.slice(-2).map((event) => (
            <small className="decision-context" key={event.id}>
              {event.message}
            </small>
          ))}
        </>
      ) : (
        <div className="empty-state">
          {positive ? "No closed winner." : "No closed loser."}
        </div>
      )}
    </div>
  );
}

function NumberCell({ label, value }: { label: string; value: string }) {
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
