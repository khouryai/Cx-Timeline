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
- **Derived state is never stored.** Violations, critical path and float are
  computed from the document, so they appear and clear on their own. Do not
  add a `violated` field to a link — there is nothing to keep in step.
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
  `ui/panels.js`, and to `NAV` in `ui/shell.js`.
- **A new editable list**: add the seed to `DEFAULT_LISTS` and an entry to
  `LIST_DEFS` in `core/model.js` saying where its values live on an object —
  `field` (a top-level property), `dataKeys` (inside `data`) or `styleKey`
  (inside `style`). Usage counting, deletion-with-reassign, the manager tab
  and the Dropdown Lists pane all follow from that one entry.
- **A new export format**: consume the scene from `io/scene.js` rather than
  re-walking the document — that is what keeps every export agreeing with
  every other.
- **Schema changes**: bump `SCHEMA_VERSION` in `core/model.js` and append a
  step to `MIGRATIONS`. Never delete a migration step; old files must always
  be able to walk forward. A new top-level key also needs adding to
  `COLLECTIONS` or `FIELDS` in `core/history.js`, or edits to it will not be
  undoable — they will not even register as a change.

## Verify after changes

```bash
npm run build                        # must succeed — it also lints the module graph
npm test                             # all three suites, must exit 0

node tools/smoke.js                  # 144 checks — the application, local mode
node tools/smoke_hosted.js           #  49 checks — sign-in, invites, read-only
node tools/test_sql.js               #  78 checks — the permission model
node tools/smoke.js --shot out.png   # …and eyeball the result
```

`smoke.js` boots the real application in Chromium and checks rendering,
selection, typing into panel fields without losing focus, snapping, undo/redo,
zoom, the dropdown vocabularies, filter dim/hide, baseline comparison, all
seventeen dock panes, all five themes, every exporter (including PDF header
validation) and reload persistence. **Any console error fails the run.**

`smoke_hosted.js` boots it with a configured backend and a stubbed client, so
the gate, invitations, sharing and read-only mode are covered without a
network or an account. `test_sql.js` stands up a throwaway PostgreSQL, applies
the real `schema.sql` against a stub of what Supabase provides, and becomes
each user in turn; it never touches a real project.

Two traps worth knowing, both of which have caused real bugs:

- **Panels must not rebuild while a text field in them has focus.** They write
  to the store on every keystroke, and the resulting `doc:changed` would
  replace the input under the caret. `inspector.js` and `panels.js` each guard
  this and defer the rebuild until focus leaves.
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
