# 08 — Defects and Limitations

Checked on commit `c54e7e2`, production build. Desktop Chrome (1366×800) unless the area says otherwise; phone = Pixel 5 emulation, tablet = 1024×1366 Chromium with touch, iPad = WebKit with the iPad profile. Every defect below was reproduced by an automated test, except the four marked *intermittent*, which were seen but cannot be reproduced on demand. Priorities are suggestions. None has been filed as a GitHub issue.

## Summary

| Suggested priority | Defects | of which intermittent |
|---|---:|---:|
| P1 | 6 | 0 |
| P2 | 25 | 1 |
| P3 | 46 | 3 |
| **All** | **77** | **4** |

| ID | Priority | Area | What is wrong |
|---|---|---|---|
| DEF-906 | P1 | Accessibility | Projects and documents cannot be opened with the keyboard |
| DEF-902 | P1 | Backup & restore | A backup loses the text that OCR read from scanned pages |
| DEF-505 | P1 | Live share | A document the teacher stopped sharing is sent to students again |
| DEF-007 | P1 | Offline & PWA | The app cannot open without internet, even after it has been used online |
| DEF-916 | P1 | Offline & PWA | Offline, opening a screen not used yet reloads the app into a blank page |
| DEF-001 | P1 | PDF viewer & Find | Find in document says it found the word but does not take you to it |
| DEF-003 | P2 | Accessibility | Messages that pop up at the corner are not read out by screen readers |
| DEF-910 | P2 | Accessibility | Low-contrast text on many screens |
| DEF-911 | P2 | Accessibility | Form fields a screen reader cannot name |
| DEF-002 | P2 | Backup & restore | Restoring the wrong kind of file only says "Restore failed" |
| DEF-402 | P2 | Backup & restore | A cloud backup that arrived only in part is reported with the wrong reason |
| DEF-908 | P2 | Backup & restore | A very large note is silently left out of a restore |
| DEF-006 | P2 | Canvas | A new text box on the canvas does not take typing straight away |
| DEF-303 | P2 | Canvas | Erasing part of a pen stroke linked to a highlight silently breaks the link |
| DEF-305 | P2 | Canvas | A clicked link between two notes is deleted by Delete pressed in the PDF |
| DEF-703 | P2 | Catalog & deep links | Catalog items downloaded together get only their bare title as project name |
| DEF-706 | P2 | Law mode (Legal layout) | In the Legal layout, clicking a classification badge opens the document instead of the menu |
| DEF-504 | P2 | Live share | After a failed live push, a successful "Push again" still shows the failure |
| DEF-804 | P2 | Mobile, tablet & iPad | Pinch zoom on a PDF does nothing on phones, tablets and iPad |
| DEF-805 | P2 | Mobile, tablet & iPad | On a touch screen, a document card lifted by press-and-hold never drops |
| DEF-806 | P2 | Mobile, tablet & iPad | On a tablet, a freshly opened PDF sometimes leaves a page blank (intermittent) |
| DEF-201 | P2 | OCR | A scanned page with a printed page number is never made searchable |
| DEF-904 | P2 | Offline & PWA | Sign in while offline throws the user out of the app |
| DEF-207 | P2 | PDF viewer & Find | Text on a PDF page cannot be selected or copied |
| DEF-208 | P2 | PDF viewer & Find | The page you were reading is forgotten after a reload |
| DEF-213 | P2 | PDF viewer & Find | Going back to a document you were reading opens it on page 1, not where you left off |
| DEF-004 | P2 | Projects | Uploading a broken PDF from Home leaves an empty project behind |
| DEF-917 | P2 | Scanner | Scans cannot be saved without internet |
| DEF-502 | P2 | Sharing | When the sharing service is down, Sharing shows empty boards instead of an error |
| DEF-209 | P2 | Text documents (Markdown, TXT) | In a Markdown document, moving to the next search match removes all the highlights |
| DEF-601 | P2 | Tours & tutorials | Offline, a tutorial video stays a black box forever |
| DEF-005 | P3 | Accessibility | The Change PIN boxes have no spoken names |
| DEF-302 | P3 | Accessibility | The play/pause buttons on audio and video note cards have no spoken name |
| DEF-602 | P3 | Accessibility | The Install app dialog and the language offer have no spoken name |
| DEF-907 | P3 | Accessibility | Tool buttons do not tell a screen reader which tool is on |
| DEF-912 | P3 | Accessibility | The OCR dialog's language list has no spoken name |
| DEF-913 | P3 | Accessibility | Some scrolling areas cannot be reached with the keyboard |
| DEF-914 | P3 | Accessibility | On a phone, hidden decorative copies still contain buttons keyboard users land on |
| DEF-915 | P3 | Accessibility | Keyboard focus is lost after closing some dialogs |
| DEF-606 | P3 | App shell & navigation | When another tab blocks the data, the loading screen gives the wrong reason |
| DEF-701 | P3 | Assistant | "Create a project called Lab Book" creates a project named "called Lab Book" |
| DEF-704 | P3 | Assistant | When two catalog items share a title, the assistant always imports the first |
| DEF-707 | P3 | Assistant | "class 12 physics" opens the right chapters but the assistant says it did not understand |
| DEF-708 | P3 | Assistant | "download chapter 5" gets a question that cannot be answered |
| DEF-404 | P3 | Backup & restore | Reopening the app makes another identical automatic backup although nothing changed |
| DEF-901 | P3 | Backup & restore | The search text of a restored PDF is not rebuilt |
| DEF-301 | P3 | Canvas | Changing the eraser size does not change the eraser circle under the mouse |
| DEF-304 | P3 | Canvas | Send to Back does not put a note behind all the others |
| DEF-306 | P3 | Canvas | Choosing the Default text colour does not remove a colour |
| DEF-307 | P3 | Canvas | Ctrl+Enter while typing in a note does not save and close it |
| DEF-308 | P3 | Canvas | An empty note's editor says "0 words · 1 char" |
| DEF-309 | P3 | Canvas | Clicking a spot on the mini-map centres the view below that spot |
| DEF-311 | P3 | Canvas | The note editor sometimes throws an error while formatting text (intermittent) |
| DEF-312 | P3 | Canvas | After a reload, overlapping pen strokes can come back in a different stacking order |
| DEF-702 | P3 | Catalog & deep links | A catalog item packaged as a backup keeps the name stored inside the file |
| DEF-705 | P3 | Catalog & deep links | With no projects yet, a catalog download in progress shows nothing on Home |
| DEF-401 | P3 | Data Center | Switching to Restore keeps a backup-only page on screen |
| DEF-403 | P3 | Data Center | Signed out, Cloud restore is marked "Pro" although no plan is needed |
| DEF-210 | P3 | Document tools | The Link Doc button does not close its own document picker |
| DEF-204 | P3 | Documents | An unsupported file uploaded with a PDF inside a project is ignored without a word |
| DEF-909 | P3 | Documents | A full device during an upload is reported as a broken file |
| DEF-503 | P3 | Live share | Stopping a live share for everyone removes it from the owner's history |
| DEF-801 | P3 | Mobile, tablet & iPad | Renaming a phone project to a name with symbols silently keeps the old name |
| DEF-802 | P3 | Mobile, tablet & iPad | On a phone, Install app skips the "why install" screen |
| DEF-803 | P3 | Mobile, tablet & iPad | The "Can't reach MuulOrigin" banner covers the bottom rows of the phone Menu |
| DEF-202 | P3 | OCR | The OCR summary counts a blank page as a page with text |
| DEF-203 | P3 | OCR | The OCR completion message says "1 pages processed" |
| DEF-211 | P3 | OCR | Cancelling OCR sometimes causes an error in the page (intermittent) |
| DEF-903 | P3 | Offline & PWA | Offline, Support shows a raw browser error |
| DEF-918 | P3 | Offline & PWA | Offline, the cloud restore list says there are no backups |
| DEF-205 | P3 | PDF viewer & Find | "Open" on the Hindi virtual keyboard suggestion does not open the keyboard |
| DEF-212 | P3 | PDF viewer & Find | Clicking a page thumbnail right after opening the page list can jump back to page 1 (intermittent) |
| DEF-603 | P3 | Projects | Double-clicking a project name opens the project instead of renaming it |
| DEF-604 | P3 | Projects | A single file uploaded from Home opens the document list instead of the file |
| DEF-501 | P3 | Sharing | A people search refused for "too many searches" says nobody was found |
| DEF-506 | P3 | Sharing | With no team members, Add people hides the people searched before |
| DEF-206 | P3 | Text documents (Markdown, TXT) | In Markdown and text documents the first search match is not marked |

## Defects found (most severe first, related ones together)

### P1 · Accessibility

#### DEF-906 — Projects and documents cannot be opened with the keyboard — **P1**
- **Test:** A11Y-039, A11Y-041 (reproduced in Run 10)
- **Steps:**
  1. On Home, press Tab repeatedly to reach a project card.
  2. Inside a project, Tab through the document list.
- **Expected:** Tab reaches each card and Enter opens it.
- **Actual:** The cards never receive keyboard focus, so a keyboard-only user cannot open a project at all. Documents can only be opened through quick search (Ctrl+K).

### P1 · Backup & restore

#### DEF-902 — A backup loses the text that OCR read from scanned pages — **P1**
- **Test:** PST-014 (reproduced in Run 10)
- **Steps:**
  1. Upload a scanned PDF and run OCR on it; Find now finds a word on the page.
  2. Make a Local backup.
  3. Delete the project and restore the backup.
  4. Search for the same word.
- **Expected:** The OCR'd words come back with the backup and Find finds them at once.
- **Actual:** The backup leaves out all search text, and the restored document still says it is indexed, so nothing rebuilds it. Find has to OCR every scanned page again (about 12 seconds a page) before it finds anything; for a long scanned book that is hours of work redone. The re-read uses the current OCR language (English by default), so text first read in another language would probably come back wrong (not tested).

### P1 · Live share

#### DEF-505 — A document the teacher stopped sharing is sent to students again — **P1**
- **Test:** REG-539 (reproduced in Run 10)
- **Steps:**
  1. Share a project with two PDFs live to a student.
  2. In Sharing > Shares, open the share, press Stop on one document and confirm "Stop this one?".
  3. Push again (Push now, or make any edit).
- **Expected:** The stopped document stays out of the share; students keep only the copy they already have.
- **Actual:** The first push leaves it out, but the share quietly takes it back, and the next push sends it to the students again.

### P1 · Offline & PWA

#### DEF-007 — The app cannot open without internet, even after it has been used online — **P1**
- **Test:** OFF-000, OFF-001, OFF-009, REG-107 (reproduced in Run 10)
- **Steps:**
  1. Open the app with internet on, set a PIN, open a PDF.
  2. Turn the internet off.
  3. Reload the page.
- **Expected:** the app opens and the PDF is still there (the app is meant to work offline after the first visit).
- **Actual:** the offline helper (service worker) is never installed, so with no internet the page does not load. The app does work while you stay on the page; it is the reload or reopen that fails.

#### DEF-916 — Offline, opening a screen not used yet reloads the app into a blank page — **P1**
- **Test:** OFF-010 (reproduced in Run 10)
- **Steps:**
  1. Use the app online (do not open Backup & Restore yet).
  2. Lose the internet connection.
  3. Press Backup & Restore (also seen with Settings > Support, Sharing, and starting a cloud backup).
- **Expected:** The screen opens, or says it needs a connection.
- **Actual:** The app reloads itself, cannot load without internet, and the tab stays blank until the connection is back. Unsaved typing in the open screen is lost. Related to DEF-007 (the offline helper never installs), but even without it the app should not reload itself into nothing.

### P1 · PDF viewer & Find

#### DEF-001 — Find in document says it found the word but does not take you to it — **P1**
- **Test:** REG-020 (reproduced in Run 10)
- **Steps:**
  1. Open a PDF with several pages, staying on page 1.
  2. Open Find and search for a word that appears only on a later page, for example page 4.
  3. Press Enter.
- **Expected:** the viewer moves to page 4 and shows the word.
- **Actual:** the counter shows "1 of 1", but the viewer stays on page 1. It also happens for page 2. It only works if you have already scrolled to that page earlier.

### P2 · Accessibility

#### DEF-003 — Messages that pop up at the corner are not read out by screen readers — **P2**
- **Test:** A11Y-004 (reproduced in Run 10)
- **Steps:**
  1. With a screen reader on, upload a PDF (or do anything that shows a corner message such as "… uploaded" or "PIN updated.").
- **Expected:** the screen reader reads the message.
- **Actual:** the messages are not marked as announcements, so a screen reader stays silent.

#### DEF-910 — Low-contrast text on many screens — **P2**
- **Test:** A11Y-009, A11Y-010, A11Y-012, A11Y-015, A11Y-017, A11Y-018, A11Y-019, A11Y-020, A11Y-021, A11Y-022, A11Y-023, A11Y-024, A11Y-025, A11Y-026, A11Y-027, A11Y-029, A11Y-031, A11Y-032, A11Y-033, A11Y-034, A11Y-035, A11Y-037 (reproduced in Run 10)
- **Steps:**
  1. Run an accessibility check (or look closely) on Settings (Appearance, Language, Permissions, Support), the Data Center, the Catalog, the Legal calendar, the note editor, the OCR dialog, the image editor, a tour card, the audio/video dialogs, Delete Project, Change/Reset PIN, the Install dialog, Sharing, the green "uploaded" message and the phone layout.
- **Expected:** Text has at least 4.5:1 contrast with its background.
- **Actual:** Below the minimum on all of them. Examples: white text on the purple buttons 3.95:1, the green "uploaded" message 2.27:1, the orange Reset PIN text 1.91:1.

#### DEF-911 — Form fields a screen reader cannot name — **P2**
- **Test:** A11Y-023, A11Y-026, A11Y-031 (reproduced in Run 10)
- **Steps:**
  1. With a screen reader, move to the hearing-time field in the Legal calendar, the three sliders in the image editor, or the file-upload field on the document list.
- **Expected:** Each field is announced with its name.
- **Actual:** They are announced without a name.

### P2 · Backup & restore

#### DEF-002 — Restoring the wrong kind of file only says "Restore failed" — **P2**
- **Test:** REG-072, REG-418 (reproduced in Run 10)
- **Steps:**
  1. Open Backup & Restore, choose Restore, then Local.
  2. Select a file that is not a backup, for example a text file renamed to `.zip`.
  3. Press Restore Now and confirm.
- **Expected:** a message that says why, for example "This file is not a ZIP archive, so it cannot be a backup or a catalog package."
- **Actual:** only "Restore failed" is shown, with no reason. Nothing in the library changes, which is correct.

#### DEF-402 — A cloud backup that arrived only in part is reported with the wrong reason — **P2**
- **Test:** REG-448 (reproduced in Run 10)
- **Steps:**
  1. Signed in on Pro, back up to Cloud when the server confirms fewer bytes than were sent (reproduced with a mocked server).
- **Expected:** The app's own message: "The backup did not arrive intact: the server stored X MB of Y MB. Nothing was recorded — please try again."
- **Actual:** "Backup failed: Muul Cloud is temporarily unavailable. Nothing was lost — try again shortly." This names the wrong cause.

#### DEF-908 — A very large note is silently left out of a restore — **P2**
- **Test:** PST-024 (reproduced in Run 10)
- **Steps:**
  1. Write a note of more than about 4 million characters (for example a long pasted text).
  2. Back up, delete the project, restore it.
- **Expected:** The note comes back.
- **Actual:** The project comes back without the note, and no message says anything was skipped.

### P2 · Canvas

#### DEF-006 — A new text box on the canvas does not take typing straight away — **P2**
- **Test:** REG-055 (reproduced in Run 10)
- **Steps:**
  1. Open a PDF.
  2. Choose the Text tool on the canvas and click an empty spot.
  3. Start typing.
- **Expected:** the typed words go into the new text box.
- **Actual:** the box still says "Text" and the typing goes nowhere. You must click the box once more before typing works.
- Possibly the same problem as open issue #336 ("ipad > canvas tool > text > unable to enter text in text box"), here seen on desktop.

#### DEF-303 — Erasing part of a pen stroke linked to a highlight silently breaks the link — **P2**
- **Test:** REG-398 (reproduced in Run 10)
- **Steps:**
  1. Draw a highlight on the PDF, switch the Highlight tool off and click the highlight.
  2. Draw a pen stroke on the canvas (it joins the highlight's link).
  3. Erase through the middle of the stroke with the Eraser.
  4. Hover the highlight.
- **Expected:** The two pieces left behind stay linked to the highlight, and the connecting line is drawn.
- **Actual:** The link still points at the stroke that no longer exists: no connecting line and no glow.

#### DEF-305 — A clicked link between two notes is deleted by Delete pressed in the PDF — **P2**
- **Test:** REG-068 (reproduced in Run 10)
- **Steps:**
  1. Link two notes on the canvas.
  2. Click the link line to select it.
  3. Click the PDF page.
  4. Press Delete.
- **Expected:** The link stays, as notes do: the PDF has the keyboard now.
- **Actual:** The link is deleted, with no undo.

### P2 · Catalog & deep links

#### DEF-703 — Catalog items downloaded together get only their bare title as project name — **P2**
- **Test:** REG-727 (reproduced in Run 10)
- **Steps:**
  1. In the Catalog, press Select.
  2. Select "Cell Biology" and "Genetics Basics" and press Download (2).
- **Expected:** The same names a single download gives, such as "Science — Cell Biology".
- **Actual:** Projects named "Cell Biology" and "Genetics Basics". With real titles like "Chapter 2", batch downloads give projects that cannot be told apart.

### P2 · Law mode (Legal layout)

#### DEF-706 — In the Legal layout, clicking a classification badge opens the document instead of the menu — **P2**
- **Test:** REG-019 (reproduced in Run 10)
- **Steps:**
  1. Switch to the Legal layout (Settings > Appearance).
  2. Open a project with documents.
  3. Click the "Unclassified" badge on a document card.
- **Expected:** The classification menu opens.
- **Actual:** The document opens and no menu appears. Mouse and touch users cannot classify; only the keyboard (Tab to the badge, then Enter) works.

### P2 · Live share

#### DEF-504 — After a failed live push, a successful "Push again" still shows the failure — **P2**
- **Test:** REG-535 (reproduced in Run 10)
- **Steps:**
  1. Make a live push fail.
  2. Open Sharing > Shares and press "Push again" (it succeeds).
- **Expected:** The card goes back to "Live · 1 person" and the warning strip goes away.
- **Actual:** The success message appears, but the card keeps "Live · couldn't send your last change" and the warning strip stays.

### P2 · Mobile, tablet & iPad

#### DEF-804 — Pinch zoom on a PDF does nothing on phones, tablets and iPad — **P2**
- **Test:** REG-864, REG-885 (reproduced in Run 10)
- **Steps:**
  1. On a phone, tablet or iPad, open a PDF.
  2. Pinch with two fingers on the page.
- **Expected:** The zoom changes (between 50 % and 250 %).
- **Actual:** The zoom stays at 100 %. The browser's own pinch is switched off over the document, so a PDF cannot be zoomed by pinching at all, although the tours tell users to "pinch to zoom". Pinch zoom on the canvas does work.

#### DEF-805 — On a touch screen, a document card lifted by press-and-hold never drops — **P2**
- **Test:** REG-865 (reproduced in Run 10)
- **Steps:**
  1. On a tablet, open a project with two documents.
  2. Press and hold a document card until it lifts.
  3. Drag it up and lift the finger.
- **Expected:** The order changes and is saved.
- **Actual:** The touch is cancelled as soon as the finger moves. The lifted copy stays on screen and nothing is saved.

#### DEF-806 — On a tablet, a freshly opened PDF sometimes leaves a page blank — **P2** — *intermittent*
- **Test:** Seen in: REG-862 failed on it in Run 8 and in 2 of 3 re-runs (page 2 never drawn); REG-866 failed on it in Run 10 and in 1 of 3 re-runs (page 2 never drawn while opening the PDF); a 6-open check saw page 1 blank once (intermittent: no test is marked as expected to fail)
- **Steps:**
  1. On a 1024×1366 touch tablet, upload a 4-page PDF into a project.
  2. Look at the first two pages, which both fit on screen.
- **Expected:** Both pages are drawn.
- **Actual:** Now and then one of them stays blank although it is on screen (measured: its frame at 954 px of a 1366 px screen, nothing drawn for 10–30 seconds). Seen on page 1 (about 1 open in 6–8, while page 2 is drawn; once the page counter read 2/4 instead of 1/4) and on page 2 (more often when the computer is busy). Never seen on desktop. Timing-dependent, so no test is marked as expected to fail for it; the tablet tests REG-862 and REG-866 will keep failing now and then until it is fixed.

### P2 · OCR

#### DEF-201 — A scanned page with a printed page number is never made searchable — **P2**
- **Test:** REG-215 (reproduced in Run 10)
- **Steps:**
  1. Inside a project, upload a scanned PDF whose pages carry only a printed page number as text (for example "7") and otherwise only the scanned image.
  2. Wait for background reading (OCR) to finish.
  3. Search for a word that is visible on the scanned page.
- **Expected:** Background OCR reads the page, so its words can be found.
- **Actual:** The page is skipped because it already "has text" (the page number), so its words are never found.

### P2 · Offline & PWA

#### DEF-904 — Sign in while offline throws the user out of the app — **P2**
- **Test:** OFF-008 (reproduced in Run 10)
- **Steps:**
  1. Signed out and with no internet, press Sign in.
- **Expected:** A message that sign-in needs a connection; the app stays open.
- **Actual:** The browser leaves for the sign-in website, which cannot load.

### P2 · PDF viewer & Find

#### DEF-207 — Text on a PDF page cannot be selected or copied — **P2**
- **Test:** REG-290 (reproduced in Run 10)
- **Steps:**
  1. Open a PDF with no tool selected.
  2. Drag across a sentence on the page.
- **Expected:** The text is selected; it can be copied, or dragged onto the canvas to make a note.
- **Actual:** Nothing is selected: the app turns text selection off, and the page's invisible text layer is too narrow to catch the mouse, so the page underneath takes every click. Copying text and dragging a passage onto the canvas are impossible. (Dropping an excerpt on the canvas does work when one arrives, so only the selection is broken.)

#### DEF-208 — The page you were reading is forgotten after a reload — **P2**
- **Test:** REG-248 (reproduced in Run 10)
- **Steps:**
  1. Open a multi-page PDF and go to page 3.
  2. Reload the page (or close and reopen the app).
- **Expected:** The document reopens on page 3.
- **Actual:** It always opens on page 1.

#### DEF-213 — Going back to a document you were reading opens it on page 1, not where you left off — **P2**
- **Test:** REG-031 (reproduced in Run 10)
- **Steps:**
  1. Open a multi-page PDF and go to page 3.
  2. Press Back to documents.
  3. Open the same document again.
- **Expected:** The document opens on page 3, where you left off.
- **Actual:** Page 1 is shown. The page counter shows 3/4 for a moment, then changes to 1/4: the app remembers page 3 but never scrolls to it. Related to DEF-208 (the page is also forgotten after a reload); this one happens without leaving the app.

### P2 · Projects

#### DEF-004 — Uploading a broken PDF from Home leaves an empty project behind — **P2**
- **Test:** REG-018 (reproduced in Run 10)
- **Steps:**
  1. On the Home screen with no projects, press Upload.
  2. Choose a PDF file that is damaged.
- **Expected:** the file is refused and no project is created.
- **Actual:** the file is refused, but a project called "New Project 1" with "0 docs" stays on the Home screen.

### P2 · Scanner

#### DEF-917 — Scans cannot be saved without internet — **P2**
- **Test:** OFF-007 (reproduced in Run 10)
- **Steps:**
  1. With no internet, open the scanner, add a page and press Save.
- **Expected:** The scan is saved on the device.
- **Actual:** The save fails with "Setting up fake worker failed: Failed to fetch dynamically imported module …" and nothing is kept, even after a scan was saved online earlier in the same session.

### P2 · Sharing

#### DEF-502 — When the sharing service is down, Sharing shows empty boards instead of an error — **P2**
- **Test:** OFF-005, REG-503 (reproduced in Run 10)
- **Steps:**
  1. Make the sharing service fail (for example it answers 503).
  2. Open Sharing.
- **Expected:** "Couldn't reach the sharing service. Check your connection and try again." with a Try again button.
- **Actual:** "Nothing shared yet" and empty tabs, as if the account had nothing. No error, no Try again.

### P2 · Text documents (Markdown, TXT)

#### DEF-209 — In a Markdown document, moving to the next search match removes all the highlights — **P2**
- **Test:** REG-249 (reproduced in Run 10)
- **Steps:**
  1. Open a Markdown document.
  2. Search for a word that appears several times.
  3. Press Enter to go to the next match.
- **Expected:** All matches stay highlighted and the next one is marked as current.
- **Actual:** Every highlight disappears; only the "n of N" counter changes.

### P2 · Tours & tutorials

#### DEF-601 — Offline, a tutorial video stays a black box forever — **P2**
- **Test:** REG-675 (reproduced in Run 10)
- **Steps:**
  1. With no internet (or YouTube unreachable), open any tutorial video from the Home header or Settings > Tutorials.
- **Expected:** After a short wait: "This video didn't load" with an "Open on YouTube" link (the player has this screen built in).
- **Actual:** An empty black rectangle with no message.

### P3 · Accessibility

#### DEF-005 — The Change PIN boxes have no spoken names — **P3**
- **Test:** A11Y-005 (reproduced in Run 10)
- **Steps:**
  1. Open the profile menu, then Change PIN.
  2. Move through the three boxes with a screen reader.
- **Expected:** each box is announced as "Current PIN", "New PIN" and "Confirm new PIN".
- **Actual:** the words are shown above the boxes but are not connected to them, so the boxes are announced without names.

#### DEF-302 — The play/pause buttons on audio and video note cards have no spoken name — **P3**
- **Test:** REG-360 (reproduced in Run 10)
- **Steps:**
  1. With a screen reader on, move to the play button of an audio note card (or a video note card).
- **Expected:** It is announced as "Play" (or "Pause").
- **Actual:** It is announced only as "button".

#### DEF-602 — The Install app dialog and the language offer have no spoken name — **P3**
- **Test:** REG-614 (reproduced in Run 10)
- **Steps:**
  1. With a screen reader on, press Install app in the top bar, or type 8 or more Hindi characters into the project name box to get the language offer.
- **Expected:** The screen reader announces the dialog by name, as for every other dialog.
- **Actual:** Both are announced only as "dialog".

#### DEF-907 — Tool buttons do not tell a screen reader which tool is on — **P3**
- **Test:** A11Y-043 (reproduced in Run 10)
- **Steps:**
  1. With a screen reader, turn on a document or canvas tool and move back to its button.
- **Expected:** The button is announced as pressed (on).
- **Actual:** No on/off state is announced.

#### DEF-912 — The OCR dialog's language list has no spoken name — **P3**
- **Test:** A11Y-025 (reproduced in Run 10)
- **Steps:**
  1. With a screen reader, open the OCR dialog and move to the language list.
- **Expected:** It is announced as "Language" (or similar).
- **Actual:** It is announced without a name.

#### DEF-913 — Some scrolling areas cannot be reached with the keyboard — **P3**
- **Test:** A11Y-013, A11Y-031, A11Y-037 (reproduced in Run 10)
- **Steps:**
  1. Using only the keyboard, try to scroll Settings > Shortcuts, or the workspace (desktop and phone).
- **Expected:** The area can be focused and scrolled with the arrow keys.
- **Actual:** Keyboard focus never reaches it, so its hidden part cannot be read.

#### DEF-914 — On a phone, hidden decorative copies still contain buttons keyboard users land on — **P3**
- **Test:** A11Y-037 (reproduced in Run 10)
- **Steps:**
  1. On a phone layout, Tab through Home and the workspace.
- **Expected:** Focus moves only through visible controls.
- **Actual:** Focus also lands on buttons inside hidden decorative copies (the Home sample card, workspace overlays).

#### DEF-915 — Keyboard focus is lost after closing some dialogs — **P3**
- **Test:** A11Y-045, A11Y-046, A11Y-048 (reproduced in Run 10)
- **Steps:**
  1. Open Delete Project, Change PIN or quick search with the keyboard, then close it.
- **Expected:** Focus returns to the button that opened it.
- **Actual:** Focus is left nowhere, so a keyboard user must start again from the top of the page.

### P3 · App shell & navigation

#### DEF-606 — When another tab blocks the data, the loading screen gives the wrong reason — **P3**
- **Test:** REG-617 (reproduced in Run 10)
- **Steps:**
  1. Keep an old tab of the app open at an older data version.
  2. Open the app in another tab.
- **Expected:** "Another Cognitive Canvas tab is holding your data at an older version. Close the other tabs and try again." (the app has this message).
- **Actual:** After the retries: "Your data did not open within 20 seconds.", which does not say what to do.

### P3 · Assistant

#### DEF-701 — "Create a project called Lab Book" creates a project named "called Lab Book" — **P3**
- **Test:** REG-743 (reproduced in Run 10)
- **Steps:**
  1. Open the Canvas Assistant and type: create a project called Lab Book
- **Expected:** A project named "Lab Book".
- **Actual:** A project named "called Lab Book" ("named X" behaves the same).

#### DEF-704 — When two catalog items share a title, the assistant always imports the first — **P3**
- **Test:** REG-749 (reproduced in Run 10)
- **Steps:**
  1. With "Chapter 2" in both Class 11 and Class 12, type "import chapter" in the assistant.
  2. Press the second "Chapter 2" button.
- **Expected:** The Class 12 chapter is imported.
- **Actual:** The two buttons look the same and both import Class 11. Typing "import chapter 2" imports Class 11 without asking.

#### DEF-707 — "class 12 physics" opens the right chapters but the assistant says it did not understand — **P3**
- **Test:** REG-790 (reproduced in Run 10)
- **Steps:**
  1. Type "class 12 physics" in the assistant.
- **Expected:** The catalog opens Class 12 › Physics and the reply lists its chapters.
- **Actual:** The catalog opens correctly, but the reply is "I can open the catalog, jump to a class… What would you like to do?".

#### DEF-708 — "download chapter 5" gets a question that cannot be answered — **P3**
- **Test:** REG-791 (reproduced in Run 10)
- **Steps:**
  1. Type "download chapter 5" in the assistant (any chapter except 1).
- **Expected:** Chapter 5 is downloaded.
- **Actual:** "Did you mean: 1) … 2) …" with no buttons; typing "2" is not understood.

### P3 · Backup & restore

#### DEF-404 — Reopening the app makes another identical automatic backup although nothing changed — **P3**
- **Test:** REG-499 (reproduced in Run 10)
- **Steps:**
  1. In MoBrowser, open Data Center > Auto Backup > Folder & GitHub.
  2. Turn automatic backup on, choose a folder (a backup is made) and pick an interval.
  3. Close and reopen the app without changing anything.
  4. Wait one interval.
- **Expected:** No new backup; the card keeps saying "Runs every … when you have new changes."
- **Actual:** A new, identical backup file is written. Old backups are never removed, so the folder or repository fills with duplicates.

#### DEF-901 — The search text of a restored PDF is not rebuilt — **P3**
- **Test:** PST-013 (reproduced in Run 10)
- **Steps:**
  1. Back up a project with a normal (text) PDF, delete it, restore it.
  2. Check whether the restored document's search text is rebuilt.
- **Expected:** It is rebuilt, as the app's own design says ("text is re-extracted from PDFs on restore").
- **Actual:** It is not rebuilt. Find still works on text PDFs because it reads the page itself, so users do not notice; for scanned pages this is DEF-902.

### P3 · Canvas

#### DEF-301 — Changing the eraser size does not change the eraser circle under the mouse — **P3**
- **Test:** REG-306 (reproduced in Run 10)
- **Steps:**
  1. Arm Draw, then the Eraser.
  2. Choose another eraser size and move the mouse over the canvas.
- **Expected:** The circle under the mouse matches the chosen size.
- **Actual:** It keeps showing the Medium circle, although erasing does use the new size.

#### DEF-304 — Send to Back does not put a note behind all the others — **P3**
- **Test:** REG-322 (reproduced in Run 10)
- **Steps:**
  1. Place three overlapping notes.
  2. Right-click the top one and choose Send to Back.
- **Expected:** It goes behind both other notes.
- **Actual:** It goes behind the newest note but stays in front of the oldest.

#### DEF-306 — Choosing the Default text colour does not remove a colour — **P3**
- **Test:** REG-340 (reproduced in Run 10)
- **Steps:**
  1. In a note, colour some words Red and press Done.
  2. Reopen the note, select the words, choose Text color > Default and press Done.
- **Expected:** The words go back to the default colour.
- **Actual:** They stay red.

#### DEF-307 — Ctrl+Enter while typing in a note does not save and close it — **P3**
- **Test:** REG-380 (reproduced in Run 10)
- **Steps:**
  1. Open a note, type some words, press Ctrl+Enter.
- **Expected:** The note is saved and the editor closes.
- **Actual:** The editor stays open. It only works when the cursor is outside the text.

#### DEF-308 — An empty note's editor says "0 words · 1 char" — **P3**
- **Test:** REG-390 (reproduced in Run 10)
- **Steps:**
  1. Create a note and open it without typing.
- **Expected:** "0 words · 0 chars".
- **Actual:** "0 words · 1 char": the empty line is counted. (A paste into an empty note is likewise cut at 49,999 of the 50,000 allowed characters.)

#### DEF-309 — Clicking a spot on the mini-map centres the view below that spot — **P3**
- **Test:** REG-386 (reproduced in Run 10)
- **Steps:**
  1. Open the mini-map.
  2. Click a note's mark on it.
- **Expected:** That note is in the middle of the canvas.
- **Actual:** The view lands about 110 pixels off vertically, roughly the mini-map title bar's height.

#### DEF-311 — The note editor sometimes throws an error while formatting text — **P3** — *intermittent*
- **Test:** Seen in: REG-336 (about 1 run in 6) (intermittent: no test is marked as expected to fail)
- **Steps:**
  1. Open a note, type text, select words and apply formatting (bold, italic, …) several times.
- **Expected:** No errors.
- **Actual:** Now and then the page logs "Maximum update depth exceeded" from the editor toolbar. Nothing visible goes wrong. Timing-dependent, so no test is marked as expected to fail for it.

#### DEF-312 — After a reload, overlapping pen strokes can come back in a different stacking order — **P3**
- **Test:** REG-395 (reproduced in Run 10)
- **Steps:**
  1. On the canvas, draw several pen strokes in different colours over the same spot, one after another.
  2. Reload the page.
- **Expected:** Each newer stroke is still drawn on top of the older ones, as before the reload.
- **Actual:** The strokes come back in a random order (the order in which they happen to be stored), so an older stroke can now cover a newer one. The colours themselves are kept.

### P3 · Catalog & deep links

#### DEF-702 — A catalog item packaged as a backup keeps the name stored inside the file — **P3**
- **Test:** REG-720 (reproduced in Run 10)
- **Steps:**
  1. Download a catalog item whose package is a Cognitive Canvas backup.
- **Expected:** The project gets its catalog name, as every other package type does.
- **Actual:** The project gets the name stored inside the file (in the test: "genetics authoring copy v3").

#### DEF-705 — With no projects yet, a catalog download in progress shows nothing on Home — **P3**
- **Test:** REG-738 (reproduced in Run 10)
- **Steps:**
  1. On a fresh profile with no projects, start a catalog download.
  2. Go to Home while it downloads.
- **Expected:** A placeholder card with "Downloading…" (shown when at least one project exists).
- **Actual:** An empty list with neither the placeholder nor the "No projects yet" message, until the download finishes. This is exactly where new users are.

### P3 · Data Center

#### DEF-401 — Switching to Restore keeps a backup-only page on screen — **P3**
- **Test:** REG-420 (reproduced in Run 10)
- **Steps:**
  1. Open Backup & Restore and pick Local.
  2. In the sidebar, click Auto Backup.
  3. Click Restore at the top.
- **Expected:** The restore sources are shown, as when Auto Backup was picked from the start screen.
- **Actual:** The automatic backup page stays on screen in Restore mode, with nothing highlighted in the sidebar.

#### DEF-403 — Signed out, Cloud restore is marked "Pro" although no plan is needed — **P3**
- **Test:** REG-436 (reproduced in Run 10)
- **Steps:**
  1. Signed out, open Backup & Restore and switch to Restore.
- **Expected:** No plan badge on Cloud; the page itself says "No plan is needed to restore — just your account."
- **Actual:** The Cloud card and its sidebar row both show "Pro".

### P3 · Document tools

#### DEF-210 — The Link Doc button does not close its own document picker — **P3**
- **Test:** REG-287 (reproduced in Run 10)
- **Steps:**
  1. In a PDF, press Link Doc (the picker opens).
  2. Press Link Doc again.
- **Expected:** The picker closes.
- **Actual:** It closes and immediately opens again.

### P3 · Documents

#### DEF-204 — An unsupported file uploaded with a PDF inside a project is ignored without a word — **P3**
- **Test:** REG-235 (reproduced in Run 10)
- **Steps:**
  1. Inside a project, upload a PDF together with an unsupported file (for example a .exe).
- **Expected:** A message says the unsupported file was skipped (uploading from Home does say this).
- **Actual:** The PDF is added and nothing is said about the other file.

#### DEF-909 — A full device during an upload is reported as a broken file — **P3**
- **Test:** PST-025 (reproduced in Run 10)
- **Steps:**
  1. Fill the device storage until it is nearly full.
  2. Upload a PDF into a project.
- **Expected:** A message that the device is full.
- **Actual:** Only 'Could not open "<file>".' Nothing is half-saved, which is correct.

### P3 · Live share

#### DEF-503 — Stopping a live share for everyone removes it from the owner's history — **P3**
- **Test:** REG-583 (reproduced in Run 10)
- **Steps:**
  1. In Sharing > Shares, open a live share > ⋯ > Stop updating for everyone… > Stop updating.
- **Expected:** It stays under Stopped ("Stopped · they keep their copies") with "Share again, live".
- **Actual:** It disappears; Stopped shows 0, so it cannot be shared again from its history.

### P3 · Mobile, tablet & iPad

#### DEF-801 — Renaming a phone project to a name with symbols silently keeps the old name — **P3**
- **Test:** REG-804 (reproduced in Run 10)
- **Steps:**
  1. On a phone, open a project row's ⋯ menu > Rename.
  2. Type "Bad/Name" and press Enter.
- **Expected:** As on the desktop card, the field stays open with "Only letters, numbers, and spaces are allowed".
- **Actual:** The field closes and the old name stays, with no message.

#### DEF-802 — On a phone, Install app skips the "why install" screen — **P3**
- **Test:** REG-819 (reproduced in Run 10)
- **Steps:**
  1. On a phone whose browser offers installation, tap Menu > Install app.
- **Expected:** As on the desktop: first the explanation with one Install app button, then the browser's prompt.
- **Actual:** The browser's install prompt appears at once.

#### DEF-803 — The "Can't reach MuulOrigin" banner covers the bottom rows of the phone Menu — **P3**
- **Test:** REG-848 (reproduced in Run 10)
- **Steps:**
  1. On a phone, cause two failed requests (for example open the Catalog with no internet).
  2. Open Menu.
- **Expected:** Every row can be tapped.
- **Actual:** The banner covers Help & support, Change PIN and Lock until it is dismissed.

### P3 · OCR

#### DEF-202 — The OCR summary counts a blank page as a page with text — **P3**
- **Test:** REG-219 (reproduced in Run 10)
- **Steps:**
  1. Run OCR on a blank scanned page.
- **Expected:** The summary says 0 pages with text.
- **Actual:** It says "1 pages with text".

#### DEF-203 — The OCR completion message says "1 pages processed" — **P3**
- **Test:** REG-219 (reproduced in Run 10)
- **Steps:**
  1. Run OCR on a single page.
- **Expected:** "1 page processed".
- **Actual:** "OCR Complete · 1 pages processed".

#### DEF-211 — Cancelling OCR sometimes causes an error in the page — **P3** — *intermittent*
- **Test:** Seen in: REG-208 (seen once) (intermittent: no test is marked as expected to fail)
- **Steps:**
  1. Start OCR on a multi-page scanned PDF.
  2. Press Cancel while it is reading.
- **Expected:** OCR stops quietly.
- **Actual:** Sometimes an error appears in the browser console ("Cannot read properties of null (reading 'postMessage')"). The OCR does stop. Seen once in many runs, so no test is marked as expected to fail for it.

### P3 · Offline & PWA

#### DEF-903 — Offline, Support shows a raw browser error — **P3**
- **Test:** OFF-006 (reproduced in Run 10)
- **Steps:**
  1. Signed in and with no internet, open Settings > Support > My tickets.
- **Expected:** A message in words that the connection is missing.
- **Actual:** "Couldn't load your tickets" followed by "Failed to fetch".

#### DEF-918 — Offline, the cloud restore list says there are no backups — **P3**
- **Test:** OFF-011 (reproduced in Run 10)
- **Steps:**
  1. Signed in on Pro with a cloud backup, and with no internet, open Backup & Restore > Restore > Cloud.
- **Expected:** A message that the cloud cannot be reached.
- **Actual:** "No backups found in Muul Cloud." and "The upload could not reach the server", although a backup exists and nothing is being uploaded.

### P3 · PDF viewer & Find

#### DEF-205 — "Open" on the Hindi virtual keyboard suggestion does not open the keyboard — **P3**
- **Test:** REG-257 (reproduced in Run 10)
- **Steps:**
  1. Open a PDF with Hindi text and open Find.
  2. Press "Open" on the suggestion "Use Hindi virtual keyboard…".
- **Expected:** The on-screen Hindi keyboard opens.
- **Actual:** The suggestion disappears and no keyboard opens.

#### DEF-212 — Clicking a page thumbnail right after opening the page list can jump back to page 1 — **P3** — *intermittent*
- **Test:** Seen in: REG-027 (worked around) (intermittent: no test is marked as expected to fail)
- **Steps:**
  1. Open a multi-page PDF.
  2. Open the page list (thumbnails) and immediately click the thumbnail of page 3.
- **Expected:** The viewer goes to page 3.
- **Actual:** Sometimes it goes to page 3 and then back to page 1, because the viewer re-aligns itself after the panel opens. Timing-dependent, so no test is marked as expected to fail for it.

### P3 · Projects

#### DEF-603 — Double-clicking a project name opens the project instead of renaming it — **P3**
- **Test:** REG-638 (reproduced in Run 10)
- **Steps:**
  1. On Home, double-click a project's name on its card.
- **Expected:** The name becomes editable (the app has a double-click rename for this).
- **Actual:** The first click opens the project, so the rename never happens. Rename from the ⋯ menu works.

#### DEF-604 — A single file uploaded from Home opens the document list instead of the file — **P3**
- **Test:** REG-633 (reproduced in Run 10)
- **Steps:**
  1. On Home, upload (or drag in) one PDF or Markdown file.
- **Expected:** The new project opens with that file open, as when uploading one file inside a project.
- **Actual:** It lands on the project's document list and the file has to be clicked again.

### P3 · Sharing

#### DEF-501 — A people search refused for "too many searches" says nobody was found — **P3**
- **Test:** REG-520, REG-585 (reproduced in Run 10)
- **Steps:**
  1. In the Share dialog or New group, search for people quickly enough for the server to slow you down ("try again in 12 seconds").
- **Expected:** "Searching too fast — try again in 12 seconds."
- **Actual:** "No one found for …" / "No registered users found.", which reads as if the account does not exist. Affects every people search box.

#### DEF-506 — With no team members, Add people hides the people searched before — **P3**
- **Test:** REG-586 (reproduced in Run 10)
- **Steps:**
  1. On an account with no team, open a class > Manage > Add people.
  2. Search a student by email, close the dialog, reopen it.
- **Expected:** A "Recently searched" list with that student.
- **Actual:** "No results" and no tabs, so the person must be typed again.

### P3 · Text documents (Markdown, TXT)

#### DEF-206 — In Markdown and text documents the first search match is not marked — **P3**
- **Test:** REG-247 (reproduced in Run 10)
- **Steps:**
  1. Open a Markdown or text document.
  2. Search for a word that appears twice.
- **Expected:** The first match is marked as current and scrolled into view.
- **Actual:** Nothing is marked as current until Enter is pressed.

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
| Real servers: MuulOrigin sign-in, Muul Cloud, sharing, support, catalog, GitHub, the MoBrowser host | Tests must never touch real accounts, repositories or storage | Stateful fakes that follow each contract (06, "External services"); a pass proves the app's side of the contract, not the server's |
| The sign-in round trip itself | It happens on an external website | The redirect address and the signed-in state are checked |
| Screen-reader listening experience | Automated checks find rule violations, not how it sounds | Axe scans of every screen (A11Y-001..037), keyboard and focus tests (A11Y-038..050); manual A11Y-007 |
| Safari's own page-zoom gesture | Playwright's WebKit on Windows cannot create the gesture event | REG-886 is parked (Blocked) until it runs on macOS or a real iPad |
| Very long or very large operations | 10-minute recordings, 120 MB video takes, share uploads over 90 MB, more than 9 GB of app data | Their size checks are tested with sparse files and mocked limits |
| Recovery of an unsaved recording after a crash | Needs the page to crash mid-recording | Not covered |
| "Device storage almost full" warning before an upload | The browser's storage estimate cannot be overridden from a test | The save failing on a full device is tested (PST-025, PST-026) |
| Mobile-data warning for large downloads during sync | The Network Information API cannot be faked reliably | Not covered |
| Rules that say something must *not* happen on a device (a phone never OCRs in the background; a tablet skips files over 30 MB) | Proving a non-event needs an arbitrary wait | The positive side is tested (REG-876, REG-877) |
| States shown for under a second ("Unlocking…", "Scanning pages…", "Reading file…") | Too short to observe reliably | The states before and after are checked |
| Intermittent defects DEF-211, DEF-212, DEF-311, DEF-806 | Timing races in the app that cannot be triggered on demand | Written up above; the affected tests wait for the race to settle |
| Code that no screen can reach | Quiz and select tools, floating workspace toolbar, old sharing views, old backup window and quick backup/restore, in-app backup picker, upgrade prompt, keyword and "search all documents" panels, long-press text menu, gesture hint, install card, theme toggle, users-management section, Settings auto-backup panel, the off-by-default workspace change feed | Not testable without changing the app; listed so dead code can be removed or wired up |
| Visual appearance | No pixel-snapshot tests: fonts and anti-aliasing differ between machines, so snapshots would be noise | Layout, geometry and state assertions instead |
| Code coverage of the production bundle | The bundle is not instrumented | Unit coverage (Vitest) is reported separately |
