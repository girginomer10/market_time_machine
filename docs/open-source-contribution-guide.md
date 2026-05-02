# Open Source Contribution Guide

## Philosophy

Market Time Machine should be easy to extend.

The most valuable contributions will not only be code. They will also include clean historical scenarios, better broker models, better analytics, validation tools, and documentation.

## Contribution Types

### Code

Examples:

- Replay engine
- Broker simulation
- Chart components
- Scenario loader
- Scenario validator
- Report metrics
- Behavioral analysis
- UI improvements

### Scenario Packages

Examples:

- Bitcoin 2020-2021
- S&P 500 Covid crash
- Tesla 2019-2021
- USD/TRY crisis period
- Gold inflation shock
- Nasdaq 2022 rate hike regime

### Data Quality Improvements

Examples:

- Better source attribution
- Corrected timestamps
- Event publication time fixes
- Adjusted price handling
- Missing candle repair

### Documentation

Examples:

- Scenario authoring guide
- Broker model explanation
- Financial metric definitions
- Architecture examples
- Educational walkthroughs

## Scenario Contribution Checklist

A scenario pull request should include:

- `scenario.json`
- `instruments.json`
- candles file
- optional events file
- optional benchmark file
- broker assumptions
- source documentation
- license information
- known limitations

Review checklist:

- No future leakage
- Events use `publishedAt`
- Event summaries avoid hindsight
- Timestamps include timezone or are clearly UTC
- Candle data is sorted
- Symbols are consistent
- Data source license is compatible
- Benchmark is appropriate
- Broker assumptions are reasonable

## Code Contribution Principles

- Keep domain logic separate from UI components.
- Prefer pure functions for replay, simulation, and analytics.
- Add tests for information firewall behavior.
- Make broker assumptions explicit.
- Avoid hidden magic in scoring.
- Keep scenario schemas backward-compatible when possible.

## Testing Priorities

Highest priority tests:

- Future candles are hidden
- Future events are hidden
- Event visibility uses `publishedAt`
- Orders cannot fill with unknown future prices
- Portfolio value uses last visible price
- Report metrics unlock only after completion

Medium priority tests:

- Fee calculations
- Slippage calculations
- Drawdown metrics
- Benchmark comparison
- Behavioral flag detection

## Licensing

Contributors must ensure scenario data can be legally redistributed.

If a data source cannot be redistributed, the scenario should provide:

- a fetch script
- transformation instructions
- source references
- checksums where possible

Do not commit proprietary datasets without permission.

## Review Standard

A contribution is better when it is:

- historically honest
- reproducible
- explicit about assumptions
- easy to inspect
- free of hindsight wording
- useful for learning

The project should prefer transparent limitations over hidden confidence.

