# Product Design

## Vision

Market Time Machine is a financial history lab where users can experience famous market periods as if they were happening live.

The product hides the future, reveals only historically available information, simulates realistic broker behavior, and then explains the user's performance and decision patterns after the replay ends.

The goal is to make historical market learning experiential instead of passive.

## Local Lab v1 Product Boundary

Local Lab v1 is the complete single-user, local-first product. It includes the
scenario library and briefing, replay and trading, structured decision plans,
post-game learning report, local run history, scenario/session portability,
and installable offline delivery. It requires no account or server.

Hosted accounts, server-enforced anti-cheat, leaderboards, cohort management,
payments, managed market-data services, and broker connectivity are a separate
future platform scope. The local product must never imply that its blind or
challenge modes prevent a technical user from inspecting bundled future data.

## V2 Product Boundary: Personal Decision Gym

V2 keeps the local, private architecture and adds a deliberate-practice layer.
It connects completed-run evidence to one focused next exercise, then measures
only the process signals that the simulator can actually observe.

V2 must:

- state why a practice was recommended and identify its source run;
- show a current value and target only when the report supports both;
- label every coaching rubric with a version;
- leave missing or inapplicable evidence unassessed rather than treating it as
  poor performance;
- keep the existing report score scoped to a run instead of claiming it is a
  durable cross-scenario skill rating;
- preserve active-session confirmations and the information firewall;
- derive the first coach view from local history without adding telemetry or a
  second copy of sensitive reports.

The first V2 slice is the Local Practice Coach and Decision Foundations track.
The next slice is a versioned Event Discipline drill with high-importance event
checkpoints. The complete definition is in
[V2 Product Definition](v2-personal-decision-gym.md).

## Product Thesis

Most investors study history after knowing the outcome. That creates hindsight bias.

Market Time Machine removes hindsight. It asks:

- Would you have bought during panic?
- Would you have sold before the crash?
- Would you have trusted the news?
- Would you have held through volatility?
- Would you have beaten a passive benchmark after costs?

The product becomes valuable when the user feels the uncertainty of the past.

## Target Users

### Individual Learners

Retail investors, crypto traders, students, and finance-curious users who want to test themselves against real market history.

Primary value:

- Learn market history by doing
- Understand personal bias
- Practice risk decisions safely
- Compare against passive benchmarks

### Active Traders

Discretionary traders and systematic traders who want scenario-based training.

Primary value:

- Practice execution discipline
- Test reaction to volatility
- Review decision journals
- Measure behavior across regimes

### Educators and Communities

Finance educators, trading communities, newsletters, streamers, and online courses.

Primary value:

- Assign historical challenges
- Compare participant decisions
- Build custom scenario packs
- Teach market regimes interactively

### Professional Training Teams (Future Hosted Platform)

Prop firms, analyst training programs, and investment teams.

Primary value:

- Assess candidate behavior
- Compare cohorts under identical information
- Enforce realistic execution assumptions
- Generate evidence-based performance reports

## Product Modes

### Explorer Mode

Explorer Mode is gamified individual learning.

Characteristics:

- Fast onboarding
- Curated scenarios
- Clear scorecards
- Shareable results
- Optional hints after replay
- Friendly language and visual feedback

This mode should feel like an interactive financial history challenge.

### Realistic Practice Mode

Realistic Practice is the serious single-user local mode.

Characteristics:

- Realistic broker assumptions
- Locked scenario broker rules
- Required thesis plus risk/exit planning for each order
- Auditable trade history
- Exportable, printable reports
- Full event and source context

It should feel like a lightweight training terminal without claiming hosted
security or team administration.

### Blind Replay

Blind Replay hides the scenario identity and ending during the session, locks
broker assumptions, and disables skipping. It is a self-test on the local
device, not secure anti-cheat.

### Local Challenge

Local Challenge combines locked rules, structured decision plans, masked
scenario identity, and full completion. It creates a repeatable local practice
format. Competitive rankings and server-side future-data protection belong to
the hosted platform.

## Scenario Types

Market Time Machine should support multiple asset classes and market regimes.

Asset classes:

- Crypto
- Equities
- Equity indices
- FX
- Commodities
- Rates
- ETFs

Scenario tags:

- crash
- bubble
- earnings_cycle
- rate_shock
- inflation
- currency_crisis
- liquidity_crisis
- geopolitical
- regulation
- meme_stock
- trend_following
- mean_reversion

Example scenarios:

- Bitcoin 2020-2021 bull market
- S&P 500 Covid crash and recovery
- Tesla 2019-2021 repricing
- USD/TRY currency crisis period
- Gold during inflation shock
- Nasdaq during 2022 rate hikes
- Regional banking crisis
- Meme stock mania

## User Journey

### 1. Scenario Selection

The user chooses a scenario from a library.

Visible before start:

- Asset class
- Date range, unless in Blind Mode
- Difficulty
- Initial capital
- Trading rules
- Replay granularity
- Available information channels

Hidden before start in selected modes:

- Final outcome
- Scenario regime label
- Future event summaries
- Benchmark return

### 2. Replay Session

The user enters a historical date.

The screen shows:

- Live-updating price chart
- Current replay time
- Position and cash
- Trade controls
- Visible event timeline
- Journal prompt
- Risk and exposure monitor

The product must preserve uncertainty. The user should never see a chart range, event, indicator, or report clue that exposes the future.

### 3. Trading and Journaling

Every trade can capture a structured decision plan:

- Thesis
- Invalidation condition
- Exit plan
- Accepted risk
- Links to events already visible at submission time

Users can also add standalone journal notes. Good prompts include:

- Why are you entering?
- What would invalidate this trade?
- What risk are you accepting?
- Are you reacting to price, news, or both?
- What will make you exit?

The journal is later used for decision analysis.

### 4. Post-Game Report

After the scenario ends, the product unlocks the full historical outcome.

The report should explain:

- How the user performed
- How much of the result came from timing, exposure, and sizing
- Whether the user beat the benchmark
- Which trades helped or hurt most
- Which events influenced the user
- Which behavioral patterns appeared
- What the user should replay next

The user can print/save the report as PDF, share a concise text summary through
the operating system or clipboard, export report JSON, and revisit bounded
completed-run history on the same device. Repeat attempts show score and return
deltas against the previous run of that scenario.

## Differentiators

### Information Firewall

Market Time Machine's main product feature is not replay speed. It is the guarantee that the user only sees what was knowable at the time.

### Broker Realism

The simulator should not fill every trade at perfect candle close prices. It should model spread, commission, slippage, liquidity, and margin.

### Behavioral Analytics

The report should detect patterns such as panic selling, FOMO buying, early profit taking, overtrading, loss holding, and news overreaction.

### Open Source Scenario Ecosystem

The project should let contributors create scenario packs. This creates a durable community advantage because the product grows with new historical periods.

## Product Tone

The product should feel like a modern financial research lab:

- Calm
- Precise
- Trustworthy
- Global
- Serious enough for training
- Engaging enough for self-directed learning

Avoid casino language. Avoid implying that trading is easy. The product should reward process, not reckless risk.

## North Star Metric

The best north star metric is:

**Completed replay sessions with journaled decisions.**

This measures whether users are genuinely practicing decision-making, not merely browsing charts.

Secondary metrics:

- Replay completion rate
- Percentage of trades with journal notes
- Number of scenarios replayed per user
- User-initiated report shares or exports
- Challenge participation
- Scenario contributions accepted
