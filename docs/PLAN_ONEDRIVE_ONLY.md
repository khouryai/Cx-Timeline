# Plan: CX Timeline on OneDrive alone

**Status: saved, not started.** Nothing in this document has been implemented.
It was written on 15 October 2026 so the change can be picked up later, by a
person or a Claude session, without re-deriving it. Read it whole before
starting; the stages are ordered so the live calendar keeps working until the
day you switch.

---

## 1. What this is

Today the application has three parts with three different homes:

| Part | Lives in | Reached through |
|---|---|---|
| The timeline (the plan) | A JSON file in the OneDrive folder | The desktop app, or Edge/Chrome on the website |
| The resource calendar (4WLA, cancellations, huddle, week plan, PTO, TAWR…) | Supabase (Postgres + Storage) | The website, the desktop app, the phone app |
| The application code | Cloudflare (`cx-timeline.aik-khoury.workers.dev`) | Browsers, and the desktop app's updater |

Supabase is not an approved cloud for this data. The goal is to put **all of
the data in OneDrive**, run the application **only as the Windows desktop
app**, and keep only the parts actually used in the daily huddle.

After this change:

- **No Supabase.** No database, no storage buckets, no accounts, no keys.
- **No website.** No Cloudflare deployment, no phone app, no service workers.
- **Two editors:** you and your deputy, taking turns with the same "pen" the
  timeline already uses.
- **The team views, never edits:** they get a read-only OneDrive folder of
  Excel and PDF files, which opens on a laptop or in the OneDrive phone app.
- **Updates are automatic:** push to GitHub → GitHub Actions builds and
  publishes a release → the desktop app finds it on launch, downloads it, and
  restarts on the new version.

## 2. Decisions already made

These were settled in conversation on 13–15 October 2026.

| Question | Answer |
|---|---|
| Where is the 4WLA written? | In the app's editor only. Nothing is imported from BART's workbook. |
| Excel export of the 4WLA? | Kept — it is how the schedule leaves the app. |
| TAWRs? | Kept. |
| SARs? | Dropped. |
| Changes list and edit history? | Both kept. |
| Who edits? | You and your deputy. |
| Who views? | The rest of the team, read-only, through OneDrive. |
| PTO calendar? | Kept, reworked to look like the 4-week calendar. Leave can be entered in either the 4WLA's PTO row or the PTO calendar; both show in both. |
| Daily huddle, week plan, My day, reports, outcome statistics? | Dropped. |
| Phone app? | Dropped. The team uses the published files in the OneDrive app instead. |
| Website? | Dropped. Desktop app only. |
| Updates? | Automatic, from GitHub Releases, on launch, with a restart. |

## 3. What stays, what goes

### 3.1 Kept

| Feature | Modules | Change needed |
|---|---|---|
| **Timeline** (the whole plan side) | `timeline/*`, `core/store`, `core/model`, `core/history`, `core/query`, `core/analysis`, `core/filestore`, `core/folder_rules`, `core/desktop`, `io/*` (plan side), `ui/*` (plan panes) | None, apart from removing the hosted (Supabase) branches — see 3.2 |
| **Look-ahead → timeline suggestions** | `ui/lookahead.js` | Reads the newest reading from the folder; the "progress from the huddle" part (`outcomeProgress()`, `listActuals`) is removed |
| **4-week look-ahead, view and editor** | `ui/rc_lookahead.js`, `ui/rc_la_editor.js`, `ui/rc_la_state.js`, `ui/rc_activity.js`, `core/la_edit.js`, `core/lookahead.js`, `io/lookahead.js` | Data layer only (section 6) |
| **Cancellations** — log, reasons, remove / put back, calendar view, Excel export, BART resources struck out (`X.~WIT`) | `ui/rc_la_cancellations.js`, `core/lookahead.js` (`cancellationEvents`, `supportCancellationEvents`, `attachCancellationNotes`) | The two SQL views behind it are ported to JavaScript (section 6.4) |
| **Changes list** and **Every edit** | `ui/rc_la_changes.js`, `core/la_register.js` | Data layer only |
| **Legend and support codes** | `ui/rc_la_legend.js` | Data layer only. Cannot be dropped: the legend is what says red is a cancellation |
| **Staffing clashes, names suggested from the roster, "why was this cancelled?"** | inside the editor and `core/la_edit.js` | None |
| **Excel export of the 4WLA** | `io/la_xlsx.js`, `io/xlsx_write.js` | None |
| **Printed calendar (PDF)** | `io/rc_pdf.js`, `io/pdf.js` | None |
| **TAWRs** | `ui/rc_tawr.js`, `core/tawr.js`, `io/tawr_pdf.js`, `io/inflate.js` | Data layer; the blank form and signatures move into the folder |
| **PTO calendar** | `ui/rc_pto.js` | Reworked — section 7 |
| **Lists**: people (and their aliases), locations (and aliases), leave kinds, parties | parts of `ui/rc_roster.js` | Cut down to these four lists |
| **Shared helpers** | `ui/rc_util.js`, `ui/rc_table.js` | Lose the week-plan and huddle helpers; keep the look-ahead reading, name register and cancellation rules |
| **Desktop shell** | `src-tauri/`, `tools/desktop.js`, `tools/shell/loader.js` | Update channel moves to GitHub Releases — section 9 |

### 3.2 Removed

**Calendar screens and features**

| Removed | Modules | Notes |
|---|---|---|
| Daily huddle (outcomes, photos, carry-over, digest, run-the-meeting) | `ui/rc_huddle.js` | 1,707 lines |
| Week plan | `ui/rc_week.js` | 1,197 lines |
| My day (what changed for me, Got it) | `ui/rc_myday.js` | |
| Reports and KPIs | `ui/rc_reports.js` | |
| Organisation → Inbox, Accounts, Problems, Settings | `ui/rc_inbox.js`, `ui/rc_settings.js`, most of `ui/rc_roster.js` | The few settings left move onto the Legend page (6.6) |
| Leave requests and approvals | inside `ui/rc_pto.js` | Everyone with the app is an editor, so leave is booked, never requested |
| View as… (preview as somebody else) | `ui/rc.js`, `core/rc.js` | |
| Sign-in, "not on the team", schema banner | `ui/rc_gate.js`, parts of `ui/rc.js` | Replaced by "connect the folder" |
| Reading BART's workbook ("Check now") | the `ingest()` half of `ui/rc_ingest.js` | The publish half stays (6.3) |
| SARs | `ui/rc_la_sars.js` | |
| Blockers, carry chains, plan entries, categories | tables and their screens | Only the week plan and huddle used them |
| "When the sheet moves a task, the task moves" | `applyReassignments()` in `ui/rc_ingest.js` | Moved plan entries; there are none now |
| Client error reports | `rc.reportError()` → console only | |
| Realtime bell, 30-second read memory, `forgetReads`, snapshot compaction RPC | `core/rc.js` | Replaced by the file layer's own rules (6.2) |

**The phone app**

`m/` (page, manifest, service worker, icons), `src/mobile.js`, `src/mobile/*`,
`mobile.bundle.js`, `phone.js`, `tools/pwa_icons.js`, `tools/smoke_mobile.js`,
and the `mobile` entry and its `forbid` list in `tools/build.js`.

**The website**

`.github/workflows/deploy.yml`, `wrangler.jsonc`, `_headers`, `sw.js` (the
site's service worker), the `hosted`, `folder` and `calendar` shapes in
`tools/dist.js` (one desktop shape replaces them), and the Cloudflare project.

**Supabase**

- `vendor/supabase.js`, `src/core/sdk.js`, `src/core/cloud.js`, `src/core/rc.js`
- `src/ui/auth.js` (sign-in, invitations, account block)
- the hosted branches of `src/core/storage.js`, `src/ui/pane_projects.js`,
  `src/ui/shell.js`, `src/main.js`, and `isReadOnly` from `cloud.js` in
  `src/core/store.js`
- `supabase/` (`schema.sql`, `rc_schema.sql`, `migrate.sql`, `test/*`)
- `config.js`'s Supabase fields, the `SUPABASE_*` and `RC_SUPABASE_*` build
  variables and GitHub secrets
- `https://*.supabase.co` and `wss://*.supabase.co` in the desktop window's
  Content-Security-Policy
- `tools/test_sql.js`, `tools/smoke_hosted.js`

Roughly two-thirds of the calendar's code and all of the backend go.

## 4. The OneDrive folders

Two folders, shared differently. The split is what keeps the TAWR signatures,
the blank BART form and the edit log away from the team while still giving them
the schedule.

```
CX/                                  you and your deputy — can edit
  bart-cbtc.json                     the timeline plan             (exists today)
  bart-cbtc.lock.json                who has the timeline's pen    (exists today)
  attachments/                       the plan's attachments        (exists today)

  lookahead/
    calendar.json                    the 4WLA: rows and cells
    calendar.lock.json               who has the calendar's pen
    registers.json                   legend, support codes, people, locations,
                                     aliases, parties, leave kinds, settings
    leave.json                       leave booked in the PTO calendar
    cancellations.json               reasons, and remove / put back
    changes.json                     what moved between readings, and notes on it
    readings/
      index.json                     one line per reading: id, when, who, dates covered
      2026-10-15T14-02-11Z.json      one reading per "Done editing"
    history/
      2026-10.json                   the edit log, one file per month

  tawr/
    requests.json                    every TAWR, draft and approved
    descriptions.json                saved activity descriptions
    profiles.json                    requester details and signature strokes
    settings.json
    template.pdf                     BART's blank form

  _app/                              optional fallback for updates (9.6)

CX Published/                        the team — view only
  4WLA.xlsx                          the existing Excel export
  4WLA.pdf                           the printed calendar
  Cancellations.xlsx                 the cancellation log as a calendar
  PTO.xlsx                           the PTO calendar                     (new export)
  PTO.pdf                                                                 (new export)
  Updated.txt                        when, and by whom, the files were last written
```

**Sharing:** share `CX` with your deputy (Can edit). Share `CX Published` with
the team (Can view). Both of you mark `CX` **Always keep on this device** so the
files are real local files, as `DEPLOY.md` already explains for the plan.

**Why several files rather than one:** OneDrive uploads a whole file every time
it changes. The 4WLA cells change every edit; the lists change rarely; the
history only grows. Keeping them apart keeps each upload small, and one file a
month stops the edit log becoming a file that is rewritten in full forever.

## 5. How the two editors share it

The calendar gets its own pen, exactly like the timeline's (`calendar.lock.json`,
same format, same rules — see "How two people stay out of each other's way" in
`DEPLOY.md`):

- Whoever opens the calendar first has the pen; the other opens read-only and
  is told who has it. Take over is always offered and never refused.
- **Every write is guarded by content, not by OneDrive's timestamps.** The app
  remembers the digest of each file it read and refuses to save over a file
  that has changed since — "reload", never a silent overwrite. This is the rule
  `core/filestore.js` and `src-tauri/src/plan.rs` already apply to the plan; it
  is extended to the calendar's files.
- The timeline and the calendar have separate pens, so you can hold one while
  your deputy holds the other.
- Edit history records **the name set in the app** (the same name the pen
  shows). There are no accounts, so it is a typed name, not a verified one.

What is given up compared with Supabase:

- Two people editing the calendar **at the same moment** is no longer merged
  edit by edit; the second is read-only until they take over. With two editors
  taking turns, this is the normal case anyway.
- "Can only be added to, never edited" (outcomes are gone; cancellation notes
  and the edit log remain) becomes **OneDrive version history**, not a database
  refusing the change.

## 6. The file layer

### 6.1 The approach

Write **one new module, `src/core/rc_files.js`, with the same exported names
`core/rc.js` has for the features kept.** The screens call `rc.listLegend()`,
`rc.applyLookaheadOps()`, `rc.latestSnapshot()` and so on today; if the new
module answers the same calls with the same shapes, the kept screens barely
change. Change their import from `core/rc.js` to `core/rc_files.js` and delete
the calls the removed features made.

Three existing pieces make this smaller than it looks:

- **`tools/lib/rc_stub.js` already re-implements the server logic in
  JavaScript** for the tests: `rc_la_apply` with its version check, `rc_tawr_revise`,
  `rc_cancelled_days`, `rc_cancelled_support_days`, `rc_lookahead_snapshot_meta`.
  Port from it rather than from the SQL where it already exists.
- **`core/filestore.js` already reads and writes guarded files in the folder**,
  in the browser and through Tauri, and owns the pen.
- **`core/la_register.js` (`rowsFrom`, `classify`) and `core/lookahead.js` are
  already pure** — they compute readings, rows and change events with no
  database involved.

Layer rule (for the `CLAUDE.md` layer diagram): `core/rc_files.js →
core/filestore.js · core/lookahead.js`. It must never import a `ui/` module.

### 6.2 What each file holds

Field names are kept identical to today's tables, so the screens and the
importer need no translation.

**`calendar.json`** — the editor's model (today `rc_la_rows` and `rc_la_cells`):

```json
{
  "format": "cx-calendar", "formatVersion": 1,
  "revision": 1234,
  "savedAt": "2026-10-15T14:02:11Z", "savedBy": "Aik",
  "rows":  [{ "id": "…", "kind": "activity", "parent_id": null, "sort": 10, "level": 0,
              "activity_id": "…", "description": "…", "location": "T12", "sswp": "…",
              "party": "…", "work_hours": "…", "absence_kind": null, "archived": false,
              "version": 7, "updated_at": "…", "updated_by": "Aik" }],
  "cells": { "<row id>": { "2026-10-15": { "color": "FF0000", "text": "X.~WIT",
                                           "version": 3, "updated_at": "…", "updated_by": "Aik" } } },
  "pendingHistory": []
}
```

- `revision` replaces `rc_la_revision()`; it rises by one per saved batch.
- `version` on rows and cells is kept, because "Changes say who made them" and
  the editor's history views read it.

**`registers.json`** — the small lists:
`legend` (`id, valid_from, argb, meaning, role, active`), `supportCodes`
(`id, code, name, party, active, sort`), `people` (`id, name, title, subsystem,
active, scheduled, working_days`), `personAliases`, `locations` (`id, name,
code, active`), `locationAliases`, `parties`, `leaveKinds` (`id, name, color,
counts_against_entitlement, active`), and `settings` (6.6).

**`leave.json`** — today's `rc_leave`: `id, person_id, start_date, end_date,
kind_id, status ('approved' | 'cancelled'), start_portion, end_portion, note,
created_at, created_by`. A change is recorded in the edit history like any
other edit.

**`cancellations.json`** — today's `rc_cancellation_notes`: `id, raw_label,
raw_location, start_date, end_date, codes, party, reason, dismissed, author,
created_at, supersedes_id`. Append-only by convention: a correction is a new
entry with `supersedes_id`, exactly as now.

**`readings/<when>.json`** — one reading (today a row of `rc_lookahead_snapshots`
plus its `rc_lookahead_rows`): `id, taken_at, by, hash, legend_at, sheet_name,
grid, rows[]`. **`readings/index.json`** lists `id, taken_at, by, hash,
row_count, cover_from, cover_to` for every reading, so the Changes list and
the cancellation log can choose which readings to open without opening all of
them.

**`changes.json`** — today's `rc_change_events` and `rc_change_annotations`.

**`history/<yyyy-mm>.json`** — today's `rc_la_edits`: `id, at, by, batch,
target, row_id, day, action, before, after`, plus leave and register edits.

**`tawr/*.json`** — today's `rc_tawrs`, `rc_tawr_descriptions`,
`rc_tawr_profiles` (signature strokes stay strokes) and `rc_tawr_settings`.

### 6.3 When things are written

| Moment | Written |
|---|---|
| Every edit in the editor (debounced about 1.5 s, as `PUBLISH_QUIET_MS` does now) | `calendar.json`, then the new history entries into `history/<month>.json` |
| **Done editing**, closing the app, or handing over the pen | a new reading in `readings/`, its line in `readings/index.json`, the change events in `changes.json`, and the files in `CX Published` (section 8) |
| A list changed (legend, codes, people…) | `registers.json` |
| Leave booked, changed or cancelled | `leave.json` |
| A cancellation reason given, removed, put back | `cancellations.json` |
| A TAWR saved, approved, revised | `tawr/requests.json` |

Two things change from today on purpose:

- **A reading is taken on Done editing, not every 2.5 seconds.** The editor
  currently publishes a reading after every pause, because other people were
  reading the database live. Here nobody else reads until the files sync, and
  a reading per pause would fill the folder with files. The edit history keeps
  the fine detail; the Changes list compares sessions.
- **History is written after the calendar, and never lost.** If the history
  write fails, its entries stay in `calendar.json`'s `pendingHistory` and are
  written with the next save.

Old readings are compacted the way `rc_compact_snapshots()` does now: after the
keep period (setting, default 60 days), a reading's `grid` is removed and its
`rows` are kept. Rows, change events and history are never deleted.

### 6.4 Server logic to port into JavaScript

| Today (SQL) | What it does | Port to |
|---|---|---|
| `rc_la_apply(ops)` | applies a batch of editor ops, all or nothing, refusing an op whose expected `version` is stale | `applyLookaheadOps()` — copy the rules from `rc_stub.js`; a stale op still answers "conflict:" so `onConflict()` in the editor is unchanged |
| `rc_la_revision()` | the newest change number | `calendar.json.revision` |
| `rc_lookahead_snapshot_meta` (view) | the reading list without grids | `readings/index.json` |
| `rc_lookahead_cover` (view) | which dates each reading covers | `cover_from` / `cover_to` in the index |
| `rc_cancelled_days` (view) | each day a run of cells is red, by meaning or by `#hex` of a cancellation colour, **kept only if the newest reading covering that date still shows it red** | `cancelledDays()` — port `_daysOver()` from `rc_stub.js`. Open only the readings that are newest for some date: about one per week of the log's span |
| `rc_cancelled_support_days` (view) | a BART code struck out (`~`) on a day that is not itself red | same function, second rule |
| `rc_compact_snapshots()` | drops old editor grids | `compactReadings()`, run at most once a day |
| `rc_tawr_revise(id, …)` | an approved TAWR is final; revising makes a new draft that supersedes it | `reviseTawr()` — copy from `rc_stub.js` |
| `rc_resolve_location(raw)` | folded lookup of a location spelling through the alias register | `resolveLocation()` over `registers.json` |
| `rc_delete_person`, `rc_delete_location`, `rc_delete_legend` | delete if nothing points at it, otherwise retire | the same check over the files: rows, cells, leave, TAWRs, readings |
| Row-level security, roles, `rc_can_act_for()` | who may do what | **gone** — the folder's sharing is the control |

### 6.5 Calls the kept screens make

Taken from the screens as they are now; the new module must answer each.

| Screen | Calls |
|---|---|
| `rc_lookahead.js` | `latestSnapshot`, `listLegend`, `listCancellationNotes`, `isAdmin`, `me`, `reportError` |
| `rc_la_editor.js` | `listLaRows`, `listLaCells`, `applyLookaheadOps`, `lookaheadRevision`, `listLaEdits`, `listLaEditsForRow`, `listLegend`, `listSupportCodes`, `listPeople`, `listPersonAliases`, `listLeave`, `listLeaveKinds`, `listSettings`, `setSetting`, `latestSnapshot`, `listCancellationNotes`, `addCancellationNote`, `compactSnapshots`, `onLookaheadChange`, `lookaheadLive`, `forgetReads`, `ensure`, `isAdmin`, `reportError` |
| `rc_la_cancellations.js` | `listSnapshotMeta`, `listSnapshotRows`, `snapshotById`, `updateLookaheadRowCells`, `addCancellationNote`, `listLegend`, `listSettings`, `isAdmin` |
| `rc_la_changes.js` | `listChangeEvents`, `listAnnotations`, `addAnnotation`, `listLaEditsBetween`, `listLaRows`, `listSnapshotMeta`, `snapshotMetaByIds`, `latestSnapshot`, `listIngestRuns`, `listParties`, `listPeople`, `listLegend` |
| `rc_la_legend.js` | `listLegend`, `addLegend`, `updateLegend`, `deleteLegend`, `listSupportCodes`, `addSupportCode`, `updateSupportCode`, `listSettings`, `setSetting`, `latestSnapshot` |
| `rc_tawr.js` | `listTawrs`, `listTawrsFrom`, `addTawr`, `updateTawr`, `reviseTawr`, `discardTawr`, `listTawrDescriptions`, `addTawrDescription`, `updateTawrDescription`, `deleteTawrDescription`, `listTawrProfiles`, `saveTawrProfile`, `listTawrSettings`, `setTawrSetting`, `downloadTawrTemplate`, `uploadTawrTemplate`, `listLocations`, `listLocationAliases`, `listSupportCodes`, `listLegend`, `latestSnapshot`, `currentUser`, `me`, `isAdmin` |
| `rc_activity.js` | `latestSnapshot`, `listLegend`, `listCancellationNotes`, `isAdmin` |
| `rc_pto.js` | `listLeave`, `addLeave`, `updateLeave`, `listLeaveKinds`, `listPeople`, `listPersonAliases` (request/approve calls removed) |
| `rc_ingest.js` (publish half) | `addSnapshot`, `addSnapshotRows`, `addChangeEvents`, `addIngestRun`, `latestSnapshot`, `listSnapshotRows`, `listLegend`, `resolveLocation` |
| `ui/lookahead.js` (timeline) | `latestSnapshot`, `listLegend`, `listSnapshotMeta`, `lookaheadRowsByIds` |

Simplified answers:

- `isAdmin()` and `canWrite()` → **true while you hold the pen**, false
  otherwise. Every "admin only" check in the kept screens then means "editor".
- `me()` / `currentUser()` → the name set in the app.
- `onLookaheadChange(fn)` → called when the file watcher sees another machine's
  save of `calendar.json` (the timeline already watches its file this way);
  `lookaheadLive()` → false, so the polls behave as they do without Realtime.
- `forgetReads()` → no-op. `reportError()` → `console.warn`.

### 6.6 Settings that remain

| Key | Used for | Where it is set |
|---|---|---|
| `lookahead_title` | the Excel export's title | Legend page (moved from Organisation → Settings) |
| `lookahead_sheet` | the Excel export's sheet name | Legend page |
| `cancellation_log_from` | where the cancellation log starts | Cancellations page |
| `published_folder` | where `CX Published` is (new) | first run, and the Legend page |
| `reading_keep_days` | how long a reading keeps its grid (new, default 60) | Legend page |

`lookahead_source` and `schema_version` are dropped: the editor is the only
source, and the file has its own `formatVersion`.

## 7. The PTO calendar

### 7.1 What exists today

`ui/rc_pto.js` is already a four-week calendar that reads two sources into one
grid: leave **booked** (`rc_leave`, with a kind and a status) and the 4WLA's
**PTO row** (names typed into day cells, derived at paint time). A day only the
4WLA knows can be clicked to book it. Members could request leave and an
administrator approved it.

### 7.2 What it becomes

**It looks like the 4-week calendar.** The same grid the look-ahead draws:

- people down the side, days across, in the look-ahead's week window (the same
  4 / 5 / 6 week choice, `WEEK_CHOICES`)
- the same week headings, weekend shading (`--la-weekend`) and today column
- each day coloured by its leave kind (`leaveKinds.color`), with the kind's
  name in the cell for anyone who cannot rely on colour
- the same totals row idea: how many are off each day

**Two ways in, one picture.**

| Entered in | Stored in | Shows in the PTO calendar | Shows in the 4WLA |
|---|---|---|---|
| The 4WLA's PTO row (type a name into a day) | `calendar.json` (it is a 4WLA cell) | Yes, marked "from the 4WLA" in the cell's corner and title | Yes — it is the row |
| The PTO calendar (click or drag across a person's days, choose the kind) | `leave.json` | Yes | **Yes**: the PTO row draws booked names in grey after the typed ones, read-only, titled "booked in the PTO calendar" |

Neither input is copied into the other: each is stored once and both views read
both. That keeps one record of each day off and avoids two copies drifting
apart.

**Editing from the PTO calendar:**

- **Booked leave** (from `leave.json`): click to change the dates, kind or note,
  or to cancel it (status `cancelled`, kept in the file and the edit history).
- **A day from the 4WLA's PTO row:** the choices are *Book it properly* (adds a
  `leave.json` entry with a kind, today's behaviour) or *Remove from the 4WLA*,
  which takes the name out of that PTO row cell **through the editor's own op**
  (`core/la_edit.js`), so it appears in Every edit and can be undone like any
  other edit.

**Things that read leave keep doing so:** the editor's staffing clash already
counts booked leave and the PTO row (`staffingIssues()`), and keeps working.

**The Excel export for BART:** a setting on the export dialog, *Include leave
booked in the PTO calendar on the PTO row*, default on, merges the two at
export time. The stored 4WLA is never changed by it.

**Leave beyond the look-ahead:** the 4WLA only spans its window, but
`leave.json` takes any dates, so leave booked months ahead is held and appears
when the window reaches it. The PTO calendar can step forward past the
look-ahead window for exactly this.

**Dropped from today's PTO tab:** requesting and approving (everyone with the
app is an editor), and the "Leave requested" badges.

**New exports:** `PTO.xlsx` and `PTO.pdf`, written to `CX Published` on Done
editing and on every leave change, built the same way as the look-ahead's
exports (`io/xlsx_write.js`, `io/rc_pdf.js`).

## 8. Publishing for the team

On **Done editing** in the look-ahead, and on any leave change, the app writes
into `CX Published`:

| File | Built by | Exists today? |
|---|---|---|
| `4WLA.xlsx` | `io/la_xlsx.js` (the existing Excel export) | Yes |
| `4WLA.pdf` | `io/rc_pdf.js` (the existing print) | Yes |
| `Cancellations.xlsx` | `cancellationWorkbook()` | Yes |
| `PTO.xlsx`, `PTO.pdf` | new, same builders | No |
| `Updated.txt` | one line: when, by whom, which reading | No |

Rules:

- Written to a temporary name and then renamed, so the team never opens a
  half-written file.
- If a write fails (the folder is missing, or someone has the file open in
  Excel), the status bar says so once and offers *Try again*; the editor's own
  save is unaffected.
- The published copies are always regenerated from the newest reading, never
  edited.
- The team opens them in Excel, Excel online or the OneDrive phone app. Nobody
  needs the desktop app to view.

## 9. Automatic updates from GitHub

### 9.1 What you will see

1. You push a change to the default branch.
2. GitHub Actions runs the checks, then builds and publishes a release (about
   5 minutes for an app change, about 15 if the Windows shell changed).
3. Next time you or your deputy open the app, it starts on the version it
   already has, checks GitHub in the background, and downloads the new one.
4. If you have nothing unsaved, it says *Updated to 2026.10.15-1402 —
   restarting* and restarts within a couple of seconds. If you are mid-edit,
   the status bar shows *Update ready — Restart* and the update is applied at
   the next launch at the latest. It never restarts under unsaved work.
5. While the app stays open it checks again every four hours.

### 9.2 Two kinds of update, decided automatically

The app is two layers, and they update differently. This split exists today
(`tools/shell/loader.js`) and is kept, because it makes most updates fast and
safe.

| Layer | What it is | Changes when | How it updates | Restart |
|---|---|---|---|---|
| **App kit** | `app.bundle.js`, `calendar.bundle.js`, the stylesheets — everything under `src/` and `css/` | Nearly every push | Downloaded, verified, stored; the window reloads onto it | The window reloads (about a second) |
| **Shell** | the Rust program and installer (`src-tauri/`) | Rarely | Tauri's official updater plugin downloads the signed installer and runs it silently, per-user, no admin rights | The app closes and reopens |

The workflow decides which to publish by looking at what changed: a push that
touches `src-tauri/` also builds a new installer; any other push publishes only
the kit. You do nothing different either way.

The **on-trial rule** stays: a downloaded kit is used only once it has started
successfully (`CX_SHELL.confirmHealthy()`); a kit that cannot start is thrown
away and the previous one runs. One bad push cannot leave both laptops unable
to open the app, and the next good push fixes it.

### 9.3 Where updates come from

The repository is **public**, so GitHub Releases can be downloaded with no
account and no token — nothing secret is shipped in the app.

- **Kit:** a release tagged `kit-<version>` holding `version.json`,
  `payload.json` and `payload.json.sig`, plus a fixed tag `kit-latest` that
  always points at the newest. The app reads
  `https://github.com/khouryai/Cx-Timeline/releases/download/kit-latest/version.json`.
- **Shell:** Tauri's updater manifest `latest.json` plus the signed installer,
  on a release tagged `shell-<version>`, with `shell-latest` the same way.
- `version.json` carries `version`, `builtAt`, `sha` (the commit),
  `minShell` (the oldest shell this kit runs on), and the payload's SHA-256. If
  a kit needs a newer shell, the shell updates first.

**The download is done by the Rust side, not the web page.** GitHub's release
files are served without the headers a web page needs to fetch them, so a
page-side `fetch()` (what `loader.js` does now against Cloudflare) fails. A new
Rust command (`kit_check` / `kit_download`) fetches, verifies and stores the
kit in the app's data folder; `loader.js` reads it from there. A useful side
effect: **the window itself no longer needs any network access**, and its
Content-Security-Policy `connect-src` drops to `'self' ipc: http://ipc.localhost`.

### 9.4 Signing

Every kit and every installer is signed, and the app refuses an unsigned or
wrongly signed one.

- **Kit:** an Ed25519 key pair. The private key is a GitHub Actions secret
  (`KIT_SIGNING_KEY`); the public key is compiled into the shell. The Rust side
  checks the signature before storing anything.
- **Shell:** Tauri's updater key pair (`TAURI_SIGNING_PRIVATE_KEY` and its
  password as secrets; the public key in `tauri.conf.json` under
  `plugins.updater.pubkey`).
- **Keep an offline copy of both private keys.** Losing one means the
  installed apps can no longer accept updates and both of you reinstall by
  hand.

### 9.5 The GitHub workflow

A new `.github/workflows/release.yml` replaces `deploy.yml`, triggered on push
to the default branch:

1. **Checks** — the existing `checks.yml` jobs must pass first (build, lint,
   typecheck, tests).
2. **Kit** (Ubuntu): `npm run build`, then the desktop payload
   (`tools/dist.js`'s desktop output, as `dist/desktop/{version,payload}.json`
   today), sign it, create release `kit-<version>`, move `kit-latest`.
3. **Shell** (Windows, only if `src-tauri/` changed since the last shell
   release): build the installer the way `desktop.yml` does now, sign it,
   publish `shell-<version>` with `latest.json`, move `shell-latest`.
4. Keep the last 20 kit releases and delete older ones, so the releases page
   stays readable.

`desktop.yml` stays for building an installer by hand (first installs).

Version numbers: `YYYY.MM.DD-HHMM` from the commit time, plus the short commit
SHA in `version.json`.

### 9.6 If GitHub is blocked at work

If the work network blocks GitHub downloads, the Rust side also looks in
`CX/_app/` for the same three files. Download them once from the releases page
on any network and drop them in; both machines pick them up from OneDrive. The
newest signed kit from either place wins.

### 9.7 What to ask IT first

- **An installer built by GitHub Actions, not code-signed with a company
  certificate.** Windows SmartScreen warns on first install. If IT requires
  signed installers, they may need to sign it, or provide a certificate the
  workflow can use.
- **The app downloads updates from `github.com`.** It sends no data there — it
  only downloads public, signed files — but some organisations want to know.
- **Data location:** everything is in OneDrive. Nothing is sent anywhere else.

## 10. Stages

Each stage leaves the live calendar working until stage 6. **All new code goes
in behind a new deployment shape, `"deployment": "desktop"` in
`package.json`.** While it says `"calendar"`, the live site and Supabase
calendar run exactly as now. Changing it to `"desktop"` is the switch. This
follows the repo's existing rule that the deployment shape is decided in the
repository, and avoids a long-lived branch.

| Stage | What | Size | You can test it by |
|---|---|---|---|
| 0 | Protect the data, ask IT | Small | Having the export files in hand |
| 1 | The file layer (`core/rc_files.js`) | Large | The new Node tests |
| 2 | The kept screens on the file layer | Medium | Running the desktop app against a copy of the folder |
| 3 | The PTO calendar | Medium | Booking from both sides |
| 4 | Publishing to `CX Published` | Small–medium | Opening the files in Excel and on a phone |
| 5 | Automatic updates from GitHub | Large | Pushing a trivial change and watching both apps update |
| 6 | Import from Supabase, and switch | Medium | Comparing old and new side by side |
| 7 | Remove what is no longer used | Medium | The test suite, slimmed |
| 8 | Docs and tests rewritten | Medium | `CLAUDE.md` matching the code |
| 9 | After a month: delete Supabase and Cloudflare | Small | — |

### Stage 0 — protect the data, ask IT

1. **Fix a gap in the export first.** `exportEverything()` in `core/rc.js`
   does not list `rc_cancellation_notes`, so today's "export everything"
   **would lose every cancellation reason**. Add it to the `tables` list (and
   the cancellation log's own CSV export as a second copy), or run
   `select * from rc_cancellation_notes` in the Supabase SQL editor and save
   the result as JSON.
2. Run the calendar's export everything as an administrator. Keep the JSON.
3. Download BART's blank TAWR form from the private `tawr` bucket.
4. Take one Excel export of the 4WLA and one CSV of the cancellation log —
   these are the "before" pictures for stage 6.
5. Ask IT the questions in 9.7.

### Stage 1 — the file layer

- `src/core/rc_files.js`, as section 6. Port the rules from `tools/lib/rc_stub.js`
  and the SQL.
- Extend the guarded write so it covers the calendar's files:
  `core/filestore.js` (browser and desktop backends) and, for the desktop,
  `src-tauri/src/plan.rs` — a write that takes the digest it expects and
  refuses when the file on disk differs. Add Rust tests next to the existing 33.
- The calendar's pen (`calendar.lock.json`) using the existing lock code.
- **New Node suite, `tools/test_rc_files.js`**:
  - an op batch applies whole or not at all
  - a stale version is refused with "conflict:"
  - the cancellation log matches what the SQL view gives, on the fixtures in
    `rc_stub.js` (same days, same "newest reading covering the date" rule,
    the `#hex` rule, support codes struck out)
  - an approved TAWR cannot be changed, only revised
  - leave from both sources merges into one answer
  - history is never lost when its write fails (`pendingHistory`)
  - a reading's grid is dropped after the keep period and its rows are not

### Stage 2 — the kept screens on the file layer

- Point the kept screens at `core/rc_files.js` when the deployment is
  `"desktop"` (one switch in `ui/rc.js` and `ui/lookahead.js`).
- `ui/rc.js` shows only: **Look-ahead** (Calendar / Edit, Cancellations,
  Changes, Every edit, Legend), **PTO**, **TAWR**, **Lists** (people,
  locations, leave kinds, parties).
- Replace the sign-in door (`rc_gate.js`) with "connect the folder" — the same
  folder the timeline already uses; `lookahead/` is created on first use.
- Readings are taken on Done editing, not after every pause (6.3).
- **Test:** `smoke_calendar.js`, cut down to the kept tabs, run against a fake
  folder instead of the fake Supabase (turn `rc_stub.js` into a folder stub).

### Stage 3 — the PTO calendar

As section 7: the grid restyled to match the look-ahead; booking by click and
drag; the PTO row showing booked names; removing a 4WLA PTO day through an
editor op; the export option; the two new exports.

**Test:** book in each place and see it in both; remove from each place; a
staffing clash with booked leave; the Excel export with the option on and off.

### Stage 4 — publishing

As section 8. **Test:** the files appear after Done editing; a locked
`4WLA.xlsx` (open in Excel) is reported once and does not block saving; the
files open in Excel online and the OneDrive phone app.

### Stage 5 — automatic updates

1. The Rust side: `kit_check`, `kit_download` (with signature check), reading
   the `CX/_app/` fallback, and the Tauri updater plugin for the shell.
2. `tools/shell/loader.js`: read the kit from the Rust side instead of
   fetching it; the restart rule from 9.1; the four-hour check.
3. The signing keys, as GitHub secrets.
4. `.github/workflows/release.yml`.
5. CSP: remove Cloudflare and Supabase hosts; `connect-src` becomes
   `'self' ipc: http://ipc.localhost`.
6. Build the installer once and **install it on both laptops while the old
   website still exists** — the installed app then follows GitHub from then on.

**Test:** `smoke_desktop.js` extended with a stub release server: a newer kit
is found, verified, stored and started; a wrongly signed kit is refused; a kit
that cannot start is rolled back; no restart while there is unsaved work. Then
for real: push a one-line text change and watch both apps update.

### Stage 6 — import and switch

1. A one-time **Import from the old calendar** in the app (Lists page, shown
   only while the folder's `lookahead/` is empty): reads the stage 0 export and
   writes every file in section 4. It keeps every id, so links between rows,
   cells, edits, readings, change events and TAWRs survive. Edit history and
   TAWR authors stored as account ids are mapped to people's names.
2. Copy the TAWR template into `CX/tawr/template.pdf`.
3. **Compare, side by side, with the live site still running:**
   - the 4WLA Excel export from both: read both with `parseSheet()` and compare
     every cell
   - the cancellation log CSV from both: identical
   - the Changes list for the last four weeks
   - the TAWR list and one TAWR PDF from each
   - the PTO calendar for the next eight weeks
4. Set `"deployment": "desktop"` in `package.json`. Push. The release goes out;
   both apps update to the OneDrive version.
5. Share `CX Published` with the team and tell them where it is.

**Way back:** until stage 9, Supabase and the website still exist. Setting
the deployment back to `"calendar"` and pushing returns to the old setup; any
edits made in the folder meanwhile would need re-entering, so decide within
the first few days.

### Stage 7 — remove what is no longer used

Everything in section 3.2: the removed calendar screens, the phone app, the
website files, the Supabase modules, the hosted plan mode, `deploy.yml`,
`wrangler.jsonc`, `sw.js`, `phone.js`, `config.js`'s keys, the `forbid` list,
the old `deployment` shapes in `tools/dist.js`. `npm run build` must report two
bundles (`app.bundle.js`, `calendar.bundle.js`).

**Optional, later:** the File System Access (browser) half of
`core/filestore.js` is only needed if the app is ever run in a browser again.
The tests use it today (`smoke_folder.js` runs in a browser), so remove it only
after moving those tests onto the desktop backend's stub.

### Stage 8 — docs and tests

- Rewrite `CLAUDE.md`: the deployment section (one shape), the layer diagram
  (no `core/cloud`, `core/rc`, `core/sdk`, `mobile/*`; add `core/rc_files`), the
  Supabase traps, the conventions that describe database enforcement (row-level
  security, `(select auth.uid())`, foreign-key indexes, the bell, invitations,
  roles, the phone app), the git section (a push now publishes a release, not a
  website), and the suite table.
- Rewrite `docs/ARCHITECTURE.md` sections to match; keep the reasoning for the
  rules that survive.
- Rewrite `DEPLOY.md` as: share the two folders, install the app, how updates
  arrive, how to rotate signing keys.
- Suites after the change:

  | Suite | Status |
  |---|---|
  | `test_lookahead`, `test_la_edit`, `test_tawr`, `test_folder_rules`, `test_xlsx_compat` | kept unchanged |
  | `smoke`, `smoke_folder`, `smoke_desktop` | kept; `smoke_desktop` gains the update checks |
  | `smoke_calendar`, `smoke_la_editor`, `smoke_tawr` | kept, cut to the kept tabs, on the folder stub |
  | `test_dist` | rewritten: one desktop shape, no Supabase or Cloudflare string in any bundle, the CSP has no network host |
  | `test_rc_files` | new |
  | `test_sql`, `smoke_hosted`, `smoke_mobile` | removed |

### Stage 9 — after a month

- Delete the Supabase project (after one last export, kept with the folder).
- Delete the Cloudflare project and its variables.
- Remove the `SUPABASE_*` and `RC_SUPABASE_*` GitHub secrets.

## 11. Risks and how they are handled

| Risk | Handling |
|---|---|
| You and your deputy both edit within the minute OneDrive takes to sync | The second save is refused with "reload"; nothing is overwritten silently (section 5) |
| OneDrive creates a "conflicted copy" file | The app only reads its own file names; on start it lists any `* (conflicted copy)*` or `*-<PC name>*` files in `lookahead/` and says so once, so they can be checked and deleted |
| `calendar.json` grows large | Only cells with something in them are stored; history and readings are separate files; old readings lose their grids after the keep period |
| A cancellation reason or history entry is edited by hand in the file | OneDrive version history shows and restores it; the app never edits them in place |
| A bad push | The kit is on trial until it starts; a broken one is rolled back automatically, and the next push fixes it |
| Losing a signing key | Offline copy of both keys (9.4); otherwise both laptops reinstall once |
| GitHub blocked at work | `CX/_app/` fallback (9.6) |
| The team opens a published file while it is being written | Written under a temporary name and renamed (section 8) |
| Your deputy's laptop has the old app after the switch | The stage 5 installer is installed on both laptops before the switch; after that, updates are automatic |

## 12. Still to decide when you start

- What IT says about the installer and GitHub downloads (9.7).
- How long readings keep their grids (default 60 days).
- Whether leave booked in the PTO calendar should appear on the PTO row of the
  Excel export sent to BART (default yes, switchable per export).
- How long to keep Supabase after switching (this plan says a month).
- Whether to also drop the browser half of the folder code (stage 7, optional).
