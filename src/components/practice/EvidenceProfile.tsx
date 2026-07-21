import { useId } from "react";
import type {
  EvidenceConfidence,
  EvidenceTrend,
  PracticeEvidenceClaim,
  PracticeEvidenceProfile,
} from "../../domain/practice/evidenceProfile";
import { rubricContentReference } from "../../domain/practice/evidenceProfile";
import "./evidenceProfile.css";

type Props = {
  profile: PracticeEvidenceProfile;
};

const CONFIDENCE_LABELS: Record<EvidenceConfidence, string> = {
  insufficient_evidence: "Insufficient evidence breadth",
  limited: "Limited evidence breadth",
  growing: "Growing evidence breadth",
  established: "Established evidence breadth",
};

const TREND_LABELS: Record<EvidenceTrend["status"], string> = {
  insufficient_evidence: "Not enough comparable runs",
  improving: "Improving",
  stable: "Stable",
  declining: "Declining",
};

function scoreLabel(score: number | undefined): string {
  return score === undefined ? "Not assessed" : `${Math.round(score * 10) / 10}/100`;
}

function deltaLabel(delta: number | undefined): string | undefined {
  if (delta === undefined) return undefined;
  const rounded = Math.round(delta * 10) / 10;
  return rounded === 0 ? "No change" : `${rounded > 0 ? "+" : ""}${rounded} points`;
}

function coverageLabel(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function ClaimCard({ claim }: { claim: PracticeEvidenceClaim }) {
  const titleId = useId();
  const trendDelta = deltaLabel(claim.trend.delta);
  const comparedRuns = claim.trend.currentRunId && claim.trend.previousRunId;

  return (
    <article className="evidence-claim" aria-labelledby={titleId}>
      <header className="evidence-claim-head">
        <div>
          <span>Process evidence claim</span>
          <h3 id={titleId}>{claim.competencyId}</h3>
        </div>
        <span className={`evidence-claim-state ${claim.status}`}>
          {claim.status === "assessed" ? "Assessed" : "Not assessed"}
        </span>
      </header>

      <dl className="evidence-claim-identity" aria-label="Assessment identity">
        <div>
          <dt>Competency</dt>
          <dd>{claim.competencyId}</dd>
        </div>
        <div>
          <dt>Rubric</dt>
          <dd>{claim.rubricVersion}</dd>
        </div>
        <div>
          <dt>Rubric content</dt>
          <dd title={claim.rubricFingerprint}>
            {rubricContentReference(claim.rubricFingerprint)}
          </dd>
        </div>
      </dl>

      <div className="evidence-claim-summary">
        <div className="evidence-latest-score">
          <span>Latest process score</span>
          <strong>{scoreLabel(claim.latestScore)}</strong>
        </div>
        <dl className="evidence-breadth-counts">
          <div>
            <dt>Assessed evidence</dt>
            <dd>{coverageLabel(claim.evidenceCount, "run")}</dd>
          </div>
          <div>
            <dt>Total attempts</dt>
            <dd>{claim.attemptCount}</dd>
          </div>
          <div>
            <dt>Scenario coverage</dt>
            <dd>{coverageLabel(claim.scenarioCoverage, "scenario")}</dd>
          </div>
          <div>
            <dt>Validated coverage</dt>
            <dd>
              {coverageLabel(
                claim.validatedSourceScenarioCoverage,
                "source-reviewed scenario",
              )}
            </dd>
          </div>
        </dl>
      </div>

      <section className="evidence-scope" aria-label="Evidence scope and provenance">
        <div className="evidence-definition-scope">
          <span>Included drill definitions</span>
          <p>
            {claim.drillDefinitions
              .map(
                ({ drillId, definitionVersion }) =>
                  `${drillId} · definition v${definitionVersion}`,
              )
              .join(", ")}
          </p>
        </div>
        <div>
          <span>Scenarios represented</span>
          <p>
            {claim.scenarioIds.length > 0
              ? claim.scenarioIds.join(", ")
              : "No assessed scenario evidence"}
          </p>
        </div>
        <div>
          <span>Source-reviewed scenarios</span>
          <p>
            {claim.validatedSourceScenarioIds.length > 0
              ? claim.validatedSourceScenarioIds.join(", ")
              : "None validated yet"}
          </p>
        </div>
        <div>
          <span>Data fidelity represented</span>
          <p>
            {claim.dataFidelities.length > 0
              ? claim.dataFidelities.join(", ")
              : "Not available"}
          </p>
        </div>
        <div>
          <span>Synthetic sample evidence</span>
          <p>{coverageLabel(claim.sampleEvidenceCount, "run")}</p>
        </div>
      </section>

      <div className="evidence-confidence-row">
        <div className={`evidence-confidence ${claim.confidence}`}>
          <span>Confidence</span>
          <strong>{CONFIDENCE_LABELS[claim.confidence]}</strong>
        </div>
        <p>
          Confidence describes evidence breadth across assessed runs and
          source-reviewed scenarios. It is not an outcome, skill, or investment
          certainty rating.
        </p>
      </div>

      <section className={`evidence-trend ${claim.trend.status}`}>
        <div className="evidence-trend-head">
          <span>Comparable-run trend</span>
          <strong>{TREND_LABELS[claim.trend.status]}</strong>
          {trendDelta ? <em>{trendDelta}</em> : null}
        </div>
        {comparedRuns ? (
          <dl aria-label="Compared process runs">
            <div>
              <dt>Current run</dt>
              <dd>
                {claim.trend.currentRunId} · {scoreLabel(claim.trend.currentScore)}
              </dd>
            </div>
            <div>
              <dt>Previous run</dt>
              <dd>
                {claim.trend.previousRunId} · {scoreLabel(claim.trend.previousScore)}
              </dd>
            </div>
          </dl>
        ) : (
          <p>
            {claim.trend.currentRunId
              ? `Current assessed run: ${claim.trend.currentRunId}. A second run with the same scenario and data version, mode, exact broker settings, drill id, definition version, and rubric content is required for comparison.`
              : "Two assessed runs with the same scenario and data version, mode, exact broker settings, drill id, definition version, and rubric content are required for comparison."}
          </p>
        )}
      </section>
    </article>
  );
}

export default function EvidenceProfile({ profile }: Props) {
  const titleId = useId();

  return (
    <section className="evidence-profile" aria-labelledby={titleId}>
      <header className="evidence-profile-head">
        <div>
          <span>Practice evidence</span>
          <h2 id={titleId}>Evidence profile</h2>
          <p>
            Competency-level process claims built from drill assessments. Each
            claim keeps its rubric boundary and discloses every included drill
            definition.
          </p>
        </div>
        <dl aria-label="Evidence profile totals">
          <div>
            <dt>Ledger entries</dt>
            <dd>{profile.ledgerEntryCount}</dd>
          </div>
          <div>
            <dt>Assessed evidence</dt>
            <dd>{profile.assessedEntryCount}</dd>
          </div>
        </dl>
      </header>

      {profile.claims.length > 0 ? (
        <div className="evidence-claim-grid">
          {profile.claims.map((claim) => (
            <ClaimCard claim={claim} key={claim.id} />
          ))}
        </div>
      ) : (
        <div className="evidence-profile-empty" role="status">
          <strong>No process evidence yet</strong>
          <p>
            Complete a validated drill to create a versioned evidence claim.
            Free replays and unassessed records do not produce a process score.
          </p>
        </div>
      )}
    </section>
  );
}
