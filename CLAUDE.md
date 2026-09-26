# CLAUDE.md — project conventions for cx-timeline

## The one rule that bites

`index.html` loads **`app.bundle.js`**, not `src/`. After changing anything
under `src/`, run `npm run build`. The bundle is committed on purpose: it is
what a deploy serves, with no build step at the edge.

## Hosted, with a local mode for tests

The application runs against Supabase (accounts, projects, backups, sharing).
`config.js` is the only file that knows this — blank `supabaseUrl` puts it in
**local mode**, against browser storage, with no account. That is the
development and test path, not a deployment option: a build with a backend
always requires an account (`requireAuth` defaults to true, and
`tools/dist.js` refuses to publish a config with no backend).

There is a third shape, and it is a real deployment: **file mode**, where the
document is a JSON file in a folder the user picked — a shared drive, or one
synced by OneDrive or SharePoint. It is reachable only when there is no backend
configured, needs no account, and puts nothing anywhere but that folder. See
the shared-folder bullet in Conventions, and `DEPLOY.md` for how to ship it.

File mode ships in two places, and they are the same application: the deployed
site, where a browser has to be granted the folder, and the **Windows desktop
build** in `src-tauri/`, where the folder is a path and simply opens. Neither has
a backend. The desktop build is not a fork — it runs the same
`app.bundle.js`, fetched from the deployment, so a change deployed once reaches
both. See the two desktop bullets in Conventions.

Local mode is also why the 126-check offline suite still passes untouched. If
you add a hosted-only feature, hide it behind `cloud.isConfigured()` and cover
it in `tools/smoke_hosted.js` instead.

**Permissions are enforced in Postgres, never in the UI.** `supabase/schema.sql`
defines three roles — owner, editor, viewer — as row-level security policies.
`src/ui/auth.js` and the `body.read-only` styles explain the state to the user;
they do not create it. Changing what a role may do means changing the SQL and
`supabase/test/permissions.sql`, not the interface.

**Sign-up is closed.** An account exists only because an administrator invited
that address; a trigger on `auth.users` refuses anything else, so hiding the
form is presentation, not the control. Supabase's own "Allow new users to sign
up" must stay **on** — turning it off rejects invited people too, before the
trigger runs. The first account ever created bootstraps as administrator.

**There are two gates, and they claim the same trigger.** `rc_schema.sql`
installs its own `on_auth_user_invited`, because a calendar deployment applies
both files into one project and the timeline's version would refuse everybody
the calendar invited. `rc_enforce_invitation()` accepts an invitation from
*either* register, guarded by `to_regclass` so it works in a project that has
only one of them. Apply `rc_schema.sql` **second**; re-running `schema.sql`
afterwards puts the timeline-only gate back and locks calendar invitees out.

Three things about Postgres here that have already caused bugs:

- **A refused UPDATE or DELETE is not an error.** The row is excluded, the
  statement matches nothing, and the driver reports success. Every save goes
  through the `save_project()` function, which raises instead — and any direct
  table write has to check the returned row count, or it will report a save
  that never happened.
- **A policy that queries the table it protects recurses.** The `can_read` /
  `can_write` / `owns` / `is_admin` helpers are `SECURITY DEFINER` to step
  outside RLS and break the cycle.
- **A `RETURNS TABLE` column name shadows a real column inside plpgsql.**
  `returns table (email text)` makes a bare `email` in the body resolve to the
  OUT parameter, so `on conflict (email)` and unqualified INSERT column lists
  fail at runtime — not at creation. This bit `share_project` and
  `invite_user`; both now prefix their outputs (`member_email`,
  `invited_email`).
- **A BEFORE INSERT trigger cannot reference the row it is inserting.**
  `accept_invitation` sets `accepted_user_id` to the new `auth.users` id, so
  it has to run AFTER — in BEFORE the foreign key has nothing to point at and
  every sign-up fails.

## Architecture

Authored as ES6 modules, linked ahead of time by `tools/build.js` into one
IIFE. The linker supports a deliberately strict subset and rejects everything
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
  `calendar.bundle.js` is `ui/rc.js` and whatever only it reaches, fetched by
  `ui/calendar_loader.js` the first time the calendar opens. Importing
  `ui/rc.js` statically from the main graph is a build error, and so is a
  bundle that does not parse.

### Layers

```
core/util · core/events · core/dates      leaves — import nothing
core/folder_rules                         a leaf: the shared folder's names,
                                          digest and pen rules, pure (Node-tested)
core/access                               a leaf: may this account edit the plan,
                                          and the view that is theirs alone.
                                          Written by main.js, read by store and
                                          filestore — which must never see core/rc
core/cloud                                the only module that knows Supabase
core/rc                                   the calendar's *separate* Supabase client
                                          — the plan's path never imports it
core/desktop                              the only module that knows Tauri
core/filestore → core/desktop · core/folder_rules
                                          the only module that knows the File
                                          System Access API
core/model → core/query · core/history · core/analysis
core/store → core/filestore · core/access · core/lookahead
                                          (never core/storage: that imports the
                                          store, and the build rejects the cycle)
timeline/viewport → timeline/layout → timeline/connectors
                  → timeline/renderer → timeline/interactions
ui/icons · ui/components → ui/lists · ui/auth → ui/theme → ui/commands
ui/pane_util → ui/pane_plan · ui/pane_filters · ui/pane_io · ui/pane_projects
             · ui/pane_settings · ui/p6 · ui/lookahead → ui/panels
ui/panels → ui/command_menu · ui/canvas_hint → ui/shell
ui/workspace · ui/calendar_loader         the calendar, fetched on first use:
    ui/rc → ui/rc_roster · ui/rc_huddle · ui/rc_week · ui/rc_pto · ui/rc_reports
          · ui/rc_lookahead → ui/rc_la_* · ui/rc_ingest → ui/rc_la_state
          · ui/rc_table                   → ui/rc_util   (calendar.bundle.js)
io/scene → io/svg · io/pdf · io/inflate → io/exporters · io/importers
io/rc_pdf → io/pdf · io/lookahead         the calendar drawn for print — no DOM
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
- The look-ahead reaches the timeline as suggestions, read from the file. [→](docs/ARCHITECTURE.md#the-look-ahead-reaches-the-timeline-as-suggestions-read-from-the-file)
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
- The desktop build has no backend for the plan, and may have one for the calendar. [→](docs/ARCHITECTURE.md#the-desktop-build-has-no-backend-for-the-plan-and-may-have-one-for-the-calendar)
- The desktop app is fed by the deployment, not by reinstalling. [→](docs/ARCHITECTURE.md#the-desktop-app-is-fed-by-the-deployment-not-by-reinstalling)
- The published assets are named after their contents; the repository's are not. [→](docs/ARCHITECTURE.md#the-published-assets-are-named-after-their-contents-the-repositorys-are-not)
- A download is the one action with no visible result, so it says so. [→](docs/ARCHITECTURE.md#a-download-is-the-one-action-with-no-visible-result-so-it-says-so)

### The resource calendar

- The resource calendar is a second module, not a second product. [→](docs/ARCHITECTURE.md#the-resource-calendar-is-a-second-module-not-a-second-product)
- A grid is the one heavy row, and it moves once. [→](docs/ARCHITECTURE.md#a-grid-is-the-one-heavy-row-and-it-moves-once)
- Reads are remembered for thirty seconds and forgotten on every write. [→](docs/ARCHITECTURE.md#reads-are-remembered-for-thirty-seconds-and-forgotten-on-every-write)
- The sheet is parsed once, against the legend it was parsed with. [→](docs/ARCHITECTURE.md#the-sheet-is-parsed-once-against-the-legend-it-was-parsed-with)
- The meeting can be run rather than filled in, and both are one path. [→](docs/ARCHITECTURE.md#the-meeting-can-be-run-rather-than-filled-in-and-both-are-one-path)
- Pressing a status is the record; the line that follows is the detail. [→](docs/ARCHITECTURE.md#pressing-a-status-is-the-record-the-line-that-follows-is-the-detail)
- An outcome is corrected, never edited — and "recorded" is not "final". [→](docs/ARCHITECTURE.md#an-outcome-is-corrected-never-edited--and-recorded-is-not-final)
- A photograph goes up before the row, never after. [→](docs/ARCHITECTURE.md#a-photograph-goes-up-before-the-row-never-after)
- An outcome says what the day was spent on, and what kind of work it was. [→](docs/ARCHITECTURE.md#an-outcome-says-what-the-day-was-spent-on-and-what-kind-of-work-it-was)
- Who said it and who typed it are different facts. [→](docs/ARCHITECTURE.md#who-said-it-and-who-typed-it-are-different-facts)
- The digest carries no rate and no score. [→](docs/ARCHITECTURE.md#the-digest-carries-no-rate-and-no-score)
- A carry chain has to survive being rolled forward. [→](docs/ARCHITECTURE.md#a-carry-chain-has-to-survive-being-rolled-forward)
- A read is only worth taking if the next one is compared to it. [→](docs/ARCHITECTURE.md#a-read-is-only-worth-taking-if-the-next-one-is-compared-to-it)
- `before` and `after` are jsonb, and two places have to agree on the shape. [→](docs/ARCHITECTURE.md#before-and-after-are-jsonb-and-two-places-have-to-agree-on-the-shape)
- The 4WLA *is* the plan for the days it names — derived, never written. [→](docs/ARCHITECTURE.md#the-4wla-is-the-plan-for-the-days-it-names--derived-never-written)
- The look-ahead now says who, and a Resource row is not an activity. [→](docs/ARCHITECTURE.md#the-look-ahead-now-says-who-and-a-resource-row-is-not-an-activity)
- The sheet says who is away as well as who is on what, and none of it is scope. [→](docs/ARCHITECTURE.md#the-sheet-says-who-is-away-as-well-as-who-is-on-what-and-none-of-it-is-scope)
- `ABSENCE_KINDS` holds three facts about each kind, in one table. [→](docs/ARCHITECTURE.md#absence_kinds-holds-three-facts-about-each-kind-in-one-table)
- A day off and a day spent elsewhere are different answers. [→](docs/ARCHITECTURE.md#a-day-off-and-a-day-spent-elsewhere-are-different-answers)
- PTO is a third reading, not a second store. [→](docs/ARCHITECTURE.md#pto-is-a-third-reading-not-a-second-store)
- Who takes shifts decides who is in a view about work. [→](docs/ARCHITECTURE.md#who-takes-shifts-decides-who-is-in-a-view-about-work)
- The names come off the snapshot, not off the stored column. [→](docs/ARCHITECTURE.md#the-names-come-off-the-snapshot-not-off-the-stored-column)
- A name in a spreadsheet is matched exactly, corrected out loud, or reported — never guessed. [→](docs/ARCHITECTURE.md#a-name-in-a-spreadsheet-is-matched-exactly-corrected-out-loud-or-reported--never-guessed)
- Unscheduled rows are hidden, and a heading is not exempt. [→](docs/ARCHITECTURE.md#unscheduled-rows-are-hidden-and-a-heading-is-not-exempt)
- The key describes what is on screen, not the register. [→](docs/ARCHITECTURE.md#the-key-describes-what-is-on-screen-not-the-register)
- The Changes list is about the weeks anybody can still act on. [→](docs/ARCHITECTURE.md#the-changes-list-is-about-the-weeks-anybody-can-still-act-on)
- Every red run is a cancellation, and the log is derived from every read. [→](docs/ARCHITECTURE.md#every-red-run-is-a-cancellation-and-the-log-is-derived-from-every-read)
- The week plan is one tab, and it used to be two. [→](docs/ARCHITECTURE.md#the-week-plan-is-one-tab-and-it-used-to-be-two)
- Today is a column, not a hairline. [→](docs/ARCHITECTURE.md#today-is-a-column-not-a-hairline)
- The workbook is the assumption, so only a hand-typed day is flagged. [→](docs/ARCHITECTURE.md#the-workbook-is-the-assumption-so-only-a-hand-typed-day-is-flagged)
- The huddle reads the same index, so half the team stops reading as unplanned. [→](docs/ARCHITECTURE.md#the-huddle-reads-the-same-index-so-half-the-team-stops-reading-as-unplanned)
- Linking an account before it exists is normal, not a failure. [→](docs/ARCHITECTURE.md#linking-an-account-before-it-exists-is-normal-not-a-failure)
- The calendar is the team's; the register around it is not. [→](docs/ARCHITECTURE.md#the-calendar-is-the-teams-the-register-around-it-is-not)
- A member plans their own days, and takes them back. [→](docs/ARCHITECTURE.md#a-member-plans-their-own-days-and-takes-them-back)
- A member reads the plan and never writes it. [→](docs/ARCHITECTURE.md#a-member-reads-the-plan-and-never-writes-it)
- A reader's view is their own. [→](docs/ARCHITECTURE.md#a-readers-view-is-their-own)
- Reports, Organisation and the Daily huddle are an administrator's, and the tabs say so. [→](docs/ARCHITECTURE.md#reports-organisation-and-the-daily-huddle-are-an-administrators-and-the-tabs-say-so)
- A day is a list of tasks, not a task. [→](docs/ARCHITECTURE.md#a-day-is-a-list-of-tasks-not-a-task)
- There is one place a day is planned. [→](docs/ARCHITECTURE.md#there-is-one-place-a-day-is-planned)
- When the sheet moves a task, the task moves. [→](docs/ARCHITECTURE.md#when-the-sheet-moves-a-task-the-task-moves)
- Being scheduled is a different fact from what somebody may do. [→](docs/ARCHITECTURE.md#being-scheduled-is-a-different-fact-from-what-somebody-may-do)
- An invitation link points at the site, not at the window it was made in. [→](docs/ARCHITECTURE.md#an-invitation-link-points-at-the-site-not-at-the-window-it-was-made-in)
- Nothing is emailed from the application, and that is structural. [→](docs/ARCHITECTURE.md#nothing-is-emailed-from-the-application-and-that-is-structural)
- Adding somebody to the calendar never needs the SQL editor. [→](docs/ARCHITECTURE.md#adding-somebody-to-the-calendar-never-needs-the-sql-editor)
- Plan data must never reach Supabase, and that is enforced rather than intended. [→](docs/ARCHITECTURE.md#plan-data-must-never-reach-supabase-and-that-is-enforced-rather-than-intended)
- A blocked day is not an obstacle until somebody owns it. [→](docs/ARCHITECTURE.md#a-blocked-day-is-not-an-obstacle-until-somebody-owns-it)
- Asking for leave is a member's; answering is an administrator's. [→](docs/ARCHITECTURE.md#asking-for-leave-is-a-members-answering-is-an-administrators)
- Two families of status, never averaged. [→](docs/ARCHITECTURE.md#two-families-of-status-never-averaged)
- Retire is the first answer; Delete is the second, and Postgres decides which applies. [→](docs/ARCHITECTURE.md#retire-is-the-first-answer-delete-is-the-second-and-postgres-decides-which-applies)
- Evidence is append-only, in the database. [→](docs/ARCHITECTURE.md#evidence-is-append-only-in-the-database)
- The look-ahead's window moving is not a change of scope. [→](docs/ARCHITECTURE.md#the-look-aheads-window-moving-is-not-a-change-of-scope)
- A plan is revised, never edited. [→](docs/ARCHITECTURE.md#a-plan-is-revised-never-edited)
- The calendar's data can be taken out whole. [→](docs/ARCHITECTURE.md#the-calendars-data-can-be-taken-out-whole)
- A SAR is recorded, filed and linked in that order, and each step can fail alone. [→](docs/ARCHITECTURE.md#a-sar-is-recorded-filed-and-linked-in-that-order-and-each-step-can-fail-alone)
- The calendar is used standing up, so it stops assuming a wide screen. [→](docs/ARCHITECTURE.md#the-calendar-is-used-standing-up-so-it-stops-assuming-a-wide-screen)

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

### Added with the module split and the calendar bundle

- **The calendar is a second bundle, fetched the first time it is opened.** [→](docs/ARCHITECTURE.md#the-calendar-is-a-second-bundle-fetched-the-first-time-it-is-opened)
- **The folder's pure rules live in a leaf, and agree with the Rust.** [→](docs/ARCHITECTURE.md#the-folders-pure-rules-live-in-a-leaf-and-agree-with-the-rust)
- **The calendar's database says which version it is.** [→](docs/ARCHITECTURE.md#the-calendars-database-says-which-version-it-is)
- **Only the calendar reports its failures, and only from named places.** [→](docs/ARCHITECTURE.md#only-the-calendar-reports-its-failures-and-only-from-named-places)
- **The command menu adds no behaviour.** [→](docs/ARCHITECTURE.md#the-command-menu-adds-no-behaviour)
- **Every calendar table gets the same behaviour, without asking.** [→](docs/ARCHITECTURE.md#every-calendar-table-gets-the-same-behaviour-without-asking)
- **An empty screen names its next step.** [→](docs/ARCHITECTURE.md#an-empty-screen-names-its-next-step)
- **Touch decides the calendar's sizes, not width.** [→](docs/ARCHITECTURE.md#touch-decides-the-calendars-sizes-not-width)
- **Announce what changes; never rely on colour alone.** [→](docs/ARCHITECTURE.md#announce-what-changes-never-rely-on-colour-alone)

## Extending it

- **A new object type**: add an entry to `TYPES` in `core/model.js` (label,
  group, icon, shape, whether it has duration, accent, inspector fields). The
  palette, context menus, legend, filters and CSV export all pick it up. Add a
  `build<Shape>` branch in `timeline/renderer.js` only if it needs a new shape.
- **A new calendar tab**: add it to `TABS` and `RENDERERS` in `ui/rc.js`, and
  give it a module beside `ui/rc_week.js` that imports `ui/rc_util.js` for
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
- **A calendar schema change**: make it re-runnable in `rc_schema.sql`, add any
  column to `migrate.sql` (a `create table if not exists` never adds one), and
  raise the stamp at the end of `rc_schema.sql` together with `SCHEMA_VERSION`
  in `core/rc.js`. Cover it in `supabase/test/rc_permissions.sql`, and in
  `supabase/test/downgrade.sql` if an older project would lack it.
- **A new calendar failure worth an administrator's attention**: call
  `rc.reportError('<area>', err)` at that call site. Never from a global
  handler — see the rule on reporting.

## Verify after changes

```bash
npm run build          # must succeed — it lints the module graph and parses both bundles
npm test               # every suite, in parallel lanes (tools/run_tests.js); must exit 0
npm run test:serial    # the same, one at a time
npm run test:rust      #  33 checks — the plan, lock and intake rules, in Rust

node tools/run_tests.js smoke smoke_calendar   # just these suites
node tools/smoke.js --shot out.png             # …and eyeball the result
```

| Suite | Checks | What it covers |
|---|---|---|
| `test_dist.js` | 46 | every deployment shape, both bundles fingerprinted, and that the plan has no backend in any of them |
| `test_lookahead.js` | 195 | the parser, the rows it derives, the change events and the printed calendar's geometry, no browser |
| `test_folder_rules.js` | 46 | the folder's names, digest and pen rules, in Node |
| `smoke.js` | 318 | the application, local mode — **any console error fails the run** |
| `smoke_calendar.js` | 349 | the resource calendar, accounts, the look-ahead grid, a tablet, and that plan data never leaves |
| `smoke_folder.js` | 89 | the shared folder, in a browser |
| `smoke_desktop.js` | 64 | the desktop shell and its updates |
| `smoke_hosted.js` | 49 | sign-in, invites, read-only |
| `test_sql.js` | 328 | both permission models, the schema stamp, and that `migrate.sql` upgrades an old project |

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
- **An inline `background:` shorthand wipes out every class-drawn pattern.**
  A painted look-ahead cell set `style="background:#hex"`, which resets
  `background-image` — so the hatch marking an unmapped colour was never drawn,
  for as long as it existed. Paint with `background-color`.
- **A Playwright test types before a dialog's field has focus.** Opening a
  modal focuses its field on a timer; wait for `document.activeElement` to be
  the input before `keyboard.type()`, or the first characters go nowhere.

## Git

Commit and push to the branch named in the task. Keep the rebuilt
`app.bundle.js` **and** `calendar.bundle.js` in the same commit as the `src/`
change that produced them, otherwise the running application and the source
disagree — CI rebuilds both and fails on a difference.
