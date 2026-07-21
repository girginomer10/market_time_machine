# Privacy And Local Data

Market Time Machine is a local-first educational simulator. The current app has
no user accounts, advertising, analytics SDK, telemetry collector, payment flow,
or broker connection. A static hosting provider still receives ordinary request
metadata such as IP address, user agent, requested path, and timestamps under
that provider's own terms.

## What The Browser Stores

| Data | Location | Contents | Removal |
| --- | --- | --- | --- |
| Replay session | `localStorage` key `market-time-machine.session.v2` | Scenario id and canonical data identity, replay position, full active broker identity, orders, fills, journal entries, audit events, finished report, and active drill state including checkpoint responses, reflections, and explicit event selections | **Switch scenario → Clear browser save**, or clear site data in the browser |
| Practice history and compact ledger | `localStorage` key `market-time-machine.practice-archive-storage.v1` | One canonical envelope containing up to 12 completed full reports and 250 compact factual/assessment records, including scenario and broker provenance; compact records contain no raw journal, plan, checkpoint-response, or reflection text | Use **Remove** on one report or **Clear history** for the whole envelope; **Export practice archive** saves a portable copy first |
| Imported scenario packages | `localStorage` key `market-time-machine.user-scenarios.v1` | Complete, validated Market Time Machine scenario JSON files imported in the library | Use **Remove imported lab** on its library card, or clear site data; an active replay with progress must be replaced first |
| Offline app files | Browser Cache Storage | Static HTML, JavaScript, CSS, icons, and shipped scenario bundles | Clear site data/cache for the app origin, or uninstall the PWA and clear its data |
| Exported session/report/practice archive | A file chosen by the user | Plain-text JSON; sessions and full reports may contain journal text plus drill plans, checkpoint decisions, reflections, and violations, while compact archive ledger entries do not | Delete it from the device or file-sync provider |
| Local OHLCV input | A file chosen by the user and processed by the local CLI | User-provided market rows | Delete the input and generated local scenario folder |

Replay state is saved automatically after state changes so a reload can resume
the session. Journal notes may contain sensitive personal reasoning. Do not use
real brokerage identifiers, credentials, account numbers, private financial
records, or secrets in notes. Exported JSON is not encrypted.

Automatic save is verified rather than assumed. A read, restore, write, or
deletion failure produces a global browser-save health message in both the lab
and the initial library. While writes are failing, keep the tab open and export
the active session before relying on reload; a later successful write is shown
as recovered. A damaged startup save is not silently treated as an empty save.
Starting, restoring, or removing a lab also treats an initial drill plan,
checkpoint response, or rule violation as progress and requires explicit
replacement confirmation, including progress created while a restore file is
still being read.

The Practice Coach is recomputed locally from completed reports and the compact
ledger. It uses a retained report for a source-report link when available, but
can continue from versioned compact assessments after the 12-report window
expires without reconstructing missing free text. It assigns only the
plan/checkpoint/event/rule behavior that Event Discipline measures; broader
outcome recommendations stay in the report instead of being mislabeled as
drill evidence. The V2 evidence profile and
tracks use the same compact ledger. Reviewed built-in scenario-version aliases
remain eligible for the same evidence context, but unreviewed mismatches do not.
Comparable trends require the same canonical scenario version, drill/rubric
content, mode, broker mode, and full broker fingerprint. A legacy attempt with
only a broker label may remain assessed process evidence, but it cannot support
a broker-comparable trend or coach transfer/repeat decision. Clearing history clears both logical layers;
removing one report also removes ledger records matching that run id or
run-instance id. If no full reports remain while compact evidence still exists,
the history view keeps **Export practice archive** and **Clear history**
available and identifies the ledger-only state instead of presenting the device
as empty.

New checkpoint responses record only the events the learner explicitly selected
as influencing the decision. Older attempts that contain checkpoint membership
but no explicit-link provenance remain readable, yet their prior automatic link
counts are excluded from evidence, trends, coach claims, shared assessed scores,
and track credit.

The full-report and compact-ledger layers are committed together inside one
verified canonical storage envelope. Historical `run-history.v1` and
`practice-ledger.v1` keys are read only when that envelope is absent, then
migrated together. A malformed canonical envelope fails closed instead of
reviving potentially stale legacy keys. Same-origin tabs use an exclusive Web
Lock for complete read/merge/write mutations when the browser supports it. A
revisioned compare-and-swap/rebase loop remains the fallback and detects a
concurrent change instead of silently accepting last-writer-wins data loss.

The current replay-session key is `.v2`, while the document inside it is format
version 4. It pins the scenario replay-contract identity and a canonical
fingerprint of every active broker execution setting. A current restore requires
that fingerprint to match both the serialized broker and the broker configuration
the app would install; changed commission, spread, slippage, leverage, liquidity,
hours, or margin settings fail closed.

Scenario versions compare exactly after a deliberately small built-in migration
map is applied. The ECB observation-only and retrieval-stamped identities are
reviewed aliases of their current full replay-contract hashes; the prior
full-contract hashes are also reviewed after a metadata-only derivation
disclosure update. Three unchanged synthetic scenarios retain their former
missing version as an alias of their first pinned version. BTC v2 changes a
replay-visible event timestamp, so BTC v1 and a missing BTC identity fail closed.
No other missing or unknown value is promoted: unreviewed values compare only by
exact equality. Imported scenarios must carry a non-empty author version; the
browser replaces it with an app-derived full-contract SHA-256, including
scenario-authored drills, before persistence. They cannot be replaced under the
same id until the installed package is removed.

Ordinary version-1 through version-3 sessions may migrate through those scenario
rules only when their serialized broker settings still exactly match the broker
that the stored mode and broker label imply. Professional, Blind, and Challenge
restores must carry the scenario-broker label. An accepted restore is persisted
as format version 4 with an enforceable broker fingerprint. Any version-1
through version-3 practice session is rejected because it lacks the complete
immutable drill identity. A current practice backup pins the scenario identity
plus drill id, competency, definition version, rubric, and normalized definition
snapshot. An active drill session can contain the user's free-form checkpoint
reflections and explicit event selections; do not confuse it with the compact
ledger, which intentionally strips them.

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
is recomputed before installation. A current backup pins the canonical scenario
data version and full active broker fingerprint and, for practice, the full drill
identity and normalized definition. Reviewed built-in version aliases can migrate
to the canonical version; all unreviewed mismatches fail. The backup does not
embed an imported scenario package, so the matching package must already exist
in the destination browser.

The in-app **Import practice archive** control accepts the V2
`market-time-machine-practice-archive` document, up to the UI's 25 MB file
limit. It strictly validates every run and compact entry before merging anything,
keeps existing same-id records when content conflicts, and retains at most 12
full reports plus 250 compact entries. It also accepts the previous
`market-time-machine-run-history` version `1` export and derives factual,
unassessed ledger entries. The complete merged envelope is byte-verified after
one canonical write; a failed write or readback restores the prior envelope. A
practice archive is not an active-session backup and cannot be used as a
scenario package. It is also editable plain-text JSON: validation detects
malformed or internally contradictory records but cannot prove authorship or
detect every intentional, internally consistent alteration. Practice evidence
and track progress are local self-assessment aids, not tamper-proof
certification.

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
The package must declare a non-empty author data version, but the browser stores
an app-derived SHA-256 over the full replay contract—including authored drills—
so reusing the label cannot make changed content look identical to a saved run.

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
timestamps, duplicates, finite values, OHLC relationships, metadata, tick size,
and output paths, and stages the generated `index.ts`/`README.md` pair before
replacement, restoring the prior pair if installation fails. CamelCase CSV
timestamp headers are accepted. FX imports default to a `0.0001` tick and can
override it with `--tickSize=<positive number>`; the chosen tick is part of the
content-addressed scenario version.

Default output under `src/data/scenarios/local-*/` is gitignored and discovered
only by the development server. Production builds replace local discovery with
an empty registry. The importer also refuses output under production-copied
`public/`/`dist/` or bundled `src/` roots. The browser app does not upload the
input file. Other custom output paths may be git-visible, so inspect `git status`
and confirm redistribution rights before sharing anything.

## Financial And Data Safety

- The app is for education, research, and historical simulation.
- It is not investment advice, a broker, an exchange, a recommendation engine,
  or a guarantee of trading performance.
- Sample or derived candles are not equivalent to executable market quotes.
- Local/Pages challenge modes do not protect future data from technical users.
- Never import data unless its local-use and redistribution terms are understood.
