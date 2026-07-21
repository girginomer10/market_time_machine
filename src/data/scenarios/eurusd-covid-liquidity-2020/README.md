# EUR/USD COVID Liquidity Shock 2020 — Source Manifest

This built-in scenario uses the European Central Bank's daily euro foreign
exchange reference rate for the US dollar. It is a source-observed daily
reference-rate replay, not an intraday executable-price record.

## Price source

- Series: `EXR/D.USD.EUR.SP00.A`
- Meaning: US dollars per euro, ECB daily reference exchange rate
- Requested range: 2020-02-03 through 2020-06-30
- Committed observations: 104
- Snapshot retrieval time: 2026-07-14T00:00:00.000Z
- Normalized observation content SHA-256: `3ce0c0483a1204994bdfbc44be48b5c4351e1e84fec9adefd2e6bf94b14587d9`
- API URL: <https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=2020-02-03&endPeriod=2020-06-30&format=csvdata>
- ECB statistics usage policy: <https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html>

The ECB usage policy was reviewed on 14 July 2026. It permits free reuse of
publicly available ECB statistics, including commercial reuse, when the source
is attributed and the statistics and metadata are not modified. This snapshot
attributes the ECB and preserves every published `OBS_VALUE`; the app-specific
bar fields described below are separately identified as derivations.

The committed `OBS_VALUE` values are reproduced without price transformation.
Because the source publishes one daily reference observation rather than an
OHLCV bar, each candle repeats that value for open, high, low, and close; volume
is unavailable and set to zero. The benchmark repeats the same observed series.
The date-only observation is placed in a deterministic `00:00Z`-`15:00Z`
replay window, and the matching benchmark point uses `15:00Z`. Those timestamps
are app-derived replay boundaries, not observed publication or execution times.
These derivations are disclosed in scenario metadata and in the in-app briefing.

## Event sources

All event summaries are short, present-tense descriptions of information
published by the issuing institution. They link to the official publication:

- World Health Organization, 11 March 2020 pandemic characterization
- Federal Reserve FOMC statements and market-support releases on 3, 15, and 23
  March 2020
- European Central Bank policy, dollar-liquidity, and PEPP releases on 12, 15,
  and 18 March, 30 April, and 4 June 2020

The complete URLs are stored on each event in `index.ts`. The scenario does not
bundle copies of those publications.

## Reproduction

From the repository root:

```sh
npm run import:ecb-eurusd -- \
  --force=true \
  --retrieved-at=2026-07-14T00:00:00.000Z
```

The importer validates the date range, CSV fields, positive finite values,
duplicates, and requested-range containment before replacing the snapshot
atomically. Review the diff and the current ECB reuse terms before committing a
refreshed snapshot. The content digest excludes `retrievedAt`, so a retrieval
timestamp change alone does not create a different scenario `dataVersion`.
