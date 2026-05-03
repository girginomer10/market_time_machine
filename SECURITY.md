# Security Policy

Market Time Machine is a local-first educational application. It does not currently provide hosted user accounts, payment flows, broker connectivity, or real-money trading.

## Supported Versions

Security fixes target the `main` branch while the project is in open source alpha.

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

## Financial Safety

This project is not a broker, exchange, trading system, or investment adviser. Security reports should not include real brokerage credentials, account identifiers, or private financial records.
