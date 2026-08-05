# CLAUDE.md — project conventions for cx-timeline

## The one rule that bites

`index.html` loads **`app.bundle.js`**, not `src/`. After changing anything
under `src/`, run `npm run build`. The bundle is committed on purpose: it is
what makes double-clicking `index.html` work with no server and no setup.

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
core/model → core/query · core/history · core/analysis
core/store → core/storage
timeline/viewport → timeline/layout → timeline/connectors
                  → timeline/renderer → timeline/interactions
ui/icons · ui/components → ui/theme → ui/commands → ui/dialogs
                                    → ui/panels → ui/shell
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
  undoable and autosaved. Live drag feedback uses `preview()`, and the gesture
  commits once with `edit()` on release — never one `edit()` per mouse-move.
- **New user actions go in `ui/commands.js`**, then get wired to the menu, the
  shortcut and the button. One implementation, three entry points.
- **Dates are UTC-midnight milliseconds internally**, `YYYY-MM-DD` on disk.
  Never call a local-time getter — a calendar date must not shift by a
  timezone.

## Extending it

- **A new object type**: add an entry to `TYPES` in `core/model.js` (label,
  group, icon, shape, whether it has duration, accent, inspector fields). The
  palette, context menus, legend, filters and CSV export all pick it up. Add a
  `build<Shape>` branch in `timeline/renderer.js` only if it needs a new shape.
- **A new dock pane**: add it to `PANES`, `TITLES` and `RENDERERS` in
  `ui/panels.js`, and to `NAV` in `ui/shell.js`.
- **A new export format**: consume the scene from `io/scene.js` rather than
  re-walking the document — that is what keeps every export agreeing with
  every other.
- **Schema changes**: bump `SCHEMA_VERSION` in `core/model.js` and append a
  step to `MIGRATIONS`. Never delete a migration step; old files must always
  be able to walk forward.

## Verify after changes

```bash
npm run build                        # must succeed — it also lints the module graph
node tools/smoke.js                  # 47 end-to-end checks, must exit 0
node tools/smoke.js --shot out.png   # …and eyeball the result
```

The smoke test boots the real application in Chromium and checks rendering,
selection, undo/redo, zoom, all fifteen dock panes, all five themes, every
exporter (including PDF header validation) and reload persistence. **Any
console error fails the run.**

## Git

Commit and push to the branch named in the task. Keep the rebuilt
`app.bundle.js` in the same commit as the `src/` change that produced it,
otherwise the running application and the source disagree.
