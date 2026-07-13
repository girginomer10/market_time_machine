import type { CompletedRun } from "../../domain/history/runHistory";
import {
  compareRunWithPrevious,
  runHistoryStats,
} from "../../domain/history/runHistory";
import { formatPct } from "../../utils/format";
import { scenarioModeLabel } from "../../utils/scenarioMode";
import "./runHistory.css";

type Props = {
  runs: CompletedRun[];
  onViewReport: (run: CompletedRun) => void;
  onReplay: (run: CompletedRun) => void;
  onRemove: (run: CompletedRun) => void;
  onExport: () => void;
  onClear: () => void;
};

function scoreLabel(run: CompletedRun): string {
  if (run.scoreStatus === "insufficient_evidence") return "Not scored";
  if (run.score === undefined) return "Score unavailable";
  return `${Math.round(run.score)} / 100`;
}

function signedPct(value: number): string {
  const formatted = formatPct(value);
  if (formatted === "—" || value === 0) return formatted;
  return value > 0 ? `+${formatted}` : formatted;
}

export default function RunHistory({
  runs,
  onViewReport,
  onReplay,
  onRemove,
  onExport,
  onClear,
}: Props) {
  const stats = runHistoryStats(runs);

  return (
    <section className="run-history" aria-labelledby="run-history-title">
      <div className="run-history-heading">
        <div>
          <span className="run-history-eyebrow">Your local progress</span>
          <h2 id="run-history-title">Completed replays</h2>
        </div>
        <div className="run-history-heading-side">
          <div className="run-history-stats" aria-label="Replay progress summary">
            <span><strong>{stats.completedRuns}</strong> runs</span>
            <span><strong>{stats.scenariosCompleted}</strong> scenarios</span>
            <span><strong>{stats.journaledRuns}</strong> journaled</span>
            <span>
              <strong>{stats.bestScore !== undefined ? Math.round(stats.bestScore) : "—"}</strong>
              best score
            </span>
          </div>
          {runs.length > 0 ? (
            <div className="run-history-library-actions">
              <button className="btn" type="button" onClick={onExport}>
                Export history
              </button>
              <button className="btn danger" type="button" onClick={onClear}>
                Clear history
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="run-history-empty">
          <strong>Your first completed replay will appear here.</strong>
          <p>
            Finish a scenario to preserve its score, benchmark comparison, and
            decision review on this device.
          </p>
        </div>
      ) : (
        <div className="run-history-list">
          {runs.map((run) => {
            const comparison = compareRunWithPrevious(run, runs);
            return (
              <article className="run-history-card" key={run.id}>
                <div className="run-history-card-main">
                  <span className="run-history-date">
                    {new Date(run.completedAt).toLocaleDateString("en-US", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  <h3>{run.scenarioTitle}</h3>
                  <p>
                    {scenarioModeLabel(run.mode)} · {run.brokerMode} broker · {run.executionCount}{" "}
                    executions · {run.journalEntryCount} journal entries
                  </p>
                  {run.sampleData ? <span className="run-history-sample">Demo data</span> : null}
                </div>
                <div className="run-history-metrics">
                  <span><small>Score</small><strong>{scoreLabel(run)}</strong></span>
                  <span><small>Return</small><strong>{signedPct(run.totalReturn)}</strong></span>
                  <span><small>Alpha</small><strong>{signedPct(run.excessReturn)}</strong></span>
                  <span><small>Max drawdown</small><strong>{formatPct(run.maxDrawdown)}</strong></span>
                </div>
                {comparison.previous ? (
                  <p className="run-history-comparison">
                    Versus your prior attempt: return {signedPct(comparison.returnDelta ?? 0)}
                    {comparison.scoreDelta !== undefined
                      ? ` · score ${comparison.scoreDelta >= 0 ? "+" : ""}${Math.round(comparison.scoreDelta)}`
                      : ""}
                  </p>
                ) : null}
                <div className="run-history-actions">
                  <button className="btn" type="button" onClick={() => onViewReport(run)}>
                    View report
                  </button>
                  <button className="btn primary" type="button" onClick={() => onReplay(run)}>
                    Replay
                  </button>
                  <button className="btn danger" type="button" onClick={() => onRemove(run)}>
                    Remove
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
