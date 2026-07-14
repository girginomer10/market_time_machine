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
- records rule violations when the process is bypassed or a checkpoint is
  skipped;
- assesses initial-plan coverage, checkpoint coverage, visible-event linkage,
  and rule adherence under rubric `event-discipline-process-v1`.

Missing process evidence is `insufficient_evidence` and has no score. The
assessment does not use return or hindsight to grade the drill.

### 3. Compact Practice Ledger And Evidence Profile

The browser retains two history layers:

- up to 12 recent full reports in completed-run history;
- up to 250 compact ledger entries containing run identity, scenario and data
  version, mode, broker, factual counts/rates, and an optional validated drill
  assessment.

The ledger never copies raw journal notes, plan text, checkpoint responses, or
reflection text. Legacy and ordinary free-replay entries remain factual and
unassessed. Incomplete drill attempts can remain visible as attempts, but they
do not add evidence, confidence, trend, or track credit even if they contain a
provisional component score.

Evidence claims are grouped by the drill definition's stable `competencyId` and
rubric version. The four built-in definitions therefore contribute to the same
`event-discipline` competency while the claim still lists every exact drill id
and definition version represented in its evidence. Older compact assessments
without a competency id fall back to their drill id instead of being silently
merged into a broader claim. Each claim shows assessed-run count, scenario
coverage, exact source-reviewed scenario coverage, sample-data count, data
fidelity, confidence, and the latest process score.

A trend is deliberately narrower than a competency claim: it requires two
scored runs with the same scenario id and data version, drill id and definition
version, rubric, mode, and broker. A change of at least 10 points is labeled
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

A validated unit receives credit only when one attempt matches the exact
scenario id and data version, fidelity/sample flags, drill id, definition,
rubric, and mode, and satisfies every completion criterion in that same attempt.
Criteria are never combined across runs. Imported lookalikes and synthetic
preview units cannot earn credit.

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
rolls both history layers back instead of keeping half an import. Exact
duplicates are no-ops. Same-id records with different content are reported as
conflicts and the browser's existing record is kept. New records are merged in
deterministic newest-first order.

The importer also accepts the previous
`market-time-machine-run-history` version `1` export. It derives compact factual
entries without inventing drill assessments. This archive migration is separate
from active-session backup and scenario-package import.

Active practice-session backups pin the scenario data version and the complete
drill identity: competency, definition version, rubric, and normalized
definition snapshot. Restore rejects drift instead of finishing an old attempt
under changed evidence. A session backup does not embed an imported scenario
package; the matching package must be imported into the destination browser
first.

### 6. Drill-Definition Authoring Surface

`ScenarioPackage` accepts an optional `drills` array. Untrusted definitions are
parsed defensively and must pass the same domain validation as built-in drills,
including scenario/symbol/mode compatibility, checkpoint mapping, supported
actions, plan fields, and rubric weights.

Valid authored definitions are discovered as runnable options only while their
containing scenario is available. They are scenario-scoped, cannot replace a
reserved built-in drill id, and remain data-only: custom functions and scoring
code are not accepted. Runnable does not mean creditable; all track units and
their exact evidence references remain separately curated in
`src/data/practice/`.

## Evidence And Data Boundary

The two completion-grade source scenarios use official ECB daily reference-rate
observations. They are labeled `mixed` fidelity because open, high, and low
repeat the daily observation and volume is zero; they are not intraday execution
evidence. Official event sources do not turn a synthetic price path into
completion-grade market evidence.

Track credit uses exact curated scenario ids and data-version strings. A user
import cannot gain credit merely by copying a title, setting `sampleData` to
false, or claiming a similar source.

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
