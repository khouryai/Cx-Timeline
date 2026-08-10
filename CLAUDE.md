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

### Layers

```
core/util · core/events · core/dates      leaves — import nothing
core/cloud                                the only module that knows Supabase
core/desktop                              the only module that knows Tauri
core/filestore → core/desktop             the only module that knows the File
                                          System Access API, and the only caller
                                          of the desktop bridge
core/model → core/query · core/history · core/analysis
core/store → core/storage
timeline/viewport → timeline/layout → timeline/connectors
                  → timeline/renderer → timeline/interactions
ui/icons · ui/components → ui/lists · ui/auth → ui/theme → ui/commands
                             → ui/dialogs → ui/panels → ui/shell
io/scene → io/svg · io/pdf · io/inflate → io/exporters · io/importers
main.js                                    the only module that may import freely
```

Lower layers never import upwards. When something low needs to reach the UI it
**emits an event** (`core/events.js`, names in the `EV` map) and the UI
subscribes. That is what keeps the graph acyclic.

## Conventions

- **Colours go through tokens, never raw hex.** All values live in
  `css/tokens.css`. If a value you need does not exist, add a token in the
  right category and use `var(--name)`. Every theme must define the same
  semantic contract (`--surface`, `--text`, `--good`, …).
- **The design language is shared with cx-portal**: Archivo + Roboto Mono,
  Hitachi red `#e60012` for primary actions, 8px control radius, 140 ms
  micro-transitions on `cubic-bezier(0.16, 1, 0.3, 1)`, mono uppercase
  eyebrows, dot-prefixed status badges, chip-stat KPIs. New controls reuse
  `.cx-btn` (+ `.primary` / `.ghost` / `.danger` / `.mini` / `.icon`) — do not
  start an eleventh button family.
- **No emoji as icons.** Add glyphs to the `ICONS` map in `src/ui/icons.js`
  with search keywords and a category; render with `icon('name')`. Icons use
  `currentColor`. Icon-only buttons need an `aria-label`.
- **Every document mutation goes through the store** (`core/store.js`) so it is
  undoable and autosaved. Live drag feedback uses `previewObjects(ids, fn)` —
  copy-on-write, so a gesture costs the selection, not the project — and the
  gesture commits once with `edit()` on release. Never one `edit()` per
  mouse-move, and never the whole-document `preview()` on a pointer path.
- **`getDoc()` is never mutated in place.** Every write builds a new object
  graph and reassigns the binding. `edit()` uses the outgoing document as the
  "before" side of its diff, and derived analysis is memoised in a WeakMap
  keyed on document identity. Mutating in place breaks both, silently.
- **Filtered-out objects dim by default and can be hidden instead**
  (`settings.filterMode`). Hiding drops them before packing in
  `computeLayout()`, so the rows reflow and the lanes close up; skipping them
  at paint time would leave the gaps they used to occupy. Exports always hide.
- **Baseline comparison draws four things, not one** (`renderBaseline`): the
  ghost at the baseline dates behind the live bar, an arrow between the two
  finish edges labelled in days, outlines for objects the baseline had and the
  plan no longer does, and a banner naming the baseline. `io/scene.js` draws
  the same, so an exported PDF is the drawing on screen. All of it is derived
  per frame from the snapshot — there is no comparison state to go stale.
- **A ghost is packed, not painted over.** `computeLayout()` measures the
  comparison with the objects (`measureGhost`, `measureGone`) and `packRows()`
  reserves the whole pair — bar, label, ghost and the arrow's day badge — so a
  ghost can never land on another bar or on another ghost; the lane reflows
  instead. Where a ghost covers the same dates as its *own* bar the two cannot
  share a height, so it drops to a slim tier along the bottom of the row
  (`rect.ghost.stacked`) and the row grows. That test is in pixels, so zooming
  out until a gap closes splits them and zooming back in re-joins them. The
  renderer and `io/scene.js` only draw what they are handed — `rect.ghost` and
  `layout.removed` — and neither works out a position of its own. Never place a
  comparison rectangle from the snapshot at paint time: it will be the one
  thing on the canvas nothing else knows is there.
- **A P6 baseline is derived; a taken baseline is frozen.** Both live in
  `doc.baselines`, but a P6 one carries `source: 'p6'` and **no rows** — the
  comparison has to follow whatever is linked right now, so
  `baselineSnapshot(doc, baseline)` computes it. Anything reading
  `baseline.snapshot` directly is a bug: it will be empty for the P6 pair.
  `ensureP6Baselines()` creates them on import; deleting one only means the
  next import brings it back.
- **P6 data is a register, not objects.** `doc.p6` holds every imported
  activity keyed by activity ID — the only identifier P6 gives that survives a
  rename — and an object points at a **set** of them with `data.p6Ids`, because
  one commissioning bar is routinely a whole test package in P6. Read it with
  `p6LinkedIds(obj)`, never the raw field: the singular `data.p6Id` written by
  the first version is still migrated and still read. Where a link needs one
  pair of dates — variance, the derived baselines, "move onto the P6 dates" —
  it is the roll-up from `p6RollUp()`: earliest start to latest finish across
  the set. Each activity carries
  a `baseline` and a `progress` date set, because that is how the reviews
  work; slip, variance and schedule position are all derived from those and
  never stored. An import writes the register and *proposes* changes to
  objects; it never moves a bar without being told to. An activity missing
  from a later file is flagged `missing`, never deleted — something on the
  timeline may point at it.
- **Derived state is never stored.** Violations, critical path and float are
  computed from the document, so they appear and clear on their own. Do not
  add a `violated` field to a link — there is nothing to keep in step.
- **Selecting a bar marks what it is waiting on.** `predecessorsOf()` returns
  one hop — the links arriving at the selection and the objects on the far end —
  and the renderer marks them `.upstream` for as long as the selection stands,
  in `--upstream` rather than the selection blue so the two are never confused.
  Not the transitive closure: the upstream chain of a real plan is most of the
  plan, and that is what the critical path is for. The flash on top of it is
  one-shot and says *where to look*, so it must not replay on every frame of a
  drag — object nodes persist and get the class for one frame (`flash`), while
  the connector layer is rebuilt every frame and so is told the whole window
  (`flashing`), with a timer closing it. Anything else that wants to flash
  something on the canvas has the same two cases to answer.
- **A shared folder is a third storage backend, not a export/import trick.**
  `core/filestore.js` owns the File System Access API the way `core/cloud.js`
  owns Supabase, and `core/storage.js` branches on `fileMode` beside `hosted`.
  Two rules matter and both exist because a synced folder is not a database.
  **The lock file is courtesy, the write guard is the control**: `savePlan()`
  re-reads the file's size and modified time before every write and refuses if
  either moved, so a colleague's save can never be silently overwritten even
  when the lock has not synced yet. A lock is keyed on a **device** id kept in
  localStorage, not the per-load tab id — with the tab id, closing the browser
  and reopening it left you locked out of your own plan until the lock went
  stale. And `takeOver()` never refuses: refusing left "I know that session is
  dead" with nowhere to go, and the write guard already means the loser of a
  race is told rather than overwritten. Warning the user is `ui/commands.js`'s
  job; deciding for them is not the store's. And **a directory handle only survives a
  reload through IndexedDB** — it cannot be serialised — so it lives in a
  database of its own, which is what lets `storage.js` import `filestore.js`
  without the reverse. Anything that writes to the folder goes through
  `filestore.js`; nothing else should ever hold a handle. A lock is keyed on a
  device id, and on the desktop that id belongs to the **shell**
  (`settings.json`), adopted by `adoptSettings()` on every settings read —
  minting a second one in localStorage would recreate, on the desktop, the exact
  bug it was introduced to fix.
- **`core/filestore.js` has two backends and one set of rules.** The I/O layer at
  the top of it is the only place a browser (a directory handle) and the desktop
  shell (a path) differ; every rule that matters — whose lock it is, when one is
  stale, when a save is refused — sits below that line and runs identically in
  both. `core/desktop.js` is the only module that knows Tauri exists and it
  decides nothing: it moves bytes, and rethrows Rust's `{ kind, message }` so a
  caller can branch on `err.kind === 'conflict'` from either backend. The Rust
  side (`src-tauri/src/plan.rs`) is a Tauri-free library, tested with
  `npm run test:rust` on a machine with no webview installed, and it gives the
  desktop build two things a browser cannot have: no permission prompt on launch,
  and an **atomic** write (temp file, then rename) so OneDrive never reads a
  half-written plan.
- **The desktop app is fed by the deployment, not by reinstalling.** The window
  loads a local page; `tools/shell/loader.js` runs the newest copy the machine
  has and fetches a newer one in the background for the *next* launch. Two rules
  make that safe to leave running on someone else's laptop: launch never waits on
  the network, and a downloaded copy is **on trial** until `main.js` calls
  `CX_SHELL.confirmHealthy()` — a copy that cannot boot is thrown away rather
  than retried forever, so a bad deploy cannot brick both laptops with no way
  back. Publishing the site is the whole release: `tools/dist.js` writes
  `dist/desktop/{version,payload}.json` alongside it. Rebuild the installer only
  when the Rust side changes.
- **New user actions go in `ui/commands.js`**, then get wired to the menu, the
  shortcut and the button. One implementation, three entry points.
- **Dropdown vocabularies are document data, not constants.** Status,
  subsystem, test type, severity, approval and the font menu live in
  `doc.lists`, seeded from `DEFAULT_LISTS` and described by `LIST_DEFS` in
  `core/model.js`. Read them with `listOptions()` / `listOption()` /
  `statusOf()` — never re-declare a hard-coded array — and render them with
  `managedSelect()` from `ui/lists.js` so the "Add…" and "Manage…" rows come
  along. Free-text fields with suggestions use `suggestInput()`. The store
  owns the mutations (`addListOption`, `updateListOption`,
  `removeListOption`, `moveListOption`, `resetList`), and `removeListOption`
  rewrites the objects that used the option in the *same* edit so one undo
  puts everything back.
- **Dates are UTC-midnight milliseconds internally**, `YYYY-MM-DD` on disk.
  Never call a local-time getter — a calendar date must not shift by a
  timezone. Display order (M/D/Y by default) is a preference pushed into
  `core/dates.js` via `setDateOrder()`, because that module is a leaf and
  cannot read the store. `toISO()` ignores it: the on-disk format is fixed.
- **No timeline text is ever truncated, ellipsised or clamped**, at any zoom.
  Labels are measured with `timeline/text.js` before placement: they wrap
  inside a bar when they fit, move beside it when they do not, packing
  reserves the space the label occupies, and rows and lanes grow to suit. Do
  not reach for `text-overflow: ellipsis`, `-webkit-line-clamp` or
  `truncate()` anywhere the canvas draws — the smoke test fails the build if
  you do.

## Extending it

- **A new object type**: add an entry to `TYPES` in `core/model.js` (label,
  group, icon, shape, whether it has duration, accent, inspector fields). The
  palette, context menus, legend, filters and CSV export all pick it up. Add a
  `build<Shape>` branch in `timeline/renderer.js` only if it needs a new shape.
- **A new dock pane**: add it to `PANES`, `TITLES` and `RENDERERS` in
  `ui/panels.js`, and to `NAV` in `ui/shell.js`. A pane that changes only its
  own view state — a filter, a search — must emit `EV.PANE_REFRESH` to redraw
  itself: nothing in the document changed, so no `doc:changed` fires, and it
  cannot import the dock without creating a cycle.
- **A new editable list**: add the seed to `DEFAULT_LISTS` and an entry to
  `LIST_DEFS` in `core/model.js` saying where its values live on an object —
  `field` (a top-level property), `dataKeys` (inside `data`) or `styleKey`
  (inside `style`). Usage counting, deletion-with-reassign, the manager tab
  and the Dropdown Lists pane all follow from that one entry.
- **A new export format**: consume the scene from `io/scene.js` rather than
  re-walking the document — that is what keeps every export agreeing with
  every other.
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

## Verify after changes

```bash
npm run build                        # must succeed — it also lints the module graph
npm test                             # all four browser suites plus the SQL one, must exit 0
npm run test:rust                    #  13 checks — the plan and lock rules, in Rust

node tools/smoke.js                  # 204 checks — the application, local mode
node tools/smoke_folder.js           #  43 checks — the shared folder, in a browser
node tools/smoke_desktop.js          #  48 checks — the desktop shell and its updates
node tools/smoke_hosted.js           #  49 checks — sign-in, invites, read-only
node tools/test_sql.js               #  78 checks — the permission model
node tools/smoke.js --shot out.png   # …and eyeball the result
```

`smoke.js` boots the real application in Chromium and checks rendering,
selection, typing into panel fields without losing focus, snapping, undo/redo,
zoom, the dropdown vocabularies, filter dim/hide, the predecessor highlight and
its one-shot flash, baseline comparison — down to measuring, at five zooms, that
no ghost is drawn over a bar or over another ghost — all seventeen dock panes,
all five themes, every exporter (including PDF header validation) and reload
persistence. **Any console error fails the run.**

`smoke_folder.js` replaces `window.showDirectoryPicker` with an in-memory
folder, so the lock, the read-only handover and the write guard are covered
without a real filesystem. No browser lets a script click its own file dialog,
so the picker and a genuine OneDrive folder stay on the manual checklist in
`DEPLOY.md` rather than being pretended at.

`smoke_desktop.js` serves `dist-desktop/` — reassembled on every run, so it can
never pass against code that has moved on — and replaces
`window.__TAURI_INTERNALS__.invoke` with an in-memory folder. It covers the
things the desktop build claims and the browser cannot do: the plan opening on
launch with no picker and no prompt, the pen announced *before* anything is
drawn, a save going through the shell, the guard refusing one, and the whole
update path — downloaded in the background, applied on the next launch, and
rolled back when the downloaded copy either throws or silently never boots. The
Rust side is `npm run test:rust`, which needs no webview and no display.

`smoke_hosted.js` boots it with a configured backend and a stubbed client, so
the gate, invitations, sharing and read-only mode are covered without a
network or an account. `test_sql.js` stands up a throwaway PostgreSQL, applies
the real `schema.sql` against a stub of what Supabase provides, and becomes
each user in turn; it never touches a real project.

Two traps worth knowing, both of which have caused real bugs:

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

## Git

Commit and push to the branch named in the task. Keep the rebuilt
`app.bundle.js` in the same commit as the `src/` change that produced it,
otherwise the running application and the source disagree.
