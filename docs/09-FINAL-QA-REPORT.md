# 09 — Final QA Report

**App under test:** Cognitive Canvas, commit `c54e7e2` (branch `AbhishekBugs`), production build served from `dist/` (stamped `c54e7e2-dirty`; the "-dirty" is line endings only, OBS-004). No application file was changed by this work.
**Environment:** Windows 11 laptop, Node 24.13, Playwright 1.64.1 (Chromium 1248, Firefox 1555, WebKit 2370), 8 logical CPUs, MoBrowser (Firefox 152 based) for the live MoBrowser tests. The machine was shared with other work, including another project's Playwright suites: the CPU was at 100 % for most of Runs 9 and 10.
**Dates:** 2026-10-29 to 2026-11-09. The latest round (Runs 11 to 13) ran on 2026-11-02, 11-04 and 11-09.

Every number below comes from a recorded run (`results.json` under `reports/<run>/`). Nothing is estimated. The workbook `Cognitive-Canvas-Test-Suites.xlsx` holds the same data case by case.

## 1. Headline

- **916 test cases in 35 modules, 909 automated (99.2 %).** Every user-facing feature found in the source has at least one case. The 7 not automated need a real iPad, Apple Pencil, Android build, operating-system prompt or screen reader (6, manual), or a gesture event Playwright's WebKit on Windows cannot create (1, blocked).
- **The whole app was checked again on 2026-11-09 for screens no test reached.** Every one a user can reach is now tested: the crash screen (REG-943, REG-944) and the "Receiving audio…" state of a recording in a live share (REG-941, REG-942). A class shared live straight after it is made (REG-945) and the speed of the server's list of live shares (REG-946) were added after the live run found them. Code that no screen can reach is listed by name in 08.
- **Final full run (Run 13, 2026-11-09): 857 tests on desktop Chrome, phone, tablet, iPad (WebKit) and an offline profile, in 37 minutes: 752 passed, 104 known defects reproduced, 0 failed, 0 flaky, 1 parked (REG-886).** The first full run that day (856 tests, before REG-945) also had no unexpected failure, and so did Run 12 on 2026-11-04. No retries are allowed, so nothing passed by being tried again.
- **Live suite against the real servers: 32 cases, every one run on 2026-11-09.** Real sign-in, Muul Cloud backup, restore and sync, the real MoBrowser host with a real GitHub backup into `codernik-dev/cc-test-` and a folder backup, and copies and live shares between the QA teacher and two real student accounts, compared field by field. Latest results: 27 passed, 5 known defects reproduced. Run 13 live had 6 failures, each traced (§3): 2 were the new app defect DEF-515, 3 were tests waiting less than the server now takes (new server defect DEF-516), and 1 was PIN input lost in MoBrowser. All passed after the fixes.
- **Performance: 8 / 8 within budget** (alone, one worker, quiet machine). **Cross-browser smoke: 16 / 16** on Firefox and WebKit.
- **86 application defects found and written up** in plain language with steps (08, and for testers 10): **7 P1, 22 P2, 57 P3**. 81 are reproduced on every run by a test that checks the correct behaviour; 5 are intermittent. The seven P1s:
  - **DEF-001** Find does not take you to a match on a page not viewed yet;
  - **DEF-007** the app cannot open without internet (the offline helper never installs);
  - **DEF-207** text on a PDF page cannot be selected or copied;
  - **DEF-505** a document the teacher stopped sharing in a live share is sent to students again;
  - **DEF-510** after a new document and Push now, the teacher's app keeps sending the live share every few seconds;
  - **DEF-804** pinch zoom on a PDF does nothing on phones, tablets and iPad;
  - **DEF-916** offline, opening a screen not used yet reloads the app into a blank page.
- **New on 2026-11-09:** DEF-514 (P3, the teacher's recordings never show "Uploading"), DEF-515 (P2, a class shared live straight after it is made can leave students out) and DEF-516 (P2, server side: the teacher's list of live shares takes over 40 seconds, and longer with every live share made).
- **Written on 2026-11-10, not yet run:** a text-by-text check of every reachable screen against the tests added REG-947 to REG-959: every accent and Style in Appearance, every Tool Guide card word for word, the Settings explanations, Cloud sync with no projects and a project that never reached the cloud, deleting a live-shared project (alone, in bulk, and with the server unreachable), a teacher's read-only note and its "Duplicate to edit", uploads from Home that are all refused, the Storage filters, the delete wording for video notes, and the plan's storage allowance on upload. They are typechecked and in the inventory; their first run is the next full run.
- **Traceability:** every automated case is carried by a test with its ID, checked by `npm run inventory -- --check` (0 drift).

## 2. Inventory and coverage

| Measure | Value | Definition |
|---|---|---|
| Test cases | **916** (Smoke 8, Sanity 11, Regression 897) | `data/test-inventory.csv` |
| Modules | 35 | Product areas; each has its own spec file(s) under `tests/` |
| Automated | **909** (800 plain + 109 known-defect) | A test carries the ID and asserts the expected result |
| Manual | 6 | SAN-004/005/006/008/009 (real iPad, Pencil, Android build, OS prompts, install) and A11Y-007 (screen reader) |
| Blocked | 1 | REG-886 (Safari gesture event; needs macOS or a real iPad) |
| **Scenario automation coverage** | **99.2 %** (909 / 916) | Automated ÷ all cases |
| P1 cases automated | **201 / 203** | The two not automated are SAN-004 and SAN-005 (real iPad and Pencil) |

| Sub-suite | Cases | Automated | Script folder |
|---|---:|---:|---|
| Smoke | 8 | 8 | `tests/smoke` |
| Sanity | 11 | 6 | `tests/sanity` (plus 78 regression cases tagged `@sanity`: the Sanity run executes 84) |
| Functional (module-wise) | 676 | 676 | `tests/regression` |
| Responsive (phone / tablet / iPad) | 87 | 86 | `tests/responsive` |
| Live (real servers, real MoBrowser, real student accounts) | 32 | 32 | `tests/live` (opt-in, QA accounts) |
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

### Latest round (2026-11-02 to 11-09)

| Run | Scope | Passed | Known defect reproduced | Failed | Wall clock |
|---|---|---:|---:|---:|---|
| Run 11 | full regression in the standalone repository; another project's suites held the CPU at 96-100 % | 744 | 100 | 4 | 101 min 25 s |
| Run 12 | full regression | 749 | 102 | 0 | 59 min 14 s |
| Live sharing 1 | copies, classes and live shares on the real server, teacher and two students | 19 | 2 | 1 | 45 min 28 s |
| Live MoBrowser 10 | REG-903 to REG-906: the first real GitHub and folder backups through MoBrowser | 4 | 0 | 0 | 51 s |
| Run 13 (first) | full regression after the app review (REG-941 to REG-944 added) | 752 | 103 | 0 | 41 min 20 s |
| Performance (Run 13) | 8 budgets, alone, 1 worker | **8** | — | 0 | 1 min 28 s |
| Cross-browser (Run 13) | smoke on Firefox + WebKit | **16** | 0 | 0 | 35 s |
| Run 13 live | the whole live suite, one test at a time | 19 | 4 | 6 | 59 min 59 s |
| Run 13 live re-check | the fixed tests and the new REG-946, one at a time | 6 | 1 | 1 | 22 min 40 s |
| Run 13 MoBrowser re-check | REG-903 to REG-906, twice | 8 | 0 | 0 | 2 min 6 s |
| **Run 13** | **full regression on the final suite** (REG-945 added): chromium, phone, tablet, ipad, offline; 2 workers | **752** | **104** | **0** | 37 min 23 s |

Every full run had 1 parked test (REG-886, reported as skipped). Run 11's 4 failures each passed 3 of 3 on a re-check that day: they ran 5 to 20 times slower than alone under the other project's load. Two re-runs of the live failures on 2026-11-09 ran two tests at once on the shared accounts by mistake; they are not counted.

### What Run 13 settled

| Test | Cause | Whose problem | After the fix |
|---|---|---|---|
| REG-919, REG-937 (share to a class of two) | The class was made and shared at once. The app's refresh after saving the class took the answer of a check that left before the save finished; the real server answered that one with the class holding its first member only. The app then said "Send a copy to 1" / "Share live with 1", and a live share went to the first student only. Seen on every try. | **App defect DEF-515** (new, P2) | REG-945 reproduces it every time against the fake server; REG-919 and REG-937 now share once the class shows both students, and pass |
| REG-934, REG-935, REG-938 (live share stopped, left, joined) | Each waited 30 s for the server's list of the teacher's live shares, which took 42 s: about 0.9 s per live share the account has ever made (45, all stopped; the server keeps them and has no call to delete them). Accounts with none: 1.1-1.5 s. | **Server defect DEF-516** (new, P2) | the tests allow 3 minutes and pass; REG-946 measures the list (53 live shares, 49.1 s) and fails until it answers within 10 s |
| REG-904 (MoBrowser pickers) | The PIN typed into the test MoBrowser lost keys typed straight after the screen appeared; later, one tap was lost too. The window never has the system's focus. Same steps passed on 2026-11-04. | Test input in MoBrowser | the driver clicks the screen first, taps each digit and checks it landed (a second tap is recorded on the test); REG-903 to REG-906 passed 8 of 8, no second tap needed |

### Round of 2026-10-29 to 31

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

### Live suite: the real servers, the real MoBrowser and real student accounts

| Cases | What they prove | Latest (2026-11-09) |
|---|---|---|
| REG-900 to REG-902, REG-907, REG-940 | Real MuulOrigin sign-in; a project backed up to the real Muul Cloud restores identical after deletion; sign-out ends the session and keeps local projects; cloud sync between two browsers | 4 passed; REG-940 reproduces DEF-511 |
| REG-903 to REG-906 | In the real MoBrowser: the host bridge, the GitHub and folder pickers, a real GitHub backup into `codernik-dev/cc-test-` and a real folder backup, each restored identical | 4 passed (8 of 8 on re-check) |
| REG-910 to REG-921 | Copies from the Pro teacher to real Free students: one or two students, a class, every kind of content, only the ticked documents, OCR words searchable on the student's device, deleted copies stay deleted, a Free student is offered no Share | 10 passed; REG-914 and REG-916 reproduce DEF-507 and DEF-508 |
| REG-930 to REG-939, REG-946 | Live shares: going live, notes and highlights reaching the student, every kind of content, new documents, stopping, the student leaving and coming back, a class of two, a late joiner, Push now | 9 passed; REG-939 reproduces DEF-510, REG-946 reproduces DEF-516 |

How it is kept safe:
- The live tests run this build at the app's real address inside the test browser.
- They sign in out of process, so no password reaches a trace or a report.
- They tag everything they create and delete it afterwards, whatever the outcome; the server keeps stopped live shares, which it offers no way to delete (DEF-516).
- MoBrowser runs on a separate test profile, never the user's own, and pushes only to `codernik-dev/cc-test-`.
- They run one test at a time (`npm run live`): the tests share the accounts.

### Performance (Run 13, alone, one worker)

| Measurement | Result | Budget |
|---|---|---|
| Cold start to PIN screen | 270 ms | 5 s |
| 40-page PDF open to page 1 drawn | 530 ms | 10 s |
| Find a word across 40 pages | 269 ms | 10 s |
| 200-page PDF: upload to page 1 drawn / all pages indexed | 600 ms / 1.2 s | 30 s / 90 s |
| Reload to a 200-page document with 500 notes on screen | 1.3 s | 20 s |
| 500 notes: input to canvas moving (median / slowest of 15) | 16 ms / 112 ms | 1 s |
| Jump to page 150 drawn | 853 ms | 5 s |
| Local backup / restore of the large project | 1.8 s / 1.7 s | 60 s / 90 s |
| Home with 100 projects / search them | 362 ms / 51 ms | 15 s / 3 s |
| Find a word on each of 200 pages | 852 ms | 45 s |

Measured on 2026-11-09, with no other test run on the machine. Performance 3 (2026-10-30) ran with the CPU at about 30 % from other work, and its numbers were slower.

### Static checks

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| Lint | not set up in this repository: the suite moved out of the app repository, whose eslint run covered it |
| `npm run inventory -- --check` | 916 cases, 909 automated, 0 drift (reads Playwright's own test list, so data-driven tests count) |
| Page-error guard, network guard | unchanged; the MoBrowser driver now fails a test when the build could not be served to MoBrowser, instead of ignoring it |
| Banned patterns (sleeps, forced clicks, swallowed errors, `.only`) | No forced clicks, swallowed errors or `.only`. No sleep stands in for a wait. Four fixed pauses exist, all in live tests, each a deliberate observation window: REG-939 watches 2 × 45 s for pushes that must not happen, REG-935 gives the student's app 30 s to (wrongly) pull a note, and REG-916 samples the bell every 5 s for 45 s. 7 page-error allow-lists, each naming one exact, explained error |
| CI workflow YAML | parses; jobs `automation-gate`, `automation-regression` (4 shards), `automation-performance`, `automation-cross-browser`. **Not yet run on GitHub.** The live suite is not in CI (it needs the QA account). |
| Unit suite | not re-run this round (no application change); last run 706/706 |

### Earlier rounds

Runs 1-7 (2026-10-29/30) covered the first 121 cases. Each failure there was a test-side wait under CPU load, and each was fixed at its root. The full table is in the workbook's Run History sheet.

## 4. Defects and risks

Full write-ups are in **08-DEFECTS-AND-LIMITATIONS.md** and in the workbook's "Defects Found" sheet. They list P1 first, group related defects, and give steps, expected and actual results. None has been filed as a GitHub issue; raising them is the QA owner's call.

| Priority | Defects | Areas with the most |
|---|---:|---|
| P1 | 7 | PDF viewer and Find, offline, live share, touch devices |
| P2 | 22 | Backup and restore, accessibility, canvas, text documents, PDF viewer, live share |
| P3 | 57 | Accessibility, canvas, backup and restore, sharing, assistant, touch devices |

Remaining risks the suite cannot close (see 08, "Automation limitations"):
- Real iPad, Pencil and Android behaviour: emulated only.
- The screen-reader listening experience.
- The real servers for support and the content catalog: proven against stateful fakes only. Sign-in, Muul Cloud, sync, MoBrowser (GitHub and folder) and sharing (copies and live shares between real accounts) are also proven against the real servers.
- The live suite's teacher account gets slower with every run while DEF-516 stands (about 10 more stopped live shares per full live run).

## 5. Recommendations

1. **Fix the seven P1 defects first**, starting with those a user meets on day one: DEF-207 (text cannot be selected), DEF-001 (Find does not go to the match) and DEF-804 (no pinch zoom on touch devices); then the offline pair DEF-007 and DEF-916, and the live-share pair DEF-505 and DEF-510.
2. **Fix DEF-515 before teachers use classes**: a class shared live straight after it is made can leave students out without anyone noticing. Separately, the server should answer the list of live shares quickly whatever their number, and let stopped ones be deleted (DEF-516).
3. **Fix DEF-806** (tablet page sometimes left blank). It affects users, and it can make a correct test fail now and then.
4. **Run the CI jobs once on GitHub** and check the time budgets. Locally the full regression took 37 minutes on 2 workers on a quiet machine; CI splits it four ways.
5. Run long suites with the machine plugged in and kept awake, or in CI. Never run them alongside another browser-test suite, and run the live suite only through `npm run live` (one test at a time).
6. Each release, do a short manual pass on a real iPad with Pencil and on the Muul-Android build (SAN-004/005/006), plus a screen-reader walkthrough (A11Y-007).
7. Remove or wire up the unreachable code listed in 08.

## 6. Engineering review

| Question | Answer |
|---|---|
| **Completeness** | Every module's source was inventoried for screens, controls, messages, limits and persistence. Each item maps to a case, or is listed in 08 with the concrete reason it cannot be automated. |
| **Maintainability** | Module-wise specs; one page object per screen; per-area fixtures on one base; a stateful fake per external service; data generated in memory (only one binary file). A new case is one CSV row plus one test. First-time setup for a new team member: `SETUP.md`. |
| **Reliability** | Fresh browser context per test, no sleeps, state-based waits, no retries. Runs 9, 12 and 13 had no unexpected failure. In Runs 8, 10, 11 and the Run 13 live run, every failure was traced to its root cause. Remaining instability comes from the app (DEF-806), from a sleeping laptop, and from bursts of heavy load from other suites on the same machine (Run 10's GitHub window), not from the test logic. |
| **Traceability** | CSV ↔ test IDs enforced in CI; each defect links to the tests that reproduce it, and the Excel and 08 are generated from the same register. |
| **Safety** | Refuses non-local base URLs, blocks every external request, mocks every server, uses throwaway profiles and a reserved-domain test identity, never the real camera. The opt-in live suite uses a dedicated QA account from the environment only, never writes its password anywhere, cleans up everything it creates, and runs MoBrowser on a separate test profile. |
| **Diagnostics** | Trace, screenshot, video and page snapshot on failure; blocked-request and axe attachments; a Markdown summary per run with the build under test. |
| **CI readiness** | Jobs written and validated; regression sharded 4 ways; performance on its own runner. Not yet run on GitHub runners, which is the first thing to verify. |
