# Privacy And Local Data

Market Time Machine is a local-first educational simulator. The current app has
no user accounts, advertising, analytics SDK, telemetry collector, payment flow,
or broker connection. A static hosting provider still receives ordinary request
metadata such as IP address, user agent, requested path, and timestamps under
that provider's own terms.

## What The Browser Stores

| Data | Location | Contents | Removal |
| --- | --- | --- | --- |
| Replay session | `localStorage` key `market-time-machine.session.v2` | Scenario id, replay position, orders, fills, journal entries, audit events, finished report, and active drill state including checkpoint responses/reflections | **Switch scenario → Clear browser save**, or clear site data in the browser |
| Completed-run history | `localStorage` key `market-time-machine.run-history.v1` | Up to 12 completed runs, including summary metrics and a bounded copy of each report | Use **Remove** on one entry or **Clear history** for all entries; **Export practice archive** saves a copy first |
| Compact practice ledger | `localStorage` key `market-time-machine.practice-ledger.v1` | Up to 250 compact factual records and optional validated drill assessments; no raw journal, plan, checkpoint-response, or reflection text | Removing a run removes its matching ledger entry; **Clear history** clears both history layers; clearing site data also removes it |
| Imported scenario packages | `localStorage` key `market-time-machine.user-scenarios.v1` | Complete, validated Market Time Machine scenario JSON files imported in the library | Use **Remove imported lab** on its library card, or clear site data; an active replay with progress must be replaced first |
| Offline app files | Browser Cache Storage | Static HTML, JavaScript, CSS, icons, and shipped scenario bundles | Clear site data/cache for the app origin, or uninstall the PWA and clear its data |
| Exported session/report/practice archive | A file chosen by the user | Plain-text JSON; sessions and full reports may contain journal text plus drill plans, checkpoint decisions, reflections, and violations, while compact archive ledger entries do not | Delete it from the device or file-sync provider |
| Local OHLCV input | A file chosen by the user and processed by the local CLI | User-provided market rows | Delete the input and generated local scenario folder |

Replay state is saved automatically after state changes so a reload can resume
the session. Journal notes may contain sensitive personal reasoning. Do not use
real brokerage identifiers, credentials, account numbers, private financial
records, or secrets in notes. Exported JSON is not encrypted.

The Practice Coach is recomputed locally from completed reports and the compact
ledger. It uses a retained report for a source-report link when available, but
can continue from versioned compact assessments after the 12-report window
expires without reconstructing missing free text. It assigns only the
plan/checkpoint/event/rule behavior that Event Discipline measures; broader
outcome recommendations stay in the report instead of being mislabeled as
drill evidence. The V2 evidence profile and
tracks use the same compact ledger. Clearing history clears both stores;
removing one report also removes ledger records matching that run id or
run-instance id. If no full reports remain while compact evidence still exists,
the history view keeps **Export practice archive** and **Clear history**
available and identifies the ledger-only state instead of presenting the device
as empty.

The current replay-session key is `.v2`, while the document inside it is format
version 3. On first load, a valid historical `.v1` or ordinary `.v2` free-replay
session is migrated and the old key is removed. Version-1/2 practice sessions
without an immutable drill-definition identity are rejected rather than being
silently reinterpreted. An active drill session can contain the user's free-form
checkpoint reflections; do not confuse it with the compact ledger, which
intentionally strips them.

Clearing the browser save removes only the persisted active session, not the
current in-memory replay, completed-run history, imported scenarios, or the
PWA's static offline cache. Use the browser's site-data controls when the entire
local footprint must be removed.

Removing an imported lab does not erase completed reports already preserved in
history. Those reports remain readable, but replaying them requires importing
the matching scenario package again. History exports, session exports, report
exports, clipboard copies, printed PDFs, and native shares are user-created
files or transfers outside browser storage; delete those copies separately.

## Four Different JSON Paths

The in-app **Restore** control accepts only a versioned Market Time Machine
session export. It does not accept a scenario package, arbitrary JSON, or raw
OHLCV rows. Restored sessions are validated and derived portfolio/report state
is recomputed before installation. A backup pins the scenario data version and,
for practice, the full drill identity and normalized definition. It does not
embed an imported scenario package, so the exact matching package must already
exist in the destination browser.

The in-app **Import practice archive** control accepts the V2
`market-time-machine-practice-archive` document, up to the UI's 25 MB file
limit. It strictly validates every run and compact entry before merging anything,
keeps existing same-id records when content conflicts, and retains at most 12
full reports plus 250 compact entries. It also accepts the previous
`market-time-machine-run-history` version `1` export and derives factual,
unassessed ledger entries. Both local history layers roll back if the complete
merged archive cannot be retained in browser storage. A practice archive is not an active-session backup
and cannot be used as a scenario package.

The in-app **Import scenario package** control accepts one complete Market Time
Machine scenario-package JSON file, up to 25 MB. It validates the scenario,
refuses to replace a bundled scenario id, and attempts to store successful
imports in this browser. If browser storage is unavailable or full, the app
reports that the scenario is available only for the current visit. It does not
accept a session backup or raw OHLCV rows. Persisted package content stays local
to the origin until it is removed or site data is cleared.

An imported package may contain validated data-only drill definitions. Valid
definitions are runnable only with that containing scenario and cannot replace a
reserved built-in drill. They do not automatically enter credit-bearing tracks.

Users who own or are licensed to use a raw OHLCV dataset can turn a JSON array
or CSV file into a development-only local scenario through the CLI:

```sh
npm run import:ohlcv -- \
  --input=local-data/eurusd.json \
  --symbol=EURUSD \
  --assetClass=fx \
  --title="EUR/USD Local Replay" \
  --license="Licensed local use only"
```

The JSON input must be an array of row objects. A daily example is:

```json
[
  {
    "date": "2022-01-03",
    "open": 1.137,
    "high": 1.138,
    "low": 1.128,
    "close": 1.13,
    "volume": 0
  },
  {
    "date": "2022-01-04",
    "open": 1.13,
    "high": 1.132,
    "low": 1.127,
    "close": 1.129,
    "volume": 0
  }
]
```

Rows may use `date` or explicit `openTime` and `closeTime`, with positive
`open`, `high`, `low`, and `close`; `volume` is optional. The importer validates
timestamps, duplicates, finite values, OHLC relationships, metadata, output
paths, and writes atomically.

Default output under `src/data/scenarios/local-*/` is gitignored and discovered
only by the development server. Production builds replace local discovery with
an empty registry. The browser app does not upload the input file. Custom output
paths may be git-visible, so inspect `git status` and confirm redistribution
rights before sharing anything.

## Financial And Data Safety

- The app is for education, research, and historical simulation.
- It is not investment advice, a broker, an exchange, a recommendation engine,
  or a guarantee of trading performance.
- Sample or derived candles are not equivalent to executable market quotes.
- Local/Pages challenge modes do not protect future data from technical users.
- Never import data unless its local-use and redistribution terms are understood.
