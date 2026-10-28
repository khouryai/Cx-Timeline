# CLAUDE.md — project conventions for cx-timeline

## The one rule that bites

`index.html` loads **`app.bundle.js`**, not `src/`. After changing anything
under `src/`, run `npm run build`, which writes both bundles — the second,
`calendar.bundle.js`, is the calendar the main one loads on first use. They are
committed on purpose: they are what the desktop update kit is packed from, with
no build step after Checks.

## One shape: the desktop app, and a OneDrive folder

There is no server. The plan (the timeline) is a JSON file in a folder the user
picked — one OneDrive or SharePoint keeps in sync — and the resource calendar
is a set of JSON files under `calendar/` in the same folder. There is no
Supabase, no account, no website and no phone app any more; how that came
about is `docs/PLAN_ONEDRIVE_ONLY.md` (implemented), and how to run it is
`DEPLOY.md`.

It ships as the **Windows desktop build** in `src-tauri/`, where the folder is a
path and simply opens. The same page also runs in Edge or Chrome over a folder
the browser is granted (File System Access API) — that is how the browser
suites drive it — and, with no folder connected, against browser storage
(**local mode**), which is the development and test path.

**Who may do what is the folder's sharing, never the application's.** A
read-only OneDrive share cannot write; the application's read-only state (the
pen, `body.read-only`) explains who is editing, it does not protect anything.
What protects the work is the write guard: every file is written only if it is
still the copy this window last read.

**The calendar's database is `core/rc_db.js`.** It answers the subset of the
Supabase client's builder the screens were written against — `from(table)`,
`.select()`, `.eq()` … `.range()`, `.insert()`, `.upsert()`, `rpc()` — over
tables kept in files, with the old views and functions ported to JavaScript
(`rc_cancelled_days`, `rc_lookahead_days`, `rc_la_apply()`, `rc_tawr_revise()` …).
So the screens kept their queries, and the rules Postgres used to enforce live
in one module, tested in Node by `tools/test_rc_db.js`. Three things about it:

- **Every write is all or nothing, one at a time.** `tx()` applies the change in
  memory, writes each touched file through the guard, and rolls memory back if
  any write is refused — so what is on screen is what is on disk.
- **A refused write says `conflict:` and reads the file again.** Another
  computer's save that OneDrive brought down is never written over; the error
  carries `err.conflict` and the screens say so.
- **A write without the pen is refused before it reaches a file**
  (`err.readOnly`). The pen is `core/rc_folder.js`, with the plan's rules
  (`core/folder_rules.js`), but a separate pen: one person can hold the
  timeline while another holds the calendar.

**Nobody signs in.** `rc.me()` is the roster person whose name (or an
*Also written as* spelling) is the name set in the application
(`filestore.getDisplayName()`); an edit is stamped with that person's id.
`rc.isAdmin()` is true whenever a calendar is open — there is one editor at a
time, and whoever holds the pen may do everything — and `rc.canWrite()` is
whether this window holds it.

**The old calendar comes in once**, from the backup the old site took of itself
(*Reports → Back it up*): `core/rc_import.js` reads it, every id kept, and lists
what is not coming (the huddle, the week plan, SARs, accounts).

## Architecture

Authored as ES6 modules, linked ahead of time by `tools/build.js` into an
IIFE per entry point (`ENTRIES`). The linker supports a deliberately strict subset and rejects everything
else with a clear error:

- `import { a, b as c } from './x.js';` (may wrap across lines)
- `import * as NS from './x.js';`
- `export function` / `export class` / `export const`
- **No** `export default`, no re-exports (`export { x }`), no `export let/var`
- **No circular imports** — the build fails and prints the cycle
- An **empty name in an import list** (`import { a,, b }`) is a build error. It
  is a syntax error in real JavaScript, and the linker used to filter it away —
  so a file no browser could load bundled happily and shipped. A regex parser
  more forgiving than the language hides exactly the mistakes it should catch.
- **Two bundles.** `app.bundle.js` is everything `main.js` reaches;
  `calendar.bundle.js` is `ui/rc.js` and whatever only it reaches, loaded by
  `ui/calendar_loader.js` the first time the calendar opens (the desktop kit
  carries both in one script, so the desktop loads nothing). Importing
  `ui/rc.js` statically from the main graph is a build error, and so is a
  bundle that does not parse.

### Layers

```
core/util · core/events · core/dates      leaves — import nothing
core/folder_rules                         a leaf: the shared folder's names,
                                          digest and pen rules, pure (Node-tested)
core/access                               a leaf: may this window edit the plan,
                                          and the view that is theirs alone.
                                          Written by main.js, read by store and
                                          filestore — which must never see core/rc
core/desktop                              the only module that knows Tauri
core/filestore → core/desktop · core/folder_rules
                                          the only module that knows the File
                                          System Access API, and the folder
core/rc_db → core/folder_rules            the calendar's database: tables in files,
                                          the old views and functions — no DOM,
                                          storage handed in (Node-tested)
core/rc_folder → core/filestore           calendar/ in the folder, and its pen
core/rc → core/rc_db · core/rc_folder     the calendar's client — the plan's path
                                          never imports it
core/rc_import → core/rc_db               the old Supabase backup, read once
core/model → core/query · core/history · core/analysis
core/store → core/filestore · core/access · core/lookahead
                                          (never core/storage: that imports the
                                          store, and the build rejects the cycle)
timeline/viewport → timeline/layout → timeline/connectors
                  → timeline/renderer → timeline/interactions
ui/icons · ui/components → ui/lists · ui/access_mode → ui/theme → ui/commands
ui/pane_util → ui/pane_plan · ui/pane_filters · ui/pane_io · ui/pane_backups
             · ui/pane_settings · ui/p6 · ui/lookahead → ui/panels
ui/panels → ui/command_menu · ui/canvas_hint → ui/shell
ui/workspace · ui/calendar_loader         the calendar, loaded on first use:
    ui/rc → ui/rc_gate · ui/rc_roster → ui/rc_settings · ui/rc_activity
          · ui/rc_pto · ui/rc_tawr · ui/rc_master_export
          · ui/rc_lookahead → ui/rc_la_editor · ui/rc_la_* · ui/rc_ingest → ui/rc_la_state
          · ui/rc_table       → ui/rc_util   (calendar.bundle.js)
io/scene → io/svg · io/pdf · io/inflate → io/exporters · io/importers
io/rc_pdf → io/pdf · io/lookahead         the calendar drawn for print — no DOM
core/la_edit → core/lookahead             the look-ahead editor's model — no DOM
core/la_register → core/lookahead         readings stored as rows, and compared —
                                          the calendar's alone (calendar.bundle.js)
core/la_p6                                a leaf: the P6 list a look-ahead row names —
                                          an extract read, searched, compared — no DOM
core/export_schedule                      a leaf: when a scheduled master export is due
io/la_xlsx → core/la_edit · io/xlsx_write the 4WLA as an .xlsx — no DOM
core/tawr → core/lookahead                a look-ahead week as TAWRs — no DOM
io/tawr_pdf → io/inflate · io/pdf         BART's fillable PDF, filled — no DOM
ui/rc_gate                                the calendar's front door: no folder, an
                                          empty folder (import or start), unreadable
main.js                                   the only module that may import freely
```

Lower layers never import upwards. When something low needs to reach the UI it
**emits an event** (`core/events.js`, names in the `EV` map) and the UI
subscribes. That is what keeps the graph acyclic — and it is how a dock pane
opens another pane (`goToPane()` → `EV.PANE_OPEN`) and a calendar tab opens
another tab (`goToTab()` → `EV.RC_SHOW_TAB`): neither may import its router.

## Conventions

One line per rule. Each links to its reasoning in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — read that section before
changing anything the rule covers; most of them exist because the obvious
alternative shipped once and went wrong.

### Design and interface

- Colours go through tokens, never raw hex. [→](docs/ARCHITECTURE.md#colours-go-through-tokens-never-raw-hex)
- The design language is shared with cx-portal: Archivo + Roboto Mono, Hitachi red `#e60012` for primary actions, 8px control radius, 140 ms micro-transitions on `cubic-bezier(0.16, 1, 0.3, 1)`, mono uppercase eyebrows, dot-prefixed status badges, chip-stat … [→](docs/ARCHITECTURE.md#the-design-language-is-shared-with-cx-portal)
- No emoji as icons. [→](docs/ARCHITECTURE.md#no-emoji-as-icons)

### The plan and the canvas

- Every document mutation goes through the store (`core/store.js`) so it is undoable and autosaved. [→](docs/ARCHITECTURE.md#every-document-mutation-goes-through-the-store)
- `getDoc()` is never mutated in place. [→](docs/ARCHITECTURE.md#getdoc-is-never-mutated-in-place)
- Filtered-out objects dim by default and can be hidden instead (`settings.filterMode`). [→](docs/ARCHITECTURE.md#filtered-out-objects-dim-by-default-and-can-be-hidden-instead)
- Hidden is a way back, not a way out. [→](docs/ARCHITECTURE.md#hidden-is-a-way-back-not-a-way-out)
- A date window hides; the rest of the filter dims. [→](docs/ARCHITECTURE.md#a-date-window-hides-the-rest-of-the-filter-dims)
- Baseline comparison draws five things, not one (`renderBaseline`): the ghost at the baseline dates behind the live bar, an arrow between the two finish edges labelled in days, the reason someone typed into the striped area, outlines for objects the … [→](docs/ARCHITECTURE.md#baseline-comparison-draws-five-things-not-one)
- What actually happened is drawn, and it is what a baseline is compared against. [→](docs/ARCHITECTURE.md#what-actually-happened-is-drawn-and-it-is-what-a-baseline-is-compared-against)
- A note written on an object is shown on the timeline. [→](docs/ARCHITECTURE.md#a-note-written-on-an-object-is-shown-on-the-timeline)
- The reason a bar moved is the one part of a comparison that is stored. [→](docs/ARCHITECTURE.md#the-reason-a-bar-moved-is-the-one-part-of-a-comparison-that-is-stored)
- A ghost is packed, not painted over. [→](docs/ARCHITECTURE.md#a-ghost-is-packed-not-painted-over)
- A P6 baseline is derived; a taken baseline is frozen. [→](docs/ARCHITECTURE.md#a-p6-baseline-is-derived-a-taken-baseline-is-frozen)
- P6 data is a register, not objects. [→](docs/ARCHITECTURE.md#p6-data-is-a-register-not-objects)
- The look-ahead reaches the timeline as suggestions, read from the calendar only — there is no workbook import in the timeline. [→](docs/ARCHITECTURE.md#the-look-ahead-reaches-the-timeline-as-suggestions-read-from-the-file)
- A document and a release are read for their state, not their kind. [→](docs/ARCHITECTURE.md#a-document-and-a-release-are-read-for-their-state-not-their-kind)
- Derived state is never stored. [→](docs/ARCHITECTURE.md#derived-state-is-never-stored)
- A hidden dependency line is a choice that does not survive going wrong. [→](docs/ARCHITECTURE.md#a-hidden-dependency-line-is-a-choice-that-does-not-survive-going-wrong)
- A pair of objects may carry several dependencies — one per type. [→](docs/ARCHITECTURE.md#a-pair-of-objects-may-carry-several-dependencies--one-per-type)
- Selecting a bar marks what it is waiting on. [→](docs/ARCHITECTURE.md#selecting-a-bar-marks-what-it-is-waiting-on)
- New user actions go in `ui/commands.js`, then get wired to the menu, the shortcut and the button. [→](docs/ARCHITECTURE.md#new-user-actions-go-in-uicommandsjs)
- The filter's text box holds a list, not a phrase. [→](docs/ARCHITECTURE.md#the-filters-text-box-holds-a-list-not-a-phrase)
- Dropdown vocabularies are document data, not constants. [→](docs/ARCHITECTURE.md#dropdown-vocabularies-are-document-data-not-constants)
- A duration is counted on a five-day week by default. [→](docs/ARCHITECTURE.md#a-duration-is-counted-on-a-five-day-week-by-default)
- Dates are UTC-midnight milliseconds internally, `YYYY-MM-DD` on disk. [→](docs/ARCHITECTURE.md#dates-are-utc-midnight-milliseconds-internally)
- No timeline text is ever truncated, ellipsised or clamped, at any zoom. [→](docs/ARCHITECTURE.md#no-timeline-text-is-ever-truncated-ellipsised-or-clamped)

### The shared folder and the desktop build

- A shared folder is a third storage backend, not a export/import trick. [→](docs/ARCHITECTURE.md#a-shared-folder-is-a-third-storage-backend-not-a-exportimport-trick)
- A file moving is not a plan changing, and only the second is worth saying. [→](docs/ARCHITECTURE.md#a-file-moving-is-not-a-plan-changing-and-only-the-second-is-worth-saying)
- Say it once, in the status bar, without taking the keyboard. [→](docs/ARCHITECTURE.md#say-it-once-in-the-status-bar-without-taking-the-keyboard)
- Two windows of one install are one machine. [→](docs/ARCHITECTURE.md#two-windows-of-one-install-are-one-machine)
- Waiting and taking over are not the only two options. [→](docs/ARCHITECTURE.md#waiting-and-taking-over-are-not-the-only-two-options)
- A claim says when its holder last *saved*, not just that it is alive. [→](docs/ARCHITECTURE.md#a-claim-says-when-its-holder-last-saved-not-just-that-it-is-alive)
- The pen borrows the name the calendar already knows. [→](docs/ARCHITECTURE.md#the-pen-borrows-the-name-the-calendar-already-knows)
- `core/filestore.js` has two backends and one set of rules. [→](docs/ARCHITECTURE.md#corefilestorejs-has-two-backends-and-one-set-of-rules)
- The calendar is files in the folder, behind its own pen, and every write is guarded: refused when the file on disk is not the one last read, rolled back whole (`core/rc_db.js`). [→](docs/ARCHITECTURE.md#the-calendar-is-files-in-the-folder)
- The desktop app is fed by the `desktop-kit` branch, not by reinstalling; a kit that needs a newer installer (`SHELL` in `tools/desktop.js`) says so instead of running. [→](docs/ARCHITECTURE.md#the-desktop-app-is-fed-by-github-not-by-reinstalling)
- The desktop app zooms the page as a browser does (Ctrl + / −, Ctrl + wheel, − 100% + in the status bar) through the window's own zoom, never CSS zoom. [→](docs/ARCHITECTURE.md#the-desktop-app-zooms-the-page-as-a-browser-does)
- A download is the one action with no visible result, so it says so. [→](docs/ARCHITECTURE.md#a-download-is-the-one-action-with-no-visible-result-so-it-says-so)

### The resource calendar

- The resource calendar is a second module, not a second product. [→](docs/ARCHITECTURE.md#the-resource-calendar-is-a-second-module-not-a-second-product)
- A grid is the one heavy row, and it moves once. [→](docs/ARCHITECTURE.md#a-grid-is-the-one-heavy-row-and-it-moves-once)
- The sheet is parsed once, against the legend it was parsed with. [→](docs/ARCHITECTURE.md#the-sheet-is-parsed-once-against-the-legend-it-was-parsed-with)
- A read is only worth taking if the next one is compared to it. [→](docs/ARCHITECTURE.md#a-read-is-only-worth-taking-if-the-next-one-is-compared-to-it)
- `before` and `after` are jsonb, and two places have to agree on the shape. [→](docs/ARCHITECTURE.md#before-and-after-are-jsonb-and-two-places-have-to-agree-on-the-shape)
- The 4WLA *is* the plan for the days it names — derived, never written. [→](docs/ARCHITECTURE.md#the-4wla-is-the-plan-for-the-days-it-names--derived-never-written)
- The look-ahead now says who, and a Resource row is not an activity. [→](docs/ARCHITECTURE.md#the-look-ahead-now-says-who-and-a-resource-row-is-not-an-activity)
- The sheet says who is away as well as who is on what, and none of it is scope. [→](docs/ARCHITECTURE.md#the-sheet-says-who-is-away-as-well-as-who-is-on-what-and-none-of-it-is-scope)
- `ABSENCE_KINDS` holds three facts about each kind, in one table. [→](docs/ARCHITECTURE.md#absence_kinds-holds-three-facts-about-each-kind-in-one-table)
- A day off and a day spent elsewhere are different answers. [→](docs/ARCHITECTURE.md#a-day-off-and-a-day-spent-elsewhere-are-different-answers)
- PTO is a third reading, not a second store — and it shows leave and other-group work, never the Office row. [→](docs/ARCHITECTURE.md#pto-is-a-third-reading-not-a-second-store)
- Who takes shifts decides who is in a view about work. [→](docs/ARCHITECTURE.md#who-takes-shifts-decides-who-is-in-a-view-about-work)
- The names come off the snapshot, not off the stored column. [→](docs/ARCHITECTURE.md#the-names-come-off-the-snapshot-not-off-the-stored-column)
- A name in a spreadsheet is matched exactly, corrected out loud, or reported — never guessed. [→](docs/ARCHITECTURE.md#a-name-in-a-spreadsheet-is-matched-exactly-corrected-out-loud-or-reported--never-guessed)
- Unscheduled rows are hidden, and a heading is not exempt. [→](docs/ARCHITECTURE.md#unscheduled-rows-are-hidden-and-a-heading-is-not-exempt)
- The key describes what is on screen, not the register. [→](docs/ARCHITECTURE.md#the-key-describes-what-is-on-screen-not-the-register)
- The Changes list is about the weeks anybody can still act on. [→](docs/ARCHITECTURE.md#the-changes-list-is-about-the-weeks-anybody-can-still-act-on)
- Every red run is a cancellation, and the log is derived from every read. [→](docs/ARCHITECTURE.md#every-red-run-is-a-cancellation-and-the-log-is-derived-from-every-read)
- A BART resource can be cancelled without the day: "X.~WIT" strikes the witness out, the editor asks *Cancel and log* or *Just remove*, and `rc_cancelled_support_days` puts it in the log beside the days cancelled outright. [→](docs/ARCHITECTURE.md#a-bart-resource-can-be-cancelled-without-the-day-and-both-are-in-the-log)
- The cancellation log is what the look-ahead says now (the newest reading covering each date), lists only BART's resources, and draws as a calendar exportable to Excel, coloured by whose it was (BART red, Hitachi blue, Other amber, no reason yet purple); "Show cells" pins the calendar to that row and its weeks (`la.calendarRow`), never a typed filter. [→](docs/ARCHITECTURE.md#the-cancellation-log-is-what-the-look-ahead-says-now-and-barts)
- A wrong cancellation is removed from the log by a `dismissed` note, never deleted, and can be put back; a stored "Resource" label is never a cancellation. [→](docs/ARCHITECTURE.md#a-cancellation-can-be-removed-from-the-log-and-put-back)
- Today is a column, not a hairline. [→](docs/ARCHITECTURE.md#today-is-a-column-not-a-hairline)
- The workbook is the assumption, so only a hand-typed day is flagged. [→](docs/ARCHITECTURE.md#the-workbook-is-the-assumption-so-only-a-hand-typed-day-is-flagged)
- Nothing is emailed from the application, and that is structural. [→](docs/ARCHITECTURE.md#nothing-is-emailed-from-the-application-and-that-is-structural)
- Nothing in `src/` makes a network request; the window's policy allows only `raw.githubusercontent.com`, for updates — `test_kit.js` checks both. [→](docs/ARCHITECTURE.md#the-calendar-is-files-in-the-folder)
- Retire is the first answer; Delete is the second, and the database decides which applies (`rc_delete_*`). [→](docs/ARCHITECTURE.md#retire-is-the-first-answer-delete-is-the-second-and-postgres-decides-which-applies)
- The look-ahead's window moving is not a change of scope. [→](docs/ARCHITECTURE.md#the-look-aheads-window-moving-is-not-a-change-of-scope)
- The calendar's data can be taken out whole. [→](docs/ARCHITECTURE.md#the-calendars-data-can-be-taken-out-whole)
- The master export is one Excel workbook, a sheet per question, each read through the function its screen uses (`assignmentIndex()`, `cancellationLog()`, `describe()`) and through the policies; the look-ahead's history is `rc_lookahead_days`, each week from its newest reading — by the week, never day by day over every reading, which took a minute on a real project; a week written in the editor that no reading has comes through the publish path (`writtenOnlyDays()`), and the 4WLA beside it (`4WLA_Latest.xlsx`) is every week written, not the next four. [→](docs/ARCHITECTURE.md#the-master-export-is-one-workbook-read-the-way-the-screens-read)
- A scheduled master export runs in the page on this computer, catches a missed slot up once, and files into `exports/` in the shared folder as `LookAhead_Latest.xlsx`, with `4WLA_Latest.xlsx` and `4WLA_Latest.pdf` beside it (the next four weeks on one A3 page, `lookaheadPdfNow()` — the Export PDF dialog's defaults, never the screen's state), each replacing the last (downloads without one); its settings are this computer's. [→](docs/ARCHITECTURE.md#the-master-export-runs-on-a-schedule-in-the-page-and-files-into-the-shared-folder)
- The calendar is used standing up, so it stops assuming a wide screen. [→](docs/ARCHITECTURE.md#the-calendar-is-used-standing-up-so-it-stops-assuming-a-wide-screen)

### Shifts

- The third shift is called Blanket and stored as `possession`; draw a shift with `shiftLabel()`, never the raw value. [→](docs/ARCHITECTURE.md#the-third-shift-is-called-blanket-and-stored-as-possession)

### Reading the look-ahead workbook

- A colour the legend does not know is never guessed. [→](docs/ARCHITECTURE.md#a-colour-the-legend-does-not-know-is-never-guessed)
- What a colour is, is changed in Legend and nowhere else. [→](docs/ARCHITECTURE.md#what-a-colour-is-is-changed-in-legend-and-nowhere-else)
- The legend is versioned, so a colour resolves to the row *in force*. [→](docs/ARCHITECTURE.md#the-legend-is-versioned-so-a-colour-resolves-to-the-row-in-force)
- The workbook's own key is read once, into an empty register. [→](docs/ARCHITECTURE.md#the-workbooks-own-key-is-read-once-into-an-empty-register)
- The sheet's own column headings are read once and drawn everywhere. [→](docs/ARCHITECTURE.md#the-sheets-own-column-headings-are-read-once-and-drawn-everywhere)
- The location column is found the same way the date axis is, and the spelling is kept whether or not it resolves. [→](docs/ARCHITECTURE.md#the-location-column-is-found-the-same-way-the-date-axis-is-and-the-spelling-is-kept-whether-or-not-it-resolves)
- Where the work is comes off the snapshot, like who is on it. [→](docs/ARCHITECTURE.md#where-the-work-is-comes-off-the-snapshot-like-who-is-on-it)
- A read that started recording the location is not a read where everything moved. [→](docs/ARCHITECTURE.md#a-read-that-started-recording-the-location-is-not-a-read-where-everything-moved)
- The date axis is found, never configured. [→](docs/ARCHITECTURE.md#the-date-axis-is-found-never-configured)
- White is not a highlight, and shading is not work. [→](docs/ARCHITECTURE.md#white-is-not-a-highlight-and-shading-is-not-work)
- A section heading is found structurally, not by its colour. [→](docs/ARCHITECTURE.md#a-section-heading-is-found-structurally-not-by-its-colour)
- The look-ahead prints on one sheet, and filling the sheet is half of it. [→](docs/ARCHITECTURE.md#the-look-ahead-prints-on-one-sheet-and-filling-the-sheet-is-half-of-it)
- Every switch on the export is an argument, not the screen's state. [→](docs/ARCHITECTURE.md#every-switch-on-the-export-is-an-argument-not-the-screens-state)
- The calendar draws the snapshot, not the file. [→](docs/ARCHITECTURE.md#the-calendar-draws-the-snapshot-not-the-file)

### The look-ahead editor

- Weekends (`--la-weekend`) and section bands (`--la-band`) are fixed grey shading in the editor and the view alike — not legend colours; a painted shift covers them. [→](docs/ARCHITECTURE.md#weekends-and-section-bands-are-fixed-shading-the-same-in-both-views)
- The editor is the calendar with **Edit** switched on (`la.editing`), not a section beside it; switching off saves and publishes, waiting for a publish already under way, and the read view redraws when a newer reading lands. [→](docs/ARCHITECTURE.md#the-editor-is-the-calendar-with-edit-switched-on)
- The calendar is the look-ahead's source once the editor is adopted (`rc_settings.lookahead_source = 'editor'`); "Check now" then refuses to read the workbook. [→](docs/ARCHITECTURE.md#the-calendar-is-the-look-aheads-source-and-the-workbook-is-something-it-produces)
- The editor publishes the grid a workbook read used to produce (`gridFromModel()` → `publishGrid()`), so nothing downstream reads a second source. Never teach a screen to read `rc_la_*` directly — the read view's weeks past the reading go through the publish path (`writtenView()`), not beside it. [→](docs/ARCHITECTURE.md#the-editor-publishes-the-grid-the-workbook-used-to-produce)
- Every edit is an op from `core/la_edit.js` with an inverse, written only through `rc_la_apply()`, stamped at send time with the version it expects. [→](docs/ARCHITECTURE.md#every-edit-is-an-op-with-an-inverse-sent-with-the-version-it-expects)
- Only an activity's days are painted, only with the legend's shift colours; names rows are never painted. [→](docs/ARCHITECTURE.md#what-may-be-written-where)
- Support codes are a register (`rc_support_codes`); an unknown code is kept and marked, never dropped or guessed. [→](docs/ARCHITECTURE.md#support-codes-are-a-register-like-the-colours)
- The Excel export's layout is measured off BART's workbook and read back by `parseSheet()` in the tests. [→](docs/ARCHITECTURE.md#the-export-is-measured-off-barts-own-workbook)
- Names rows offer the roster as you type; what is typed is what is written. [→](docs/ARCHITECTURE.md#names-are-offered-from-the-roster-and-what-is-typed-is-kept)
- Painting a cancellation asks why, once; the paint is saved whatever the answer. [→](docs/ARCHITECTURE.md#painting-a-cancellation-asks-why-once-and-not-now-is-an-answer)
- Going back is new edits through `rc_la_apply()`, never a rewind of the log. [→](docs/ARCHITECTURE.md#going-back-is-new-edits-not-a-rewind)
- The timeline reads the calendar's look-ahead in one step, and sends nothing back. [→](docs/ARCHITECTURE.md#the-timeline-reads-the-calendars-look-ahead-in-one-step)
- The export is also opened and re-saved by LibreOffice Calc in CI (`test_xlsx_compat.js`). [→](docs/ARCHITECTURE.md#the-export-is-opened-by-a-second-program-in-ci)
- A staffing clash is about the team (names rows, the PTO row, booked leave, two shifts in a day) — never the support codes, and never a name the roster does not know. [→](docs/ARCHITECTURE.md#a-staffing-clash-is-about-the-team-never-about-the-support)
- A day's or a row's history is `rc_la_edits` read for one place; nothing is reconstructed. [→](docs/ARCHITECTURE.md#a-days-history-is-the-edit-log-read-for-one-place)
- Readings are compacted, never deleted: only an editor reading's grid goes (`rc_compact_snapshots()`); rows, change events and links stay. [→](docs/ARCHITECTURE.md#readings-are-compacted-never-deleted)
- The Activity ID is filled from P6: the list (`rc_p6_activities`) is imported from an extract, previewed first, written by `rc_p6_import()` with what it leaves out marked `missing`, never deleted; typing in the column searches it by name or ID, Alt+K links the selection, and a row with no P6 activity gives a reason from `rc_p6_flags` in the same column. It is never taken from the plan's `doc.p6`. [→](docs/ARCHITECTURE.md#the-activity-id-is-filled-from-p6-and-a-row-without-one-says-why)
- The read view pages a week at a time and "Everything" reaches every week ever written; a window past the reading is drawn from the editor's tables through the publish path (`writtenView()`), never stored, and says so — and weeks before the editor (it was started from the workbook from the week it was adopted) come from the newest workbook reading of each (`rc_lookahead_workbook_weeks`) — all of it one calendar, never a grid per source (`mergeViews()`): one set of rows, the days of every source across, a line above saying where each stretch came from. [→](docs/ARCHITECTURE.md#the-calendar-pages-back-past-the-reading-from-what-the-editor-holds)
- Hovering the look-ahead repaints nothing — a bar marks the row — and its frozen columns rule their edges with shadows, not borders. [→](docs/ARCHITECTURE.md#hovering-the-look-ahead-repaints-nothing)

### Track access work requests (TAWR)

- A TAWR is one location, one shift, one week (Monday–Sunday), read off the newest reading by `extractWeek()` — never `rc_la_*`, never the workbook. [→](docs/ARCHITECTURE.md#a-request-is-one-location-one-shift-one-week)
- Hours combine (earliest start, latest finish; the shift's own hours where the sheet has none), support adds across activities and the busiest day is asked for; a witness is never on the form and `tawr_line` says where each code goes. [→](docs/ARCHITECTURE.md#hours-combine-and-support-adds-and-the-busiest-day-is-asked-for)
- An unknown location, a missing location and an unmapped colour are flags that stop approval, never guesses. [→](docs/ARCHITECTURE.md#what-the-sheet-cannot-say-is-a-default-what-it-cannot-be-trusted-with-is-a-flag)
- A draft follows the look-ahead without losing an edit (`mergeRegenerated()`); an approved request is final in `core/rc_db.js` and changed only by `rc_tawr_revise()`. [→](docs/ARCHITECTURE.md#a-draft-follows-the-look-ahead-an-approved-request-is-final)
- BART's form is filled by an incremental update with an appearance per field, never redrawn, so it stays fillable and signable; every box — filled or blank, and the form's default — is set to 9 pt, never auto (a short box grows upwards; only text too wide shrinks), each field declares the size it was drawn at (never auto) a date takes the box's own `AFDate_FormatEx` format, `NeedAppearances` is switched off, and `FILLER_VERSION` is stamped into every download — raise it when what the filler writes changes. [→](docs/ARCHITECTURE.md#barts-form-is-filled-not-redrawn-and-stays-a-form)
- The blank form lives in the folder (`calendar/tawr/template.pdf`) and is never committed. [→](docs/ARCHITECTURE.md#the-blank-form-and-every-signature-are-an-administrators-alone)
- A signature is strokes saved once per administrator, drawn as vector lines at download; the approval signatures stay blank. [→](docs/ARCHITECTURE.md#a-signature-is-strokes-drawn-once-per-administrator)

### Added with the module split and the calendar bundle

- **The calendar is a second bundle, fetched the first time it is opened.** [→](docs/ARCHITECTURE.md#the-calendar-is-a-second-bundle-fetched-the-first-time-it-is-opened)
- **The folder's pure rules live in a leaf, and agree with the Rust.** [→](docs/ARCHITECTURE.md#the-folders-pure-rules-live-in-a-leaf-and-agree-with-the-rust)
- **The calendar's database says which version it is.** [→](docs/ARCHITECTURE.md#the-calendars-database-says-which-version-it-is)
- **The command menu adds no behaviour.** [→](docs/ARCHITECTURE.md#the-command-menu-adds-no-behaviour)
- **Every calendar table gets the same behaviour, without asking.** [→](docs/ARCHITECTURE.md#every-calendar-table-gets-the-same-behaviour-without-asking)
- **An empty screen names its next step.** [→](docs/ARCHITECTURE.md#an-empty-screen-names-its-next-step)
- **Touch decides the calendar's sizes, not width.** [→](docs/ARCHITECTURE.md#touch-decides-the-calendars-sizes-not-width)
- **Announce what changes; never rely on colour alone.** [→](docs/ARCHITECTURE.md#announce-what-changes-never-rely-on-colour-alone)
- **Settings are changed on screen** (Lists → Settings). [→](docs/ARCHITECTURE.md#settings-are-changed-on-screen)
- **Only my rows keeps the activity line with its names**: an activity is kept whole, never a names row alone, with the sections above (`rowsNaming()`). [→](docs/ARCHITECTURE.md#only-my-rows-keeps-the-activity-line-with-its-names)
- **Changes say who made them**: a published reading carries each editor row's id (`la_row_id`, never shown), two readings that both carry ids are compared on them, and `editsBehind()` names who from `rc_la_edits`; **Every edit** is the log itself, one line per thing changed (`editLines()`). [→](docs/ARCHITECTURE.md#changes-say-who-made-them-by-the-rows-id)

### Added with the performance pass

- The calendar's stylesheet (`css/rc.css`) comes with its bundle; `css/calendar.css` keeps what the main page draws, and `rc.css` wins every tie. [→](docs/ARCHITECTURE.md#the-calendars-stylesheet-comes-with-its-bundle)
- The look-ahead rings a bell (`rc_la_revision`, `onLookaheadChange()`) when the folder brings a newer revision; the polls only check on it. [→](docs/ARCHITECTURE.md#the-look-ahead-rings-a-bell-the-polls-only-check-on-it)
- An edit made of cell ops redraws the days it touched (`redrawAfter()`, `dayCell()`), not the editor's grid. [→](docs/ARCHITECTURE.md#an-edit-redraws-the-days-it-touched)
- The timeline draws the rows in view and 800 px either side (`CULL_MARGIN`); layout, links and counts still see everything. [→](docs/ARCHITECTURE.md#the-timeline-draws-the-rows-in-view)
- Reading a sheet is `core/lookahead.js`; comparing two readings is `core/la_register.js`, the calendar's alone. [→](docs/ARCHITECTURE.md#reading-a-sheet-and-comparing-two-readings-are-two-modules)
- `npm run lint` and `npm run typecheck` catch mistakes, not preferences; destructured options are documented with `?` on the optional ones. [→](docs/ARCHITECTURE.md#lint-and-types-catch-mistakes-not-preferences)
- The System theme is Dark or Light, as the computer is; Dark stays the default. [→](docs/ARCHITECTURE.md#the-system-theme-is-dark-or-light-as-the-computer-is)
- Motion follows the system's preference, in script (`scrollBehavior()`) as in CSS. [→](docs/ARCHITECTURE.md#motion-follows-the-systems-preference-in-script-as-in-css)

## Extending it

- **A new object type**: add an entry to `TYPES` in `core/model.js` (label,
  group, icon, shape, whether it has duration, accent, inspector fields). The
  palette, context menus, legend, filters and CSV export all pick it up. Add a
  `build<Shape>` branch in `timeline/renderer.js` only if it needs a new shape.
- **A new calendar tab**: add it to `TABS` and `RENDERERS` in `ui/rc.js`, and
  give it a module beside `ui/rc_pto.js` that imports `ui/rc_util.js` for
  the shared reading — never a second copy of `assignmentIndex()` or a second
  register, which is the whole reason that module exists. Its tables get the
  shared header, sorting and export from `ui/rc_table.js` without asking; mark
  one `data-csv="<name>"` to offer the export.
- **A new dock pane**: add it to `PANES`, `TITLES` and `RENDERERS` in
  `ui/panels.js`, and to `NAV` in `ui/shell.js`. A pane that changes only its
  own view state — a filter, a search — must emit `EV.PANE_REFRESH` to redraw
  itself: nothing in the document changed, so no `doc:changed` fires, and it
  cannot import the dock without creating a cycle. Being in `TITLES` puts it
  in the command menu too. Pane modules live in `ui/pane_*.js`; `ui/panels.js`
  is the dock and the router, not a place for panes.
- **A new editable list**: add the seed to `DEFAULT_LISTS` and an entry to
  `LIST_DEFS` in `core/model.js` saying where its values live on an object —
  `field` (a top-level property), `dataKeys` (inside `data`) or `styleKey`
  (inside `style`). Usage counting, deletion-with-reassign, the manager tab
  and the Dropdown Lists pane all follow from that one entry.
- **A new calendar export**: build scene items in `io/rc_pdf.js` from the
  parsed view and hand them to `fitToPdf()`. No DOM in that module, which is
  what lets `tools/test_lookahead.js` assert the geometry — that nothing is
  drawn past the edge, that a long description grows its row — without a
  browser. Hand the bytes to `saveFile()` like everything else.
- **A new export format**: consume the scene from `io/scene.js` rather than
  re-walking the document — that is what keeps every export agreeing with
  every other, and hand the bytes to `saveFile()` so the download announces
  itself like all the others.
- **A new export toggle**: add it to `exportOptions` in `defaultSettings()`,
  to `exportSettings()` in `io/exporters.js` (which is the one place that
  merges stored, default and per-call values), and to the dialog in
  `openExportOptions()`. Anything that changes an object's *size* — the date
  line does — must be measured in `exportLabel()`, or the packer will not
  reserve the room and the extra text will land on the next row.
- **Schema changes**: bump `SCHEMA_VERSION` in `core/model.js` and append a
  step to `MIGRATIONS`. Never delete a migration step; old files must always
  be able to walk forward. A new top-level key also needs adding to
  `COLLECTIONS` or `FIELDS` in `core/history.js`, or edits to it will not be
  undoable — they will not even register as a change.
- **A calendar table, or a column on one**: add it to `TABLES` in
  `core/rc_db.js` — the file it is kept in (or its `shard` by month), its key,
  its unique columns, its `defaults()` — and, if old backups carry it, to
  `core/rc_import.js`. A column needs no migration: rows are JSON, so read a
  missing one as its default. Raise `FORMAT_VERSION` only for a change an older
  copy would misread; it refuses a folder written by a newer one. Cover it in
  `tools/test_rc_db.js`. A view or function from the old SQL is a function in
  `VIEWS` or `RPC` there, never a second query in a screen.
- **A new column on the look-ahead**: add it to `FIELDS` in `core/la_edit.js`
  (heading and width off the sheet), to `rc_la_rows` and `rc_la_apply()`, and
  to the frozen offsets in `.lae-grid` — the export and the published grid follow
  from `FIELDS`.
- **A new Rust command**: add it to `generate_handler!` in `src-tauri/src/main.rs`
  and call it from `core/desktop.js` only; raise `SHELL` in `tools/desktop.js`
  in the same commit, so an older installer is told it needs replacing rather
  than running a kit that calls something it lacks. `test_kit.js` fails on a
  command the application calls that the shell does not register.

## Verify after changes

```bash
npm run build          # must succeed — it lints the module graph and parses both bundles
npm run lint           # ESLint over src/ — no undefined names, no unused imports
npm run typecheck      # the JSDoc read as types (tsc --checkJs, no emit)
npm test               # every suite, in parallel lanes (tools/run_tests.js); must exit 0
npm run test:serial    # the same, one at a time
npm run test:rust      #  37 checks — the plan, lock, intake and calendar-file rules, in Rust
npm run test:xlsx      # the Excel export through LibreOffice Calc (skips without it)

node tools/run_tests.js smoke smoke_calendar   # just these suites
node tools/smoke.js --shot out.png             # …and eyeball the result
```

| Suite | Checks | What it covers |
|---|---|---|
| `test_kit.js` | 24 | the desktop shell and its update kit: the channel and the workflow that writes it, the window's policy, the kit whole and saying which installer it needs, every command the application calls registered in Rust, and that nothing makes a network request |
| `test_rc_db.js` | 90 | the calendar's database over a folder in memory: queries, views and functions, all-or-nothing writes, another computer's save refused rather than overwritten, the pen, and a backup imported |
| `test_lookahead.js` | 266 | the parser, the rows it derives, the change events, only-my-rows, one activity whole, and the printed calendar's geometry, no browser |
| `test_folder_rules.js` | 46 | the folder's names, digest and pen rules, in Node |
| `test_tawr.js` | 138 | TAWRs read off a look-ahead week — grouping, hours, support, flags, defaults, regenerating — and BART's form filled and read back in both PDF shapes |
| `test_la_edit.js` | 230 | the look-ahead editor's model, undo, support codes, the published grid, cell history, who changed what, staffing clashes, and the Excel export read back, P6 extracts read, searched and compared, and the master export's workbook and schedule |
| `smoke.js` | 322 | the application, local mode — a tall plan drawn by the rows in view, less motion and the System theme, files from elsewhere (imports, notes, CSV), and dates away from Greenwich — **any console error fails the run** |
| `smoke_calendar.js` | 449 | the resource calendar over a fake folder (`tools/lib/rc_folder.js`): the door, importing the old calendar and starting empty, the look-ahead register, the cancellation log, PTO, the lists, two computers and the pen, the look-ahead grid and editor (`smoke_la_editor.js`), TAWRs (`smoke_tawr.js`), P6 activities linked to rows (`smoke_la_p6.js`), the master export and its schedule (`smoke_master_export.js`), a tablet, and that nothing is sent anywhere |
| `smoke_folder.js` | 89 | the shared folder, in a browser |
| `smoke_desktop.js` | 65 | the desktop shell, its updates — and a kit needing a newer installer refused — and the calendar written into the folder through the shell |
| `test_xlsx_compat.js` | 18 | the Excel export opened, re-saved and printed by LibreOffice Calc, and the master export's sheets read out by it (skips where Calc is absent; the `xlsx` CI job installs it) |

**The suites run as though it were Wednesday 23 September 2026, 14:00 UTC**
(`tools/lib/clock.js` shifts `Date` in Node and in every page). Build fixtures
from `new Date()` as before — they will agree with the page. `CX_TEST_NOW=<ISO>`
runs at another instant, `CX_TEST_NOW=real` against the wall clock. Update the
counts above when you add checks. What each suite covers in detail is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#what-each-suite-covers).

## Traps

Each of these has caused a real bug:

- **Panels must not rebuild while a text field in them has focus.** They write
  to the store on every keystroke, and the resulting `doc:changed` would
  replace the input under the caret. `inspector.js` and `panels.js` each guard
  this and defer the rebuild until focus leaves. **A pane that rebuilds itself
  is subject to the same rule** — `EV.PANE_REFRESH` now respects the guard,
  but the real fix for a search box is to redraw only the rows and leave the
  input alone, as `ui/p6.js` does. This has now bitten three times.
- **A canvas mousedown calls `preventDefault()`**, which suppresses the focus
  change a click normally makes. The canvas carries `tabindex="-1"` and is
  focused explicitly on mousedown, otherwise keyboard focus stays in whatever
  toolbar dropdown was last used and every shortcut silently stops working.
- **A `.xlsx` row cannot be matched with `<row[\s\S]*?(?:\/>|<\/row>)`.** The
  lazy match stops at the first `/>`, which is *inside* the row whenever a cell
  is formatted but empty (`<c r="D2" s="1"/>`) — truncating it and dropping
  every cell after. A sheet full of values never hits it, because those cells
  close with `</c>`; a sheet full of colours hits it on nearly every row. Both
  readers now use an explicit alternation. This shipped undetected for the same
  reason it was hard to see: the spreadsheets people import are full of values.
- **A wrapped label is several `.ob-line` spans**, so an object's
  `textContent` has no spaces in it. The whole string lives on the object node
  as `aria-label` and `data-label`; use those to find or announce an object,
  never the concatenated text.
- **`.ob-flag` is the release shape's coloured pole**, not a status badge.
  The broken-dependency badge is `.ob-breach`. Reusing the former restyled
  every release marker on the canvas.
- **`Element.append(null)` inserts the string "null"**, unlike `el()`, which
  filters its children. Any conditional argument to a raw `append()` has to be
  filtered first — this shipped a visible "null" in the inspector once.
- **Ruler ticks do not clip, so a label must be measured before it is
  placed.** `placeTickLabel()` computes the reach to the *next labelled* tick
  and draws the label — and its optional sub-label — only if it fits. Nudging
  a partly off-screen label into view without that check prints it on top of
  its neighbour.
- **Redrawing a grid drops the keyboard.** The editor rebuilds its grid on
  every edit, and the element that had focus goes with it — so the shortcut
  after an edit (Ctrl+Z after a paste, Alt+0 after Alt+3) went nowhere. `draw()`
  gives focus back to the new grid unless a dialog or the search box has it.
- **Removing a focused input fires its blur.** An in-place editor that commits
  on blur and removes itself on commit re-entered itself; clear the editing
  state *before* removing the input.
- **The timeline's shortcuts listen on the whole window.** They now stand down
  when the calendar is showing (`workspace.isTimeline()`), or Delete in the
  calendar deleted a bar nobody could see and Ctrl+Z undid the plan.
- **An inline `background:` shorthand wipes out every class-drawn pattern.**
  A painted look-ahead cell set `style="background:#hex"`, which resets
  `background-image` — so the hatch marking an unmapped colour was never drawn,
  for as long as it existed. Paint with `background-color`.
- **A view the engine has worked out is kept until something writes.**
  `core/rc_db.js` caches what its views return (`rc_cancelled_days`,
  `rc_lookahead_days` …) and clears the cache on every write and every file the
  folder brings in. Rows put into its memory any other way — a test pushing a
  fixture row — have to call `rc.forgetReads()`, or the views answer as they
  stood before, and paging back past the reading quietly found no weeks.
- **`innerHTML` on an element of this page runs what it parses.** An element
  of a live document fetches its images whether or not it is attached, so
  `stripHtml()` setting a `div`'s `innerHTML` to a note carrying
  `<img src=x onerror=…>` ran the handler — from a plan file somebody else
  wrote. Parse text you did not write with `DOMParser`; it builds a document
  that loads and runs nothing (`stripHtml()`, `sanitiseHtml()`).
- **`toISOString().slice(0, 10)` of an instant is Greenwich's date.** For a
  UTC-midnight value it is the date; for *now*, or a file's modified time, it
  is tomorrow in California from five in the afternoon. A date a person reads
  comes from `todayMs()` or `localDayMs(instant)`.
- **`setting || default` turns a meaningful 0 into the default.** "0 disables
  scheduled backups" read `autoBackupMinutes || 60`, so 0 meant an hour. Use
  `??` for any setting where 0 or an empty string is an answer.
- **A CSV cell starting `=`, `+`, `-` or `@` is a formula to Excel.** Every CSV
  writer goes through `csvField()`, which writes such a cell as text and leaves
  a plain number alone.
- **A Playwright test types before a dialog's field has focus.** Opening a
  modal focuses its field on a timer; wait for `document.activeElement` to be
  the input before `keyboard.type()`, or the first characters go nowhere.
- **A redraw that waits on the network lands under whatever is typed by then.**
  "Cancel and log" drew the editor's whole grid once its note was written,
  and on a slow connection that was after the next cell had been opened — the
  box being typed in went with the old grid. Draw again only what the answer
  changed, in place (`redrawNoted()`, `redrawDays()`), never the grid.
- **A view computed per row re-runs per row.** `rc_cancelled_days` asked for
  the newest reading once per cancelled day, and the cover aggregates every
  reading's rows — on the live project's 31,772 reading rows that was over a
  minute. Work the cover out once and look each day up in it; time a new view
  against a realistic volume, not the test fixtures.
- **A unique fingerprint is not "the same as the newest".** The editor's
  publish skipped a grid identical to the newest reading and stored the rest
  under their content hash, which `rc_lookahead_snapshots.file_hash` holds
  unique — so painting a day red and back recreated an older reading's hash,
  the insert collided, and every publish after it failed: the editor drew the
  day put back and the calendar drew it cancelled. The stored hash carries a
  suffix (`storedHash()`), compared by `sameContent()`; `core/rc_db.js` enforces
  the uniqueness, so the smoke suite catches it.
- **A note found by a row's words is lost when the words change.** Reasons
  were matched to the log by the activity's label, which includes the Activity
  ID — filling it in afterwards orphaned every reason logged on that row. A
  note now names the editor row (`la_row_id`) and is found by it first.

## Git

**Work on the default branch, `claude/timeline-planner-app-y1t1nm`, and push
to it directly** — the owner's standing instruction, whatever branch a session
was started on. No feature branches and no pull requests: a change is merged
the moment it is pushed, and a push there is a release — once Checks passes on
it, `.github/workflows/kit.yml` writes the `desktop-kit` branch, and every
installed copy takes it on its next launch (its log is in the Actions tab). So
`npm run build` and `npm test` pass before every push, not after. Keep the
rebuilt `app.bundle.js` **and** `calendar.bundle.js` in the same commit as the
`src/` change that produced them, otherwise the running application and the
source disagree — CI rebuilds both and fails on a difference. Never push to
`desktop-kit` by hand; the workflow replaces it whole.
