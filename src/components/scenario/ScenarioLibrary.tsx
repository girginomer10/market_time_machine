import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { replayTimeline } from "../../domain/replay/engine";
import type {
  ReplayStatus,
  ScenarioMode,
  ScenarioPackage,
} from "../../types";
import { formatCurrency, formatNumber } from "../../utils/format";
import {
  scenarioModeDescription,
  scenarioModeLabel,
} from "../../utils/scenarioMode";

type Props = {
  scenarios: ScenarioPackage[];
  activeScenario: ScenarioPackage;
  activeMode: ScenarioMode;
  activeStatus: ReplayStatus;
  activeProgressPct: number;
  hasActiveSession: boolean;
  hideActiveIdentity?: boolean;
  history?: ReactNode;
  sessionMessage?: string;
  scenarioMessage?: string;
  scenarioMessageKind?: "status" | "error";
  userScenarioIds: string[];
  onContinue: () => void;
  onStart: (scenarioId: string, mode: ScenarioMode) => void;
  onClose?: () => void;
  onExport: () => void;
  onRestore: (event: ChangeEvent<HTMLInputElement>) => void;
  onImportScenario: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveScenario: (scenarioId: string, title: string) => void;
  onClearSavedSession: () => void;
};

export default function ScenarioLibrary({
  scenarios,
  activeScenario,
  activeMode,
  activeStatus,
  activeProgressPct,
  hasActiveSession,
  hideActiveIdentity = false,
  history,
  sessionMessage,
  scenarioMessage,
  scenarioMessageKind = "status",
  userScenarioIds,
  onContinue,
  onStart,
  onClose,
  onExport,
  onRestore,
  onImportScenario,
  onRemoveScenario,
  onClearSavedSession,
}: Props) {
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    activeScenario.meta.id,
  );
  const [selectedMode, setSelectedMode] = useState<ScenarioMode>(
    supportedMode(activeScenario, activeMode),
  );
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const scenarioInputRef = useRef<HTMLInputElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const userScenarioIdSet = useMemo(
    () => new Set(userScenarioIds),
    [userScenarioIds],
  );

  useEffect(() => {
    setSelectedScenarioId(activeScenario.meta.id);
    setSelectedMode(supportedMode(activeScenario, activeMode));
  }, [activeMode, activeScenario]);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const selectedScenario = useMemo(
    () =>
      scenarios.find((candidate) => candidate.meta.id === selectedScenarioId) ??
      scenarios[0] ??
      activeScenario,
    [activeScenario, scenarios, selectedScenarioId],
  );

  function chooseScenario(candidate: ScenarioPackage): void {
    setSelectedScenarioId(candidate.meta.id);
    setSelectedMode(supportedMode(candidate, selectedMode));
  }

  const activeTitle = hideActiveIdentity
    ? activeMode === "blind"
      ? "Blind replay in progress"
      : "Local challenge in progress"
    : activeScenario.meta.title;
  const activeProgressLabel =
    activeStatus === "finished"
      ? "Replay complete · report ready"
      : hideActiveIdentity
        ? "Ending and progress stay hidden in this mode"
        : `${formatNumber(activeProgressPct, 0)}% complete · ${scenarioModeLabel(activeMode)} mode`;

  return (
    <div className="library-shell">
      <header className="library-topbar">
        <div className="library-brand" aria-label="Market Time Machine">
          <span className="library-brand-mark" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 22 22" fill="none">
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
          </span>
          <span>
            <strong>Market Time Machine</strong>
            <small>Local Financial History Lab</small>
          </span>
        </div>
        {onClose ? (
          <button className="btn" type="button" onClick={onClose}>
            Back to lab
          </button>
        ) : null}
      </header>

      <main className="library-main">
        <section className="library-hero" aria-labelledby="library-title">
          <div className="library-eyebrow">Decision practice without hindsight</div>
          <h1 id="library-title" ref={titleRef} tabIndex={-1}>
            Enter the market before you know the ending.
          </h1>
          <p>
            Choose a historical lab, set the learning mode, and make every
            decision using only the information available at that replay time.
          </p>
          <div className="library-trust-grid" aria-label="Product boundaries">
            <article>
              <strong>Local and private</strong>
              <span>
                Replay state stays in this browser unless you export it. There
                is no account or cloud sync.
              </span>
            </article>
            <article>
              <strong>Education only</strong>
              <span>
                Orders are simulated. Nothing here places a real trade or
                provides investment advice.
              </span>
            </article>
            <article>
              <strong>Data fidelity is explicit</strong>
              <span>
                Demo scenarios identify synthetic prices before you start; data
                sources remain visible in the final report.
              </span>
            </article>
          </div>
        </section>

        {hasActiveSession ? (
          <section className="continue-card" aria-labelledby="continue-title">
            <div>
              <span className="continue-kicker">Saved on this device</span>
              <h2 id="continue-title">{activeTitle}</h2>
              <p>{activeProgressLabel}</p>
            </div>
            <button className="btn primary" type="button" onClick={onContinue}>
              {activeStatus === "finished"
                ? "View completed report"
                : "Continue active replay"}
            </button>
          </section>
        ) : null}

        {history ? <div className="library-history-card">{history}</div> : null}

        <section className="library-section" aria-labelledby="scenario-list-title">
          <div className="library-section-head">
            <div>
              <span className="library-step">Step 1</span>
              <h2 id="scenario-list-title">Choose a historical lab</h2>
            </div>
            <p>
              Start with the market and learning objective you want to practice.
            </p>
          </div>
          <div className="scenario-library-grid">
            {scenarios.map((candidate) => (
              <ScenarioCard
                key={candidate.meta.id}
                scenario={candidate}
                selected={candidate.meta.id === selectedScenario.meta.id}
                onChoose={() => chooseScenario(candidate)}
                onRemove={
                  userScenarioIdSet.has(candidate.meta.id)
                    ? () =>
                        onRemoveScenario(candidate.meta.id, candidate.meta.title)
                    : undefined
                }
              />
            ))}
          </div>
          <div className="scenario-import-row">
            <div>
              <strong>Add your own scenario</strong>
              <span>
                Import a Market Time Machine scenario package JSON (up to 25
                MB), not a session backup. It stays in this browser and never
                replaces a bundled lab.
              </span>
            </div>
            <button
              className="btn"
              type="button"
              onClick={() => scenarioInputRef.current?.click()}
            >
              Import scenario package
            </button>
            <input
              ref={scenarioInputRef}
              className="visually-hidden"
              type="file"
              accept=".json,application/json"
              onChange={onImportScenario}
              aria-label="Import scenario package JSON"
            />
          </div>
          {scenarioMessage ? (
            <p
              className={
                scenarioMessageKind === "error"
                  ? "scenario-import-message error"
                  : "scenario-import-message"
              }
              role={scenarioMessageKind === "error" ? "alert" : "status"}
            >
              {scenarioMessage}
            </p>
          ) : null}
        </section>

        <section className="briefing-card" aria-labelledby="briefing-title">
          <div className="briefing-copy">
            <span className="library-step">Step 2 · Briefing</span>
            <h2 id="briefing-title">{selectedScenario.meta.title}</h2>
            <p>
              {selectedScenario.meta.description ?? selectedScenario.meta.subtitle}
            </p>
            {selectedScenario.meta.mission ? (
              <div className="briefing-mission">
                <strong>Your mission</strong>
                <span>{selectedScenario.meta.mission}</span>
              </div>
            ) : null}
            {selectedScenario.meta.learningObjectives?.length ? (
              <div className="learning-objectives">
                <strong>What you will practice</strong>
                <ul>
                  {selectedScenario.meta.learningObjectives.map((objective) => (
                    <li key={objective}>{objective}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="briefing-facts">
              <Fact
                label="Starting capital"
                value={formatCurrency(
                  selectedScenario.meta.initialCash,
                  selectedScenario.meta.baseCurrency,
                )}
              />
              <Fact
                label="Replay length"
                value={replayLengthLabel(selectedScenario)}
              />
              <Fact
                label="Difficulty"
                value={capitalize(selectedScenario.meta.difficulty)}
              />
              <Fact
                label="Price data"
                value={dataFidelityLabel(selectedScenario)}
              />
            </div>
            <div className="briefing-rules">
              <strong>Scenario broker rules</strong>
              <span>{brokerRulesLabel(selectedScenario)}</span>
            </div>
            {selectedScenario.meta.observedFields?.length ||
            selectedScenario.meta.derivedFields?.length ? (
              <div className="data-fidelity-detail">
                {selectedScenario.meta.observedFields?.length ? (
                  <div>
                    <strong>Observed from source</strong>
                    <ul>
                      {selectedScenario.meta.observedFields.map((field) => (
                        <li key={field}>{field}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {selectedScenario.meta.derivedFields?.length ? (
                  <div>
                    <strong>Derived or unavailable</strong>
                    <ul>
                      {selectedScenario.meta.derivedFields.map((field) => (
                        <li key={field}>{field}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {selectedScenario.meta.isSampleData ? (
              <div className="sample-warning" role="note">
                <strong>Demo price path</strong>
                <span>
                  Prices are deterministic synthetic samples shaped around the
                  documented historical regime. Use this lab to learn the product,
                  not to infer historical execution results.
                </span>
              </div>
            ) : null}
          </div>

          <div className="mode-briefing">
            <span className="library-step">Step 3</span>
            <h3>Choose how much context you want</h3>
            <div
              className="library-mode-grid"
              role="radiogroup"
              aria-label="Learning mode"
            >
              {selectedScenario.meta.supportedModes.map((candidateMode) => (
                <button
                  key={candidateMode}
                  className={
                    candidateMode === selectedMode
                      ? "library-mode active"
                      : "library-mode"
                  }
                  type="button"
                  role="radio"
                  aria-checked={candidateMode === selectedMode}
                  onClick={() => setSelectedMode(candidateMode)}
                >
                  <span>{scenarioModeLabel(candidateMode)}</span>
                  <small>{scenarioModeDescription(candidateMode)}</small>
                </button>
              ))}
            </div>
            <button
              className="btn primary library-start"
              type="button"
              onClick={() => onStart(selectedScenario.meta.id, selectedMode)}
            >
              Start {scenarioModeLabel(selectedMode)} replay
            </button>
            {hasActiveSession ? (
              <p className="start-replacement-note">
                Starting a new replay replaces the active lab only after you
                confirm.
              </p>
            ) : (
              <p className="start-replacement-note">
                The replay stays paused until you press Play.
              </p>
            )}
          </div>
        </section>

        <section className="library-session-tools" aria-labelledby="session-tools-title">
          <div>
            <span className="library-step">Local backup</span>
            <h2 id="session-tools-title">Move a session between browsers</h2>
            <p>
              Export creates a JSON backup. Restore validates a backup before it
              changes the active replay.
            </p>
          </div>
          <div className="library-session-actions">
            <button
              className="btn"
              type="button"
              onClick={onExport}
              disabled={!hasActiveSession}
            >
              Export active session
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => restoreInputRef.current?.click()}
            >
              Restore session file
            </button>
            <button className="btn" type="button" onClick={onClearSavedSession}>
              Clear browser save
            </button>
            <input
              ref={restoreInputRef}
              className="visually-hidden"
              type="file"
              accept=".json,application/json"
              onChange={onRestore}
              aria-label="Restore Market Time Machine session backup"
            />
          </div>
          {sessionMessage ? (
            <p className="session-message library-session-message" role="status">
              {sessionMessage}
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function ScenarioCard({
  scenario,
  selected,
  onChoose,
  onRemove,
}: {
  scenario: ScenarioPackage;
  selected: boolean;
  onChoose: () => void;
  onRemove?: () => void;
}) {
  return (
    <article className={selected ? "scenario-card selected" : "scenario-card"}>
      <div className="scenario-card-head">
        <span>{capitalize(scenario.meta.assetClass)}</span>
        <span>{capitalize(scenario.meta.difficulty)}</span>
      </div>
      <h3>{scenario.meta.title}</h3>
      <p className="scenario-card-subtitle">{scenario.meta.subtitle}</p>
      <div className="scenario-objective">
        <strong>{scenario.meta.mission ? "Mission" : "What you will practice"}</strong>
        <span>
          {scenario.meta.mission ??
            scenario.meta.learningObjectives?.[0] ??
            scenario.meta.description ??
            scenario.meta.subtitle}
        </span>
      </div>
      <dl className="scenario-card-facts">
        <div>
          <dt>Time</dt>
          <dd>{replayLengthLabel(scenario)}</dd>
        </div>
        <div>
          <dt>Capital</dt>
          <dd>
            {formatCurrency(
              scenario.meta.initialCash,
              scenario.meta.baseCurrency,
            )}
          </dd>
        </div>
        <div>
          <dt>Price data</dt>
          <dd>{dataFidelityLabel(scenario)}</dd>
        </div>
      </dl>
      <div className="scenario-broker-summary">
        <strong>Broker</strong>
        <span>{brokerRulesLabel(scenario)}</span>
      </div>
      <div className="scenario-mode-chips" aria-label="Supported modes">
        {scenario.meta.supportedModes.map((mode) => (
          <span key={mode}>{scenarioModeLabel(mode)}</span>
        ))}
      </div>
      <div
        className={
          scenario.meta.isSampleData
            ? "scenario-fidelity-note sample"
            : "scenario-fidelity-note"
        }
      >
        {dataFidelityLabel(scenario)}
      </div>
      <button
        className={selected ? "btn primary" : "btn"}
        type="button"
        onClick={onChoose}
        aria-pressed={selected}
        aria-label={`${selected ? "Selected" : "Choose"} ${scenario.meta.title}`}
      >
        {selected ? "Selected for briefing" : "Choose this lab"}
      </button>
      {onRemove ? (
        <button
          className="btn danger"
          type="button"
          onClick={onRemove}
          aria-label={`Remove imported scenario ${scenario.meta.title}`}
        >
          Remove imported lab
        </button>
      ) : null}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function replayLengthLabel(scenario: ScenarioPackage): string {
  const steps = replayTimeline(scenario).length;
  const minutes =
    scenario.meta.estimatedMinutes ??
    Math.max(8, Math.min(35, Math.ceil(steps / 30)));
  return `${steps} steps · about ${minutes} min`;
}

function dataFidelityLabel(scenario: ScenarioPackage): string {
  const fidelity =
    scenario.meta.dataFidelity ??
    (scenario.meta.isSampleData ? "synthetic" : "observed");
  switch (fidelity) {
    case "observed":
      return "Observed source data";
    case "derived":
      return "Derived source series";
    case "synthetic":
      return scenario.meta.isSampleData
        ? "Synthetic sample prices"
        : "Synthetic series";
    case "mixed":
      return "Observed + derived data";
  }
}

function brokerRulesLabel(scenario: ScenarioPackage): string {
  const broker = scenario.broker;
  const slippage =
    broker.slippageModel === "none"
      ? "no slippage"
      : `${broker.slippageModel.replaceAll("_", " ")} slippage`;
  return [
    `${formatNumber(broker.commissionRateBps, 1)} bps commission`,
    `${formatNumber(broker.spreadBps, 1)} bps spread`,
    slippage,
    broker.allowShort ? "shorting allowed" : "long only",
    `${formatNumber(broker.maxLeverage, 1)}x max leverage`,
  ].join(" · ");
}

function supportedMode(
  scenario: ScenarioPackage,
  preferred: ScenarioMode,
): ScenarioMode {
  return scenario.meta.supportedModes.includes(preferred)
    ? preferred
    : (scenario.meta.supportedModes[0] ?? "explorer");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}
