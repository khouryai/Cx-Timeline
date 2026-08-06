# CX Timeline

**A local-first interactive timeline and commissioning planner.**

Built for managing software releases, testing schedules, commissioning
campaigns and programme milestones on rail signalling projects — and designed
to sit alongside the CX Portal as part of the same software suite.

Everything runs on your computer. There is no server, no account, no cloud,
and nothing leaves the machine.

---

## Getting started

**Double-click `index.html`.** That is the whole installation.

The application opens in your browser with a sample commissioning plan loaded.
Edit it, or start a clean project from **Import / Export → New project**.

Your work is saved automatically after every edit. There is no Save button and
no way to lose changes by forgetting to press one.

### Optional: running from a local server

Not required, but useful during development:

```bash
npm run serve      # http://localhost:8123
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

Take a **baseline** at any time. The timeline then shows original-versus-current
ghost bars, and the Baselines pane reports every slip, acceleration, reshape
and scope change, exportable as CSV.

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

### Search, filters and legend

Global search covers titles, notes, owners, subsystems, areas, tags, versions,
build numbers and references, ranked by where the match landed.

Filters combine text, date range, type, status, lane, owner, subsystem, area
and tag. Filtered-out objects dim rather than disappear, so the shape of the
plan stays readable — and exports honour the filters.

The legend is generated from what is actually in the document and doubles as a
filter control.

### Saving, backups and history

- **Autosave** after every edit, debounced to 500 ms.
- **Version history** — every edit recorded as a reversible patch, with
  unlimited undo/redo and one-click rollback to any earlier point.
- **Backups** — automatic hourly and every 100 edits (both configurable),
  plus before every import or restore. Configurable retention, restorable and
  downloadable.
- **Crash recovery** — work in flight is mirrored on unload and offered back
  on the next launch.

### Export and import

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

That indirection exists for one reason: browsers refuse to load
`<script type="module">` over `file://`, so a real module graph cannot run by
double-clicking an HTML file. Pre-linking keeps the source properly modular
*and* keeps the application zero-setup. The bundle is committed, so a fresh
clone runs immediately.

```
src/
  core/        util · events · dates · model · query · history · store
               storage · analysis
  timeline/    viewport · layout · connectors · renderer · interactions
  ui/          icons · components · lists · theme · shell · panels · inspector
               dialogs · menus · commands · shortcuts · notes · attachments
               minimap · legend
  io/          scene · svg · pdf · inflate · exporters · importers
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
  decompressor for `.xlsx`, the icon set — is in the repository. Nothing is
  fetched at runtime, so the application works offline, forever.

### Working on it

```bash
npm run build      # link src/ → app.bundle.js
npm run watch      # rebuild on change
npm run serve      # local dev server
node tools/smoke.js --shot out.png   # headless end-to-end check (needs Playwright)
```

After editing anything under `src/`, run `npm run build` — `index.html` loads
the bundle, not the source.

### Data and privacy

All data is stored in this browser, on this computer:

- **IndexedDB** — the project, backups and attachment bytes
- **localStorage** — device preferences (theme, panel sizes) and a crash-recovery mirror

Nothing is transmitted anywhere. To move a project between machines, export
JSON and import it on the other side.
