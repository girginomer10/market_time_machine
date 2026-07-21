import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { replayTimeline } from "../../domain/replay/engine";
import type {
  PracticeCoachPlan,
  PracticeCoachStartContext,
} from "../../domain/coaching/practiceCoach";
import { scenarioDataVersionsEqual } from "../../data/scenarios/dataVersions";
import { drillRubricFingerprint } from "../../domain/practice/drills";
import {
  brokerConfigFingerprint,
  getBrokerPreset,
} from "../../domain/broker/executionModels";
import type { PracticeEvidenceProfile } from "../../domain/practice/evidenceProfile";
import type {
  PracticeTrack,
  PracticeTrackProgress,
  PracticeTrackUnit,
} from "../../domain/practice/tracks";
import PracticeCoach from "../coaching/PracticeCoach";
import EvidenceProfile from "../practice/EvidenceProfile";
import PracticeTracks from "../practice/PracticeTracks";
import type {
  DrillDefinition,
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
  activeDrillId?: string;
  hasActiveSession: boolean;
  hideActiveIdentity?: boolean;
  history?: ReactNode;
  practicePlan?: PracticeCoachPlan;
  drills?: DrillDefinition[];
  evidenceProfile?: PracticeEvidenceProfile;
  practiceTracks?: PracticeTrack[];
  practiceTrackProgress?: PracticeTrackProgress[];
  sessionMessage?: string;
  scenarioMessage?: string;
  scenarioMessageKind?: "status" | "error";
  userScenarioIds: string[];
  onContinue: () => void;
  onStart: (
    scenarioId: string,
    mode: ScenarioMode,
    drillId?: string,
    context?: PracticeCoachStartContext,
  ) => void;
  onStartSurprise: (mode: "blind" | "challenge") => void;
  onClose?: () => void;
  onExport: () => void;
  onRestore: (event: ChangeEvent<HTMLInputElement>) => void;
  onImportScenario: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveScenario: (scenarioId: string, title: string) => void;
  onViewPracticeSource?: (runId: string) => void;
  onClearSavedSession: () => void;
};

function brokerFingerprintForTrackContext(
  scenario: ScenarioPackage,
  mode: PracticeTrackUnit["broker"]["mode"],
): string {
  const broker =
    mode === "scenario"
      ? scenario.broker
      : {
          ...getBrokerPreset(mode),
          baseCurrency: scenario.meta.baseCurrency,
        };
  return brokerConfigFingerprint(broker);
}

function trackUnitMatchesSelection(
  unit: PracticeTrackUnit,
  scenario: ScenarioPackage,
  drill: DrillDefinition,
): boolean {
  return (
    unit.scenario.id === scenario.meta.id &&
    scenarioDataVersionsEqual(
      unit.scenario.id,
      unit.scenario.dataVersion,
      scenario.meta.dataVersion,
    ) &&
    unit.scenario.dataFidelity === scenario.meta.dataFidelity &&
    unit.scenario.sampleData === (scenario.meta.isSampleData ?? false) &&
    unit.drill.id === drill.id &&
    unit.drill.definitionVersion === drill.definitionVersion &&
    unit.drill.rubricVersion === drill.rubricVersion &&
    unit.drill.rubricFingerprint === drillRubricFingerprint(drill.rubric) &&
    unit.drill.mode === drill.mode &&
    unit.broker.fingerprint ===
      brokerFingerprintForTrackContext(scenario, unit.broker.mode)
  );
}

export default function ScenarioLibrary({
  scenarios,
  activeScenario,
  activeMode,
  activeStatus,
  activeProgressPct,
  activeDrillId,
  hasActiveSession,
  hideActiveIdentity = false,
  history,
  practicePlan,
  drills = [],
  evidenceProfile,
  practiceTracks = [],
  practiceTrackProgress = [],
  sessionMessage,
  scenarioMessage,
  scenarioMessageKind = "status",
  userScenarioIds,
  onContinue,
  onStart,
  onStartSurprise,
  onClose,
  onExport,
  onRestore,
  onImportScenario,
  onRemoveScenario,
  onViewPracticeSource,
  onClearSavedSession,
}: Props) {
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    activeScenario.meta.id,
  );
  const [selectedMode, setSelectedMode] = useState<ScenarioMode>(
    supportedMode(activeScenario, activeMode),
  );
  const [selectedDrillId, setSelectedDrillId] = useState<string | undefined>(
    activeDrillId,
  );
  const [preparedCoachPlan, setPreparedCoachPlan] =
    useState<PracticeCoachPlan>();
  const [preparedTrackUnit, setPreparedTrackUnit] =
    useState<PracticeTrackUnit>();
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const scenarioInputRef = useRef<HTMLInputElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const briefingTitleRef = useRef<HTMLHeadingElement | null>(null);
  const modeButtonRefs = useRef<
    Partial<Record<ScenarioMode, HTMLButtonElement | null>>
  >({});
  const userScenarioIdSet = useMemo(
    () => new Set(userScenarioIds),
    [userScenarioIds],
  );

  useEffect(() => {
    setSelectedScenarioId(activeScenario.meta.id);
    setSelectedMode(supportedMode(activeScenario, activeMode));
    setSelectedDrillId(
      activeDrillId,
    );
    setPreparedCoachPlan(undefined);
    setPreparedTrackUnit(undefined);
  }, [activeDrillId, activeMode, activeScenario]);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    setPreparedCoachPlan((current) =>
      current && current !== practicePlan ? undefined : current,
    );
  }, [practicePlan]);

  const selectedScenario = useMemo(
    () =>
      scenarios.find((candidate) => candidate.meta.id === selectedScenarioId) ??
      scenarios[0] ??
      activeScenario,
    [activeScenario, scenarios, selectedScenarioId],
  );
  const scenarioDrills = useMemo(
    () =>
      drills.filter(
        (definition) => definition.scenarioId === selectedScenario.meta.id,
      ),
    [drills, selectedScenario.meta.id],
  );
  const selectedDrill = scenarioDrills.find(
    (definition) => definition.id === selectedDrillId,
  );
  const preparedTrackUnitMatches = Boolean(
    selectedDrill &&
      preparedTrackUnit &&
      trackUnitMatchesSelection(
        preparedTrackUnit,
        selectedScenario,
        selectedDrill,
      ),
  );
  const selectedValidatedTrackUnit = selectedDrill
    ? preparedTrackUnitMatches
      ? preparedTrackUnit?.status === "validated"
        ? preparedTrackUnit
        : undefined
      : practiceTracks
          .flatMap((track) => track.units)
          .find(
            (unit) =>
              unit.status === "validated" &&
              unit.broker.mode === "scenario" &&
              trackUnitMatchesSelection(
                unit,
                selectedScenario,
                selectedDrill,
              ),
          )
    : undefined;
  const surpriseModes = (["blind", "challenge"] as const).filter((mode) =>
    scenarios.some((candidate) => candidate.meta.supportedModes.includes(mode)),
  );
  const selectedSampleDisclosure = sampleDataDisclosure(selectedScenario);

  function chooseScenario(candidate: ScenarioPackage): void {
    setSelectedScenarioId(candidate.meta.id);
    setSelectedDrillId(undefined);
    setPreparedCoachPlan(undefined);
    setPreparedTrackUnit(undefined);
    setSelectedMode(supportedMode(candidate, selectedMode));
  }

  function focusBriefing(): void {
    window.requestAnimationFrame(() => {
      briefingTitleRef.current?.focus();
      briefingTitleRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function preparePractice(plan: PracticeCoachPlan): void {
    const candidate = scenarios.find(
      (scenario) => scenario.meta.id === plan.scenarioId,
    );
    if (
      !candidate ||
      !scenarioDataVersionsEqual(
        candidate.meta.id,
        candidate.meta.dataVersion,
        plan.scenarioDataVersion,
      )
    ) {
      return;
    }
    setSelectedScenarioId(candidate.meta.id);
    setSelectedDrillId(plan.drillId);
    setPreparedCoachPlan(plan);
    setPreparedTrackUnit(undefined);
    setSelectedMode(plan.mode);
    focusBriefing();
  }

  function prepareTrackUnit(unit: PracticeTrackUnit): void {
    const candidate = scenarios.find(
      (scenario) => scenario.meta.id === unit.scenario.id,
    );
    const definition = drills.find(
      (drill) =>
        drill.id === unit.drill.id &&
        drill.scenarioId === unit.scenario.id &&
        drill.definitionVersion === unit.drill.definitionVersion &&
        drill.rubricVersion === unit.drill.rubricVersion &&
        drill.mode === unit.drill.mode,
    );
    if (
      !candidate ||
      !definition ||
      !trackUnitMatchesSelection(unit, candidate, definition)
    ) {
      return;
    }
    setSelectedScenarioId(candidate.meta.id);
    setSelectedDrillId(definition.id);
    setSelectedMode(definition.mode);
    setPreparedCoachPlan(undefined);
    setPreparedTrackUnit(unit);
    focusBriefing();
  }

  function startSelectedPractice(): void {
    if (!selectedDrill) {
      onStart(selectedScenario.meta.id, selectedMode);
      return;
    }
    const coachContext =
      preparedCoachPlan &&
      preparedCoachPlan === practicePlan &&
      preparedCoachPlan.scenarioId === selectedScenario.meta.id &&
      preparedCoachPlan.drillId === selectedDrill.id &&
      preparedCoachPlan.mode === selectedDrill.mode
          ? {
            scenarioDataVersion: preparedCoachPlan.scenarioDataVersion,
            brokerMode: preparedCoachPlan.brokerMode,
            brokerFingerprint: preparedCoachPlan.brokerFingerprint,
          }
        : undefined;
    const trackUnitContext =
      preparedTrackUnitMatches && preparedTrackUnit
        ? {
            scenarioDataVersion: preparedTrackUnit.scenario.dataVersion,
            brokerMode: preparedTrackUnit.broker.mode,
            brokerFingerprint: preparedTrackUnit.broker.fingerprint,
          }
        : selectedValidatedTrackUnit
          ? {
              scenarioDataVersion: selectedValidatedTrackUnit.scenario.dataVersion,
              brokerMode: selectedValidatedTrackUnit.broker.mode,
              brokerFingerprint: selectedValidatedTrackUnit.broker.fingerprint,
            }
          : undefined;
    const preparedContext = coachContext ?? trackUnitContext;
    if (preparedContext) {
      onStart(
        selectedScenario.meta.id,
        selectedDrill.mode,
        selectedDrill.id,
        preparedContext,
      );
      return;
    }
    onStart(
      selectedScenario.meta.id,
      selectedDrill.mode,
      selectedDrill.id,
    );
  }

  function handleModeKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentMode: ScenarioMode,
  ): void {
    const modes = selectedDrill
      ? [selectedDrill.mode]
      : selectedScenario.meta.supportedModes;
    const currentIndex = modes.indexOf(currentMode);
    if (currentIndex < 0 || modes.length === 0) return;

    let nextIndex: number | undefined;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (currentIndex + 1) % modes.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (currentIndex - 1 + modes.length) % modes.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = modes.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextMode = modes[nextIndex];
    setSelectedMode(nextMode);
    modeButtonRefs.current[nextMode]?.focus();
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
              <span className="continue-kicker">Active in this browser</span>
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

        {practicePlan ? (
          <PracticeCoach
            plan={practicePlan}
            onPrepare={() => preparePractice(practicePlan)}
            onViewSource={onViewPracticeSource}
          />
        ) : null}

        {evidenceProfile ? <EvidenceProfile profile={evidenceProfile} /> : null}

        {practiceTracks.length > 0 ? (
          <PracticeTracks
            tracks={practiceTracks}
            progress={practiceTrackProgress}
            onPrepareUnit={prepareTrackUnit}
          />
        ) : null}

        {history ? <div className="library-history-card">{history}</div> : null}

        {surpriseModes.length > 0 ? (
          <section
            className="library-section surprise-replay-card"
            aria-labelledby="surprise-replay-title"
          >
            <div className="library-section-head">
              <div>
                <span className="library-step">Surprise self-test</span>
                <h2 id="surprise-replay-title">Start without choosing the lab</h2>
              </div>
              <p>
                The app selects an eligible lab only after you start, so the
                scenario choice itself does not reveal the identity first.
              </p>
            </div>
            <div className="surprise-replay-actions">
              {surpriseModes.map((mode) => (
                <button
                  className="btn primary"
                  type="button"
                  key={mode}
                  onClick={() => onStartSurprise(mode)}
                >
                  Start surprise {scenarioModeLabel(mode)}
                </button>
              ))}
            </div>
            <p className="surprise-replay-boundary" role="note">
              Scenario identity and the ending are masked during the replay, but
              this is a local self-test—not secure anti-cheat. Decision-relevant
              historical time and bundled future data remain inspectable by a
              technical user.
            </p>
          </section>
        ) : null}

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
            <h2 id="briefing-title" ref={briefingTitleRef} tabIndex={-1}>
              {selectedScenario.meta.title}
            </h2>
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
            {selectedSampleDisclosure ? (
              <div className="sample-warning" role="note">
                <strong>{selectedSampleDisclosure.title}</strong>
                <span>{selectedSampleDisclosure.detail}</span>
              </div>
            ) : null}
            {selectedDrill && !selectedValidatedTrackUnit ? (
              <div className="sample-warning" role="note">
                <strong>Preview practice · No completion credit</strong>
                <span>
                  This drill rehearses the guided process, but its exact
                  scenario and definition are not a validated track unit. It
                  cannot award unit or track completion credit
                  {selectedScenario.meta.isSampleData
                    ? "; its market path uses synthetic sample data."
                    : "."}
                </span>
              </div>
            ) : null}
          </div>

          <div className="mode-briefing">
            <span className="library-step">Step 3</span>
            <h3>Choose the practice format</h3>
            <div className="library-practice-options">
              {scenarioDrills.map((definition) => (
                <button
                  className={
                    definition.id === selectedDrill?.id
                      ? "library-practice-option active"
                      : "library-practice-option"
                  }
                  type="button"
                  key={definition.id}
                  aria-pressed={definition.id === selectedDrill?.id}
                  onClick={() => {
                    setSelectedDrillId(definition.id);
                    setPreparedCoachPlan(undefined);
                    setPreparedTrackUnit(undefined);
                    setSelectedMode(definition.mode);
                  }}
                >
                  <strong>{definition.title}</strong>
                  <span>{definition.description}</span>
                  <small>
                    Version {definition.definitionVersion} · rubric {definition.rubricVersion}
                  </small>
                </button>
              ))}
              <button
                className={
                  selectedDrill ? "library-practice-option" : "library-practice-option active"
                }
                type="button"
                aria-pressed={!selectedDrill}
                onClick={() => {
                  setSelectedDrillId(undefined);
                  setPreparedCoachPlan(undefined);
                  setPreparedTrackUnit(undefined);
                }}
              >
                <strong>Free replay</strong>
                <span>
                  Use the simulator without mandatory process checkpoints.
                </span>
                <small>Report evidence only; no drill observation</small>
              </button>
            </div>
            <span className="library-step">Step 4</span>
            <h3>Choose how much context you want</h3>
            <div
              className="library-mode-grid"
              role="radiogroup"
              aria-label="Learning mode"
            >
              {(selectedDrill
                ? [selectedDrill.mode]
                : selectedScenario.meta.supportedModes
              ).map((candidateMode) => (
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
                  tabIndex={candidateMode === selectedMode ? 0 : -1}
                  ref={(element) => {
                    modeButtonRefs.current[candidateMode] = element;
                  }}
                  onClick={() => setSelectedMode(candidateMode)}
                  onKeyDown={(event) =>
                    handleModeKeyDown(event, candidateMode)
                  }
                >
                  <span>{scenarioModeLabel(candidateMode)}</span>
                  <small>{scenarioModeDescription(candidateMode)}</small>
                </button>
              ))}
            </div>
            <button
              className="btn primary library-start"
              type="button"
              onClick={startSelectedPractice}
            >
              {selectedDrill
                ? "Start guided drill"
                : `Start ${scenarioModeLabel(selectedMode)} replay`}
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
            <h2 id="session-tools-title">Back up or restore this replay</h2>
            <p>
              Export creates a version-pinned JSON backup. Restore requires the
              exact same scenario data and drill definition; for an imported lab,
              import its scenario package in the other browser first.
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

function sampleDataDisclosure(
  scenario: ScenarioPackage,
): { title: string; detail: string } | undefined {
  if (!scenario.meta.isSampleData) return undefined;
  if (scenario.meta.dataFidelity === "mixed") {
    return {
      title: "Observed values with derived fields",
      detail:
        "Some values come from the declared source while other replay fields are derived or unavailable. Review the observed and derived field lists above before using the lab.",
    };
  }
  if (scenario.meta.dataFidelity === "derived") {
    return {
      title: "Derived replay series",
      detail:
        "This replay is derived from the declared source rather than a complete observed market path. Review the derivation limits above before interpreting results.",
    };
  }
  return {
    title: "Demo price path",
    detail:
      "Prices are deterministic synthetic samples shaped around the documented historical regime. Use this lab to learn the product, not to infer historical execution results.",
  };
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
