import { useRef, type ChangeEvent } from "react";
import type { CompletedRun } from "../../domain/history/runHistory";
import {
  compareRunWithPrevious,
  runHistoryStats,
} from "../../domain/history/runHistory";
import { authoritativeCompletedPracticeAssessmentScore } from "../../domain/practice/assessmentAuthority";
import { formatPct } from "../../utils/format";
import { scenarioModeLabel } from "../../utils/scenarioMode";
import "./runHistory.css";

type Props = {
  runs: CompletedRun[];
  hasArchiveData?: boolean;
  archiveDamaged?: boolean;
  archiveBusy?: boolean;
  onViewReport: (run: CompletedRun) => void;
  onReplay: (run: CompletedRun) => void;
  onRemove: (run: CompletedRun) => void;
  onExport: () => void;
  onExportDamaged?: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  importMessage?: string;
  onClear: () => void;
  onDiscardDamaged?: () => void;
};

function scoreLabel(run: CompletedRun): string {
  const processScore = authoritativeCompletedPracticeAssessmentScore(
    run.report,
    run.executionCount,
  );
  if (processScore === undefined) return "Not assessed";
  return `${Math.round(processScore)} / 100`;
}

function signedPct(value: number): string {
  const formatted = formatPct(value);
  if (formatted === "—" || value === 0) return formatted;
  return value > 0 ? `+${formatted}` : formatted;
}

function completedAtLabel(run: CompletedRun): string {
  return new Date(run.completedAt).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function RunHistory({
  runs,
  hasArchiveData = runs.length > 0,
  archiveDamaged = false,
  archiveBusy = false,
  onViewReport,
  onReplay,
  onRemove,
  onExport,
  onExportDamaged,
  onImport,
  importMessage,
  onClear,
  onDiscardDamaged,
}: Props) {
  const stats = runHistoryStats(runs);
  const importRef = useRef<HTMLInputElement | null>(null);

  return (
    <section
      className="run-history"
      aria-busy={archiveBusy || undefined}
      aria-labelledby="run-history-title"
    >
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
              <strong>
                {
                  runs.filter(
                    (run) =>
                      authoritativeCompletedPracticeAssessmentScore(
                        run.report,
                        run.executionCount,
                      ) !== undefined,
                  ).length
                }
              </strong>
              drill assessed
            </span>
          </div>
          <div className="run-history-library-actions">
            {hasArchiveData && !archiveDamaged ? (
              <button
                className="btn"
                type="button"
                disabled={archiveBusy}
                onClick={onExport}
              >
                Export practice archive
              </button>
            ) : null}
            <button
              className="btn"
              type="button"
              disabled={archiveDamaged || archiveBusy}
              onClick={() => importRef.current?.click()}
            >
              Import practice archive
            </button>
            {hasArchiveData && !archiveDamaged ? (
              <button
                className="btn danger"
                type="button"
                disabled={archiveBusy}
                onClick={onClear}
              >
                Clear history
              </button>
            ) : null}
          </div>
          <input
            className="visually-hidden"
            ref={importRef}
            type="file"
            accept=".json,application/json"
            aria-label="Import practice archive JSON"
            disabled={archiveDamaged || archiveBusy}
            onChange={onImport}
          />
          {archiveBusy ? (
            <p className="run-history-import-message" role="status">
              Finishing the latest replay save. Archive actions will return
              when it is safely stored.
            </p>
          ) : null}
          {importMessage ? (
            <p className="run-history-import-message" role="status">
              {importMessage}
            </p>
          ) : null}
        </div>
      </div>

      {archiveDamaged ? (
        <div className="run-history-damaged" role="alert">
          <div>
            <strong>Local practice history needs recovery.</strong>
            <p>
              The stored archive is unreadable. It was left unchanged, but new
              replay saves and archive imports are blocked until you remove it.
            </p>
          </div>
          <div className="run-history-damaged-actions">
            {onExportDamaged ? (
              <button
                className="btn"
                type="button"
                disabled={archiveBusy}
                onClick={onExportDamaged}
              >
                Download damaged data
              </button>
            ) : null}
            {onDiscardDamaged ? (
              <button
                className="btn danger"
                type="button"
                disabled={archiveBusy}
                onClick={onDiscardDamaged}
              >
                Remove damaged history
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {runs.length === 0 ? (
        <div className="run-history-empty">
          {hasArchiveData ? (
            <>
              <strong>No full replay reports are stored.</strong>
              <p>
                Compact practice evidence remains available in your evidence
                profile and practice archive.
              </p>
            </>
          ) : (
            <>
              <strong>Your first completed replay will appear here.</strong>
              <p>
                Finish a scenario to preserve its score, benchmark comparison,
                and decision review on this device.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="run-history-list">
          {runs.map((run) => {
            const comparison = compareRunWithPrevious(run, runs);
            const completedAt = completedAtLabel(run);
            const accessibleRunLabel = `${run.scenarioTitle}, ${completedAt}`;
            return (
              <article className="run-history-card" key={run.id}>
                <div className="run-history-card-main">
                  <span className="run-history-date">{completedAt}</span>
                  <h3>{run.scenarioTitle}</h3>
                  <p>
                    {scenarioModeLabel(run.mode)} · {run.brokerMode} broker · {run.executionCount}{" "}
                    executions · {run.journalEntryCount} journal entries
                  </p>
                  {run.sampleData ? <span className="run-history-sample">Demo data</span> : null}
                </div>
                <div className="run-history-metrics">
                  <span><small>Process</small><strong>{scoreLabel(run)}</strong></span>
                  <span><small>Return</small><strong>{signedPct(run.totalReturn)}</strong></span>
                  <span><small>Alpha</small><strong>{signedPct(run.excessReturn)}</strong></span>
                  <span><small>Max drawdown</small><strong>{formatPct(run.maxDrawdown)}</strong></span>
                </div>
                {comparison.previous ? (
                  <p className="run-history-comparison">
                    Versus your prior attempt: return {signedPct(comparison.returnDelta ?? 0)}
                  </p>
                ) : null}
                <div className="run-history-actions">
                  <button
                    aria-label={`View report for ${accessibleRunLabel}`}
                    className="btn"
                    type="button"
                    onClick={() => onViewReport(run)}
                  >
                    View report
                  </button>
                  <button
                    aria-label={`Replay ${accessibleRunLabel}`}
                    className="btn primary"
                    type="button"
                    onClick={() => onReplay(run)}
                  >
                    Replay
                  </button>
                  <button
                    aria-label={`Remove ${accessibleRunLabel}`}
                    className="btn danger"
                    type="button"
                    disabled={archiveBusy}
                    onClick={() => onRemove(run)}
                  >
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
