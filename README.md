# CX Timeline

**A hosted interactive timeline and commissioning planner.**

Built for managing software releases, testing schedules, commissioning
campaigns and programme milestones on rail signalling projects — and designed
to sit alongside the CX Portal as part of the same software suite.

Sign in, and your projects are wherever you open them. Share a plan with the
people who need it, read-only or otherwise.

---

## Getting started

Open the site and sign in. That is the whole installation — there is nothing
to download and nothing to keep in step.

A new account starts with an empty project that you own. Your work is saved
automatically after every edit: there is no Save button, and no way to lose
changes by forgetting to press one.

### Accounts are by invitation

There is no sign-up form. An administrator invites an email address from
**Team & Access** and passes on the link that appears; nobody else can create
an account, and that is enforced by the database rather than by hiding a
button. Invitations expire after 30 days, work once, and can be revoked.

### Sharing

An account on its own sees nothing. **Projects → Share** grants access to a
plan by email address, at one of three levels:

| | Viewer | Editor | Owner |
|---|:--:|:--:|:--:|
| Open, browse, export | ● | ● | ● |
| Change the plan | | ● | ● |
| Take and restore backups | | ● | ● |
| Share, and change roles | | | ● |
| Rename, delete the project | | | ● |

Roles are per project, so the same person can own one plan and merely watch
another. A viewer sees the whole plan, exports it freely, and is stopped from
changing it — by the database, not just by the interface.

### Deploying your own

See **[DEPLOY.md](DEPLOY.md)**. There are three shapes and it covers all three:

- **Hosted** — Cloudflare and Supabase, accounts, invitation-only sign-up. Both
  free at this size, about twenty minutes.
- **Shared folder** — no backend and no account at all: the plan is a JSON file
  in a folder you picked, usually one OneDrive or SharePoint keeps in sync. Two
  people take turns, and nothing of yours reaches any vendor.
- **Desktop app** — the same folder, as a Windows application that opens your
  plan on launch and needs no administrator to install. It is not a fork: it
  runs the same bundle, fetched from the deployment, so a deploy reaches it on
  its next launch without anybody reinstalling anything.

```bash
npm run serve      # http://localhost:8123 — local development
npm test           # local UI, shared folder, desktop shell, hosted UI, permissions
```

---

## What it does

### Timeline

An infinite horizontal timeline with five scales — **day, week, month,
quarter, year** — that the ruler selects automatically as you zoom.

| Action | How |
|---|---|
| Zoom | Mouse wheel (or <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + wheel) |
| Pan | Drag the ruler, hold <kbd>Space</kbd> and drag, middle-drag, or the Pan tool |
| Scroll lanes | Vertical wheel over the canvas |
| Fit everything | <kbd>Ctrl</kbd>+<kbd>0</kbd> |
| Go to today | <kbd>T</kbd> |

Gridlines, weekend shading and grid density are all configurable. Snapping
(day, working day, week, month, quarter, or off) governs dragging, resizing
and keyboard nudging alike — an arrow key steps one snap unit.

Dates display as **M/D/Y** by default; **Settings → Date format** switches to
D/M/Y or Y-M-D. Files always store dates as `YYYY-MM-DD` regardless, and
ambiguous dates in imported spreadsheets are read using the same order.

**Labels are never truncated.** At every zoom, text either wraps inside its
bar or moves to a full wrapped block beside it; rows and lanes grow to fit,
and packing reserves the space a label needs so two can never overprint. Ruler
labels are spaced out rather than shortened. The same rules apply to SVG and
PDF output.

### Lanes

Unlimited lanes, each of which can be renamed, recoloured, reordered,
resized, hidden, locked or collapsed. **Lanes → Standard set** drops in the
usual rail signalling rows (Software Releases, Regression Testing, ATS, IXL,
SCADA, Communications, Wayside, Vehicle, Commissioning, Customer, Risks).

### Objects

Eighteen object types across five groups:

- **Schedule** — activity, milestone
- **Delivery** — software release
- **Commissioning** — campaign, test window, freeze period
- **Operations** — outage, maintenance window, customer activity
- **Assurance** — risk, open issue, decision, document
- **Annotation** — sticky note, callout, text box, shape, image, container

Every object can be dragged, resized, duplicated, copied, pasted, grouped,
locked, hidden and re-ordered in the z-stack, and every object carries full
appearance control: fill, border colour and thickness, corner radius, opacity,
shadow, gradient, four pattern fills, rotation, plus font, size, weight,
style, alignment and text colour.

A searchable library of ~110 inline SVG icons (train, rail, signal, switch,
warning, database, server, cloud, bug, calendar, clock, gear, lightning,
document, camera, bell, user, lock, globe, network …) can be attached to any
object.

### Domain features

- **Software releases** carry version, release number, build number,
  deployment date, owner, status and approval state, colour-coded
  blue = planned, orange = testing, green = released, red = delayed,
  grey = cancelled.
- **Commissioning campaigns** carry area, subsystem, test package, owner,
  planned *and* actual dates, and percent complete.
- **Subsystem tags** — ATS, IXL, SCADA, Communications, Wayside, Vehicle,
  Civil, Power.
- **Freeze periods**, **outages** and **maintenance windows** render as
  translucent full-lane bands behind the work they affect.
- **Risks and issues** carry severity, likelihood, mitigation and a reference.

### Dependencies

Drag from an object's round anchor onto another object to link them. All four
precedence relationships are supported (finish-to-start, start-to-start,
finish-to-finish, start-to-finish) with lead/lag in days, drawn as
orthogonal, curved or straight connectors that re-route automatically whenever
anything moves. Circular dependencies are rejected at creation.

**Critical path** highlighting runs a full forward/backward pass and reports
total float per activity.

**Broken dependencies flag themselves.** Move a predecessor past the point its
successor can still start and the arrow turns red and dashed, labelled with
how many days the plan is out by; both objects gain a red badge and outline,
the inspector explains the breach, and the status bar counts them. Fix the
dates — or adjust the link's type or lag — and everything reverts on its own.
Nothing is stored: the state is derived from the document on every render, so
it can never go stale. A **Fix** button moves the successor to the earliest
date the dependency allows, and **Reschedule all** settles a whole cascade.

### Progress, baselines and slip

Activities carry percent complete, drawn as a progress fill, with remaining
duration and a straight-line health assessment (on track / behind / overdue /
ahead).

Take a **baseline** at any time. Turn comparison on and the plan shows what
changed, at a glance:

- the **ghost** — each object at its baseline dates, drawn behind the live bar
  at the same height, so the pair reads as one object that moved;
- the **shift** — an arrow between the two finish edges labelled with the
  number of days, red for a slip, green for an acceleration, amber for a
  reshape. This is what makes a slip legible from across a lane;
- **what is gone** — objects that were in the baseline and are no longer in
  the plan, drawn as struck-through outlines where they used to sit. Nothing
  else in the application shows those at all;
- a **banner** naming the baseline and counting the differences.

The Baselines pane reports every slip, acceleration, reshape and scope change
and exports them as CSV. Exports draw the comparison too, so a PDF taken into
a meeting shows the movement rather than just the current dates.

### Notes and attachments

Every object supports rich notes — headings, bold/italic/underline, bullet and
numbered lists, checklists, tables, links and inline images. Notes appear as a
preview on hover and open in a full editor on click. All note HTML is
sanitised on the way in and out.

Files of any type (PDF, Excel, Word, images, ZIP, logs) can be attached to any
object. File bytes live in IndexedDB, separate from the document, so a project
carrying 40 MB of test logs still autosaves in milliseconds.

### Editable dropdowns

Every dropdown vocabulary is yours to change — **Status**, **Subsystem**,
**Test type**, **Severity & likelihood**, **Release approval**, **Owner**,
**Area** and the **font** menu. Add options, rename them, recolour them,
reorder them, or delete them, from the **Dropdown Lists** pane or from the
"＋ Add…" and "⚙ Manage…" rows at the foot of any dropdown — both are the same
editor.

Deleting an option that objects still use asks where those objects should go
and moves them in the same step, so one undo puts everything back. Renaming
never breaks anything: the stored value keeps its original id and only the
label changes. **Restore defaults** brings the shipped options back while
keeping any custom one still in use.

The lists are saved with the project, so they travel with the file, export
with it and are covered by undo like any other edit. Imported files that carry
values your lists have never seen keep them — the value is adopted rather than
silently dropped. Owner and Area stay free text, offering what the plan
already uses as suggestions rather than blocking a new name.

### Primavera P6

A P6 schedule is the contract programme; this is the commissioning narrative.
They stay separate documents with separate owners, and the P6 side is a
**register** rather than a copy of your plan.

Import an Excel or CSV export carrying four columns — **Activity ID**,
**Activity Name**, **Start**, **Finish**. `WBS`, `% Complete` and
`Activity Status` are used if the layout happens to include them, and ignored
if not. P6's own header rows, `dd-MMM-yy` dates with times, and milestones
whose start and finish are the same day are all handled.

Every import is tagged, and both are kept per activity:

- **Baseline** — the target programme. Replaced only by another baseline.
- **Progress** — where the schedule stands now. Re-imported monthly.

Nothing is drawn until you choose. From the **P6 Schedule** pane you can
place an activity on the timeline, or link one to an object you already have.
The register then shows, for all 1,500 of them, what is on your plan and what
is not, searchable by activity ID — so when someone says "A1234" in a review,
you have it.

Linking is by search, not by dropdown — a menu of 1,500 activities is not a
menu — and you can **drag a row straight onto the canvas**: onto empty space
to place it, onto a bar to link the two.

**A bar can track several activities.** "SCADA commissioning" on your plan is
usually a dozen rows in P6, so a link is a set rather than a single pointer:
drop as many as belong, and the bar is measured against the span of all of
them — earliest start to latest finish. The inspector lists each one with its
own dates, and removing one leaves the rest alone.

Three numbers fall out and are never stored:

| | |
|---|---|
| **P6 slip** | how far the scheduler has moved an activity since the baseline |
| **Your variance** | how far your plan differs from where P6 has it now |
| **Position** | where an activity sits against today — *not* status, because dates cannot tell you whether work happened |

A re-import **never moves your bars**. It reports what changed and asks which
of them should follow, defaulted to none; whatever you decline simply records
the divergence. An activity that disappears from P6 is marked, not deleted.

**Both sides become baselines automatically.** Importing gives you *P6 —
baseline* and *P6 — current progress* in the Baselines pane, and comparison
mode draws the ghost bars and day counts against either.

They are **live, not snapshots**. A baseline you take by hand is a frozen copy
and must stay that way; a P6 one has to answer for whatever is linked *now*,
so linking another activity updates the comparison immediately — nothing to
re-take, and it cannot drift out of date. No rows are stored for them at all;
the comparison is computed from the register on every frame.

### Resource Calendar

A second interface in the same application, over different data and a different
store. The **Timeline / Calendar** switch at the top of the sidebar moves
between them; the timeline is hidden rather than closed, so switching back lands
exactly where you left off.

It exists because the timeline answers *what the programme is* and this answers
*who is doing it today*. The two are deliberately not linked: the plan holds
proprietary P6 data and never leaves its folder, while the calendar is
non-proprietary and lives in Postgres so the whole team can reach it from a
browser. Nothing in the plan's code path can even see the calendar's backend,
and a test asserts it.

**The daily huddle** is the screen it is built around. One page, everyone side
by side, all subsystems in one meeting: what each person was planned to do
yesterday, what actually happened, and what they are doing tomorrow. Five
outcomes, one keypress each — and they fall into two families that are never
averaged together:

| Performance — what somebody did | Programme health — what was done to them |
|---|---|
| Completed · Partial · Carried over | Blocked · Reassigned |

A possession released late is not underperformance. Counting it as such would
make the number worse than useless, because people would stop saying they were
blocked. **Blocked needs a reason and a responsible party**, refused by the
database rather than by a dialog somebody dismisses at 3:07pm.

The meeting happens whether or not the wifi does: entries queue on the machine
and go up on their own when the connection returns.

**Leave** is a third thing again. Somebody on annual leave did not carry
anything over, and without somewhere for absence to go it gets quietly spread
across the performance statuses. Leave sits behind the week grid, so a clash is
visible rather than merely flagged, and the bottom row says how many people can
actually be staffed each day.

**Reports** run over any date range — "back one year from today" is as easy as
"this month" — grouped by person, category, location or subsystem. A carried
task counts **once** however many days it ran, ranked by age: five days of one
stuck job is one problem, not five failures by one person.

### The four-week look-ahead

The look-ahead is an Excel file in a shared folder, edited by hand, encoding
shift access in **cell fill colour** against a fixed legend. It is the
contractual source of truth; the resource calendar is the execution record. The
application reads it out of the folder, snapshots it whenever it changes, and
works out what moved.

Colours resolve whichever way Excel happened to write them — literal RGB, a
theme colour with a tint, or the legacy indexed palette — so a legend is keyed
on the colour rather than the notation. **A colour that is not in the legend is
never guessed**: it goes into an unknown bucket for somebody to map, because
that failure would otherwise be silent and would land in evidence.

Only the named sheet is read, and only its visible rows and columns — the file
is large and mostly hidden. A hidden *column* matters more than a hidden row:
with one column per day, dropping one removes a day from the week and nothing
about the result looks wrong.

Changes are classified against the previous snapshot: scope added, scope
removed, cancelled, shift changed, resources changed. Two things are recorded
and deliberately kept **out** of the figures — a week arriving at the far edge
of the window and a week falling off the back. Those are the window rolling
forward, not scope moving, and counting them would book a batch of phantom
additions every week and mark finished work as deleted.

Where the system genuinely cannot tell, it says so rather than guessing. A crew
finishing early and moving site looks exactly like a cancellation plus new
scope, and the activity descriptions are not reliable enough to match on, so
both halves are logged honestly and the pair is offered for a person to relink.
Likewise a shift turning red says a cancellation happened but not whose, so it
asks.

**Site access requests** match look-ahead rows by date and location — never by
activity text, which is worded differently on the two sides. One SAR covering
several rows at a location is expected rather than ambiguous. Two reports fall
out of having both registers: rows with no SAR, which is work planned without
confirmed access, and SARs with no rows, which is access booked for work that
has gone.

### Search, filters and legend

Global search covers titles, notes, owners, subsystems, areas, tags, versions,
build numbers and references, ranked by where the match landed.

Filters combine text, date range, type, status, lane, owner, subsystem, area
and tag. Non-matching objects **dim** by default, so the shape of the plan
stays readable, or **hide** entirely — the choice sits at the top of the
Filters pane and is saved with the project. Hiding reflows the lanes around
what is left rather than leaving gaps. Exports always hide.

The legend is generated from what is actually in the document and doubles as a
filter control.

### Accounts, saving and backups

- **Autosave** after every edit, debounced to 500 ms, straight to Postgres.
- **Version history** — every edit recorded as a reversible patch, with
  unlimited undo/redo and one-click rollback to any earlier point.
- **Backups** — automatic hourly and every 100 edits (both configurable),
  kept server-side so they survive a lost laptop. Configurable retention,
  restorable and downloadable.
- **Offline cache** — every successful save is mirrored into IndexedDB, so a
  dropped connection costs nothing and a crash is recoverable.
- **Conflicts are refused, not merged** — if someone else saved while you had
  the plan open, your write is rejected rather than silently overwriting
  their work, and you are offered their version. Your copy stays in the
  browser and can be exported first.

### Export and import

**Drawing options** (Import / Export → Drawing options) decide what a picture
contains, and apply to PDF, print, SVG, PNG and JPEG alike:

- **Dates on every object** — start, finish and duration under each label, so a
  bar can be cross-referenced without reading it off the ruler. On by default,
  because a month-scale ruler cannot be read to the day.
- **Dependencies**, **progress fill**, **legend**, **gridlines**, **today**
- **Baseline comparison**, against the baseline on screen or a different one
- **Apply the active filters** — on by default
- **Date range** — the whole plan, or just the window on screen
- **Density** — compact, fit to the page, or detailed

The choices are saved with the project, so a plan exports the same way for
whoever opens it.

| Export | Notes |
|---|---|
| **PDF** | True vector, landscape, multi-page with the lane gutter repeated. Selectable text. No external library. |
| **Print** | Renders the same drawing for the browser's print dialog, so "Save as PDF" matches Export PDF |
| **SVG** | Standalone, self-contained, opens in Illustrator/Inkscape/Visio |
| **PNG / JPEG** | Rasterised from the SVG at 2× |
| **CSV** | Objects (27 columns incl. float and critical flags), dependencies, baseline variance |
| **JSON** | The complete project — the canonical interchange format |

| Import | Notes |
|---|---|
| **JSON** | Full project restore, with forward schema migration |
| **CSV / TSV** | Column names mapped automatically; comma, semicolon and tab delimiters detected |
| **Microsoft Project CSV** | Predecessor syntax (`12FS+3 days`) parsed into real dependencies |
| **Excel `.xlsx`** | Read directly — ZIP + DEFLATE + sheet XML, no dependency |
| **Primavera P6** | Excel or CSV export, tagged baseline or progress — see above |

Imports preview before they apply, and can either replace the project or merge
into it.

### Themes and presentation

Five themes — **Dark** (default), **Light** (the CX Portal palette), 
**Engineering**, **Blueprint** and **Presentation**.

Presentation mode (<kbd>P</kbd> or <kbd>F11</kbd>) hides every editing control
for a clean full-screen view in customer meetings.

---

## Keyboard shortcuts

Press <kbd>?</kbd> in the application for the full list. The essentials:

| | |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Undo / redo |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd> / <kbd>D</kbd> | Copy / cut / paste / duplicate |
| <kbd>Delete</kbd> | Delete selection |
| <kbd>Ctrl</kbd>+<kbd>A</kbd> | Select all |
| <kbd>←</kbd> <kbd>→</kbd> | Nudge a day (<kbd>Shift</kbd> = a week) |
| <kbd>Ctrl</kbd>+<kbd>←</kbd> <kbd>→</kbd> | Change duration |
| <kbd>Ctrl</kbd>+<kbd>F</kbd> | Global search |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> | Print / export PDF |
| <kbd>A</kbd> <kbd>M</kbd> <kbd>R</kbd> <kbd>N</kbd> | New activity / milestone / release / note |

---

## Architecture

The application is authored as **ES6 modules** under `src/`, organised in
strict dependency layers. A zero-dependency linker (`tools/build.js`) resolves
the module graph ahead of time and emits a single self-executing
`app.bundle.js`.

That indirection exists so the deployed site is a handful of static files with
no build step at the edge, and so the source stays properly modular without a
toolchain to keep in step. The bundle is committed, so a fresh clone runs
immediately.

```
src/
  core/        util · events · dates · model · query · history · store
               storage · cloud · analysis · lookahead
               rc            the resource calendar's separate Supabase client
  timeline/    viewport · layout · connectors · renderer · interactions
  ui/          icons · components · lists · theme · shell · panels · inspector
               dialogs · menus · commands · shortcuts · notes · attachments
               minimap · legend · auth · p6
               workspace · rc · rc_roster · rc_huddle · rc_lookahead
               rc_reports · rc_util        the second interface
  io/          scene · svg · pdf · inflate · exporters · importers · lookahead · p6
  main.js
css/           tokens · base · components · layout · timeline · notes
```

Layering is enforced by the build: **circular imports are a hard error.**
Lower layers never import upwards — they publish on the event bus in
`core/events.js` and let the UI subscribe.

A few decisions worth knowing about:

- **One document, one mechanism.** A project is a single plain-JSON object.
  Undo, autosave, baselines, export and import are all transformations of it,
  which is why they cannot drift apart.
- **Patch-based history.** Each edit is reduced to a structural diff
  (entities added/removed/changed plus field moves), so deep history costs
  almost nothing and its inverse is the patch read backwards.
- **DOM objects, not canvas.** Objects are real elements. That buys gradients,
  pattern fills, shadows, live text and browser hit-testing for free;
  virtualisation keeps the node count proportional to what is on screen.
- **One export scene, two backends.** SVG and PDF consume the same primitive
  list, so the two outputs are the same drawing rather than two
  re-implementations.
- **No runtime dependencies.** Everything — the PDF writer, the DEFLATE
  decompressor for `.xlsx`, the icon set, even the Supabase client — is in the
  repository. Nothing is fetched from a CDN, so there is no third party who
  can break or watch the application.
- **Permissions live in the database.** Roles are enforced by row-level
  security in Postgres, so bypassing the interface achieves nothing. The
  read-only UI explains the state; it does not create it. `npm run test:sql`
  proves it against a real PostgreSQL.

### Working on it

```bash
npm run build         # link src/ → app.bundle.js
npm run watch         # rebuild on change
npm run serve         # local dev server
npm run build:dist    # what Cloudflare runs
npm run build:desktop # assemble the frontend the Windows installer contains

npm test              # every suite below except the Rust one
npm run test:smoke    # 254 checks — the application, local mode
npm run test:lookahead #  45 checks — the look-ahead parser, no browser
npm run test:calendar #  45 checks — the resource calendar, and its isolation
npm run test:folder   #  43 checks — the shared folder, in a browser
npm run test:desktop  #  48 checks — the desktop shell, and its updates
npm run test:hosted   #  49 checks — sign-in, sharing and read-only mode
npm run test:sql      # 140 checks — both permission models, on real PostgreSQL
npm run test:rust     #  32 checks — the plan, lock and intake rules; no webview needed
```

After editing anything under `src/`, run `npm run build` — `index.html` loads
the bundle, not the source.

Leaving `config.js` blank runs the application in local mode against browser
storage. That is the development and test path — it is how the offline suite
runs — not a deployment option: a build with a backend always requires an
account.

### Data and privacy

- **Postgres (Supabase)** — projects, membership and backups, every row behind
  row-level security tied to your account
- **Supabase Storage** — attachment bytes, in a private bucket keyed by
  project, with the same access rules
- **IndexedDB** — an offline mirror of the open project, so a dropped
  connection loses nothing
- **localStorage** — device preferences (theme, panel sizes), the session, and
  any huddle entries made while offline, until they sync

The resource calendar is a **separate** Supabase project from the timeline's,
named separately in `config.js`. That separation is the point: the plan holds
proprietary programme data and stays in your folder, while the calendar holds
people's names, attendance and outcomes and goes to the database so the team can
reach it. Two different kinds of data, two different audiences, two different
homes — and the personal half is worth its own retention answer.

Your data goes to your own Supabase project and nowhere else — there is no
analytics, no telemetry and no third-party script on the page. Sharing a
project is the only way anyone else can see it, and an email address is never
exposed to someone you do not share a project with.

In the two shapes with no backend — the shared folder, and the desktop app —
none of the first two apply. The plan is a file in your folder, attachments are
files beside it, and the only thing leaving the machine is whatever your folder
already syncs. The desktop app makes exactly one network request of its own: it
asks the deployment whether a newer version of the application exists. It never
sends anything, and its Content-Security-Policy allows that one host and nothing
else.
