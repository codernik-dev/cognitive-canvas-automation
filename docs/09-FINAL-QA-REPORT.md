# 09 — Final QA Report

**App under test:** Cognitive Canvas, commit `c54e7e2` (branch `AbhishekBugs`), production build served from `dist/` (stamped `c54e7e2-dirty`; the "-dirty" is line endings only, OBS-004). No application file was changed by this work.
**Environment:** Windows 11 laptop, Node 24.13, Playwright 1.64.1 (Chromium 1248, Firefox 1555, WebKit 2370), 8 logical CPUs, MoBrowser (Firefox 152 based) for the live MoBrowser tests. The machine was shared with other work, including another project's Playwright suites: the CPU was at 100 % for most of Runs 9 and 10.
**Dates:** 2026-10-29 to 31.

Every number below comes from a recorded run (`results.json` under `automation/reports/<run>/`). Nothing is estimated. The workbook `Cognitive-Canvas-Test-Suites.xlsx` holds the same data case by case.

## 1. Headline

- **871 test cases in 35 modules, 864 automated (99.2 %).** Every user-facing feature found in the source has at least one case. The 7 not automated need a real iPad, Apple Pencil, Android build, operating-system prompt or screen reader (6, manual), or a gesture event Playwright's WebKit on Windows cannot create (1, blocked). Each of those names the emulated tests that cover everything around it.
- **A review of every complex-tool and backup test (2026-10-31 morning) made 35 tests prove more:** what was stored, exactly where it was placed, and what is on screen. It also added a page-in-view check to every page-number check, and found a new app defect, **DEF-213** (§3).
- **Final full run on the reviewed suite (Run 10): 849 executions on desktop Chrome, phone, tablet, iPad (WebKit) and an offline profile, in 60 minutes: 742 passed, 100 known defects reproduced, 6 failed, 1 parked.** Every failure was traced:
  - 5 GitHub tests hung together for 3 minutes under heavy machine load, then passed 15 of 15 on re-check;
  - 1 tablet test hit the intermittent app defect DEF-806.

  The run before the review (Run 9) had 749 passed, 99 known defects and 0 failures. No retries are allowed, so nothing passed by being tried again.
- **Live suite against the real servers (Live 4): 6 / 6 passed.** A real MuulOrigin sign-in, a real Muul Cloud backup and restore, a real sign-out, cloud auto-sync between two browsers, and the real MoBrowser host and its GitHub and folder pickers. Two GitHub and folder round trips wait for a one-time setup in the MoBrowser test profile (§3).
- **Performance: 8 / 8 within budget** (Performance 3, run alone). **Cross-browser smoke: 16 / 16** on Firefox and WebKit.
- **77 application defects found and written up** in plain language with steps (08): **6 P1, 25 P2, 46 P3**. Of these, 73 are reproduced on every run by a test that checks the correct behaviour, and 4 are intermittent. The six P1s:
  - **DEF-902** a backup loses the text OCR read from scanned pages;
  - **DEF-916** offline, opening a screen not used yet reloads the app into a blank page;
  - **DEF-505** a document the teacher stopped sharing in a live share is sent to students again;
  - **DEF-906** projects and documents cannot be opened with the keyboard;
  - **DEF-007** the app cannot open without internet (the offline helper never installs);
  - **DEF-001** Find does not take you to a match on a page not viewed yet.
- **Traceability:** every automated case is carried by a test with its ID, checked by `npm run inventory -- --check` (0 drift).

## 2. Inventory and coverage

| Measure | Value | Definition |
|---|---|---|
| Test cases | **871** (Smoke 8, Sanity 11, Regression 852) | `data/test-inventory.csv` |
| Modules | 35 | Product areas; each has its own spec file(s) under `tests/regression/` (103 spec files in all) |
| Automated | **864** (765 plain + 99 known-defect) | A test carries the ID and asserts the expected result |
| Manual | 6 | SAN-004/005/006/008/009 (real iPad, Pencil, Android build, OS prompts, install) and A11Y-007 (screen reader) |
| Blocked | 1 | REG-886 (Safari gesture event; needs macOS or a real iPad) |
| **Scenario automation coverage** | **99.2 %** (864 / 871) | Automated ÷ all cases |
| P1 cases automated | **182 / 184** | The two not automated are SAN-004 and SAN-005 (real iPad and Pencil) |

| Sub-suite | Cases | Automated | Script folder |
|---|---:|---:|---|
| Smoke | 8 | 8 | `tests/smoke` |
| Sanity | 11 | 6 | `tests/sanity` (plus 78 regression cases tagged `@sanity`: the Sanity run executes 84) |
| Functional (module-wise) | 655 | 655 | `tests/regression` |
| Responsive (phone / tablet / iPad) | 87 | 86 | `tests/responsive` |
| Live (real servers, real MoBrowser) | 8 | 8 | `tests/live` (opt-in, QA account) |
| API contracts | 5 | 5 | `tests/api` |
| Persistence and migration | 26 | 26 | `tests/persistence` |
| Offline and PWA | 13 | 13 | `tests/offline` |
| Accessibility | 50 | 49 | `tests/accessibility` |
| Performance | 8 | 8 | `tests/performance` |

The assertions prove both the visible outcome **and** the stored state. The stored state is read back from IndexedDB, the downloaded ZIP or file, or the exact request the app sent to a mocked server. Where it matters, a negative check confirms that nothing was duplicated, nothing else was deleted and no request was sent. Every module was held to this standard.

For tools that place something, the test checks **where** it went as well as that it exists:
- **OCR:** known words are drawn into a scanned page and the real OCR engine reads them. The test asserts each stored word and its position within 2 % of where it was drawn, that Find marks the right word, and that the engine loads only from the app itself, so it works offline.
- **Pen and highlighter:** a stroke drawn from one point to another must run along that line.
- **Selections and Link Area:** a dragged region must be stored as exactly that region.
- **Threads:** a thread must end within 4 px of its anchor.

Coverage by module, type and priority: 05-COVERAGE-MATRIX.md and the workbook's Summary sheet.

## 3. Execution evidence

### This round

| Run | Scope | Passed | Known defect reproduced | Failed | Wall clock |
|---|---|---:|---:|---:|---|
| Module runs (×9) | each module's specs alone, 1 worker, as they were finished | 741 | 100 | 0 | 10-30 min each |
| Performance 3 | 8 budgets, alone, 1 worker, CPU ≈ 30 % | **8** | — | 0 | 2 min 29 s |
| Run 8 | full regression: chromium, phone, tablet, ipad, offline; 2 workers | 743 | 98 | 6 | 58 min 42 s |
| Run 8 re-run | the 7 affected tests, 3× each, PC kept awake | 16 | 3 | 2 | 3 min 20 s |
| Run 9 | full regression before the review: chromium, phone, tablet, ipad, offline; 2 workers; CPU at 100 % from another project throughout | 749 | 99 | 0 | 80 min 46 s |
| **Live 4** | **the whole live suite** on the QA account (real servers, real MoBrowser) | **6** | 0 | 0 | 5 min 6 s |
| Cross-browser 3 | smoke on Firefox + WebKit, final suite | **16** | 0 | 0 | 2 min 13 s |
| Review fixes | the 21 spec files the review touched or that use the new page check | 183 | 19 | 8 | 19 min 52 s |
| Review re-run | the fixed tests, plus REG-031 three times | 36 | 2 | 3 | 5 min 1 s |
| **Run 10** | **full regression on the final, reviewed suite**: chromium, phone, tablet, ipad, offline; 2 workers | **742** | **100** | **6** | 59 min 56 s |
| Run 10 re-check | the 6 affected tests, 3 times each | 17 | 0 | 1 | 2 min 27 s |

Runs 9 and 10 each had 1 parked test (REG-886, reported as skipped), and Live 4 had 2 skipped (REG-905/906, below). Local retries are 0 and `failOnFlakyTests` is on, so no result was obtained by retrying.

### The script review (2026-10-31 morning)

Two independent reviews read every complex-tool and backup test against the app's source. They looked for checks that would let a real bug through. In total they found 6 High, 21 Medium and 9 Low gaps. Every High one and most Medium ones were fixed:

| Area | What the tests now prove that they did not before |
|---|---|
| Page navigation (every page-number check, 12 spec files) | The page is actually in view, not just named by the page counter: the app writes the counter before it scrolls. This found **DEF-213**. |
| Folder, cloud and GitHub backup (REG-101, REG-103, REG-489) | The uploaded ZIP holds the PDF byte for byte, and the restored library equals the backed-up one row for row (PDF compared by SHA-256). |
| Backup ZIP contents (REG-102, REG-481, REG-482) | Each project's own data is inside the ZIP under its id, so a stale ZIP sent with a fresh label is caught. A Free account really restores an old backup (REG-456). |
| OCR Cancel (REG-208, REG-209) | Reading really stopped: page 3 never arrives in the 30 seconds after Cancel. |
| Extract Image (REG-047) | The saved picture shows what is on the page there: it is compared pixel by pixel with that region of the page, and it must contain ink. |
| Find (REG-021, REG-250 to 253) | Each step marks the match on the right page and brings it into view. Clear removes every mark. The mark sits over the exact word (to 1 % of the page width). |
| Highlights (REG-043, REG-044, REG-263) | Redo brings back the identical highlight, and the redone erase gives back the same pieces. The eraser cuts exactly where it passed, and a highlight elsewhere is left untouched. |
| Viewer (REG-029, REG-030) | The drawn page grows and shrinks with the zoom. Single-page view shows exactly one page. |
| Canvas and notes (REG-056, 058, 066, 067, 069, 303, 333, 347, 394) | Exact stored text, position and size. A duplicate is a true copy. A link joins the right two notes. Pictures are stored byte for byte. A dropped picture adds nothing anywhere. |
| Persistence (PST-001 to 003), Link Doc, toolbar (REG-285, REG-280, REG-049) | Row-for-row equality after a reload and after closing every tab. The full stored region of a link. Removing a link keeps its note. |

Left for a next pass, all Low: the document card position on the canvas (REG-399, REG-079), the exact canvas pan distance (REG-064), the duplicate's content in REG-321, a content hash for the second device in REG-104, the scanned PDF's bytes (REG-080), the Done button in REG-356, the match position in REG-024 and REG-254, the exact pill drag in REG-281, and the pen colour step in REG-263.

The review runs also caught 7 of my own mistakes in the new checks, each fixed before Run 10:
- the page check did not handle single-page view;
- the zoom was measured before the pane settled;
- a text box's height was assumed fixed (the app fits it to its line);
- a toast was waited on after it had gone.

### What Run 10 settled

| Test | Cause | Whose problem | Re-check |
|---|---|---|---|
| REG-476, REG-102, REG-457, REG-489, REG-462 (GitHub, simulated MoBrowser host) | All 5 ran in the same 3 minutes of heavy load from another project's suite. The simulated host never answered the push or the restore list, and nothing reached the page. In the same window, every GitHub test that did not need a finished push passed. | Machine load | 15 of 15 passed; both GitHub spec files also passed in full on their own |
| REG-866 (tablet swipe) | App defect DEF-806 (intermittent): page 2 of a freshly opened PDF was on screen but never drawn | App defect | failed 1 of 3, same cause |
| REG-031 (reopen a document) | New app defect **DEF-213**: the page you were reading is remembered but never scrolled to, so the document reopens on page 1 | App defect | marked as expected to fail; reproduced 3 of 3 before marking, and again in Run 10 |

### What Run 9 settled from Run 8

Run 8 had six failures, each traced to its root cause:
- **REG-660, REG-661:** the laptop went into Modern Standby for 12½ minutes mid-run. Evidence: Windows power log entries Kernel-Power 506/507. Long runs now hold a keep-awake request.
- **REG-104:** the test read the sync manifest a moment before the app uploads it. It now waits for the manifest.
- **REG-524:** the test assumed an order of two shares that the app does not promise. It now compares them as a set.
- **REG-304:** this revealed the new app defect DEF-312: after a reload, pen strokes come back in random stacking order. REG-304 now checks the colours, and the new REG-395 checks the order.
- **REG-862:** hit the intermittent tablet defect DEF-806.

In Run 9 every one of those fixes held. REG-395 again reproduced DEF-312, and REG-862 passed this time. DEF-806 is intermittent, so REG-862 can still fail now and then until the app is fixed.

### Live suite: the real servers and the real MoBrowser

| Case | What it proved | Live 4 |
|---|---|---|
| REG-900 | A real MuulOrigin sign-in reaches the app: the account is shown, the plan reads Pro, Cloud backup opens unlocked | Passed |
| REG-901 | A project backed up to the real Muul Cloud is listed, restores identical (every store compared) after deletion, and its backup is then deleted; the account's other backups are unchanged | Passed |
| REG-902 | Signing out ends the real session (refresh answers 401) and keeps the local projects | Passed |
| REG-907 | A project made in one browser syncs to the real cloud, appears in a second signed-in browser with identical document bytes, and leaves the cloud when deleted | Passed |
| REG-903 | In the real MoBrowser the app finds the host bridge, and the GitHub host reports the streamed push the app relies on | Passed |
| REG-904 | GitHub and folder backup offer exactly what MoBrowser's credential manager holds, or say how to add it | Passed |
| REG-905 | A real GitHub backup into the test repository through MoBrowser restores the deleted project identical | Skipped: setup pending |
| REG-906 | A real folder backup through MoBrowser restores the deleted project identical, and the folder is left as it was | Skipped: setup pending |

How it is kept safe:
- The live tests run this build at the app's real address inside the test browser.
- They sign in out of process, so the password never reaches a trace or a report.
- They tag everything they create and delete it afterwards, whatever the outcome.
- MoBrowser runs on a separate test profile, never the user's own.

**To enable REG-905/906 (once):**
1. Run `npm run mobrowser:setup`.
2. In MoBrowser's credential manager, add the GitHub repository `cc` and the folder `Documents\CognitiveCanvas-QA-Backups`.
3. Close MoBrowser.

### Performance (Performance 3, alone, one worker)

| Measurement | Result | Budget |
|---|---|---|
| Cold start to PIN screen | 517 ms | 5 s |
| 40-page PDF open | 946 ms | 10 s |
| Find across 40 pages | 353 ms | 10 s |
| 200-page PDF: upload to page 1 drawn / all pages indexed | 1.2-1.5 s / 1.7-2.1 s | see PRF-004 |
| Reload to a 200-page document with 500 notes on screen | 3.9 s | see PRF-004 |
| 500 notes: input to canvas moving (median / slowest of 15) | 34 ms / 356 ms | see PRF-006 |
| Jump to page 150 drawn | 1.2 s | |
| Local backup / restore of the large project | 1.7 s / 2.2 s (ZIP 575 KB) | see PRF-004, PRF-008 |
| Home with 100 projects / search them | 562 ms / 69 ms | see PRF-005 |
| Find a word on all 200 pages | 1.5 s | see PRF-007 |

These are still Performance 3's numbers. The machine was never quiet overnight, so a fresh measurement would have measured the other project's load, not the app.

### Static checks

| Check | Result |
|---|---|
| `npm run typecheck:automation` | 0 errors |
| `npx eslint automation --max-warnings 0` | 0 errors, 0 warnings |
| `npm run inventory -- --check` | 871 cases, 864 automated, 0 drift (reads Playwright's own test list, so data-driven tests count) |
| Page-error guard, network guard | unchanged; the MoBrowser driver now fails a test when the build could not be served to MoBrowser, instead of ignoring it |
| Banned patterns (sleeps, forced clicks, swallowed errors, `.only`) | none; 5 page-error allow-lists, each naming one exact, explained error |
| CI workflow YAML | parses; jobs `automation-gate`, `automation-regression` (4 shards), `automation-performance`, `automation-cross-browser`. **Not yet run on GitHub.** The live suite is not in CI (it needs the QA account). |
| Unit suite | not re-run this round (no application change); last run 706/706 |

### Earlier rounds

Runs 1-7 (2026-10-29/30) covered the first 121 cases. Each failure there was a test-side wait under CPU load, and each was fixed at its root. The full table is in the workbook's Run History sheet.

## 4. Defects and risks

Full write-ups are in **08-DEFECTS-AND-LIMITATIONS.md** and in the workbook's "Defects Found" sheet. They list P1 first, group related defects, and give steps, expected and actual results. None has been filed as a GitHub issue; raising them is the QA owner's call.

| Priority | Defects | Areas with the most |
|---|---:|---|
| P1 | 6 | Backup, offline, live share, accessibility, PDF viewer |
| P2 | 25 | Accessibility (contrast, labels), offline, canvas, sharing, PDF viewer, touch devices |
| P3 | 46 | Assistant, canvas and note editor, accessibility, phone, catalog |

Remaining risks the suite cannot close (see 08, "Automation limitations"):
- Real iPad, Pencil and Android behaviour: emulated only.
- The screen-reader listening experience.
- The real servers for sharing, support and the content catalog: proven against stateful fakes only. The backup paths (sign-in, Muul Cloud, sync, MoBrowser) are now also proven against the real servers.

## 5. Recommendations

1. **Fix the six P1 defects first.** Do DEF-902 (backups losing OCR text) and DEF-916 (offline blank page) before the next release, because both lose user work.
2. **Fix DEF-806** (tablet page sometimes left blank). It affects users, and it is the one defect that can still make a correct test fail now and then (REG-862, REG-866). DEF-213 and DEF-208 (the reading position is lost) look like one cause and could be fixed together.
3. **Finish the MoBrowser setup once** (§3) so the real GitHub and folder round trips run too.
4. **Run the CI jobs once on GitHub** and check the time budgets. Locally, the full regression took 81 minutes on 2 workers on a fully loaded machine; CI splits it four ways.
5. Run long suites with the machine plugged in and kept awake, or in CI. Never run them alongside another browser-test suite.
6. Each release, do a short manual pass on a real iPad with Pencil and on the Muul-Android build (SAN-004/005/006), plus a screen-reader walkthrough (A11Y-007).
7. Re-measure performance on a quiet machine or a CI runner: `npm run test:performance`.
8. Remove or wire up the unreachable code listed in 08.

## 6. Engineering review

| Question | Answer |
|---|---|
| **Completeness** | Every module's source was inventoried for screens, controls, messages, limits and persistence. Each item maps to a case, or is listed in 08 with the concrete reason it cannot be automated. |
| **Maintainability** | Module-wise specs; one page object per screen; per-area fixtures on one base; a stateful fake per external service; data generated in memory (only one binary file). A new case is one CSV row plus one test. First-time setup for a new team member: `automation/SETUP.md`. |
| **Reliability** | Fresh browser context per test, no sleeps, state-based waits, no retries. Run 9 had no unexpected failure on a machine at 100 % CPU. In Runs 8 and 10, every failure was traced to its root cause. Remaining instability comes from the app (DEF-806), from a sleeping laptop, and from bursts of heavy load from other suites on the same machine (Run 10's GitHub window), not from the test logic. |
| **Traceability** | CSV ↔ test IDs enforced in CI; each defect links to the tests that reproduce it, and the Excel and 08 are generated from the same register. |
| **Safety** | Refuses non-local base URLs, blocks every external request, mocks every server, uses throwaway profiles and a reserved-domain test identity, never the real camera. The opt-in live suite uses a dedicated QA account from the environment only, never writes its password anywhere, cleans up everything it creates, and runs MoBrowser on a separate test profile. |
| **Diagnostics** | Trace, screenshot, video and page snapshot on failure; blocked-request and axe attachments; a Markdown summary per run with the build under test. |
| **CI readiness** | Jobs written and validated; regression sharded 4 ways; performance on its own runner. Not yet run on GitHub runners, which is the first thing to verify. |
