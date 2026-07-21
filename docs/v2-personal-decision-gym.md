# V2 Product Definition: Personal Decision Gym

Status: **shipped in `0.3.0`**. Local Lab v1 remains the replay, simulation,
and reporting foundation.

## Product Decision

Market Time Machine V2 turns isolated historical replays into a local
deliberate-practice loop. It does not begin with accounts, leaderboards, more
order types, or a general-purpose scenario editor.

The product promise is:

> A replay can produce observable process evidence, a focused next practice,
> and an honest view of whether comparable evidence is changing.

Free replays still create factual history, but only a completed versioned drill
can create an assessed process claim or earn track credit. The app never treats
profit, time spent, or missing evidence as proof of skill.

## Primary User

The primary V2 user is a self-directed investor or discretionary trader who
practices several times per month and wants to improve decision habits without
uploading private journal notes or creating an account.

Their core job is:

> I want to know which decision habit to work on next, which exercise will
> expose it, and what evidence would count as improvement.

Educators, teams, and competitive communities remain valuable later users, but
they do not define the shipped local V2 product.

## Product Loop

1. **Baseline:** complete a replay with at least one observable decision.
2. **Diagnose:** use only report evidence that the simulator can support.
3. **Assign:** prepare one deterministic next practice with a stated reason.
4. **Practice:** brief, plan, execute, and review under the information firewall.
5. **Compare:** assess the targeted process only across comparable attempts.

The coach and drill assessment are deterministic and local. They are not an LLM
judging free text, an investment recommendation, or a claim about real-world
trading ability.

## Shipped V2 Capabilities

### 1. Local Practice Coach

- Gives a new user a versioned Event Discipline baseline assignment.
- Uses the latest versioned drill assessment to repeat an incomplete attempt,
  target the weakest measured component, transfer a clean process to another
  regime, or request an exact-context repeat for a comparable trend.
- Keeps generic outcome/report recommendations in the report instead of
  presenting them as measured drill evidence.
- Shows a retained source report when available, compact-ledger evidence breadth,
  rubric version, and a current value and target only when supported.
- Requires the full current broker fingerprint before calling an attempt an
  exact-context repeat or completed transfer. A legacy broker label can remain
  process evidence; once completion and component gaps are handled, the coach
  assigns a broker-context repeat before comparison or transfer.
- Tracks three locally derived Practice orientation milestones, kept visibly
  separate from the credit-bearing Decision Foundations track.
- Preserves active-session replacement confirmations and never silently starts a
  trade session.
- Falls back to the shipped EUR/GBP foundation lab if a referenced imported
  scenario is no longer available.

The coach rubric remains `practice-coach-v1`. Its milestones are a lightweight
orientation layer, not the credit policy used by versioned practice tracks.
When the 12-report window expires, the coach can still use validated compact
assessments without inventing details that are absent from the ledger.

### 2. Event Discipline Drills

The shipped `DrillDefinition` contract fixes the scenario, primary symbol,
mode, definition version, rubric version, initial-plan rule, event checkpoint
rule, and process-only assessment weights.

Four built-in Event Discipline definitions are available:

| Scenario | Market-data scope | Track credit |
| --- | --- | --- |
| EUR/GBP Brexit 2016 | ECB daily reference-rate observation with derived OHLC fields and zero volume | Eligible through exact curated units |
| EUR/USD COVID Liquidity 2020 | ECB daily reference-rate observation with derived OHLC fields and zero volume | Eligible through exact curated units |
| QQQ Rate Shock 2022 | Synthetic sample prices with official-source events | Preview practice only |
| KRE Banking Crisis 2023 | Synthetic sample prices with official-source events | Preview practice only |

Each definition:

- requires at least one executed position from a complete initial plan before
  the drill can be marked completed;
- requires thesis, invalidation, exit plan, and accepted risk before the first
  position can be opened;
- maps importance-4-or-higher visible events to the next real primary-symbol
  candle close, grouping events that reach the same replay step;
- requires an explicit Hold, Reduce, Exit, or Wait response plus a reflection;
- asks the learner to explicitly select only the visible events that influenced
  each response; checkpoint membership alone never earns event-link credit;
- records rule violations when the process is bypassed or a checkpoint is
  skipped;
- assesses initial-plan coverage, checkpoint coverage, visible-event linkage,
  and rule adherence under rubric `event-discipline-process-v1`.

Missing process evidence is `insufficient_evidence` and has no score. The
assessment does not use return or hindsight to grade the drill.
Attempts created before explicit event selections were recorded remain readable,
but their automatic checkpoint membership is not accepted as evidence, trend,
coach, or track credit. Repeating the drill creates the required provenance.

### 3. Compact Practice Ledger And Evidence Profile

The browser retains two logical history layers in one atomically committed
canonical storage envelope:

- up to 12 recent full reports in completed-run history;
- up to 250 compact ledger entries containing run identity, scenario and data
  version, mode, broker label and full broker fingerprint, factual counts/rates,
  and an optional validated drill assessment.

The ledger never copies raw journal notes, plan text, checkpoint responses, or
reflection text. Legacy and ordinary free-replay entries remain factual and
unassessed. Incomplete drill attempts can remain visible as attempts, but they
do not add evidence, confidence, trend, or track credit even if they contain a
provisional component score.

Evidence claims are grouped by the drill definition's stable `competencyId`,
rubric version, and deterministic rubric-content fingerprint (all component
weights plus the violation penalty). Before an attempt may enter a claim at all,
its assessment must match an authoritative checkpoint-schedule fingerprint.
That schedule identity covers checkpoint ids, replay positions, times, and event
membership, so a partial self-declared schedule cannot claim evidence. The four
built-in definitions can therefore contribute to the same `event-discipline`
competency even though their scenario-specific schedules differ, while the claim
still lists every exact drill id and definition version represented. Older compact assessments
without a competency id fall back to their drill id instead of being silently
merged into a broader claim. Each claim shows assessed-run count, scenario
coverage, exact source-reviewed scenario coverage, sample-data count, data
fidelity, confidence, and the latest process score.

A trend is deliberately narrower than a competency claim: it requires two
scored runs with the same scenario id and canonical data-version identity, drill
id and definition version, rubric-content and checkpoint-schedule fingerprints,
mode, broker mode, and full broker fingerprint. Reviewed built-in data-version aliases can therefore
remain comparable to their canonical successor; unknown versions and legacy
broker-label-only records cannot. A change of at least 10 points is labeled
improving or declining; smaller changes are stable.

Confidence describes evidence breadth only. It is not an outcome rating,
investment certainty, or durable cross-scenario skill score. The existing
overall report score remains scoped to one replay and is never substituted for
drill evidence.

### 4. Versioned Practice Tracks

The shipped catalog has three tracks:

| Track | Status | Units |
| --- | --- | --- |
| Decision Foundations v1 | Open | One validated EUR/GBP Event Discipline unit |
| Event Pressure Transfer v1 | Open | Validated EUR/GBP and EUR/USD units; both source-reviewed scenarios are required |
| Volatility Discipline v1 | Preview | QQQ and KRE synthetic rehearsal units; no completion credit |

A validated unit receives credit only when one attempt matches the curated
scenario id and canonical data-version identity, fidelity/sample flags, drill
id, definition, rubric, mode, broker mode, and full broker-configuration
fingerprint, and satisfies every completion criterion in that same attempt. The
catalog itself pins the current full replay-contract and execution identities;
only explicitly reviewed built-in data-version aliases let an older attempt
match the scenario identity. Criteria are never combined across runs. Imported
lookalikes, unknown versions, changed broker settings, broker-label-only legacy
records, and synthetic preview units cannot earn credit.

The current Event Discipline unit threshold is a completed assessment with an
overall score of at least 80, plan coverage of at least 80, full checkpoint and
event-link coverage, full rule adherence, and no violations.

### 5. Practice Archive Portability

The history control exports
`market-time-machine-practice-archive` version `2` with:

- an export timestamp;
- up to 12 recent full reports, including the bounded initial plan, checkpoint
  decisions/reflections, safe event display fields, and rule violations for a
  completed drill;
- up to 250 compact ledger entries.

Those free-form practice details remain in the full-report layer only. They are
deliberately omitted from the compact ledger and must be treated as private when
the user exports an archive.

The archive controls remain available when the 12-report window is empty but
older compact ledger evidence still exists, so ledger-only data can still be
exported or cleared explicitly.

Import is strict and atomic: nested report collections are render-safe validated,
one malformed run or ledger entry rejects the file, and a browser-storage failure
rolls the single canonical envelope back instead of keeping half an import. Exact
duplicates are no-ops. Same-id records with different content are reported as
conflicts and the browser's existing record is kept. New records are merged in
deterministic newest-first order.

That validation proves only schema, boundedness, and internal consistency. The
archive is editable plain-text JSON owned by the user; it has no server signature
or trusted hardware attestation. A technically modified but internally
consistent archive therefore remains indistinguishable from an export produced
by the app. Local scores, evidence claims, and track progress are reflective
practice aids, not tamper-proof records, anti-cheat results, or certification.

The importer also accepts the previous
`market-time-machine-run-history` version `1` export. It derives compact factual
entries without inventing drill assessments. This archive migration is separate
from active-session backup and scenario-package import.

Active practice-session backups pin the scenario data version and the complete
drill identity: competency, definition version, rubric, and normalized
definition snapshot. Format-version-4 backups also pin the full active broker
configuration. Restore rejects unreviewed scenario drift, broker drift, or drill
drift instead of finishing an old attempt under changed evidence. A session
backup does not embed an imported scenario package; the matching package must
be imported into the destination browser first.

Scenario identities normally compare exactly. The only exceptions are a small,
scenario-id-specific migration map: the former ECB retrieval-stamped and
observation-only identities map to the current full replay-contract hashes, as
do prior ECB full-contract hashes whose only change was derivation disclosure.
Three unchanged synthetic labs map from `null` to their first pinned versions.
BTC v2 corrects a replay-visible event time, so BTC v1 and missing BTC versions
do not migrate. Unreviewed values receive no alias and compare only by exact
equality. Ordinary session formats 1 through 3 may migrate through those rules
only when their serialized broker settings exactly match the scenario or preset
that the stored mode and broker label currently imply. Professional, Blind, and
Challenge restores require the scenario-broker label. Accepted legacy sessions
are then saved in format 4 with an enforceable broker fingerprint. Practice
sessions from formats 1 through 3 are rejected because they lack the immutable
drill identity. Imported scenarios require a non-empty author-declared
`dataVersion`. On import, the app derives and persists its own SHA-256 identity
from the complete canonical replay contract, including any scenario-authored
drills; the author label alone cannot preserve identity after content changes.
An installed same-id package must be removed before a replacement can be added.

Replaying an archived assessed drill requires the retained full definition,
scenario version, broker fingerprint, and checkpoint-schedule fingerprint to
match the current catalog exactly. If any part is absent, the UI starts only a
fresh unassessed scenario replay and says why; it never silently substitutes a
newer same-id drill.

### 6. Surprise Local Self-Test

The library can start a randomly selected eligible Blind replay or Local
challenge without first revealing the lab choice. Identity, asset labels, and
ending remain masked during the run. This is an honest local self-test, not
secure anti-cheat: bundled future data and client state remain inspectable by a
technical user.

### 7. Drill-Definition Authoring Surface

`ScenarioPackage` accepts an optional `drills` array. Untrusted definitions are
parsed defensively and must pass the same domain validation as built-in drills,
including scenario/symbol/mode compatibility, checkpoint mapping, supported
actions, plan fields, and rubric weights. A package with authored drills must
also declare a non-empty scenario `dataVersion`. For browser imports, the app
then replaces that label with a content-derived replay-contract identity that
includes the authored definitions, so restored sessions and comparable evidence
cannot silently cross changed market, event, broker, or drill content.

Valid authored definitions are discovered as runnable options only while their
containing scenario is available. They are scenario-scoped, cannot replace a
reserved built-in drill id, and remain data-only: custom functions and scoring
code are not accepted. Runnable does not mean creditable; all track units and
their exact evidence references remain separately curated in
`src/data/practice/`.

## Evidence And Data Boundary

The two completion-grade source scenarios use official ECB daily reference-rate
observations. Their snapshot `contentSha256` values identify only those source
observations. The authoritative scenario `dataVersion` hashes the complete
canonical replay contract, including derived candles, curated events,
instruments, indicators, benchmarks, the default broker, calendar, and corporate
actions, while excluding only the recursive identity and retrieval timestamp.
They are labeled `mixed` fidelity because open, high, and low repeat the daily
observation and volume is zero; they are not intraday execution evidence.
Official event sources do not turn a synthetic price path into completion-grade
market evidence.

Track credit uses curated scenario ids and canonical full-contract identities,
with only the reviewed built-in migrations described above. A user import cannot
gain credit merely by copying a title, setting `sampleData` to false, reusing a
legacy version string, or claiming a similar source.

These identity and consistency checks prevent accidental drift and detectable
contradictions; they do not authenticate who produced an editable local file.

## Non-Goals

- Accounts, cloud sync, payments, and cross-device identity
- Server-authoritative anti-cheat and leaderboards
- Broker connectivity, live signals, or investment advice
- A general backtesting terminal
- Automatic semantic grading of free-form reasoning
- Automatic admission of imported drills into credit-bearing tracks
- A full no-code Scenario Studio
- Inflating the catalog with low-quality or unclear-rights data

## Success Criteria And Measurement Status

The product has no telemetry collector, so adoption and retention targets have
not been measured by the app. Any product research must be opt-in. Future
research may evaluate baseline completion, return-to-practice behavior, and
whether users can explain the evidence behind a recommendation.

The shipped engineering release gates are narrower and testable:

- future information remains hidden during replay;
- missing evidence remains unassessed;
- only exact validated units award track credit;
- synthetic preview units never award credit;
- active sessions, evidence, and archives remain local and portable;
- V1 run-history exports migrate without fabricated assessments;
- offline use and the release verification gate continue to pass.

## Follow-On Work

The V2 product loop is shipped. Useful later work includes adding more
rights-reviewed source scenarios, expanding the curated drill taxonomy,
measuring the loop through opt-in research, and defining a review path for
authored drills that seek track credit. Hosted challenges, team workflows, and
cross-device services remain a separate platform expansion.
