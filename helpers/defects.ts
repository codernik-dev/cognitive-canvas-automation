/**
 * Application defects the suite has reproduced. Plain-language write-ups,
 * steps and priorities live in docs/08-DEFECTS-AND-LIMITATIONS.md.
 *
 * A test that covers one calls knownDefect(id) first: it keeps asserting the
 * CORRECT behaviour and is expected to fail while the defect exists. When the
 * app is fixed the test "unexpectedly passes", the run goes red, and the
 * marker is removed. Never use this for a flaky or unexplained failure.
 */
import { test } from '@playwright/test'

export const DEFECTS = {
  'DEF-001': 'Find in document does not move to a match on a page that has not been scrolled into view yet',
  'DEF-002': 'Restoring an invalid backup file shows "Restore failed: Restore failed" instead of the reason',
  'DEF-003': 'Toast messages have no live-region role, so screen readers never announce them',
  'DEF-004': 'Uploading an unreadable PDF from Home leaves an empty "New Project" behind',
  'DEF-005': 'Change PIN form labels are not connected to their inputs',
  'DEF-006': 'Typing straight after placing a Text box on the canvas does nothing; the box has to be clicked again first',
  'DEF-007': 'The offline service worker never registers, so the app cannot open without a network',
  'DEF-201': 'A scanned page whose text layer holds only a page number (under 8 characters) is never read by background OCR, so its words cannot be found',
  'DEF-202': 'After OCR, the dialog\'s "pages with text" count includes pages where nothing was read',
  'DEF-203': 'The OCR completion toast says "1 pages processed" for a single page',
  'DEF-204': 'Uploading a supported file together with an unsupported one into a project silently ignores the unsupported one',
  'DEF-205': 'The "Open" button on the "Use Hindi virtual keyboard" suggestion only hides the suggestion; no keyboard opens',
  'DEF-206': 'In Markdown and text documents the first match of a new search is not marked as the current match (and is not scrolled to) until Enter is pressed',
  'DEF-207': 'Text on a PDF page cannot be selected or copied (the whole app turns text selection off), so dragging a passage onto the canvas never works',
  'DEF-208': 'The page being read is not saved: after a reload or a new session every document opens on page 1 again',
  'DEF-209': 'In a Markdown document, moving to the next or previous find match removes every match highlight; only the counter moves',
  'DEF-210': 'Clicking the Link Doc button while its document picker is open does not close the picker (it closes and opens again at once)',
  'DEF-211': 'Cancelling OCR sometimes throws an uncaught error in the page (Cannot read properties of null, reading postMessage) from the stopped OCR engine',
  'DEF-212': 'Clicking a page thumbnail just after opening the page index can throw the document back to page 1 (intermittent)',
  'DEF-213': 'Reopening a document in the same session shows page 1: the page counter briefly shows the page you were on, but the view never scrolls there and the counter falls back to 1',
  'DEF-401': 'Switching the Data Center to Restore while on an Auto Backup page opened from the sidebar keeps showing that backup-only page instead of returning to the restore sources',
  'DEF-403': 'Signed out, the Restore chooser and sidebar mark Cloud with a "Pro" badge although restoring needs no plan, only sign-in, as the page itself says',
  'DEF-404': 'With automatic folder/GitHub backup on, simply reopening the app writes another identical backup although nothing changed (the schedule promises to run only when there are new changes)',
  'DEF-402': 'A cloud backup the server stored only in part is reported as "Muul Cloud is temporarily unavailable. Nothing was lost" instead of the app\'s own "did not arrive intact" message',
  'DEF-301': 'Choosing another canvas eraser size does not change the eraser circle under the mouse; it keeps showing the old size',
  'DEF-302': 'The play/pause button on an audio note card has no accessible name, so a screen reader announces only "button"',
  'DEF-303': 'Erasing part of a pen stroke that is linked to a PDF highlight silently breaks the link: the pieces left behind are no longer linked',
  'DEF-304': 'Send to Back on the canvas does not put a note behind all the others: it stays in front of the oldest notes',
  'DEF-305': 'A link between two notes stays selected after the user moves to the PDF, and pressing Delete there deletes that link',
  'DEF-306': 'In the note editor, choosing the Default text colour for words that were coloured leaves them coloured',
  'DEF-307': 'In the note editor, Ctrl+Enter pressed while typing in the note does not save and close it (it only works when the cursor is outside the text)',
  'DEF-308': 'The editor of an empty note says "0 words · 1 char": the empty line is counted as a character',
  'DEF-309': 'Clicking a spot on the canvas mini-map centres the view about a title-bar height below the spot that was clicked',
  'DEF-311': 'Now and then the note editor throws "Maximum update depth exceeded" (React error 185) from its toolbar while text is being selected and formatted (about 1 run in 6 of REG-336)',
  'DEF-312': 'After a reload, pen strokes on the canvas come back in random stacking order, so an older stroke can end up on top of a newer one',
  'DEF-501': 'A people search refused for searching too fast (Share dialog, New group) says nobody was found instead of asking to wait',
  'DEF-502': 'When the sharing service cannot be reached on opening Sharing, the screen shows empty boards ("Nothing shared yet") instead of the error with Try again',
  'DEF-503': 'A live share stopped for everyone disappears from the owner\'s Shares instead of staying under Stopped, so it cannot be shared again from its history',
  'DEF-504': 'After a failed live push, pressing Push again succeeds but the share keeps showing "couldn\'t send your last change" and the warning strip',
  'DEF-505': 'Stopping one document of a whole-project live share works once, but the document joins the share again on the next push',
  'DEF-506': 'In Add people, an account with no team members sees "No results" and no Recently searched tab, so people found before cannot be picked again without retyping',
  'DEF-601':'Offline, a tutorial video opens on a black player forever instead of saying it could not load and offering the YouTube link',
  'DEF-701': 'Asking the Canvas Assistant to "create a project called Lab Book" creates a project named "called Lab Book"',
  'DEF-702': 'A catalog item packaged as a Cognitive Canvas backup is added under the name stored inside the file instead of its catalog name',
  'DEF-703': 'Catalog items downloaded together with Select are named by their bare title, without the category the single Download adds',
  'DEF-704': 'When two catalog items share a title, the Canvas Assistant always imports the first one: its two identical choice buttons both import the first item',
  'DEF-705': 'With no projects yet, a catalog download in progress shows nothing on Home: no placeholder card and no empty-state message',
  'DEF-706': 'In the Legal layout, clicking a document\'s classification badge opens the document instead of the classification menu',
  'DEF-707': 'Typing "class 12 physics" in the Canvas Assistant opens the right chapters, but the assistant answers as if it had not understood',
  'DEF-708': 'Asking the Canvas Assistant to "download chapter 5" gets an unanswerable "Did you mean: 1) … 2) …" question instead of the download',
  'DEF-602': 'The Install app dialog and the language offer pop-up have no accessible name, so screen readers announce only "dialog"',
  'DEF-603': 'Double-clicking a project name on its card opens the project instead of renaming it',
  'DEF-604': 'A single file uploaded from Home opens its new project on the document list instead of opening the file',
  'DEF-606': 'When another tab holds the data at an older version, the loading screen ends on "Your data did not open within 20 seconds" instead of telling you to close the other tabs',
  'DEF-801': 'On a phone, renaming a project to a name with symbols silently keeps the old name; unlike the desktop card it never says why',
  'DEF-802': 'On a phone, Install app jumps straight to the browser\'s install prompt without first showing why to install, which the desktop always does',
  'DEF-901': 'After a backup is restored, a PDF\'s search text is not rebuilt: the backup leaves it out and the restored document still says it is indexed, although the backup design says the text is re-extracted on restore',
  'DEF-902': 'A backup does not keep the text OCR read from scanned pages: after a restore the words are gone, and Find has to read every scanned page again before it can find them',
  'DEF-908': 'A note longer than about four million characters saves normally, but restoring a backup silently leaves it out',
  'DEF-909': 'When the device runs out of storage during an upload, the app only says "Could not open <file>." instead of saying the device storage is full',
  'DEF-903': 'Offline, Settings › Support says "Couldn\'t load your tickets" followed by the browser\'s raw "Failed to fetch" instead of saying the connection is missing',
  'DEF-904': 'Offline, Sign in sends the browser to the MuulOrigin sign-in page, which cannot load, so the user is thrown out of the app instead of being told sign-in needs a connection',
  'DEF-906': 'Project cards on Home and document cards in a project cannot be reached with Tab, so a keyboard-only user cannot open a project or a document from its card',
  'DEF-907': 'The document and canvas tool buttons do not tell screen readers which tool is switched on (no pressed state)',
  'DEF-910': 'Text with too little contrast against its background (below 4.5:1) on many screens: Settings (Appearance, Language, Permissions, Support), every Data Center view, the Catalog, the Legal calendar, note editor, OCR dialog, image editor, tour card, audio/video dialogs, Delete Project, Change/Reset PIN, Install dialog, Sharing, the green "uploaded" message and the phone layout',
  'DEF-911': 'Form fields without a label a screen reader can announce: the hearing time field (Legal calendar), the image editor\'s three sliders, and the hidden file-upload field on the document list',
  'DEF-912': 'The OCR dialog\'s language list has no accessible name',
  'DEF-913': 'Scrolling areas a keyboard user cannot reach or scroll: Settings › Shortcuts and the workspace (desktop and phone)',
  'DEF-914': 'On a phone, hidden decorative copies (the Home sample card, the workspace overlays) still contain buttons that keyboard and screen-reader users land on',
  'DEF-915': 'Closing the Delete Project and Change PIN dialogs, or quick search, does not put keyboard focus back on the control that opened them; it is lost',
  'DEF-916': 'With the connection gone, opening a screen not used yet in the session (Backup & Restore, Settings, Sharing) or starting a cloud backup reloads the app, which then cannot load: the page goes blank',
  'DEF-917': 'Offline, saving a scan fails with a technical message ("Setting up fake worker failed: Failed to fetch dynamically imported module …pdf.worker.min.mjs"), so pages scanned without a connection cannot be kept',
  'DEF-918': 'Offline, the cloud restore list says "No backups found in Muul Cloud." and "The upload could not reach the server", although backups exist and nothing is being uploaded',
  'DEF-803': 'On a phone, the "Can\'t reach MuulOrigin" banner sits on top of the open Menu sheet and blocks its bottom rows (Help & support, Change PIN, Lock) until it is dismissed',
  'DEF-804': 'On phones and tablets a two-finger pinch does not zoom an open PDF (it stays at its zoom), and the browser\'s own pinch is switched off there, so the PDF cannot be pinch-zoomed at all',
  'DEF-805': 'On a touch screen, a document card lifted by press-and-hold never drops: moving the finger cancels the touch, the lifted copy stays on screen and the new order is not saved',
} as const

export type DefectId = keyof typeof DEFECTS

export function knownDefect(id: DefectId) {
  test.info().annotations.push({ type: 'known-defect', description: `${id}: ${DEFECTS[id]}` })
  test.fail()
}
