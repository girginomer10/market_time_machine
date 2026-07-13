# Security Policy

Market Time Machine is a local-first educational application. It does not currently provide hosted user accounts, payment flows, broker connectivity, or real-money trading.

## Supported Versions

Security fixes for Local Lab v1 target the `main` branch. Local development and
CI require Node.js 22 or newer; Node.js 22 and 24 LTS are the supported release
lines. Reports for behavior that reproduces only on an end-of-life Node.js
version may require confirmation on a supported release. Hosted accounts,
server-side authorization, payments, and broker connectivity are not part of
the Local Lab v1 security boundary.

## Reporting A Vulnerability

Please do not open public issues for sensitive security reports.

If you find a vulnerability, contact the maintainer privately through GitHub profile contact options or use GitHub's private vulnerability reporting if it is enabled for the repository.

Include:

- A short description of the issue
- Reproduction steps
- Impact and affected files
- Any relevant environment details

## Sensitive Data

Do not commit:

- API keys or access tokens
- `.env` files
- Private keys or certificates
- Raw production logs
- Proprietary market data
- Generated local market data whose upstream terms prohibit redistribution

## Browser Storage And Offline Cache

The app automatically saves replay state, orders, fills, audit events, finished
reports, bounded completed-run history, imported scenario packages, and journal
notes in origin-scoped `localStorage`. Production builds also use a service
worker to cache same-origin static app assets. The service worker deliberately
does not cache cross-origin traffic, non-GET requests, or generic API responses.

The current runtime has no account system, analytics SDK, telemetry collector,
payment flow, or broker connection. Exported session and report JSON files are
plain text and are not encrypted. Do not put credentials, account identifiers,
private financial records, or secrets in journal notes or imported data.

See [Privacy And Local Data](docs/privacy-and-local-data.md) for the exact
storage map and deletion instructions.

## Financial Safety

This project is not a broker, exchange, trading system, or investment adviser. Security reports should not include real brokerage credentials, account identifiers, or private financial records.
Sample or derived candles are not executable quotes, and static local/Pages
challenge modes cannot prevent a technical user from inspecting future data.
