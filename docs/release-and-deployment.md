# Release And Deployment

Market Time Machine `0.3.0` ships Personal Decision Gym v2 on the Local Lab v1
replay foundation. This guide covers repeatable production builds and manual
static deployment; it does not claim a semantic-version `1.0` stability contract
or promote the local challenge into hosted anti-cheat. Accounts, server-side
authorization, managed cohorts, and broker connectivity remain hosted-platform
work outside this scope.

## Supported Toolchain

- Node.js 22.12 or newer. Node.js 22 and 24 LTS are the supported release lines.
- npm with the committed `package-lock.json`.
- A secure context for installation and offline support: HTTPS in production or
  `localhost` for local testing.

Use the same gate locally and in CI:

```sh
npm ci
npm run check
```

`npm run check` runs lint, tests, the production build, the restricted-data
bundle check, and PWA asset validation. Preview the root-path build with:

```sh
npm run preview
```

## PWA And Offline Behavior

Production builds include a web app manifest, raster icons, and a service
worker. Development mode does not register the worker, which prevents stale
production caches from interfering with local development.

On the first online visit, the worker caches the app shell and the hashed
JavaScript/CSS assets referenced by the built HTML. Later same-origin static
assets use a cache-first runtime strategy. Navigations use network-first with
the cached app shell as the offline fallback. Cross-origin requests, non-GET
requests, and response types that may contain future API or user data are not
cached.

The shipped scenarios are compiled into the static app assets, so they are
available offline after a successful first load. A first visit cannot work
offline. Browser persistence and offline files are separate stores:

- replay state, completed-run history, the compact practice ledger, and imported
  scenarios are in `localStorage`;
- static PWA files are in Cache Storage.

See [Privacy And Local Data](privacy-and-local-data.md) for deletion and export
details. V2 uses the `personal-decision-gym-v2` service-worker cache version so
older Local Lab app-shell/runtime caches are removed on activation. When cache
behavior or a release-critical static surface changes again, bump
`CACHE_VERSION` in `public/sw.js`.

## Manual GitHub Pages Deployment

`.github/workflows/deploy-pages.yml` is deliberately manual. It has only a
`workflow_dispatch` trigger, refuses to build a branch other than `main`, and
does not enable Pages or change repository settings by itself.

One-time repository setup must be performed by a maintainer:

1. In **Settings → Pages**, select **GitHub Actions** as the publishing source.
2. Optionally protect the `github-pages` environment with required reviewers.
3. Configure a custom domain and HTTPS in repository settings if desired. Do
   not add a `CNAME` until the domain is intentionally chosen.

To deploy:

1. Open **Actions → Deploy GitHub Pages**.
2. Choose **Run workflow** on `main`.
3. Review the `Verify and package` job before approving any protected
   `github-pages` environment deployment.

The workflow runs the complete release check, reads the configured Pages base
path, rebuilds Vite for that path, repeats the data-license and PWA checks, and
then uploads/deploys `dist`. This supports both project Pages paths such as
`/market_time_machine/` and a root/custom-domain path without committing a
host-specific Vite configuration.

GitHub Pages is a public static host. Every shipped scenario is downloaded to
the browser, so it remains inspectable by a technical user. Do not describe a
Pages deployment as secure challenge-mode anti-cheat.

## Personal Decision Gym v2 Release Checklist

- [x] `npm ci` and `npm run check` pass on a supported Node.js release.
- [x] Every production scenario is in the explicit shipped allowlist and its
      redistribution rights have been reviewed.
- [x] No `local-*`, generated FRED, credential, or private user-data file is in
      the production bundle.
- [x] First load, refresh, and offline reopen are smoke-tested in a desktop
      Chromium browser on `localhost`; the responsive product flow is also
      verified at a 390 px mobile viewport.
- [x] Session export/restore pins exact scenario/drill identity, imported-lab
      removal and browser-data deletion have regression coverage, and imported
      scenario packages remain an explicit separate prerequisite.
- [x] Event Discipline plan enforcement, checkpoint scheduling, process-only
      assessment, and save/restore behavior have regression coverage.
- [x] Compact-ledger sanitization, competency/rubric evidence grouping,
      exact-context trends, exact-version track credit, and synthetic preview
      non-credit are covered by tests.
- [x] V2 practice archive export/import is deep-validated, atomically persisted
      with rollback, bounded to 12 full reports and 250 compact entries,
      conflict-safe, and compatible with V1 history exports.
- [x] Financial-safety and data-quality language remains accurate.
- [x] `CHANGELOG.md` reflects the release candidate.
- [x] The ECB-based EUR/GBP and EUR/USD scenarios' sources, reuse conditions,
      derived fields, and attribution have been reviewed for this release.
- [x] Synthetic QQQ/KRE practice units are visibly preview-only and cannot award
      unit or track credit.
- [x] V2 is described as a local deliberate-practice product boundary, not as a
      hosted anti-cheat platform, real-world skill certification, or a
      semantic-version `1.0` stability guarantee.

## Post-Deployment Checks

These checks belong to a chosen public deployment, not to the local product
build. They remain intentionally open because the manual Pages workflow has not
been run:

- [ ] Run the manual Pages workflow from `main` and smoke-test the deployed HTTPS
      URL.
- [ ] Confirm the browser's install experience plus installed offline reopen on
      representative desktop and mobile devices.
