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

### Layers

```
core/util · core/events · core/dates      leaves — import nothing
core/cloud                                the only module that knows Supabase
core/rc                                   the resource calendar's *separate*
                                          Supabase client — the plan's path
                                          never imports it
core/desktop                              the only module that knows Tauri
core/filestore → core/desktop             the only module that knows the File
                                          System Access API, and the only caller
                                          of the desktop bridge
core/model → core/query · core/history · core/analysis
core/store → core/storage · core/filestore   (only to ask whether a colleague
                                              holds the pen — a read-only
                                              session refuses edits at the
                                              store, not only in the CSS)
timeline/viewport → timeline/layout → timeline/connectors
                  → timeline/renderer → timeline/interactions
ui/icons · ui/components → ui/lists · ui/auth → ui/theme → ui/commands
ui/workspace → ui/rc → ui/rc_roster · ui/rc_huddle · ui/rc_lookahead
             · ui/rc_reports → ui/rc_util   (the second interface)
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
- **Baseline comparison draws five things, not one** (`renderBaseline`): the
  ghost at the baseline dates behind the live bar, an arrow between the two
  finish edges labelled in days, the reason someone typed into the striped
  area, outlines for objects the baseline had and the plan no longer does, and
  a banner naming the baseline. `io/scene.js` draws the same, so an exported
  PDF is the drawing on screen. All of it but the reason is derived per frame
  from the snapshot — there is no comparison state to go stale.
- **A note written on an object is shown on the timeline.** Writing one *is*
  the request to see it: `data.showNotes` is only ever `false`, set by the
  switch in the inspector's Notes section, and `settings.showNotes` hides the
  lot at once. Read it with `visibleNote(obj)`, which answers the words or ''.
  It is timeline text like any other — measured by `measureNote()`, packed with
  its object, drawn whole over as many lines as it takes, and printed by
  `io/scene.js`. It is never shortened: a note too long for its row is a note
  to switch off, which is what the switch is for. It shares the band below the
  row with the comparison, in a fixed order set by `bottomTier()` — the note
  first, then a stacked ghost, then the reason on that ghost — so each object
  knows which floor it is standing on.
- **The reason a bar moved is the one part of a comparison that is stored.**
  Everything else about a baseline is derived; why it slipped cannot be, so it
  lives on the object in `data.delayReasons`, keyed by baseline id — a plan is
  compared against several, and the answer differs per baseline. Read it with
  `delayReason(obj, baselineId)`, write it with `store.setDelayReason()`, which
  deletes the key rather than storing `''` so an un-annotated object and a
  cleared one serialise the same. It is typed into the striped area on the
  canvas (`interactions.js` opens a field over the ghost, and selects the
  object so the inspector shows the rest of the activity), edited again in the
  inspector's Baseline section, and it travels into `compareBaseline()` rows,
  the variance CSV and the exported drawing. The P6 baselines keep fixed ids
  (`bl_p6_baseline` / `bl_p6_progress`), which is what lets a reason survive
  the next import re-creating them.
- **A ghost is packed, not painted over.** `computeLayout()` measures the
  comparison with the objects (`measureGhost`, `measureGone`) and `packRows()`
  reserves the whole pair — bar, label, ghost, the arrow's day badge and the
  reason note — so a ghost can never land on another bar or on another ghost;
  the lane reflows instead. The reason is measured like every other label
  (`measureReason`): it sits inside the striped area when the whole sentence
  fits on one line there, and otherwise wraps into the band `ghostTier()`
  reserves along the bottom of the row, which is the same band a stacked ghost
  drops into. Row height is content plus tier, never the larger of the two. Where a ghost covers the same dates as its *own* bar the two cannot
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
- **A hidden dependency line is a choice that does not survive going wrong.**
  `link.hidden` is real, stored intent — unlike `violated`, nothing can derive
  it — but it is not durable: `installHiddenLinkGuard()` in `main.js` watches
  every settled `DOC_CHANGED`/`DOC_REPLACED` and clears it the moment
  `linkViolations()` says that link is broken, through `store.revealBrokenLinks()`
  so undo still walks back through it like any other edit. The renderer
  (`timeline/renderer.js`) and the exported drawing (`io/scene.js`) both apply
  the same live override — hidden-but-violated still draws — so a line breaking
  mid-drag reappears before the guard ever gets a settled document to react to.
  `toggleLinkHidden()` in `ui/commands.js` refuses to hide a link that is
  already violated, for the same reason: it would just be cleared straight
  back. This is why "hidden" always means "hidden right now, on purpose," never
  "was hidden once."
- **A pair of objects may carry several dependencies — one per type.** The four
  relationships are the four pairs of edges, so a drag names its own type:
  `dropSide()` reads which end of the target the pointer is over and
  `linkTypeBetween()` turns the two edges into FS/SS/FF/SF. `addLink()` refuses
  only the *same* relationship twice (and `updateLink()` refuses retyping onto
  one), because that is the only case that would draw one line exactly on top
  of another. The connector layer paints above the bars, so a dependency
  already drawn out of an anchor lies over it: `anchorUnder()` is why a press
  there still starts a new drag instead of selecting the line — without it, the
  first link out of an edge would block every later one.
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
  **The lock is courtesy, the write guard is the control**: `savePlan()` checks
  that the plan on disk is still the one it last saw and refuses otherwise, so
  a colleague's save can never be silently overwritten even when the pen has
  not synced yet.
- **A file moving is not a plan changing, and only the second is worth saying.**
  Size and modified time answer "did the file move", which a sync client makes
  it do without anybody touching the plan — so the stamp carries a digest of
  the document as well (`fingerprint()`, which leaves out the `exported` block
  because it holds the time of the save). Metadata is still the cheap first
  question and decides whether the file is read at all; nothing is announced,
  and no save is refused, until the *content* turns out to differ. A file caught
  mid-sync does not parse, and `fingerprint()` answers null — which means "ask
  again", never "a new version". Everything unbearable about working alongside
  a colleague came from answering the first question and reporting it as the
  second: a save refused over a file nobody had edited, and a dialog every
  twelve seconds about a version that did not exist. `reconcile()` is the single
  place that decides, so the poll and a refused save cannot disagree, and
  announcing is the *caller's* job — which is what stops one fact being
  reported twice in two different sentences.
- **Say it once, in the status bar, without taking the keyboard.** A colleague's
  save is not an error and not urgent, and it arrives while somebody is typing.
  `filestore` emits `FILE_EXTERNAL_CHANGE` once per distinct version and holds
  the rest in `state().behind`, so the interface can stand a notice up (with a
  Reload button) and leave the standing fact to the status bar. A reader who has
  changed nothing gets neither: their colleague's version simply arrives.
- **Two windows of one install are one machine.** The claim file is keyed on the
  device, so both windows read back a claim they recognise as their own and both
  concluded they were the editor — then took turns being refused by the write
  guard. `otherWindow()` tells a live sibling window from this device's own
  abandoned claim by its beat, strictly, because our own claim file is read off
  our own disk and no sync delayed it; the second window defers, and stops
  writing the claim so the first window's statement of it stands. `takeOver()`
  still works from either. **Nobody writes anybody else's file.** Each
  session states its own claim in `<plan>.pen-<device>.json` and restates it on
  every heartbeat — readers included, so the turn passes to whoever has waited
  longest the moment a holder leaves — and who holds the pen is a *reading* of
  all the claims (`penHolder()`: earliest live claim, an explicit `takeover`
  outranking it, device id breaking an exact tie). `plan.rs` makes the identical
  reading in `pen_holder()`, because the shell announces a holder before the
  window opens and the application must not then announce a different one. This
  replaced a single `<plan>.lock.json` that every holder rewrote every twenty
  seconds: OneDrive cannot merge two versions of one file, so with two machines
  open each mostly read back **its own** stamp, each concluded the pen was
  theirs, and both edited all afternoon. That file is still *read* — an
  un-updated copy still writes it — and the holder still stamps it for those
  copies, but nothing relies on it. A claim is keyed on a **device** id kept in
  localStorage, not the per-load tab id — with the tab id, closing the browser
  and reopening it left you locked out of your own plan until the claim went
  stale. And `takeOver()` never refuses: refusing left "I know that session is
  dead" with nowhere to go, and the write guard already means the loser of a
  race is told rather than overwritten. Warning the user is `ui/commands.js`'s
  job; deciding for them is not the store's. **A sync client leaves copies of the
  lock behind, and they are not plans**: OneDrive cannot merge two edits of one
  file, so it keeps both and appends the machine name
  (`plan.lock-HRUSPITLT02820.json`, then `-2`, `-3`). `isLockFile()` in
  `filestore.js` and `is_lock_name()` in `plan.rs` are the same rule in both
  languages — the separator test after `.lock` is what keeps a plan called
  `lockheed.json` out of it — and the pen holder sweeps the copies away
  (`sweepLockLitter()`) on open, every fifth minute and on the way out. Never
  delete a bare `<plan>.lock.json`: it may be somebody's. And **a directory handle only survives a
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
- **The desktop build has no backend for the plan, and may have one for the
  calendar.** Those are two different sentences and `tools/desktop.js` keeps
  them apart the way `tools/dist.js` does: `supabaseUrl` is written blank in
  every desktop shape, and `rcSupabaseUrl` is filled only when
  `RC_SUPABASE_URL` and `RC_SUPABASE_ANON_KEY` are in the build environment —
  in which case the vendored client is shipped and its script tag kept, and
  otherwise both are stripped. Missing keys are **not** an error here, unlike a
  calendar *site*: a desktop build without them is what shipped for a year and
  does the thing the installer is for. What is refused is an installer whose
  own window would reject the host it is about to call — `cspAllows()` compares
  the configured origin against `app.security.csp` in `tauri.conf.json`, which
  is committed and cannot read a build variable, because that failure is
  otherwise silent: the window opens, signs in, and fails on a network error
  nobody can place. And `config.js` and `vendor/` ride in the **installer**,
  never in the update payload — a deployment that could rewrite the config on
  an installed machine could give the plan a backend from a thousand miles
  away, which is what every other rule here exists to prevent.
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
- **The published assets are named after their contents; the repository's are
  not.** `fingerprint()` in `tools/dist.js` renames `app.bundle.js` and each
  stylesheet to `app.<hash>.js` at publish time, rewrites `index.html`, and
  marks them `immutable` — so a repeat visit downloads `index.html` and
  `config.js` and nothing else, where it used to pay 328 kB for the bundle
  every time because the name never changed and the policy therefore had to say
  `no-cache`. It happens only in `dist/`: the committed `index.html` still says
  `app.bundle.js`, which is what makes double-clicking it work with no server
  and what the desktop shell falls back to from its own folder. The desktop
  payload is built from the repository rather than from `dist/`, so renaming
  the published copy cannot reach it.
- **A download is the one action with no visible result, so it says so.** The
  file lands somewhere the page cannot see, and exporting the same drawing
  twice looks exactly like exporting it never. Every export goes through
  `saveFile()` in `io/exporters.js`, which builds the Blob once, hands it to
  `download()` and raises the toast naming the file and its size — never call
  `download()` from a new exporter. The two downloads outside that module (a
  backup, an attachment) announce themselves at their own call site. Announce
  only a file that exists: the PDF dialog used to toast beside the exporter and
  so claimed success for an export that had thrown.
- **The resource calendar is a second module, not a second product.** It is a
  peer of the timeline canvas (`#rc-frame` beside `#canvas-frame`, switched by
  `ui/workspace.js`), over a *relational* Supabase schema (`supabase/rc_schema.sql`)
  rather than the one-JSON-document model the plan uses — because its reports
  answer arbitrary date ranges and two people edit it at once. It reuses the
  themes, the tokens, `ui/components.js` and `saveFile()`; if you find yourself
  writing a second toast system or a second palette, stop.
  **The timeline is hidden on a switch, never unmounted** — `renderer.mount()`
  clears its host, so tearing it down would throw away the viewport, the
  selection and the render caches. And it is **built on first use, after
  `CX_SHELL.confirmHealthy()`**: a module that needs a network in front of the
  desktop trial gate would make an unreachable backend look exactly like a
  broken update and get itself rolled back.
- **The meeting can be run rather than filled in, and both are one path.**
  The table is a form for whoever holds the keyboard; presenter mode
  (`presenter()` in `ui/rc_huddle.js`) is the same day drawn for the room — one
  person, the question asked in the words somebody would use, a context strip
  of what the room needs rather than what the person needs. It opens on the
  first person still to answer, and every write goes through `statusButtons()`,
  so there is one recording path and not two that can disagree on screen. The
  table, the meeting and the digest are handed *one* `ctx` for the same reason.
- **Pressing a status is the record; the line that follows is the detail.**
  A completed task stays one click — there is nothing left to say about it —
  and everything else gives way to `sayMore()`: what is left, pre-filled with
  the plan text so it is an edit rather than a retype, and a photograph. Every
  way out of that strip writes the outcome, Escape and walking away to the next
  person included. That is the opposite of a dialog, deliberately: the one
  thing a huddle cannot afford is an outcome that looks recorded and is not.
- **A photograph goes up before the row, never after.** `rc_actuals` has no
  UPDATE grant, so a path attached afterwards would need a second row
  superseding the first. The picture is uploaded under the `client_uuid` the
  row is about to carry — which is generated on the client precisely so it
  exists before the insert — and an upload that fails is said out loud while
  the outcome is still recorded. Losing what somebody said because a photograph
  did not upload would be the wrong way round. `evidence` is its own bucket,
  readable by anybody signed in: a picture only its author can open is not
  evidence of anything.
- **Who said it and who typed it are different facts.** Most days somebody
  speaks and somebody else enters it, and an outcome attributed to whoever
  typed it is how a record stops being trusted. `outcomeDetail()` shows
  `created_by` only where it differs from the person the outcome is about,
  which is the only case anybody wonders about — and it is one function because
  the table and the meeting must never read differently.
- **The digest carries no rate and no score.** `digestText()` answers the three
  questions a huddle asks — what happened, what is next, what is still in the
  way — as plain text somebody pastes into whatever the project talks in, and
  it names the people nothing was recorded for rather than leaving a gap. KPIs
  are a different audience and a different permission; the moment a digest puts
  a percentage against a name it stops being a summary and becomes a review, in
  a channel the whole project reads.
- **A carry chain has to survive being rolled forward.** The chain is keyed on
  the plan entry a carry came from, and carrying a task into tomorrow makes a
  *new* entry — so without `rc_plan_entries.carry_chain_id` the next carry
  starts a fresh chain and a five-day stuck job reads as five separate failures
  by one person, which is the opposite of what the chain is for. Read it with
  `carryChainFor()`, which answers the entry's existing chain or starts one,
  and `rollForward()` is the single place that writes tomorrow's row — repeating
  a task and carrying one over write the same row, and only the chain tells
  them apart afterwards.
- **A read is only worth taking if the next one is compared to it.**
  `ingest()` writes the snapshot, then `rowsFrom()` turns it into rows keyed by
  week and location, then `classify()` says what moved and the events are
  stored. All three have to happen or the last one is empty by construction —
  which it was: `classify()` was written, tested against hand-made rows, and
  never given any. The derivation lives in `core/lookahead.js` with the alias
  lookup *injected*, so the whole pipeline is testable without a browser or a
  network, and `tools/test_lookahead.js` walks it end to end. What counts as a
  cancellation comes from the legend rather than a constant, so a deployment
  that words it differently does not silently stop producing them.
- **`before` and `after` are jsonb, and two places have to agree on the shape.**
  `sideOf()` writes them and `describe()` reads them; the table has no column
  for a date, so a change to one day carries its own inside the blob. A
  mismatch does not throw — it prints "undefined → undefined" on the one screen
  somebody reads a year later, which is why there is a check that no event
  describes itself with an `undefined` in it.
- **The look-ahead proposes; a person assigns.** It says what is wanted and
  where, and never who — it has no idea who is on the team — so the week plan
  offers its rows on an empty day and the plan entry still names somebody.
  Inventing that would be the guess this module refuses everywhere else. The
  chosen row rides along on `lookahead_row_id`, which is what later lets a
  block be recorded against the row BART themselves scheduled rather than
  against a description somebody typed. `ingest()` writes `rc_lookahead_rows`
  for that join — one row per activity per *week*, with the location resolved
  through the alias register and never parsed out of the description.
- **Being scheduled is a different fact from what somebody may do.**
  `rc_people.scheduled` is what the huddle and the week plan filter on
  (`listPeople({ scheduledOnly: true })`), never the role. A manager
  administers the calendar and is never assigned to a location, but deriving
  that from `role = 'admin'` would drop an administrator who *does* take shifts
  out of the meeting the moment they were promoted, with no way back short of
  demoting them. The column defaults to true for everybody; `rc_schema.sql`
  stands down the administrators that already exist when it is applied, once,
  and the Add-person dialog merely *suggests* the same for a new one.
- **Nothing is emailed from the application, and that is structural.** There is
  no server of its own and a browser cannot send mail, so inviting somebody
  produces a link (`#join=<address>`) to send however you already talk to
  people — which also sidesteps the corporate mail scanner that opens a
  confirmation link before the person does. The link is a convenience, not a
  key: `rc_enforce_invitation()` still refuses an address nobody invited, so a
  forwarded link gets a stranger nowhere. Sign-up itself goes through GoTrue
  rather than PostgREST, which is why the gate is a trigger on `auth.users` and
  not anything `ui/rc.js` does.
- **Adding somebody to the calendar never needs the SQL editor.** Invitations,
  linking an account to a roster row and changing a role are all
  `security definer` functions — `rc_invite`, `rc_revoke_invitation`,
  `rc_list_invitations`, `rc_link_account`, `rc_set_role` — driven from
  Organisation → Accounts. They are functions rather than table writes for the
  reason the whole schema is built on: a refused UPDATE matches nothing and
  reports success, so `rc_set_role` raises instead, and refuses the demotion
  that would leave nobody able to administer anything. Supabase Auth still
  holds the password, and that is deliberate — `auth.uid()` is what every
  policy keys on, so the permission model *is* the authentication and replacing
  it would mean rewriting all of it. What is managed in the application is who
  may have an account and what they may do with it, never the credential.
- **Plan data must never reach Supabase, and that is enforced rather than
  intended.** It used to be structural — the desktop build has no backend at
  all, so it could not have sent anything — and putting a client back in the
  page would have made it a convention. So: a separate config key
  (`rcSupabaseUrl`, never `supabaseUrl`), a separate client module the plan's
  storage path never imports, a separate auth storage key, and
  `tools/smoke_calendar.js`, which edits the plan hard and asserts that nothing
  carrying plan content ever left — through the client *or* over the wire. That
  last check is the one that fails if somebody reaches across; every other
  check would still pass.
- **A blocked day is not an obstacle until somebody owns it.** `rc_actuals`
  says a day was lost and stops there — no owner, no date, no way to ask
  whether it is still true — so the huddle produced a list that only grew, and
  a list that only grows is one nobody reads. `rc_blockers` is raised once and
  never edited; `rc_blocker_updates` is append-only and its latest row is the
  state, read through `rc_blockers_current`. Taking one on, moving the date,
  chasing it and closing it are each a row, because "we told BART on the 4th
  and chased on the 9th" is the sentence a claim is built from and an UPDATE
  would erase every word of it. The owner is picked from **everybody**, not the
  scheduled roster: whoever chases a released possession is usually the manager,
  who is stood down from the meeting precisely because they take no work from
  it.
- **Two families of status, never averaged.** Completed / partial / carried are
  what somebody did; blocked / reassigned are what was done to them. A
  possession released late is not underperformance, and folding it in would
  make the number worse than useless — people would stop saying they were
  blocked. `rc_effort.signal` is where the split lives. Leave is a third thing
  again, which is why `rc_leave` exists: without it, absence gets silently
  distributed across the performance statuses.
- **Evidence is append-only, in the database.** `rc_plan_entries` and
  `rc_actuals` have no UPDATE or DELETE grant, and neither does
  `rc_change_annotations` — a correction is a new row that supersedes the old.
  The revoke has to name `authenticated`, not just `public, anon`: with the
  privilege intact, RLS excludes the row instead, the statement matches nothing
  and the driver reports success, so somebody editing an annotation would be
  told it worked.
- **The look-ahead's window moving is not a change of scope.** A four-week
  window rolls forward, so a week arriving is `window_advanced` and one leaving
  is `window_retired`; both are recorded and both are excluded from the KPIs.
  Counting them would book a batch of phantom scope additions every single week
  and count finished work as deleted scope. `classify()` compares only weeks
  present in *both* snapshots, and derives the window from the data rather than
  from a constant — the file is maintained four to six weeks out.
- **A colour the legend does not know is never guessed.** `applyLegend()` puts
  it in an `unknown` bucket for somebody to map. The legend is stable in
  practice, and relying on that would still be wrong: one stray shade from
  Excel's recent-colours picker would misclassify a shift with nothing on
  screen to show it happened, and the result lands in evidence. Colour resolves
  through all three notations (literal, theme+tint via HLS, legacy indexed) to
  one hex, so the legend is keyed on the colour rather than on how it was
  written — a literal `FFFF00` and an `indexed="13"` are one legend entry. It is
  drawn as unmapped too, not only counted: `.la-day.la-unmapped` hatches the
  cell on the calendar, so a colour nobody has explained is visible on the grid
  rather than in a number at the top of it.
- **The workbook's own key is read once, into an empty register.** BART's
  look-ahead carries a block of rows painted one colour each with a label
  beside them — "Highlight in Orange for Swing Shift" — and `readLegend()` in
  `io/lookahead.js` reads it. That is not the guessing the bullet above
  forbids: it is the authors' sentence off the page, and the swatch, not the
  colour word in the sentence, is what the entry is keyed on. It is adopted
  only when `rc_legend` is **empty**; after that the register is the authority
  and an edit to the spreadsheet cannot silently reinterpret a colour somebody
  mapped by hand. The label lives in a *hidden* column, which is why
  `parseSheet()` keeps hidden-column text as `row.label` — the one thing it
  keeps from a hidden cell, and never a cell of the grid.
- **The date axis is found, never configured.** `readGrid()` in
  `core/lookahead.js` locates the calendar by looking for the row of weekday
  letters, which is the one row on that sheet whose content cannot be mistaken
  for anything else; the day numbers are the row above it and the month band
  the row above that, carried forward across the merge. Everything left of the
  first day column is what the activity *is*. A layout pinned to a column
  letter would be wrong the first time somebody inserted one, and wrong
  silently — the grid would still draw, against the wrong days. No year is
  invented either: the sheet does not carry one, and a date is not something to
  infer from a month name — it is *resolved and then checked*. `datePlease()`
  dates the axis from the snapshot's own timestamp, which narrows the year to
  three candidates, and then picks between them on the workbook's weekday
  letters: the same date is a different weekday in adjacent years, so only one
  candidate makes M, Tu and W land where the file says they do. Below 90%
  agreement no dates are claimed at all and everything that depends on them —
  the today line, the week filters — stands down, because a today line on the
  wrong column is worse than none. Month boundaries come from the day numbers
  rather than the labels (a drop from 30 to 1), which is what recovers a month
  whose label sits in a hidden column.
- **White is not a highlight, and shading is not work.** An explicit white fill
  and no fill at all look identical to anybody reading the sheet, so
  `readFills()` resolves white to no fill — otherwise hundreds of cells land in
  the unmapped bucket asking somebody to explain the absence of a highlight.
  Grey is the harder case and cannot be settled structurally: this look-ahead
  greys most of its calendar for layout, and reading that as work made every
  row look busy on every day. So `rc_legend.role` says what a colour *does* —
  `shift`, `ignore` or `divider` — separately from what it is called, because
  no wording of the meaning fixes it ("not scheduled" is still a meaning). An
  **unmapped** colour counts as a shift on purpose: it might be one, and
  treating the unexplained as ignorable would hide the rows that most need
  looking at. The cost of that is real — with this file's layout grey
  unmapped, a four-week window shows 145 rows instead of 29 — so saying so is
  one click ("Just shading") from the list of unmapped colours, and the strip
  above the grid shows the swatches rather than only a count.
- **A section heading is found structurally, not by its colour.** The shading
  runs along the day columns of every row, so a heading is the row whose
  *activity* cells are painted — `readGrid()` tests that and nothing else. It
  is what lets a title be recognised without anybody having to tell the legend
  which of several near-identical greys is the divider. Rows with nothing
  scheduled are hidden by default and a switch brings them back; only headings
  left *trailing* with nothing under them are dropped, because the workbook
  nests its sections and a heading followed by another heading is usually a
  parent, not an orphan. **Whether a row has anything scheduled is a question
  about the weeks on screen**, so `windowed()` re-derives it after narrowing
  the axis — computing it once across the whole sheet leaves a row painted two
  months ago sitting in a four-week window with nothing in it, which is thirty
  eight rows in this file. Weekends count like any other day: possession work
  lands on them, and two rows here are scheduled on nothing else.
- **The calendar draws the snapshot, not the file.** That is what lets it
  render on a machine that was never granted the folder, which is most of them.
  The legend is re-applied to the stored grid at paint time rather than read
  out of it, so mapping a colour changes the screen at once instead of at the
  next ingest — and `sheet_name` and the legend both come from the database
  (`rc_settings`, `rc_legend`), because a renamed tab must mean a field
  somebody edits, not a redeploy.
- **A plan is revised, never edited.** `rc_supersede_plan()` writes a new row
  pointing at the old one, and `rc_plan_current` is what everything reads — the
  table underneath keeps every version, because "the plan changed the evening
  before the shift" is itself delay evidence. It refuses an entry that has
  already been revised, so two people editing one day get a refusal rather than
  one of them silently winning, and it carries `carry_chain_id` across for the
  same reason rolling a task forward does. A clickable cell in the week plan is
  the only way in, and it shows the history: a revision nobody can see is an
  edit with extra steps.
- **The calendar's data can be taken out whole.** `exportEverything()` reads
  every `rc_*` table *through* the policies rather than around them, so a
  member gets the schedule and an administrator gets the evidence; a table that
  refuses is recorded as refused rather than omitted, because "empty" and "not
  allowed" must not look alike in something somebody may restore from. SAR PDFs
  stay in Storage — they are already files, and a hundred megabytes of base64
  is not a backup anybody would successfully restore.
- **A SAR is recorded, filed and linked in that order, and each step can fail
  alone.** The row first, then the upload, then the move out of `sars/inbox/`:
  a PDF uploaded but not moved is a duplicate somebody can see, while a PDF
  moved before its row existed is a file nobody can find. What a SAR *covers*
  is confirmed by hand from the rows at that location in that week — one SAR
  covering several rows is expected, not an ambiguity — and never matched on
  activity text, which is worded differently on the two sides. Until this was
  wired, `rc_rows_without_sar` reported every row as having no access for ever,
  which is worse than not reporting it at all.
- **The calendar is used standing up, so it stops assuming a wide screen.**
  Below 900px the chrome gives way — the tab row wraps and scrolls, controls
  reach a 34px touch target — and below 620px the huddle stacks into a card per
  person, with `data-label` on each cell carrying the heading the table row
  lost. Nothing else is reshaped: the week plan is seven columns of assignments
  and the look-ahead is a hundred days wide, both already scroll inside their
  own frame, and pretending they fit a phone would be a worse answer than
  letting them scroll. The page itself must never scroll sideways, and there is
  a check for exactly that.
- **New user actions go in `ui/commands.js`**, then get wired to the menu, the
  shortcut and the button. One implementation, three entry points.
- **The filter's text box holds a list, not a phrase.** `textTerms()` in
  `core/query.js` splits it on commas and any term matching is enough — every
  other dimension of the filter narrows, but what people type here is the
  several things they are looking for at once, and asking for all of them in
  one object matches nothing. A term keeps its spaces, so `cable pull` stays
  one phrase. Global search reads its box the same way: within a comma group
  every word must appear, and the best-scoring group ranks the result.
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
- **A duration is counted on a five-day week by default.** `settings.durationUnit`
  (`working` | `calendar`) decides, and the store pushes it into the model with
  `syncDurationBasis()` on every change, the way the dropdown vocabularies are
  pushed — `core/model.js` is below the store and cannot read a setting for
  itself. Only the *counting* changes: dates never move, and the ruler, the
  critical path and slip against a baseline are all untouched. `durationDays()`
  and `endForDuration()` are exact inverses, which is what makes the duration
  field read back what was typed; `addWorkingSpan()` in `core/dates.js` exists
  for that inverse and is deliberately not `addWorkingDays()`, which advances
  *past* n working days and does not measure back to n. `fmtDuration()` divides
  by five in working mode, so ten days read as "2w".
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

## Verify after changes

```bash
npm run build                        # must succeed — it also lints the module graph
npm test                             # all five browser suites plus the SQL one, must exit 0
npm run test:rust                    #  33 checks — the plan, lock and intake rules, in Rust

node tools/test_dist.js              #  41 checks — every deployment shape, and that the
                                     #              plan still has no backend in any of them
node tools/test_lookahead.js         #  57 checks — the parser, the rows it derives and
                                     #              the change events, no browser
node tools/smoke.js                  # 254 checks — the application, local mode
node tools/smoke_calendar.js         # 172 checks — the resource calendar, accounts, the
                                     #              look-ahead grid, and the assertion that
                                     #              plan data never leaves
node tools/smoke_folder.js           #  73 checks — the shared folder, in a browser
node tools/smoke_desktop.js          #  60 checks — the desktop shell and its updates
node tools/smoke_hosted.js           #  49 checks — sign-in, invites, read-only
node tools/test_sql.js               # 244 checks — both permission models, and that
                                     #              supabase/migrate.sql upgrades a project
                                     #              built before any of it
node tools/smoke.js --shot out.png   # …and eyeball the result
```

`smoke.js` boots the real application in Chromium and checks rendering,
selection, typing into panel fields without losing focus, snapping, undo/redo,
zoom, the dropdown vocabularies, filter dim/hide, the predecessor highlight and
its one-shot flash, several dependencies between one pair of bars, baseline
comparison — down to measuring, at five zooms, that no ghost, and no reason
written on one, is drawn over a bar or over another ghost — all seventeen dock panes,
all five themes, every exporter (including PDF header validation) and reload
persistence. **Any console error fails the run.**

`smoke_folder.js` replaces `window.showDirectoryPicker` with an in-memory
folder, so the lock, the read-only handover and the write guard are covered
without a real filesystem — including the cases that made two people at once
unpleasant, which are all about a folder rather than about people: a sync client
touching a file it has just carried, a file caught half-way through arriving,
one version announced once however many times it is looked at, and two windows
of one machine recognising each other. It drives the watcher through
`visibilitychange` rather than waiting out the twelve-second poll. No browser lets a script click its own file dialog,
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
the real `schema.sql` and `rc_schema.sql` against a stub of what Supabase
provides, and becomes each user in turn; it never touches a real project. The
calendar's half of it also *signs people up* — inserting into `auth.users` is
the closest thing to the request GoTrue would serve — because sign-up never
goes through PostgREST and so the interface has no say in who gets an
account.

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

## Git

Commit and push to the branch named in the task. Keep the rebuilt
`app.bundle.js` in the same commit as the `src/` change that produced it,
otherwise the running application and the source disagree.
