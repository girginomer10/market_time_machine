# Roadmap

This roadmap separates the shipped Local Lab v1 product from optional hosted
platform expansion. Local Lab v1 is complete as a single-user, local-first
product; later phases do not block that release.

## Release Status

Shipped in Local Lab v1:

- Product foundation and information firewall
- Scenario library, onboarding, briefing, and one rights-reviewed ECB hero lab
- Event-aware replay and realistic broker simulation
- Structured decision planning and chronological post-game learning report
- Local progress history, repeat-run comparison, print/share/JSON export
- Session backup/restore and validated browser scenario-package import
- Installable offline PWA, CI release gate, and manual static deployment

Future hosted platform work:

- Accounts and cross-device sync
- Server-enforced anti-cheat and leaderboards
- Educator/team cohorts and managed assignments
- Managed market-data services, payments, and broker connectivity

## V2: Personal Decision Gym — In Progress

Goal:

Turn completed replays into a local, evidence-backed deliberate-practice loop.

Started in the V2 preview:

- Local Practice Coach on the scenario-library home
- First-run baseline assignment
- Latest-report evidence translated into one focused next practice
- Supported current/target measures instead of invented skill claims
- Decision Foundations milestones derived from existing local history
- Report-to-coach handoff and safe briefing preparation
- Versioned `practice-coach-v1` rubric label

Next increments:

1. EUR/GBP Event Discipline drill with plan requirements and event checkpoints
2. Drill-specific process scoring and targeted retry comparison
3. Versioned local evidence observations with confidence and trend
4. A compact long-horizon practice ledger and export migration
5. Validated practice tracks across multiple source-reviewed scenarios

Success criteria and non-goals are defined in
[V2 Product Definition](v2-personal-decision-gym.md). Hosted accounts,
leaderboards, teams, and anti-cheat remain later platform work rather than V2
local-product prerequisites.

## Phase 0: Product Foundation — Shipped

Goal:

Define the product contract and make future implementation decisions consistent.

Deliverables:

- Product docs
- Scenario schema
- Replay visibility rules
- Broker simulation assumptions
- Report metric definitions
- Contribution guidelines

Success criteria:

- A contributor can understand what the product is
- A developer can implement the first version without inventing core concepts
- A scenario author can see how future leakage is prevented

## Phase 1: Local Financial History Lab — Shipped

Goal:

Build a complete local replay experience for one high-quality global scenario.

Shipped onboarding scenario:

- Brexit Referendum: EUR/GBP 2016, using ECB daily reference-rate observations
  with explicit derived-field disclosure and official UK event sources

Deliverables:

- React and TypeScript app
- Scenario loader
- Candlestick replay
- Play, pause, speed, and step controls
- Market, limit, stop-loss, take-profit, and bracket/OCO orders with working-order edit/cancel controls
- Cash, positions, and portfolio value
- Trade journal
- Structured thesis, invalidation, exit, accepted-risk, and event links
- Chronological post-game report with print/share/JSON export
- Buy-and-hold benchmark
- Local completed-run history and repeat-attempt comparison

Success criteria:

- A user can complete a replay without seeing future candles
- Trades are saved in session state
- Final report compares user performance with benchmark
- The production package is installable and usable offline after first load

## Phase 2: Event-Aware Replay — Shipped

Goal:

Make the replay feel like living through the historical period.

Deliverables:

- Event timeline
- Event schema validation
- Published-time filtering
- Event importance and sentiment
- Journal prompts linked to visible events
- Report section for event influence

Success criteria:

- Events appear only when historically knowable
- Event text avoids hindsight
- User can see which visible events surrounded each trade

## Phase 3: Broker Realism — Shipped

Goal:

Move from educational replay to serious trading simulation.

Deliverables:

- Commission model
- Spread model
- Slippage model
- Market hours
- Stop loss and take profit orders
- Partial fills
- Long-only and short-enabled modes
- Leverage and margin policy

Success criteria:

- Trade outcomes differ between ideal, realistic, and harsh execution modes
- Realistic Practice can reject invalid orders
- Report includes fees and slippage drag

## Phase 4: Advanced Reporting — Shipped For Local v1

Goal:

Turn replay sessions into meaningful decision feedback.

Deliverables:

- Risk metrics
- Drawdown analysis
- Attribution engine
- Behavioral flags
- Decision replay
- Journal consistency analysis
- Native share/clipboard summary, print/PDF, and report JSON export

Success criteria:

- The report identifies the trades that drove performance
- Behavioral flags are evidence-based
- Users receive specific practice recommendations

## Phase 5: Open Scenario Ecosystem — Shipped For Local v1

Goal:

Let the community add high-quality historical market scenarios.

Deliverables:

- Scenario contribution guide
- Scenario validator
- Example scenario package
- Source and license checks
- Scenario preview page
- Scenario quality checklist
- Validated browser import for complete scenario-package JSON
- Reproducible ECB and local licensed-data import scripts

Success criteria:

- Users can import validated packages without modifying core code
- Bundled scenarios require explicit allowlisting and rights review
- Reviewers can detect future leakage and data issues
- The scenario library grows across asset classes and regions

## Phase 6: Hosted Challenge Platform — Future

Goal:

Turn the shipped local blind/challenge practice modes into secure, competitive,
repeatable hosted challenges.

Deliverables:

- Server-owned challenge configuration and future-data delivery
- Locked initial capital and rules
- Leaderboards
- Shareable results
- Reuse the shipped blind/local-challenge interaction model
- Server-side scoring option

Success criteria:

- Multiple users can play the same scenario under identical rules
- Rankings are based on risk-aware scoring, not only return
- Future data is protected in hosted challenges

## Phase 7: Professional Training Platform — Future

Goal:

Support educators, trading teams, and cohorts.

Deliverables:

- Team workspaces
- Assignments
- Cohort leaderboards
- Exportable reports
- Instructor dashboard
- Audit trail
- Custom scenario publishing

Success criteria:

- An educator can assign a scenario to a group
- A team lead can compare decision behavior across users
- Reports can be exported for review

## Phase 8: Research Lab — Future

Goal:

Support deeper experimentation and strategy analysis.

Deliverables:

- Replay variants
- Rule toggles
- Strategy templates
- Multi-asset portfolios
- Macro and indicator overlays
- Repeat-run comparison
- Scenario forks

Success criteria:

- Users can test how rule changes affect outcomes
- The same historical regime can be studied from multiple angles
- Advanced users can turn replay into structured research
