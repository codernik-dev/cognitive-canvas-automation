# 01 — Application Analysis

Checked against commit `c54e7e2` (branch `AbhishekBugs`), production build served from `dist/`, 2026-10-29.

Sources used, in order of trust: the running app (Playwright probes, accessibility snapshots, IndexedDB reads), then `src/`, then the repo docs. Where a doc disagrees with the code, the code wins and the disagreement is listed under [Documentation drift](#documentation-drift).

## 1. Architecture summary

Cognitive Canvas is an offline-first, single-page PWA. It has no backend of its own: every byte of user data lives in the browser's IndexedDB. Optional MuulOrigin services add catalog, plan, sharing, support and cloud backup.

```
index.html ── loads 2 MuulOrigin SDK scripts (auth-bridge.js, backup.js)
  └─ main.tsx ── initI18n() ── import('bootstrap.tsx')  (theme, debug capture, SW registration, <App/>)
        └─ App.tsx  screen state machine (no router):
             loading → setup (PIN) → login (PIN) → settings | sharing | team | catalog | projects | workspace
                                                                                         └─ split pane:
                                                         DocumentPane (pdf.js viewer + tools)  |  WorkspacePane (infinite canvas)
                                                                              └── ConnectionThreads (SVG, rAF) joins the two ──┘
State: Zustand, 15 slices (src/store/slices).   Persistence: IndexedDB `cognitive-canvas` v13 via idb, debounced auto-save.
```

- **Screens are chosen from store flags, not URLs.** `src/app/AppRouter.tsx` is an empty stub. Where you are (`currentProject`, `activeDocumentId`, settings tab) is kept in `sessionStorage` (`cc-nav-session`), so a reload reopens the same document.
- **Hosts:** an ordinary browser, MoBrowser (a Firefox fork) and the Muul-Android WebView. The last two expose `window.externalMessage`, which turns on Git and local-folder backup.
- **Network:** the API base is `https://api.muulorigin.com` in production builds (`src/config/api.ts`). The dev server proxies `/muulapi`.

## 2. Technology stack

| Layer | Technology (version in package.json) |
|---|---|
| UI | React 19.2, TypeScript 5.9 (strict), Tailwind CSS 4 |
| Build | Vite 8 (rolldown); custom service-worker precache plugin in `vite.config.ts` |
| State | Zustand 5 |
| Storage | IndexedDB via `idb` 8; second DB `cc2-recording-spool` for recording chunks |
| PDF | pdf.js 6.4 (README says 3.11; out of date), worker and assets bundled under `public/pdf` |
| OCR | Tesseract.js 5, language data bundled under `public/ocr` (eng, hin, pan, jpn, ara, fra, deu) |
| ZIP | fflate |
| Security | DOMPurify, marked |
| Tests | Vitest 5 (unit, 83 files), Playwright 1.64 (e2e) |

## 3. Module inventory

| Module | Main source | Size (non-test TS/TSX lines, top level of the folder) |
|---|---|---|
| Auth (local PIN) | `components/auth`, `services/auth`, `store/slices/authSlice.ts` | ~3,250 |
| App shell, header, settings, tours | `App.tsx`, `components/shared`, `components/tours`, `components/shared/settings` | ~8,600 |
| Projects (home) and Data Center | `components/projects`, `components/projects/DataCenter` | ~3,000 + |
| Documents and PDF viewer | `components/documents` (+ header, tools, textSelection), `services/pdf`, `services/documents`, `services/upload` | ~10,400 + |
| OCR | `services/ocr` | ~600 |
| Workspace canvas | `components/workspace` (+ canvas, items, tools, imagetools) | ~3,700 + |
| Media (audio/video/image) | `services/media`, `services/image`, `hooks/useMediaRecorder.ts` | ~1,700 |
| Backup and restore | `services/backup`, `services/archive` | ~6,600 |
| Sharing and live share | `components/sharing`, `services/sharing` | ~12,100 |
| Sync (change feed) | `services/sync` | ~1,600 |
| Catalog | `components/catalog`, `services/catalog` | ~3,100 |
| Subscription and plans | `services/subscription` | ~1,300 |
| Support center | `components/shared/support`, `services/support` | ~1,000 + |
| i18n | `i18n` (en, hi, pa, fr, de, ja) | ~300 + catalogs |
| PWA | `services/pwa`, `public/sw.js`, `public/boot.js` | ~230 + |
| Mobile UI | `components/mobile`, `hooks/useIsPhone.ts` | ~1,200 |
| Assistant (CC-bot) | `services/cc-bot` | ~900 + vendor |

## 4. Feature inventory and classification

Classification: **T** testable offline · **E** needs an external service · **S** stubbable or mockable · **F** feature-flagged or conditional · **P** partial · **N** planned or not implemented · **D** device-dependent · **K** blocked by a known issue.

| Area | Feature | Class | Evidence (source / observed) | Covered by |
|---|---|---|---|---|
| Auth | PIN setup (exactly 6 digits, PBKDF2-SHA256 200k hash in `users`) | T | `SetupScreen.tsx`, `authService.ts`, `utils/crypto.ts`; probe | SMK-002, REG-001..003 |
| Auth | Unlock; 5 wrong attempts then 30 s lockout kept in localStorage | T | `pinLockout.ts`, `LockedView.tsx` | SAN-002, REG-004 |
| Auth | Forgot PIN (maths captcha, keeps data) | T | `ForgotPinCaptchaModal.tsx` | REG-005 |
| Auth | Change PIN | T | `ChangePinModal.tsx` | REG-006..008 |
| Auth | Session in sessionStorage; new tab adopts it via BroadcastChannel `cc2-auth`; Lock locks all tabs | T | `utils/authBroadcast.ts` | SAN-003, REG-009, PST-003 |
| Auth | Idle auto-lock (`sessionTimeoutMinutes`) | N | stored, never read | — |
| Auth | MuulOrigin SSO | F/P | parked (`docs/SSO-PARKED.md`); `mo_token` adds identity only | API-003/004 (signed-out gates) |
| Shell | Back-button guard ("Leave Cognitive Canvas?") | T | `BackNavigationGuard.tsx` | REG-086 |
| Shell | Ctrl+P blocked; Ctrl+K quick search; Esc/Enter on modals | T | `useGlobalPrint.ts`, `GlobalSearchModal` | REG-085 |
| Shell | Server-unreachable banner after 2 failed API calls | S | `ApiOfflineBanner.tsx` | not automated |
| Shell | Error boundary with "Copy diagnostics" | T | `AppErrorBoundary.tsx` | not automated (needs a forced crash) |
| Settings | Appearance (Light/Dark/System, 9 styles, accents, Law layout) | T | `SettingsPage.tsx`, `useTheme.ts` (html `dark` class) | SMK-008, REG-082, REG-110 (planned) |
| Settings | Language (en, hi, pa, fr, de, ja; reload on switch) | T | `i18n/index.ts` | REG-083 |
| Settings | Shortcuts, Tool Guide, Tutorials (YouTube) | T / E | `shortcutsData.ts`, `config/tutorialVideos.ts` | REG-084 |
| Settings | Plan, Support, Team Members | E | `SupportPanel.tsx` (sign-in gate) | REG-108 manual |
| Onboarding | Guided tours (6), started only from the header | T | `GuidedTour.tsx` | REG-098 planned |
| Projects | Create (1-100 chars, letters/digits/spaces, no duplicate check) | T | `utils/projectName.ts` | SMK-003, REG-010..012 |
| Projects | Search, rename, delete (cascades 12 stores), card doc count | T | `ProjectSelectionScreen.tsx`, `projectsStore.ts` | REG-013..016 |
| Projects | Bulk delete (Select mode) | T | `BulkDeleteProjectsModal.tsx` | REG-096 planned |
| Projects | Upload from Home (pdf, md, txt, zip, ccbak; 100 MB) | T | `ProjectSelectionScreen.tsx` | REG-017, REG-018 |
| Documents | Upload in project (pdf, md, txt; content sniffing; size caps) | T | `DocumentListView.tsx`, `fileSniff.ts`, `importError.ts` | SMK-004, REG-032..038 |
| Documents | Delete with cascade; reorder by drag | T | `deleteDocuments.ts` | REG-040, REG-095 planned |
| Documents | Rename / move between projects | N | no UI | — |
| Documents | Classification badge (Law mode only) | F | `ClassificationBadge.tsx` | REG-019 planned |
| PDF | Render, virtualised pages, zoom 50-250 %, page nav, single page, focus mode, page index | T | `PdfViewer.tsx`, `PdfPageView.tsx`, `IndexPanel.tsx` | REG-025..031 |
| PDF | Find in document (debounced, case-insensitive, OCR fallback) | T / K | `FindBar.tsx` | SMK-007, REG-020..024 (DEF-001) |
| PDF | Freehand highlight (6 colours, pen/highlighter tips), eraser, undo/redo (60 deep, highlights only) | T | `PdfHighlightLayer.tsx`, `historySlice.ts` | REG-042..045 |
| PDF | Select Area → note; Extract Image → image + blob; Link Area; Link Doc | T | `PdfSelectAreaOverlay.tsx`, `PdfExtractImageOverlay.tsx`, `PdfAreaLinkOverlay.tsx` | REG-046..049 |
| PDF | OCR (page/range/all, 7 languages, queued in background) | P (slow) | `ocrService.ts` | REG-090/091 planned |
| PDF | Long-press OCR / text menu | N | hard-coded off (`needLongPressOcr = false`) | — |
| PDF | Drag selected PDF text to the canvas | P | `PdfTextDragHandler.tsx` (HTML5 DnD) | not automated |
| Scanner | Camera capture, gallery, note pages, HEIC decode, save as PDF | T (fake camera) / D | `CameraScannerModal.tsx` | REG-080, REG-081, SAN-006/008 manual |
| Canvas | Note, Text, Line, Ink/Eraser, Audio, Video, Document items | T | `components/workspace/tools/*`, `items/*` | SMK-005, REG-055..066, REG-074..079 |
| Canvas | Move, resize (notes/images), duplicate (Ctrl+D), multi-select, box select, Ctrl+A, layering, align/distribute | T | `panTool.ts`, `ResizeHandles.tsx`, `workspaceSlice.ts`, `ContextMenu.tsx` | REG-056..059 |
| Canvas | Pan/zoom (0.1-2.0), mini-map, timeline, page focus, unlinked filter | T | `CanvasCamera.ts`, `MiniMap.tsx`, `WorkspaceBottomBar.tsx` | REG-063..066 |
| Canvas | Undo/redo, copy/paste, locking | N | not present | — |
| Canvas | Quiz items, mindmap | N | renders existing only / types only | — |
| Links | Area links + SVG threads (rAF), item-to-item links, highlight-stroke links | T | `ConnectionThreads.tsx`, `ItemLinkOverlay.tsx`, `HighlightStrokeBridge.tsx` | REG-048..054, REG-067, REG-094 planned |
| Media | Audio upload (MP3 only, 100 MB), record (10 min/64 MB), link (direct or embeddable) | T / D | `AudioCreateModal.tsx`, `useMediaRecorder.ts` | REG-074..078 |
| Media | Video upload (MP4), record, link | T / D | `VideoCreateModal.tsx` | REG-092/093 planned |
| Backup | Local ZIP export (single/multi) and restore (preserve ids; same id replaces) | T | `backupService.ts`, `restoreService.ts`, `RestoreView.tsx` | SAN-010/011, REG-070..073 |
| Backup | Cloud (Pro), GitHub (Economy + MoBrowser), local folder (MoBrowser), auto backup | E / S | `cloudBackupApi.ts`, `bridgeService.ts`, `vaultDestinations.ts` | API-003/004, REG-101..103 |
| Sharing | Classes, people, inbox, live share, board | E | `services/sharing` (live backend only) | REG-100 manual |
| Sync | Cross-device change feed | F / K | off by default (`?workspaceSync=1`) | REG-104 blocked |
| Catalog | Explore Content (no offline fallback; auto-opens with zero projects) | E / S | `remoteCatalog.ts` | API-001/002, REG-105 planned |
| Deep links | `/download/<slug>` | S | `services/deepLink` | REG-106 planned |
| PWA | Service worker precache (51 assets), update banner | **K** | `registerSW.ts`, `public/sw.js` | OFF-000/001 (DEF-007), REG-107 blocked |
| Offline | Works after the network drops mid-session | T | IndexedDB-only data path | OFF-002, OFF-003 |
| Assistant | Offline intent engine (create/open project, catalog) | T | `services/cc-bot` | REG-099 planned |
| Mobile | Phone layout (<640 px): Menu sheet, bottom nav, Document/Split/Canvas switch | T (emulated) / D | `components/mobile`, `useIsPhone.ts` | REG-087/088 |
| Touch / pen | Touch tools, pinch, Apple Pencil arbitration (`hasPenInput`) | D | `useCanvasEvents.ts`, `usePenGestureGuard.ts` | REG-089 (emulated), SAN-004/005 manual |

## 5. Main user journeys

1. **First run.** PIN setup → (Catalog opens once, because there are no projects) → Home → create project → upload PDF → document opens beside an empty canvas.
2. **Study loop.** Read → highlight / Select Area / Extract Image → notes appear on the canvas, linked by threads → arrange, link and annotate notes → everything auto-saves.
3. **Return visit.** Open the app → unlock with the PIN → the last document reopens in the same tab. A new session (all tabs closed) asks for the PIN again.
4. **Protect the work.** Data Center → Local export (ZIP) → restore on another profile or device. Cloud and GitHub need a plan or MoBrowser.
5. **Phone.** The same flows, but one pane at a time (Document / Split / Canvas) and the header collapses into a Menu sheet.

## 6. Business rules worth testing (from source)

- **PIN:** exactly 6 digits. 5 failures lock entry for 30 s; the lock survives a reload. A successful unlock or expiry resets the counter. Change-PIN failures count towards the same lockout.
- **Project name:** trimmed, 1-100 characters, `^[a-zA-Z0-9 ]+$`. Duplicate names are allowed.
- **Uploads:** the content must match the extension (sniffed). In a project, PDF size is unlimited on desktop and capped at 50 MB on phone/tablet; md/txt at 10 MB. From Home the cap is 100 MB. One file opens; several stay on the list.
- **Deletes cascade.** Deleting a project clears every project-scoped store. Deleting a document removes its text, highlights, links, items and orphaned media.
- **Coordinates:** highlights and area-link rectangles are stored as page fractions (0..1). Canvas items are stored in world units, and pan/zoom is not persisted.
- **Saves are debounced** by 300 ms per collection. Only workspace items flush on pagehide.
- **Restore** keeps record ids. A project with the same id is replaced, with no copy/skip choice. Multi-project restore is not atomic.
- **Plans:** signed out means Free. GitHub needs Economy, Cloud needs Pro. Local is always free.

## 7. State and data dependencies

| Where | Keys / stores | Meaning |
|---|---|---|
| IndexedDB `cognitive-canvas` v13 | `users, projects, documents, searchText, workspaceItems, highlights, itemLinks, areaLinks, calendarEvents, canvasStrokes, highlightStrokeLinks, mediaBlobs, textHighlights, textAreaLinks, lawEvents, recordTombstones, binaryIndex` | All user data. Every store is keyed by `id` except `binaryIndex` (`key`). |
| IndexedDB `cc2-recording-spool` v1 | `takes`, `chunks` | Recording crash-safety spool |
| sessionStorage | `cc-auth-session`, `cc-nav-session`, `cc2_show_settings`, `cc2_settings_tab` | The unlock and "where you were" |
| localStorage | `cc-theme`, `cc-color-theme`, `cc-style-theme`, `cc2_locale`, `cc2_pin_failed_attempts`, `cc2_pin_locked_until`, `mo_token`, `cc2_subscription_*`, `cc2_flag_*`, `cc2_toolbar_pinned`, `cc2_debug_capture_v1` | Preferences, lockout, plan cache, flags |

## 8. External dependencies

| Dependency | Used for | Offline behaviour (observed) |
|---|---|---|
| `www.muulorigin.com/assets/sdk/auth-bridge.js` and `backup.js` (script tags in index.html) | SSO bridge, MuulBackup widget | Aborted in tests; the app boots normally |
| `api.muulorigin.com` (`/api/iam/auth/me`, `/api/catalogs`, `/api/entitlements`, `/api/backups*`, `/api/sharing/*`, `/api/sync/*`, `/api/support/*`, `/api/version`) | Identity, catalog, plan, cloud backup, sharing, sync, support | The catalog shows "Failed to load content"; the plan falls back to its cache; the rest is gated behind sign-in |
| YouTube / Vimeo / Spotify / SoundCloud | Tutorial videos, media embeds | Not contacted on the core journey (API-005) |
| MoBrowser / Muul-Android bridge (`window.externalMessage`) | GitHub and local-folder backup, "Open with" | Absent in an ordinary browser; the UI says so |

## 9. Testability constraints

- **The store is not exposed in production builds** (`window.__cc2` is dev only). Assertions read IndexedDB (`automation/helpers/idb.ts`) or the DOM.
- **Page virtualisation:** a page's canvas is 0×0 until it nears the viewport, and overlays mount only after the first render. All page work waits on `pageRendered(n)`.
- **Canvas culling:** off-screen items are not in the DOM, so item counts come from IndexedDB.
- **rAF-driven threads:** geometry assertions poll (`assertions/geometry.ts`).
- **Pointer capture** needs real Playwright mouse input; synthetic `PointerEvent`s throw.
- **Toasts have no role or test id.** The only stable scope is the container class (isolated in `components/Shell.ts`). This is also accessibility defect DEF-003.
- **Several labels are not tied to their inputs** (Change PIN). The page objects use placeholders there (DEF-005).
- **Native `confirm()`** is used for restore and for media deletes, so specs handle `page.on('dialog')`.
- **Timers:** lockout 30 s, toasts 3.5 s, find debounce 200 ms, auto-save 300 ms. `page.clock` is used for the lockout; everything else is awaited through state.
- **Fake camera and microphone** (Chromium flags) prove the browser flow, not real hardware.
- **No test hooks were added to the app.** Every selector uses what the product already ships: roles, labels, `data-tour`, `data-tool`, `data-item-id`, `data-page`, `data-highlight-id`, `data-area-link-id`.

## 10. Known limitations and functional risks

| Risk | Why it matters | Evidence |
|---|---|---|
| **No offline install** (DEF-007) | The product's first non-negotiable is "offline-first". With no service worker, a reload without a network shows nothing. | OFF-000/001; `load` fires at ~154 ms, the bundle that adds the `load` listener evaluates at ~232 ms |
| Find does not reach unread pages (DEF-001) | The core reading feature fails for most real searches | REG-020; probe on pages 2 and 4 |
| Restore errors are masked (DEF-002) | Users cannot tell a wrong file from a broken one | REG-072 |
| Empty project left by a failed Home upload (DEF-004) | Clutter, and confusing "0 docs" projects | REG-018 |
| Multi-project restore is not atomic | A failure part-way leaves a half-restored library | Source review (`restoreService.ts`); not automated |
| Whole backup ZIP is buffered in memory | Large libraries may crash low-memory devices | Source review (`backupService.ts`); PRF-004 planned |
| Cloud sync and live share run timers against a real backend when signed in | Tests must never carry a real token | Guarded by the network guard |

## 11. Testing recommendations

1. Make the offline promise a release gate: OFF-000/001 in CI (they are), and a fix for DEF-007 before the next deploy.
2. Add `role="status"` to the toast container and `htmlFor`/`id` to form labels. These are small changes that fix two accessibility defects and give tests stable hooks.
3. Keep e2e selectors on the existing semantic hooks. Add a `data-testid` only for canvas internals that have no role (resize handles already have `data-resize-handle`).
4. Build the two missing fixtures that block planned cases: a small MP4 (REG-092) and a scanned image-only PDF (REG-090/091).
5. Stand up a staging MuulOrigin tenant with throwaway accounts so the sharing, cloud backup and support cases (REG-100/101/108) can move from manual to automated.

## Documentation drift

| Doc says | Code / observed | Where |
|---|---|---|
| IndexedDB schema version 4, 13 stores, a `bookmarks` store | v13, 17 stores; `bookmarks` is deleted on upgrade | `docs/03-data-model.md` |
| pdf.js 3.11.174 | pdfjs-dist 6.4.299 | README.md tech stack |
| `?nc=1` used by the e2e boot (implied meaning) | No code reads `nc` | `e2e/app.ts` |
| Restore always remaps ids and adds "(restored)" | Data Center restore preserves ids and replaces | `docs/08-backup-restore.md` |
| "Coverage 8.9 %" floor comment | Measured 50.3 % statements today (see 02) | `vitest.config.ts` |
| Canvas tool "palette" opened with "Open palette" | The canvas palette is always visible on desktop; "Open palette" belongs to the PDF toolbar | `e2e/app.ts placeTool` |
