# Contributing

Thanks for considering a contribution to Market Time Machine.

The project is strongest when contributions are historically honest, reproducible, and explicit about assumptions. Scenario work is just as valuable as code work.

## Before You Start

1. Read the [README](README.md) for the product shape.
2. Read the [Architecture](docs/architecture.md) if you are touching core behavior.
3. Read [Scenario Authoring](docs/scenario-authoring.md) if you are adding or changing scenario data.
4. Open an issue first for large changes, new abstractions, or scenario data with uncertain licensing.

## Local Setup

```sh
npm install
npm run dev
```

Run the full check before opening a pull request:

```sh
npm run check
```

## Pull Request Checklist

- Keep changes focused and explain the user-facing effect.
- Add or update tests for replay visibility, broker behavior, analytics, or UI behavior when relevant.
- Keep future data hidden during replay. The report layer may use full scenario data only after the session is finished.
- Do not commit secrets, `.env` files, private keys, tokens, raw production logs, or restricted market data.
- Update documentation when behavior, setup, scenario assumptions, or contributor workflows change.
- Add a short handoff entry in the repo's existing handoff log after meaningful repository changes.

## Scenario Contributions

Scenario pull requests should include:

- Clear source attribution
- License/redistribution notes
- Timestamps with timezone
- `happenedAt` and `publishedAt` for events
- No hindsight phrasing in event titles or summaries
- Transparent notes for synthetic, smoothed, sampled, or derived data
- Broker assumptions appropriate to the asset class

Start here: [Scenario Authoring](docs/scenario-authoring.md).

## Review Standard

Review is biased toward:

- Information-firewall correctness
- Explicit assumptions
- Small, readable changes
- Reproducible data transformation
- Tests around behavioral risk
- Honest limitations over hidden confidence

## Code of Conduct

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
