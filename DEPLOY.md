# Deploying CX Timeline

There is one shape: **the Windows desktop application, with everything in a
OneDrive folder.** The plan (the timeline) is a JSON file in that folder; the
resource calendar — the look-ahead, the cancellation log, Changes, PTO, TAWRs,
P6 links — is a set of JSON files under `calendar/` in the same folder. There
is no server, no database, no account and no website. Who may open the
calendar is who OneDrive lets open the folder.

| | Where it lives | Who may edit | Who may read |
|---|---|---|---|
| The plan | `<plan>.json` in the folder | whoever holds the plan's pen | anyone the folder is shared with |
| The calendar | `calendar/` in the folder | whoever holds the calendar's pen | anyone the folder is shared with |
| The application | the installer, updated from GitHub | — | — |

Sections:

1. [Moving off Supabase — once](#1-moving-off-supabase--once)
2. [Installing it](#2-installing-it)
3. [The folder](#3-the-folder)
4. [Two editors, one pen](#4-two-editors-one-pen)
5. [The team, read-only — or not at all](#5-the-team-read-only--or-not-at-all)
6. [Updating it](#6-updating-it)
7. [Building the installer](#7-building-the-installer)
8. [Backups](#8-backups)
9. [Verifying it](#9-verifying-it)

---

## 1. Moving off Supabase — once

The calendar used to live in Supabase. Its data comes across whole, every id
kept, from the backup the old calendar takes of itself:

1. **On the old site, before anything else**, open the calendar and take
   **Reports → Back it up**. It downloads one `.json` file holding every table
   the calendar kept — readings, edits, cancellation reasons, P6 links, TAWRs
   and BART's blank TAWR form. Keep that file; it is the migration.
2. Install the desktop application (§ 2) and open the shared folder in it.
3. Switch to **Calendar**. The folder has no `calendar/` yet, so it says so and
   offers two buttons. Type your name — as the roster has it — and press
   **Import the old calendar…**, then pick the backup.
4. It shows what is in the file: the row count for each table, what is *not*
   brought across (the huddle, the week plan, SARs, accounts — the parts that
   were removed), and any warning, such as a table that stopped at exactly
   1,000 rows, which would mean the backup was cut short. Press **Import**.
5. Check the look-ahead, the cancellation log and a TAWR against the old site.

Then, when you are satisfied:

- **Supabase**: pause or delete the project. Nothing reads it any more.
- **Cloudflare**: delete the Worker (`cx-timeline`). Nothing deploys to it any
  more — `.github/workflows/deploy.yml` is gone — and the desktop application
  does not fetch from it.
- **GitHub secrets**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `RC_SUPABASE_URL`, `RC_SUPABASE_ANON_KEY` and any `SUPABASE_*` can be removed.
  Nothing uses them.

An installer from before this change carried the Supabase keys and followed the
website for updates; it cannot read a calendar in the folder. Everybody
installs the new one once (§ 2). From then on updates arrive by themselves.

## 2. Installing it

Download the installer from the repository's **Releases** page on GitHub (or
from the **Desktop app** workflow's artifact — § 7) and take the
`…_x64-setup.exe`. It is **per-user**: it writes to your own
`%LOCALAPPDATA%\Programs`, creates a Start-menu entry, and needs no
administrator.

An unsigned executable may be stopped by SmartScreen (*More info → Run anyway*
clears it) or blocked by AppLocker or Defender Application Control, which only
IT can lift. If your organisation will sign it, that is a certificate in the
repository secrets and two lines in `tauri.conf.json`.

**First run.** It has no folder yet, so it opens on a sample plan.
**Import / export → Shared folder → Connect a folder…** and pick the synced
folder; Windows' own picker opens. From then on it opens straight into that
folder on every launch, and the calendar opens from the same folder.

## 3. The folder

The application reads and writes a real path, so the folder has to be **synced
into File Explorer**, not opened on onedrive.com:

1. Open the folder on onedrive.com (or the SharePoint library).
2. **Add shortcut to My files** — or, in a library, **Sync**.
3. In File Explorer, right-click it → **Always keep on this device**, so the
   files are real files rather than placeholders.

What ends up in it:

```
bart-cbtc.json                   the plan, the format Export → JSON writes
bart-cbtc.lock.json, .pen-*.json who has the plan's pen
attachments/                     attachment bytes, one file each
calendar/db.json                 which format the calendar is, and when it was made
calendar/registers.json          people, locations, legend, support codes, parties, settings
calendar/editor.json             the look-ahead as written: rows and cells
calendar/history/<yyyy-mm>.json  every edit, a file per month
calendar/readings/…              each published reading, its rows and its grid
calendar/changes/<yyyy-mm>.json  what moved between readings
calendar/notes.json              why a day was cancelled; notes on changes
calendar/leave.json, p6.json     leave booked; the P6 activity list
calendar/tawr/                   TAWRs, what they are filled from, and BART's blank form
calendar/pen/                    who has the calendar's pen, a file per window
exports/LookAhead_Latest.xlsx    the master export, when one is scheduled
exports/4WLA_Latest.xlsx         the 4WLA in its own layout (Export to Excel's schedule)
exports/4WLA_Latest.pdf          the next four weeks on one A3 page
exports/4WLA_Latest.png          the same four weeks as a picture
```

All of it is plain JSON (and the two workbooks): readable in a text editor,
versioned by whatever versions the folder. OneDrive's own **Version history**
on a file is the first place to look if something was saved wrongly.

The calendar is split into many files because OneDrive uploads a whole file
whenever it changes: the cells change on every edit, the registers rarely, and
history only grows — so they are kept apart, and a reading once written is
never rewritten.

## 4. Two editors, one pen

The plan and the calendar each have a **pen**, and they are separate — you can
hold the calendar while your deputy holds the timeline.

- The first window to open the calendar holds its pen; the header says
  **Editing**. Every other window says **Read only**, names who has it, and
  offers **Take over**. **Hand back** gives it up.
- A window that has written nothing for an hour hands the pen back by itself.
  A window that crashes stops restating its claim, and after four minutes the
  pen is free (a minute, for a window on your own machine).
- The pen is a courtesy; the guarantee is underneath it. Every file is written
  through a guard: if the copy on disk is not the one this window last read —
  another computer's save that OneDrive brought down — the write is refused,
  the file is read again, and the change is taken back out, so what is on
  screen is what is on disk. Nobody is ever silently overwritten.
- A read-only window refreshes from the folder every fifteen seconds, so a
  reader sees the editor's publishes as OneDrive delivers them — usually within
  a minute.

**Set your name** first — the name button in the calendar's header, or *Your
name in the lock* under Import / export; it is one name for both pens. It is what the pen shows, what every edit is stamped
with, and how the calendar knows which roster row is you. Add the spelling to
the person under **Lists → People → Also written as** if it differs.

## 5. The team, read-only — or not at all

The team's access is the folder's sharing, set in OneDrive:

- **Share the folder read-only** with anyone who should see the calendar in the
  application. A read-only OneDrive share cannot write, whatever the
  application thinks — so a reader can never change it, by design or by
  accident.
- **Or give them nothing but the export.** Two exports run on schedules of
  their own, in the application, on your machine, and file into `exports/` in
  the folder — replacing the last each time, so the names never change:
  - **Master export** (on the look-ahead) — `LookAhead_Latest.xlsx`, the whole
    record, a sheet per question.
  - **Export to Excel → 4WLA_Latest** — `4WLA_Latest.xlsx` (the 4WLA in its own
    layout), `4WLA_Latest.pdf` (the next four weeks on one A3 page, as Export
    PDF draws it) and `4WLA_Latest.png` (the same as a picture).

  A Power Automate flow can watch any of them (*When a file is modified* in
  OneDrive for Business) and send it out — the PDF or the PNG is the one to
  attach to an email, since either opens on any phone. Nobody on the team then needs the
  application or the folder at all.

The schedule runs while the application is open on that machine, and a slot
missed while it was closed runs once when it next opens. Its settings are that
computer's, not the folder's.

## 6. Updating it

**A change to the application does not need a new installer.**

1. A push to the default branch runs **Checks**.
2. When Checks passes, **Desktop update** (`.github/workflows/kit.yml`) writes
   the `desktop-kit` branch: `version.json` and `payload.json`, the whole
   application in two files.
3. The next time anyone opens CX Timeline it checks that branch (through
   `raw.githubusercontent.com`, the one host the window may reach), downloads a
   newer copy in the background, and says *"Version … is ready — close CX
   Timeline and open it again."* Opening it again is the update.

Three properties, because this runs unattended on somebody else's laptop:

- **Launch never waits on the network.** The copy already on the machine starts
  at once; the check comes afterwards.
- **Nothing changes mid-session.** A new copy is used from the next launch.
- **A bad update cannot brick it.** A downloaded copy is on trial until it has
  booted once; one that throws, or never comes up, is thrown away and the copy
  inside the installer runs.

A change to `src-tauri/` — a new command the application calls — does need a
new installer. Raise `SHELL` in `tools/desktop.js` in the same commit: the kit
then says which installer it needs, an older one does not run it, and its user
is told to install the new one from GitHub Releases.

## 7. Building the installer

GitHub builds it; you need no Windows machine.

1. **Actions → Desktop app → Run workflow**, or push a tag
   (`git tag v1.0.1 && git push origin v1.0.1`).
2. Download the **cx-timeline-windows** artifact — or, for a tag, find both
   installers attached to that release, which is where a copy that needs a new
   installer sends its user.

Locally, on Windows with Rust installed: `npm run desktop` builds and runs it,
`npm run desktop:installer` produces the installers.

## 8. Backups

- **The folder is the backup's first line.** OneDrive keeps every version of
  every file for 30 days or more; a wrong save is restored from a file's
  Version history.
- **Calendar → Lists → Settings → Back it up** downloads the whole calendar as
  one `.json` — the same format the import reads. Keep one somewhere that is
  not the folder now and then; it is also how a calendar is moved to another
  folder (start the new folder with **Import the old calendar…**).
- The plan keeps its own backups (**Backups** in the dock), in browser storage
  on that machine, and **Import / export → JSON** writes the whole plan.

## 9. Verifying it

```bash
npm run build && npm test   # every suite; must exit 0
npm run test:rust           # the folder, plan and lock rules in Rust
```

`test_rc_db.js` covers the calendar's engine against a folder in memory —
refused writes, two computers, the pen's rules — and `smoke_calendar.js` the
calendar in a browser against a fake folder, including another computer's save
arriving and a takeover. What needs a real Windows machine, once:

1. **The installer** runs with no administrator prompt.
2. **The import**: the old backup comes in, and the look-ahead and the
   cancellation log match the old site.
3. **Two machines on one synced folder.** Open the calendar on both: the second
   is read-only and names the first. Edit and leave Edit on the first; within
   about a minute the second shows the change. Take over on the second; the
   first drops to read-only.
4. **The schedule**: set a master export for a few minutes ahead and see the
   two workbooks land in `exports/` and sync.
