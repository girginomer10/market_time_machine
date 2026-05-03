# Roadmap

This roadmap describes the full product direction, not only the first MVP.

## Phase 0: Product Foundation

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

## Phase 1: Local Financial History Lab

Goal:

Build a complete local replay experience for one high-quality global scenario.

Recommended first scenario:

- Bitcoin 2020-2021

Deliverables:

- React and TypeScript app
- Scenario loader
- Candlestick replay
- Play, pause, speed, and step controls
- Market and limit orders with working-order edit/cancel controls
- Cash, positions, and portfolio value
- Trade journal
- Basic post-game report
- Buy-and-hold benchmark

Success criteria:

- A user can complete a replay without seeing future candles
- Trades are saved in session state
- Final report compares user performance with benchmark
- The experience is demoable as a GIF or short video

## Phase 2: Event-Aware Replay

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

## Phase 3: Broker Realism

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
- Professional mode can reject invalid orders
- Report includes fees and slippage drag

## Phase 4: Advanced Reporting

Goal:

Turn replay sessions into meaningful decision feedback.

Deliverables:

- Risk metrics
- Drawdown analysis
- Attribution engine
- Behavioral flags
- Decision replay
- Journal consistency analysis
- Shareable report page

Success criteria:

- The report identifies the trades that drove performance
- Behavioral flags are evidence-based
- Users receive specific practice recommendations

## Phase 5: Open Scenario Ecosystem

Goal:

Let the community add high-quality historical market scenarios.

Deliverables:

- Scenario contribution guide
- Scenario validator
- Example scenario package
- Source and license checks
- Scenario preview page
- Scenario quality checklist

Success criteria:

- Contributors can submit scenarios without modifying core code
- Reviewers can detect future leakage and data issues
- The scenario library grows across asset classes and regions

## Phase 6: Challenge Mode

Goal:

Create competitive, repeatable historical challenges.

Deliverables:

- Challenge configuration
- Locked initial capital and rules
- Leaderboards
- Shareable results
- Blind mode
- Server-side scoring option

Success criteria:

- Multiple users can play the same scenario under identical rules
- Rankings are based on risk-aware scoring, not only return
- Future data is protected in hosted challenges

## Phase 7: Professional Training Platform

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

## Phase 8: Research Lab

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
