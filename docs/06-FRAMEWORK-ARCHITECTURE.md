# 06 — Framework Architecture

## Layout

```text
automation/
├── playwright.config.ts      projects, reporters, web server, isolation defaults
├── tsconfig.json             strict typecheck for the suite (npm run typecheck:automation)
├── config/
│   ├── env.ts                every environment value + the production-URL refusal
│   ├── global-setup.ts       fails fast on a missing/stale dist/, records the build id
│   └── summary-reporter.ts   reports/summary.md: totals, failures, known defects, IDs
├── data/
│   ├── files.ts              the shared test-data catalogue (facts next to the bytes)
│   ├── <area>-files.ts       per-area data: canvas, content (catalog), documents (scans), shell (tours, locales)
│   ├── builders/             in-memory generators, no binaries: pdf, png, largePdf (200 pages), scannedPdf +
│   │                         rasterText (image-only pages with known word positions, for OCR), unicodePdf, shareSnapshot
│   ├── static/encrypted.pdf  the only binary fixture of our own
│   └── test-inventory.csv    source of truth for every test case
├── fixtures/
│   ├── test.ts               the `test` every spec builds on: guards + app/signedIn/project/pdfOpen layers
│   ├── account.ts            + a mocked signed-in MuulOrigin account: test.use({ muulPlan: 'pro' | 'dev' | 'free' | … | null })
│   └── <area>.ts             per-area fixtures on top: backup, canvas, content, documents, mobile, platform, sharing, shell
├── pages/                    one object per screen (Auth, Home, Documents, Settings, DataCenter, Sharing, Support, …)
│   └── CognitiveCanvas.ts    root object: app.home / app.viewer / app.canvas / …
├── components/               shared regions (Shell, PdfViewer + FindBar, CanvasPane/CanvasWorkbench, OCR, document tools, mobile workspace)
├── workflows/                multi-step journeys reused across specs (backup.ts)
├── helpers/
│   ├── idb.ts  backupState.ts  platformDb.ts   IndexedDB reads, whole-library snapshots, schema-version seeds
│   ├── mocks/                stateful fakes of external services (see "External services" below)
│   ├── defects.ts            the known-defect registry
│   └── <area>*.ts            area infrastructure (OCR rows, media recording, pen/touch input, a11y scans, …)
├── assertions/geometry.ts    thread anchoring, normalised paths
├── scripts/build-inventory.mjs  CSV + Playwright's test list + results → docs 04/05, drift check
├── tests/
│   ├── smoke/  sanity/  regression/ (one spec per module)  persistence/  offline/
│   ├── api/  accessibility/  performance/  responsive/ (*.phone / *.tablet / *.ipad specs)
├── reports/                  (git-ignored) html/, junit.xml, results.json, summary.md, test-results/
└── docs/                     01-09 + PROGRESS.md
```

## Layers and their rules

| Layer | Owns | Must not |
|---|---|---|
| **Spec** | One behaviour per test, named `ID plain-language-outcome`, tagged with suite + priority | Hold selectors, sleeps or setup code |
| **Fixture** (`fixtures/test.ts`) | Isolation, guards, booted-app layers | Assert business behaviour |
| **Page / component object** | Locators and single-screen actions; waits that belong to the screen (e.g. `pageRendered`) | Assert outcomes beyond "the action completed" |
| **Workflow** | Multi-screen journeys used by more than one spec | Duplicate a page object's locator |
| **Helper** | Infrastructure: IndexedDB reads, mocks, ZIP parsing, the defect registry | Drive the UI |
| **Assertion** | Reusable expectations with tolerances and messages | Perform actions |

## Key design decisions

1. **Isolation by browser context.** Every test gets a fresh context, hence its own IndexedDB, local and session storage. That makes order irrelevant and allows `fullyParallel`. Setup goes through the UI (PIN, project, upload, ~3-5 s) rather than seeding IndexedDB, so the schema can change without breaking fixtures. Speed comes from removing sleeps, not from shortcuts. Two deliberate exceptions seed IndexedDB directly, because the stored data *is* the subject: the migration tests (a database exactly as an older schema version left it) and the large-data performance tests (500 notes).
2. **Network guard on by default.** A context route aborts every request off the app origin and records it. Specs that need a server use `page.route` mocks, which take precedence. Combined with `assertSafeBaseUrl`, the suite cannot reach production by accident.
3. **Page-error guard.** An uncaught exception in the page fails the test unless it is allow-listed with a reason (`allowedPageErrors`).
4. **Selectors use the app's own semantics.** Roles and accessible names first, then the existing product hooks (`data-tour`, `data-tool`, `data-ws-tool`, `data-item-id`, `data-page`, `data-highlight-id`, `data-area-link-id`, `data-resize-handle`). There is one class-based locator, the toast container, because toasts have no role (DEF-003). It is isolated in `components/Shell.ts`. **No test ids were added to the app.**
5. **State is asserted where it lives.** Canvas counts, saves, cascades and backup contents are read from IndexedDB or the exported ZIP. The DOM is used for geometry and interaction. Positions are compared in world units through the current zoom.
6. **Geometry with justified tolerances.** Thread ends must sit within 4 px of their anchors. That allows for stroke width, sub-pixel layout and one animation frame of lag; anything larger is a visibly detached thread. Highlight paths must be fully inside 0..1.
7. **Known defects are explicit** (`helpers/defects.ts`, `knownDefect()`); see 03 §7.
8. **Reports for humans and machines.** List or GitHub output, HTML with traces, screenshots and videos on failure, JUnit for CI, JSON for the inventory script, and a Markdown summary for the QA report.
9. **Config is centralised** in `config/env.ts`: port, base URL, PIN, workers. Nothing else reads `process.env`.

## Fixture layers

```text
app        CognitiveCanvas page objects; nothing loaded
signedIn   app.open → PIN created → first-run Catalog shown (it always opens on a fresh profile; see OBS-009) → Home (empty)
project    signedIn → project "Automation Project" created and open (override with test.use({ projectName }))
pdfOpen    project → FIND_PDF uploaded → open, 4 pages, page 1 drawn
```

Auto fixtures on every test: `blockedRequests` (network guard) and the page-error guard on `page`.

## Projects (browsers and devices)

| Project | Engine and device | Picks up |
|---|---|---|
| `chromium` | Desktop Chrome 1366×800, fake camera and microphone | everything except the folders and suffixes below |
| `phone` | Pixel 5 (Chromium, touch, mobile) | `*.phone.spec.ts` |
| `tablet` | Chromium 1024×1366 with touch | `*.tablet.spec.ts` |
| `ipad` | WebKit with the iPad Pro 11 profile (iPad user agent, 834×1194, touch) | `*.ipad.spec.ts` |
| `offline` | Desktop Chrome with service workers allowed | `tests/offline/` |
| `performance` | Desktop Chrome, always one worker, alone | `tests/performance/` |
| `firefox`, `webkit` | Desktop Firefox and Safari engines | `tests/smoke/` (cross-browser) |

Pen and touch input: on Chromium the tests send trusted pen and touch events through the browser's DevTools input protocol; on WebKit, which has no such channel, they dispatch pointer events in the page, with a comment saying why (helpers/mobileInput.ts). A real Apple Pencil, palm contact and pressure cannot be produced by any browser runner; those stay manual (SAN-004/005).

## External services

Every external service is a **stateful fake** inside the test, attached with `page.route`, so tests can check exactly what the app sent and what it did with each answer. None is ever reached for real.

| Fake | Stands in for | Used by |
|---|---|---|
| `mocks/muulAccount.ts` | MuulOrigin sign-in state (`mo_token`), `/api/entitlements` answered from the app's own contract fixtures, `/me`, refresh, logout; a catch-all 404 for anything unmocked | every signed-in spec (via `fixtures/account.ts`) |
| `mocks/cloudBackups.ts` | Muul Cloud backup storage: list with paging, usage, multipart and chunked uploads (SHA-256 checked), download, delete, injected failures | backup, cloud sync, mobile, platform |
| `mocks/moBrowserBridge.ts` | The MoBrowser host bridge: a fake git repository per credential (streamed push, index, ranged reads) and a fake local disk | GitHub, folder and auto backup |
| `mocks/mobileAndroid.ts` | The Muul-Android WebView host, recording every message | mobile |
| `mocks/sharingBackend.ts` | The sharing service: classes, members, copies, inbox, live shares with versions, file store, people search, presence; serves several accounts at once | sharing, live share, team members |
| `mocks/supportBackend.ts` | Support tickets, replies and attachments (bytes parsed back), staff replies on demand | support |
| `mocks/contentCatalog.ts` | The content catalog list (paged) and same-origin item ZIPs | catalog, deep links, assistant |

A pass therefore proves the app's side of each contract. It does not prove the real server behaves the same; the contracts the fakes follow are written in their header comments.

## Live suite: the real servers and the real MoBrowser

`tests/live/` (project `live`, `npm run test:live`) closes that gap for the backup paths. It is opt-in and never part of the regression run.

| Piece | What it does |
|---|---|
| `fixtures/live.ts` | Serves this build's `dist/` at the app's real address (`https://cognitivecanvas.muulorigin.com`) inside the test browser, so the real API accepts it; lets through only MuulOrigin's hosts; signs the QA account in through `helpers/live/signin.mjs`, a separate process so the password never enters a trace or report; deletes every cloud record the test created (by its run tag) whatever the outcome. |
| `helpers/mobrowser/bidi.ts` | A small WebDriver BiDi driver for MoBrowser (Firefox-based, which Playwright cannot drive): launch on a given profile, navigate, evaluate, wait on conditions, **real** pointer and key input (`input.performActions`), native dialogs, file inputs, serving the build at its real address (network interception), and profile-lock checks. |
| `fixtures/mobrowser.ts` | Runs MoBrowser on a dedicated **test** profile (`%LOCALAPPDATA%\cognitive-canvas-qa\mobrowser-profile`), never the user's; refuses to start while the user's MoBrowser is open (their profile is locked); waits for the test profile's lock to be released at the end. |
| `scripts/mobrowser-setup.mjs` | `npm run mobrowser:setup`: opens MoBrowser on the test profile once, so the QA owner can add the test repository and the QA folder in its credential manager. |

Credentials come only from the environment (`CC_LIVE_EMAIL`, `CC_LIVE_PASSWORD`). Traces are off for the live project, because they would record the real session.

## Adding things

- **A new test in an existing area:** add a row to `data/test-inventory.csv` with a new ID, write the test in the matching spec with the ID first in its title and a priority tag, then run `npm run inventory -- --check`.
- **A new screen:** add a page object under `pages/`, expose it on `CognitiveCanvas`, and keep its locators there.
- **A new external service:** add a stateful fake under `helpers/mocks/` (or a simple one to `helpers/mockApi.ts`) and note in its header which contract it follows.
- **A new area with its own setup:** add `fixtures/<area>.ts` that extends `fixtures/test.ts` (or `fixtures/account.ts` when it needs a signed-in user); keep its page objects in `pages/<Area>*.ts`.
- **A defect found by a test:** add it to `helpers/defects.ts` and 08, then call `knownDefect('DEF-nnn')` in the test. Do it only after the failure point is confirmed to be the defect's assertion.
