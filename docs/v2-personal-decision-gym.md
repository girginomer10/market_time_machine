# V2 Product Definition: Personal Decision Gym

## Product Decision

Market Time Machine V2 turns isolated historical replays into a deliberate
practice loop. It does not begin with accounts, leaderboards, more order types,
or a general-purpose scenario editor.

The product promise is:

> Every replay produces observable decision evidence, a focused next practice,
> and a clearer view of whether the user's process is improving.

Local Lab v1 remains the replay, simulation, and reporting foundation. V2 adds
the layer that answers the question left after a report: **what should I
practice next, and why?**

## Primary User

The primary V2 user is a self-directed investor or discretionary trader who
practices several times per month and wants to improve decision habits without
uploading private journal notes or creating an account.

Their core job is:

> I want to know which decision habit to work on next, which exercise will
> expose it, and what evidence would count as improvement.

Educators, teams, and competitive communities remain valuable later users, but
they do not define the local V2 product.

## Product Loop

1. **Baseline:** complete a replay with at least one observable decision.
2. **Diagnose:** use only report evidence that the simulator can support.
3. **Assign:** prepare one deterministic next practice with a stated reason.
4. **Practice:** brief, plan, execute, and review under the information firewall.
5. **Compare:** assess the targeted process evidence across comparable attempts.

The coach is deterministic and local. It is not an LLM judging free text, an
investment recommendation, or a claim about real-world trading skill.

## V2 Capabilities

### 1. Local Practice Coach

- Turns the latest report's highest-priority practice recommendation into an
  actionable next session.
- Shows the source evidence and a measurable target when the report supports
  one.
- Prepares the existing scenario briefing instead of silently replacing an
  active replay or starting a trade session.
- Falls back to the source-observed EUR/GBP foundation lab when an imported
  source scenario is no longer available.

### 2. Versioned Practice Drills

A future `DrillDefinition` will specify the target process, scenario, mode,
rules, checkpoints, completion evidence, and rubric version. Drill scores must
reward observable process, not hindsight or profit alone.

The first planned drill is **EUR/GBP Brexit — Event Discipline**:

- require a structured plan before the first position;
- pause at high-importance visible events;
- ask the user to choose Hold, Reduce, Exit, or Wait and record what changed;
- assess plan coverage, event links, rule violations, and checkpoint coverage;
- compare the targeted process with the previous comparable attempt.

### 3. Evidence Profile

V2 will build a local profile from versioned, drill-specific observations. Each
claim must show evidence count, scenario coverage, confidence, and rubric
version. Missing evidence remains unassessed; it never becomes a zero.

The existing overall report score must not be relabeled as a cross-scenario
skill score. It intentionally includes outcome measures and is useful inside a
run, but it is not sufficient evidence of durable ability.

### 4. Practice Tracks

Tracks will sequence drills around decision foundations, event pressure, and
discipline under volatility. Progress is based on completed evidence criteria,
not streaks, time spent, or profit badges.

### 5. Compact Practice Ledger

The current history retains 12 bounded reports. A later V2 migration may keep a
longer lightweight ledger of versioned practice observations while retaining
only recent full reports. The first coach slice deliberately derives everything
from existing history and adds no new persistence format.

## First Shipped V2 Slice

The initial preview implements the Local Practice Coach and the Decision
Foundations track:

- first-run baseline assignment;
- report-to-next-practice handoff;
- source evidence and supported current/target values;
- three locally derived milestones:
  1. complete one replay;
  2. complete a replay where every executed decision has a linked structured
     plan with a stated reason and risk plan;
  3. complete two different scenarios;
- safe briefing preparation with the existing active-session protection;
- rubric label `practice-coach-v1`.

This slice proves the learning loop before adding drill checkpoints or a larger
skill taxonomy.

## Non-Goals

- Accounts, cloud sync, payments, and cross-device identity
- Server-authoritative anti-cheat and leaderboards
- Broker connectivity, live signals, or investment advice
- A general backtesting terminal
- Automatic semantic grading of free-form reasoning
- A full no-code Scenario Studio
- Inflating the catalog with low-quality or unclear-rights data

## Success Criteria

Product research should be opt-in; the local app has no telemetry collector.
For a V2 beta, the intended success criteria are:

- At least 70% of observed new users complete the guided baseline in 20 minutes.
- At least 50% of completers open the prepared next practice.
- At least 35% complete another practice within seven days.
- At least 60% of users with two comparable attempts improve the target process
  score by 10 points or more.
- At least 80% can explain what they should practice next and cite the evidence.
- Every coach claim exposes its evidence, sample count, and rubric version.
- Future-leakage, offline use, local privacy, and v1 history compatibility remain
  release gates.

## Delivery Sequence

1. **Coach loop — started:** baseline, milestones, report handoff, next practice.
2. **Event Discipline drill:** checkpoints, process rubric, targeted retry.
3. **Evidence profile:** drill observations, confidence, trend, compact ledger.
4. **Track catalog:** validated units across multiple source-reviewed scenarios.
5. **Scenario authoring support:** only after drill quality and retention are
   demonstrated.

Hosted challenges and team workflows remain a separate platform expansion after
the local learning loop is proven.
