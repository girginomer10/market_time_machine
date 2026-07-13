# Support

Market Time Machine Local Lab v1 is an open source, local-first product. Support
happens through GitHub; there is no hosted account, managed data, or broker
support service in this release scope.

## Good Places To Start

- Setup and usage: [README](README.md)
- Scenario creation: [Scenario Authoring](docs/scenario-authoring.md)
- Project direction: [Roadmap](docs/roadmap.md)
- Architecture: [Architecture](docs/architecture.md)
- Installation and deployment: [Release And Deployment](docs/release-and-deployment.md)
- Session storage, deletion, and JSON imports: [Privacy And Local Data](docs/privacy-and-local-data.md)

## Asking For Help

Open a GitHub issue when you have:

- A reproducible bug
- A scenario data question
- A documentation gap
- A feature proposal
- A contribution you want to discuss before implementing

Please include your operating system, Node.js version, the command you ran, and the relevant error output.

For PWA or offline problems, also include the browser/version, installed versus
browser-tab mode, the deployed URL, whether the first online load completed,
and whether clearing the app's site data resolves the issue.

For JSON problems, state which path you used:

- in-app **Restore** for a previously exported session JSON; or
- in-app **Import scenario package** for a complete Market Time Machine scenario
  package JSON; or
- `npm run import:ohlcv` for a user-owned CSV/JSON market dataset.

These formats are intentionally different. Do not attach proprietary market
data, private journal content, account details, or credentials to a public issue.

## Not In Scope

This project cannot provide investment advice, trading recommendations, broker support, tax advice, or legal advice about your data rights. For scenario data licensing questions, start by documenting the source terms clearly in the issue or pull request.
