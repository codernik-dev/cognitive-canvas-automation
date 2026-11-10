## Smaller observations

Behaviour that looks wrong or risky but is not proven to break anything a user relies on, or is a matter of design. Worth a look; not counted as defects.

| ID | What | Where seen | Priority |
|---|---|---|---|
| OBS-001 | *Now DEF-212.* Clicking a page thumbnail just after opening the page index can leave the viewer on page 1. | Page index | — |
| OBS-002 | An empty (0-byte) PDF is refused with "… doesn't look like a PDF — its contents don't match its name." rather than the clearer "… is empty (0 bytes) …" message the app also has. | Upload in a project | P4 |
| OBS-003 | The Backup & Restore window is announced to screen readers only as "Dialog". | Data Center | P3 |
| OBS-004 | On Windows, every build is labelled "-dirty" even from a clean checkout, because the build step rewrites five library files with different line endings. The build label can no longer be trusted to show uncommitted changes. | Build | P3 |
| OBS-005 | Two backup risks seen in the code but not shown by a test: restoring several projects at once is not all-or-nothing (a failure part-way keeps the projects already restored), and the whole backup file is held in memory while it is made. | Backup & Restore | P2 (to confirm) |
| OBS-006 | *Now part of DEF-910* (low contrast). | Home | — |
| OBS-007 | *Now part of DEF-913* (scroll areas the keyboard cannot reach). | Workspace | — |
| OBS-008 | The page blocks browser zoom (pinch or Ctrl +) on every screen, which people with low vision rely on. It may be on purpose because the canvas has its own zoom, but it should be a conscious decision. On touch devices it also means a PDF cannot be enlarged at all while DEF-804 stands. | All screens | P3 |
| OBS-009 | On first launch (no projects yet), pressing Home quickly can be undone a moment later when the content catalog opens on top of it. The catalog opens after a background check finishes, without noticing the user already moved on. Every reload of an empty library opens the catalog again. | First launch | P3 |
| OBS-010 | When the computer is very busy, a small PDF upload can sit on "Loading PDF..." for more than 45 seconds with the Upload button greyed out, and no message or way to cancel. | Upload in a project | P3 |
| OBS-011 | A line's delete button appears at its midpoint on hover, so clicking the middle of a line to select it deletes the line. | Canvas | P3 |
| OBS-012 | For about 5 seconds after a project opens, the backup reminder ("Your data is on this device only…") sits over the canvas Zoom in button and blocks clicks on it. | Canvas | P3 |
| OBS-013 | Settings › Shortcuts says Escape closes any open window, but Escape does not close the Data Center, "Sign out?", Reset PIN, Change PIN or "Leave Cognitive Canvas?" windows. | Keyboard | P3 |
| OBS-014 | The "10 sec" automatic-backup interval, marked in the app as a testing option, is offered to users. | Auto backup | P3 |
| OBS-015 | While signed in, the app asks the sharing service for news every 3 seconds (about 20 requests a minute per open tab). | Sharing | P3 |
| OBS-016 | The app never tells the server that a received copy was imported; the "Copy · in your projects" label relies on the server assuming the download means an import. Worth confirming with the backend team. | Sharing | P3 (to confirm) |
| OBS-017 | On an image item, the corner resize handle covers the "Go to linked area" badge; on touch its larger hit area covers the badge completely. | Canvas | P3 |
| OBS-018 | The profile menu's Sharing count refreshes every 20 seconds, the bell every 3, so the two can disagree for up to 20 seconds. | Sharing | P4 |
| OBS-019 | "Reset View" on the canvas frames the origin at 80 %, while "Fit all notes on screen" fits the items; two "fit" actions that do different things. | Canvas | P4 |
| OBS-020 | System Check lists two different rows both called "Browser". | Settings › Diagnostics | P4 |
| OBS-021 | Every document is stored as `file.pdf` inside a backup ZIP, Markdown and text files included. Restores work; the name is misleading if someone opens the ZIP. | Backup | P4 |
| OBS-022 | A restore stamps the project's "created" date with the restore time. Nothing shows that date today. | Backup | P4 |
| OBS-023 | Two presses on the same note within 400 ms count as a double-click even when another note was clicked in between, and open the editor. | Canvas | P4 |
| OBS-024 | Pressing Space twice quickly on a selected audio note logs an error ("play() interrupted"); playback itself recovers. | Audio notes | P4 |
| OBS-025 | The default eraser size (12) is not one of the four sizes offered, so no size looks selected at first. | Document tools | P4 |
| OBS-026 | Some messages never appear: Select Area's "Note created!" (its overlay closes with the tool) and the OCR toast's step messages ("Loading language data… N %"), which the page counter replaces at once. | Document tools, OCR | P4 |
| OBS-027 | A PIN typed while the previous one is still being checked (about half a second) is silently cleared; a tour "Next" pressed during the card's 200 ms step change is lost. | PIN, tours | P4 |
| OBS-028 | On a phone, the '"<name>" uploaded' message spans the full width for 3.5 seconds and takes touches; the colour/size drawer stays open when switching from Draw to Eraser. | Phone | P4 |
| OBS-029 | Size limits are printed rounded to whole MB in backup messages ("limit is 0 MB") and unrounded in sharing ("0.00390625 MB"). Only visible with very small limits (seen with mocked limits). | Backup, Sharing | P4 |
| OBS-030 | Deleting a linked note deletes its link twice (two save paths); the second can overwrite the link's deletion record without its project. Nothing reads these records yet, so no user impact today. | Data | P4 |
| OBS-031 | On the real server a stopped live share stays in the teacher's list for good (GET /api/sharing/live/mine, `stopped: true`). "Clear from history" only hides it on that device, and there is no call to remove it, so stopped shares pile up on an account (each live-share test run leaves one per test on the QA account). | Live share | P3 |
| OBS-032 | During the live sharing runs the real server answered 503 to session refreshes (POST /api/iam/auth/refresh) for several minutes after a burst of about 30 sign-ins and refreshes from one machine; the app then showed "Can't reach MuulOrigin". It looks like rate limiting. The 503 carries no CORS headers, so a browser sees a network failure rather than "busy, try later". DEF-510's push loop adds to such load. | Sign-in, Sharing | P3 (to confirm) |
| OBS-033 | OCR text is not part of a share (as DEF-902 for backups): a student's device holds no OCR text for a shared scan on arrival and reads it again. Find still finds the scanned words there, once that OCR has run. | Sharing, OCR | P4 |

## Open GitHub issues re-checked on this build

| Issue | Result on this build | Test |
|---|---|---|
| #295 Change PIN accepts a wrong current PIN | **Does not reproduce:** the wrong PIN is refused and the stored PIN is unchanged; wrong PINs also count towards the lockout | REG-006, REG-607 |
| #222 Audio note link does not validate the URL | **Does not reproduce:** Create stays disabled for text and for non-audio links, each refusal gives its reason | REG-078 |
| #349 No error message for empty, broken or corrupted files | **Does not reproduce for uploads inside a project:** each file gets a message. Home upload has DEF-004; an unsupported file next to a PDF is ignored silently (DEF-204) | REG-032..035, REG-018, REG-235 |
| #381 Scan document: deleting pages / Save message | **Does not reproduce:** removing a page asks first and leaves it out of the saved document; the scan saves as a named document with every page. Saving without internet fails (DEF-917) | REG-220, REG-221, REG-225, OFF-007 |
| #363 iPad: OCR of a region selected with a stylus | **Does not reproduce in emulation** (WebKit with the iPad profile and emulated pen input); a real iPad and Pencil are still needed to close it | REG-883, REG-862; manual SAN-005 |
| #336 iPad: unable to enter text in a canvas text box | **Reproduces on desktop too** as DEF-006 | REG-055 |
| #337, #335, #279 (other iPad items) | Not re-checked one by one. The tablet and iPad emulation specs cover the touch and stylus flows; a real iPad is still needed to close them | REG-860..886; manual SAN-004 |

## Automation limitations

What the automated suite cannot prove, and what covers it instead.

| Limitation | Why | What covers it instead |
|---|---|---|
| A real Apple Pencil, palm contact, pressure; Safari on a real iPad | No browser runner can produce real stylus hardware input or run iOS Safari | Emulated pen and touch on WebKit and Chromium (REG-860..886); manual SAN-004, SAN-005 |
| The real Muul-Android app build | Needs the Android host | A stub of the host bridge (REG-847, REG-849, REG-850); manual SAN-006 |
| Real operating-system permission prompts and PWA installation | They are browser and OS interface, not page content | Permission denied/granted contexts (REG-852..854); a simulated install event (REG-817..819, REG-880, REG-881); manual SAN-008, SAN-009 |
| Real servers: MuulOrigin sign-in, Muul Cloud, sharing, support, catalog, GitHub, the MoBrowser host | The default run must never touch real accounts, repositories or storage | The default run uses stateful fakes that follow each contract (06, "External services"). The opt-in `live` project (32 tests in tests/live) runs the same flows on the real servers with QA accounts: sign-in, cloud backup, restore and sync, copy and live sharing between a teacher and two students, and GitHub backup through MoBrowser into codernik-dev/cc-test-. Support tickets and the content catalog are only faked |
| The sign-in round trip itself | It happens on an external website | The redirect address and the signed-in state are checked |
| Screen-reader listening experience | Automated checks find rule violations, not how it sounds | Axe scans of every screen (A11Y-001..037), keyboard and focus tests (A11Y-038..050); manual A11Y-007 |
| Safari's own page-zoom gesture | Playwright's WebKit on Windows cannot create the gesture event | REG-886 is parked (Blocked) until it runs on macOS or a real iPad |
| Very long or very large operations | 10-minute recordings, 120 MB video takes, share uploads over 90 MB, more than 9 GB of app data | Their size checks are tested with sparse files and mocked limits |
| Recovery of an unsaved recording after a crash | Needs the browser tab itself to die mid-recording (the crash screen for a render error is covered by REG-943, REG-944) | Not covered |
| "Device storage almost full" warning before an upload | The browser's storage estimate cannot be overridden from a test | The save failing on a full device is tested (PST-025, PST-026) |
| Mobile-data warning for large downloads during sync | The Network Information API cannot be faked reliably | Not covered |
| Rules that say something must *not* happen on a device (a phone never OCRs in the background; a tablet skips files over 30 MB) | Proving a non-event needs an arbitrary wait | The positive side is tested (REG-876, REG-877) |
| States shown for under a second ("Unlocking…", "Scanning pages…", "Reading file…") | Too short to observe reliably | The states before and after are checked |
| Intermittent defects DEF-211, DEF-212, DEF-311, DEF-806 | Timing races in the app that cannot be triggered on demand | Written up above; the affected tests wait for the race to settle |
| Code that no screen can reach | Checked file by file on build c54e7e2 (2026-11-09): every component no test traces to was looked up for anything that renders it. **Never rendered:** KeywordPanel, GestureHint, MobileSplitPane, ResponsiveModal, ThemeToggle, UpgradePrompt, InboxView, PersonThreadView, ShareNotesModal, SharingGetStarted, FloatingWorkspaceToolbar, InkItem, UsersManagementSection, BroadcastListView, ConversationList. **Rendered only behind a switch that is off:** Quiz (its button is commented out), the "Find in Doc" search panel (commented out), the general Calendar panel (its only button is in the Legal layout, which opens the law calendar instead), BackupModal and RestoreModal (global bar buttons commented out), QuickBackupModal and QuickRestoreModal (their chooser is never opened), BackupIndicator and the in-app Muul backup picker (used only by those windows), the long-press OCR overlay (`needLongPressOcr = false`), the off-by-default workspace change feed, and the default ("both") panel of the backup destinations with its "Set default" folder list and its own GitHub restore list (every screen asks for a specific panel; found 2026-11-10). **Also found unreachable in the first audit:** the select tools, the long-press text menu, the "search all documents" panel, the install card and the Settings auto-backup panel | Not testable without changing the app; listed so dead code can be removed or wired up. The two reachable screens that had no test, the crash screen and the "Receiving audio…" card, were automated on 2026-11-09 (REG-941, REG-943, REG-944). A text-by-text check on 2026-11-10 (every user-visible text of every reachable screen looked up in the tests) added REG-947 to REG-959 |
| Visual appearance | No pixel-snapshot tests: fonts and anti-aliasing differ between machines, so snapshots would be noise | Layout, geometry and state assertions instead |
| Code coverage of the production bundle | The bundle is not instrumented | Unit coverage (Vitest) is reported separately |
