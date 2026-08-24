# Deploying CX Timeline

Three shapes, and this file covers all three. Pick one first:

| | Where the data lives | Accounts | Start at |
|---|---|---|---|
| **Hosted** | Supabase | Yes, invitation only | § 1 below |
| **Shared folder** | A folder you picked, synced by OneDrive or SharePoint | None | *The other deployment*, further down |
| **Desktop app** | The same folder, opened by a Windows application | None | *The desktop application*, at the end |

The last two hold nothing anywhere but your own folder, and the desktop app is
not a separate application — it runs the same code as the deployed site and
picks up a deploy on its next launch.

Everything from here to the divider is the **hosted** shape: Cloudflare for the
site, Supabase for accounts and data. Both free at this size. About twenty
minutes end to end.

You need: a Supabase project and a Cloudflare account. Nothing else — no
server to run, no container, no database to administer.

---

## 1. Supabase — create the project

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Name it, pick a region near your users, and set a database password
   (you will not need it again — save it anyway).
3. Wait for it to finish provisioning.

## 2. Supabase — create the schema

**SQL Editor** → **New query** → paste the whole of
[`supabase/schema.sql`](supabase/schema.sql) → **Run**.

That creates the tables, the three roles, the row-level security policies and
the API. It is idempotent, so you can re-run it after pulling a change.

You should see `Success. No rows returned`. Warnings about triggers or
policies "not existing, skipping" are expected on a first run.

## 3. Supabase — configure auth

**Authentication → Sign In / Providers**:

- **Email** — enabled (it is by default).
- **Confirm email** — your call. On is safer; off is friendlier for a small
  team where you know everyone. With it on, a new user must click a link
  before they can sign in.

**Authentication → URL Configuration**:

- **Site URL** — your deployed URL, e.g.
  `https://cx-timeline.<subdomain>.workers.dev`. Password-reset and
  confirmation links point here, so it has to be right.
- **Redirect URLs** — add the same URL.

> Come back and fix these after step 5, once you know the real URL.

> ### Leave "Allow new users to sign up" **ON**
>
> This looks like the setting that makes the application private. It is not,
> and turning it off breaks the invitation flow — invited people would be
> refused along with everyone else, because Supabase would reject the sign-up
> before the database ever sees it.
>
> Sign-up is closed by a trigger on `auth.users` instead: an account can only
> be created for an address an administrator has invited, and the refusal
> happens in Postgres, so it applies to anyone calling the API directly as
> much as to the sign-in screen. `npm run test:sql` proves it.

## 4. Supabase — collect the two values

**Project Settings → API**:

- **Project URL** → `https://<ref>.supabase.co`
- **anon / public key** → a long `eyJ…` string

The anon key is meant to be public. It identifies the project; it does not
grant access. Every row is behind row-level security tied to the signed-in
user, so on its own it can read nothing. Do **not** use the `service_role`
key — that one bypasses every policy, and it must never reach a browser.

## 5. Cloudflare — deploy

Cloudflare offers two products here and they are easy to mix up. **Workers**
(with static assets) is the current one and is what the dashboard steers you
to; **Pages** is the older one. Either serves this app fine. The repository
carries a [`wrangler.jsonc`](wrangler.jsonc) configured for **Workers**.

### Workers (what the dashboard gives you today)

**Workers & Pages** → **Create** → **Import a repository** → pick this repo.

| Setting | Value |
|---|---|
| Build command | `npm run build:dist` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

**Build variables** (Settings → Build → Variables and Secrets — these are
*build* variables, not runtime ones):

| Name | Value |
|---|---|
| `SUPABASE_URL` | your Project URL |
| `SUPABASE_ANON_KEY` | your anon key |

The build writes these into `config.js`, so the keys live in Cloudflare rather
than in the repository. The build **fails** if they are missing, rather than
publishing a site nobody can sign in to.

> **If the build says `[ERROR] Asset too large`**, wrangler is uploading the
> repository root instead of `dist/` — it generates its own config when it
> cannot find one, and that config points at `.`, which sweeps in
> `node_modules/workerd/bin/workerd` at roughly 60 MB against a 25 MiB limit.
> Make sure `wrangler.jsonc` is committed and that the build command is
> `npm run build:dist`, so `dist/` exists by the time wrangler runs. A correct
> build reads about a dozen files, not a few thousand.

### Pages (the older product)

Build command `npm run build:dist`, output directory `dist`, same two
environment variables. Pages ignores `wrangler.jsonc`.

### The URL

You get `https://<worker>.<subdomain>.workers.dev` (or `<project>.pages.dev`)
free. Go back to step 3 and put it into Supabase, or password resets and
confirmation links will bounce.

### A custom domain

Settings → **Domains & Routes** → **Add** (Workers), or **Custom domains**
(Pages). Free to attach. If you need to *buy* one, Cloudflare Registrar sells
at cost. Add the new domain to Supabase's redirect URLs too.

---

## 6. The first account

Sign-up is invitation-only, which leaves a chicken-and-egg problem: nobody can
be invited until somebody is an administrator. So **the first account ever
created is let in and made an administrator.** After that the door shuts.

1. Open the site and go to `<your-url>/#invite=you@yourcompany.com`.
2. Fill in your name and a password, and create the account.
3. You are now the administrator. Confirm it: **Team & Access** appears in the
   sidebar, under Data.

If you had already created an account before running the invitation part of
the schema, it is not automatically an administrator. Promote it once, in the
SQL editor:

```sql
update public.profiles set is_admin = true where email = 'you@yourcompany.com';
```

## 7. Inviting everyone else

**Team & Access → Invite someone.** You get a link to send them however you
like — Teams, email, a text message. No mail server is involved, which is
deliberate: Supabase's built-in SMTP is rate-limited to a handful of messages
an hour and is not meant for production.

- The link expires in 30 days and works once.
- **Revoke** stops it being used, even if they already have the link.
- Finding the link is not enough on its own: the database checks the address
  against the invitation list, so a shared or guessed URL gets nowhere.

An account on its own sees **nothing**. Access to a plan is separate:

## 8. Check the permissions

1. **Projects → Share**, add a colleague's email as **Viewer**.
2. Have them sign in: they see the plan, a "Read-only" bar, no editing tools,
   and any attempt to change something is refused.

If sharing says *no account for …*, they have been invited but have not yet
set up their account. Sharing grants access to an account that already
exists.

---

## The permission model

| | Viewer | Editor | Owner |
|---|:--:|:--:|:--:|
| Open, browse, export | ● | ● | ● |
| Change the plan | | ● | ● |
| Take backups | | ● | ● |
| Restore a backup | | ● | ● |
| Share, and change roles | | | ● |
| Rename, delete the project | | | ● |

Roles are per project, so the same person can own one plan and merely watch
another.

**Administrator** is separate and deployment-wide: it is the right to invite
people and to appoint other administrators, and nothing else. An
administrator gets no automatic sight of anyone's plans — they have to be
shared like everybody else.

**The rules live in the database, not the interface.** A viewer who opens the
browser console and calls the API directly is refused by Postgres. The
read-only mode in the UI exists to explain the state, not to enforce it —
which is why it is safe for the interface to be the friendly part.

To prove that rather than take it on trust:

```bash
npm run test:sql
```

That stands up a throwaway PostgreSQL, applies the real `schema.sql`, and runs
78 checks that become each user in turn and confirm the database refuses what
it should — including that an uninvited address cannot create an account, that
a used or expired invitation cannot be reused, and that a user cannot make
themselves an administrator. It never touches your Supabase project.

---

# The other deployment: a shared folder, no backend

Everything above puts the data in Supabase. There is a second shape that puts it
in a folder instead — a mapped drive, or one synced by OneDrive or SharePoint —
with **no account, no database and no vendor holding anything**. The site is
static files; the plan is a file on your own disk that your existing folder
permissions and version history already cover.

Choose this when the data cannot leave infrastructure your organisation already
approves, and when two people taking turns is enough.

## What you give up

- **One editor at a time.** Whoever opens the plan first has the pen; the second
  person gets read-only and a banner saying who is in there. It becomes editable
  when they close it.
- **No accounts, so no client access.** External viewers cannot reach a file on
  your internal drive — export a PDF for them instead.
- **Edge or Chrome only.** The API that writes to a folder you picked does not
  exist in Firefox and is partial in Safari. Other browsers keep working, with
  the plan in browser storage and Export → JSON to move it. The desktop
  application at the end of this file has none of these three limits except the
  first — it is one editor at a time as well, but it needs no browser, no
  permission click on launch, and no account.

## Deploying it

**The repository decides the shape, not your CI settings.** `package.json` holds:

```json
"cxTimeline": { "deployment": "folder" }
```

`tools/dist.js` reads it, so **an existing hosted deployment needs no changes at
all** — the same build command and even leftover `SUPABASE_URL` variables produce
a folder build, and the log says the variables were ignored. Set it back to
`"hosted"` to go the other way. This lives in the repo on purpose: a deployment
shape decided by a dashboard setting nobody can see is how you end up with a site
that looks right and quietly saves to the wrong place.

1. Nothing to change in Cloudflare. Your existing build command
   (`npm run build:dist`) now produces the folder build. Locally,
   `npm run build:folder` forces it regardless of what `package.json` says.
2. Tidy up when convenient: delete `SUPABASE_URL` and `SUPABASE_ANON_KEY` from
   the Cloudflare variables — they are inert now, but leaving credentials lying
   around is untidy — and delete the Supabase project once you have exported
   anything you still want from it.
3. Open the site. There is no sign-in — go straight to **Import / export →
   Shared folder → Connect a folder…** and pick the synced folder. If it is
   empty the app offers to write the plan you have open into it; if it already
   holds plans, you choose one.
4. Your colleague opens the same URL and picks the same folder on their machine.

The published site is then about a megabyte of HTML, CSS and one JavaScript
bundle. It talks to nothing — no backend, no CDN, not even a font service — so
the only thing your host ever sees is a request for those files.

Mark the folder **Always keep on this device** in OneDrive, so the plan is a real
local file rather than a placeholder. Edge will ask permission to edit files in
that folder the first time, and again after a browser restart — one click.

## What ends up in the folder

```
bart-cbtc.json         the plan, in the same format Export → JSON writes
bart-cbtc.lock.json    who has the pen, re-stamped every 30 seconds
attachments/           attachment bytes, one file each
```

Nothing proprietary: the plan opens in the importer, reads in a text editor, and
is versioned by whatever the folder is versioned by.

## How two people stay out of each other's way

Set **your name** in the Shared folder pane first — it goes in the lock, so your
colleague sees who has the plan rather than "Someone".

The lock file is a **courtesy** — a synced folder takes seconds to propagate, so
two people opening at the same moment can both think they hold it. The guarantee
is one layer down: every save re-reads the file's size and modified time first
and refuses if either moved. You may be told to reload; you can never silently
overwrite your colleague.

Three things release the pen:

- **Closing the browser and coming back.** The lock records the *browser*, not the
  tab, so a returning session recognises its own lock and takes it straight back.
  No waiting.
- **A crash on the other machine.** No heartbeat for 75 seconds and the lock
  reads as abandoned; the next person to open it simply gets the pen.
- **An hour with no saves.** The holder's session flushes what it has, hands the
  pen back and drops to read-only, so somebody who opened a plan before lunch
  does not hold it all afternoon.

And **taking over is never refused.** If the holder still looks live you are
warned that their unsaved work is at risk, but the decision is yours — the write
guard means the loser of the race is told to reload, not overwritten.

## Your colleague needs the folder *synced*, not opened in a browser

This is the one thing that catches people out. The app writes to a real folder on
the machine, so reaching the files through `onedrive.com` in a browser is not
enough — there is nothing there for a file picker to point at.

On your colleague's machine:

1. Open the shared folder on **onedrive.com** (or the SharePoint library).
2. **Add shortcut to My files** — or, in a SharePoint library, **Sync**.
3. It now appears in **File Explorer** under OneDrive. Right-click it and choose
   **Always keep on this device**, so the plan is a real local file rather than a
   placeholder.
4. In the app, **Connect a folder…** and pick it there.

This needs the OneDrive desktop client, which is on any managed Windows machine
and already signed in. If your organisation blocks syncing shared libraries, file
mode will not work for that person — they would be back to exporting JSON by hand.

## Verifying it on your own machine

`npm run test:folder` covers the lock, the read-only handover and the write
guard against a stubbed folder — 43 checks. It cannot cover the file picker,
because no browser lets a script click its own file dialog. Run these four by
hand once, on the real thing:

1. **Connect and create.** Connect an empty synced folder, accept the suggested
   file name, and confirm the `.json` appears in File Explorer and syncs.
2. **Reconnect.** Close the browser entirely, reopen the site, and confirm one
   click on **Reconnect** in Import / export gets the plan back — no re-picking.
3. **Two machines.** Open the same plan on both. The second should be read-only
   and name the first person. Close the first; within about a minute the second
   should become editable.
4. **An attachment.** Attach a file, then confirm it appears under
   `attachments/` in the folder and opens on the other machine after it syncs.

---

# The third deployment: a folder plan, a hosted calendar

This is the shape to publish when the **team needs to read the resource
calendar in a browser** and the **plan must stay in your folder**. It is not a
compromise between the other two — it is the two halves of the application
having different answers, which is the design.

| | Plan (timeline) | Resource calendar |
|---|---|---|
| Where it lives | Your OneDrive folder | Its own Supabase project |
| Account needed | None | Yes |
| Reachable from a browser | No | Yes |

Your team can never read the plan through the site. A browser only reads a
folder the person at it grants by clicking, and that grant is per browser
profile — so the control is OneDrive's sharing, not the application's. The
Timeline workspace is hidden from read-only accounts anyway, because what they
would otherwise see is the built-in sample plan, and fabricated demo content
mistaken for a real programme is its own small problem.

## 1. A second Supabase project

Create a **new, separate** project — not the timeline's, if you have one. In
its SQL editor run, in order:

1. `supabase/schema.sql` — this shape only needs the `auth` plumbing from it.
2. `supabase/rc_schema.sql` — the calendar itself.

Then Settings → API, and copy **Project URL** and the **anon / public** key.
The anon key is designed to be public: it identifies the project and grants
nothing. Every rule is a row-level security policy tied to the signed-in
account.

## 2. Tell the repository which shape this is

```jsonc
// package.json
"cxTimeline": { "deployment": "calendar" }
```

The answer lives in the repository so it travels with a merge, rather than in a
CI dashboard where getting it wrong produces a site that looks fine.

## 3. Cloudflare — the build variables

Workers → your project → Settings → **Variables and Secrets**, added to the
**build** (not runtime) environment:

| Name | Value |
|---|---|
| `RC_SUPABASE_URL` | `https://<your-project>.supabase.co` |
| `RC_SUPABASE_ANON_KEY` | the anon / public key |

Deliberately **not** `SUPABASE_URL`. That name belongs to the plan and must
stay unset here — two names that cannot be mistaken for one another, because a
plan that quietly acquired a backend is the one failure nobody would notice.
The build refuses to publish if `RC_SUPABASE_URL` is missing, rather than
shipping a site nobody can sign in to.

Build command stays `npm run build:dist`; deploy stays `npx wrangler deploy`.

Locally, the same thing:

```bash
RC_SUPABASE_URL=https://xxxx.supabase.co RC_SUPABASE_ANON_KEY=eyJ... npm run build:calendar
```

## 4. Password-protect the site with Cloudflare Access

Zero Trust → Access → Applications → Add a self-hosted application over your
site's hostname. Free for up to 50 users. Add each team member's email; they
authenticate with a one-time PIN, or your identity provider if one is
connected.

**Add a Bypass policy on the path `/desktop/*`, ordered above the Allow
policy.** The installed desktop application fetches `/desktop/version.json`
with no browser session, so Access would answer it with a login page and the
exe would **stop updating silently and permanently** — the loader correctly
rejects the login page rather than storing it, so nothing breaks loudly enough
to notice. Nothing on that path is secret: it is the same bundle already served
to every browser.

Access controls who can load the page. It does **not** protect the Supabase
API, which is a different origin — row-level security does that. Both are
needed and neither substitutes for the other.

Verify:

```bash
curl -sI https://<your-site>/ | head -1              # should redirect to Access
curl -s  https://<your-site>/desktop/version.json    # must still be JSON
```

If the second one returns HTML, the bypass is missing or ordered below the
Allow policy, and every installed copy has quietly stopped updating.

## 5. Accounts, and what each role sees

Everything here is done from **Organisation → Accounts**, inside the
application. The SQL editor is needed once, to create the first administrator,
and never again.

| Role | Sees | Writes |
|---|---|---|
| `admin` | Everything, including the KPIs and the look-ahead register | Everything |
| `member` | The schedule and what happened | Their own daily outcomes |
| `viewer` | The schedule and what happened | Nothing |

For a read-only team, `viewer`. Promoting somebody later is a dropdown on their
row — no migration, no redeploy. That lets them record **their own outcomes**.
It does not let them set next week's tasks: the plan is admin-insert-only,
because a plan that changed the evening before is delay evidence and the
supersede chain assumes one author.

### The first administrator

Sign-up is closed: a trigger on `auth.users` refuses any address nobody
invited. That leaves the usual chicken and egg, and the same answer as the
timeline's — **the first account in an empty project is let through**, and the
roster row it lands on is the one to make an administrator:

```sql
-- after signing up once, in the SQL editor
update public.rc_people set role = 'admin' where email = 'you@example.com';
```

Supabase's own **Authentication → Sign In / Providers → Allow new users to sign
up** must stay **on**. Turning it off rejects invited people too, before the
trigger ever runs.

### Adding everybody else

**Organisation → Accounts → Invite somebody.** Give the address, the role, and
optionally the roster row it belongs to. Nothing is emailed from here — send
them the sign-up link yourself, or invite the same address from Supabase →
Authentication → Users → Invite if you would rather it came from there. Either
way the invitation row is what decides whether the sign-up is allowed, so both
routes end in the same place.

When they sign up, the account attaches to the roster row the invitation named,
with the role it carried. They are on the team before they first open the page.

Three things worth knowing:

- **An invitation lapses after thirty days.** An expired one shows as expired
  with a **Send again** button, which reopens it.
- **Somebody who signed up before their roster row existed** is joined up with
  **Link account** on their row.
- **The last administrator cannot be demoted.** The role dropdown refuses it
  out loud, because a refused UPDATE matches nothing and reports success — and
  a demotion that left nobody able to administer anything would be a trip back
  to the SQL editor.

### If you also run the timeline in this project

`schema.sql` and `rc_schema.sql` each install a sign-up gate, and they claim
the same trigger. Applying them **in the order above** leaves the calendar's
version installed, which accepts an invitation from *either* register — so
timeline invitations and calendar invitations both work.

Re-running `schema.sql` afterwards puts the timeline-only gate back, and every
address invited from Organisation → Accounts would then be refused. If you ever
re-run it, re-run `rc_schema.sql` after it.

---

# The desktop application

The same file mode, as a Windows application instead of a browser tab. Nothing
about where the data lives changes — it is still a JSON file in your synced
folder, still no account, still no vendor holding anything. What changes is the
friction:

| | In Edge | In the desktop app |
|---|---|---|
| Opening your plan | Reconnect the folder, one click, after every browser restart | Opens on launch, no prompt ever |
| Who has the pen | Told after the canvas has drawn | A dialog **before** anything is drawn |
| Writing the file | Truncate, then write | Written beside the target and renamed over it, so a sync client never reads a half-written plan |
| Getting a new version | Refresh | Picked up on the next launch, automatically |

## Installing it without administrative rights

The installer is built **per-user**: it writes to your own
`%LOCALAPPDATA%\Programs`, creates a Start-menu entry for you, and touches
nothing that needs an administrator. There is no service, no driver and no
registry work outside your own profile.

That is the part I can control. The part I cannot is your organisation's
software policy: an unsigned executable may still be stopped by SmartScreen
("More info → Run anyway" clears it) or blocked outright by AppLocker or
Defender Application Control, and neither of those has a way round that does not
involve IT. If it is blocked, the deployed site in Edge remains the fallback and
does the same job with the extra click on launch.

If your organisation will sign it, that is a certificate in the repository
secrets and two lines in `tauri.conf.json` — worth asking for, because it also
removes the SmartScreen warning for your colleague.

## Building the installer

You do not need a Windows machine or a toolchain: GitHub builds it.

1. **Actions → Desktop app → Run workflow.**
2. When it finishes, download the **cx-timeline-windows** artifact. It holds two
   installers — take the `.exe` (per-user, no admin) unless you specifically want
   the `.msi`.
3. Run it. That is the whole install.

Tagging a release (`git tag v1.0.1 && git push --tags`) does the same and attaches
both installers to the GitHub release, so "send me the installer" is a link.

Locally, on a Windows machine with Rust installed:

```bash
npm run desktop            # build and run it, for development
npm run desktop:installer  # produce the installers in src-tauri/target/release/bundle/
```

## Updating it — deploy the site, that is all

**A change to the application does not need a new installer.** The window loads a
local page which runs the newest copy of the application that machine has, and
checks the deployment in the background for a newer one:

1. You push to the default branch; Cloudflare rebuilds and publishes as usual.
   The build now also writes `desktop/version.json` and `desktop/payload.json`
   next to the site.
2. The next time anyone opens the application, it notices, downloads it in the
   background, and says *"Version x.y.z is ready — close CX Timeline and open it
   again."*
3. They restart it. That is the update.

Three deliberate properties, because this runs unattended on somebody else's
laptop:

- **Launch never waits on the network.** The copy already on the machine starts
  immediately; the check happens afterwards. On a plane, or behind a proxy that
  blocks the site, it opens exactly as fast and simply does not update.
- **Nothing changes mid-session.** A new version is used from the next launch, so
  the document and the interface are never two different versions of the app.
- **A bad deploy cannot brick it.** A downloaded copy is on trial until it has
  booted once. If it throws, the window rolls back and reloads on the spot; if it
  silently never comes up, the next launch throws it away. Either way the copy
  inside the installer is still there.

Rebuild the installer only when the Rust side (`src-tauri/`) changes — the folder
handling, the lock, the window itself. Changes under `src/` and `css/` reach
everybody through a deploy.

**The channel is `package.json → cxTimeline.updateChannel`.** If you move the site
to a different host, change it there and cut one new installer; the CSP in
`src-tauri/tauri.conf.json` names the same host and is the only one the window may
reach at all, so both have to move together.

## First run

1. Open it. It has no folder yet, so it starts on a sample plan.
2. **Import / export → Shared folder → Connect a folder…** and pick your synced
   folder. Windows' own folder picker opens — no permission prompt.
3. From then on it opens straight into that plan on every launch.

Your colleague does the same on their machine, against the same synced folder.
They still need the folder **synced into File Explorer**, exactly as described
above — the desktop app reads a real path, so a browser tab on `onedrive.com` is
no more use to it than it is to Edge.

## The pen, on the desktop

The rules are the same as in the browser — one editor, a courtesy lock, and the
write guard as the real protection. What the desktop build adds is that it reads
the lock file *before the window exists*, so:

- If your colleague has the plan open, the first thing you see is a dialog naming
  them and how long since they last saved, with **Open read-only** and **Take over
  editing**. No canvas draws and then gets walked back.
- The window title carries it too — `bart-cbtc.json — read-only, Dana has it` —
  so the state is legible from the taskbar.
- If their session was left open and died, you are told the pen is yours and whose
  name was on it, rather than nothing at all.
- Taking over is still never refused, and whoever saves second is still told to
  reload rather than overwritten.

## Verifying the desktop build

`npm run test:desktop` (48 checks) and `npm run test:rust` (13) cover the shell,
the update path including both ways a bad download can fail, and every rule about
locks and refused writes. Three things need a real Windows machine:

1. **The installer.** It runs without an administrator prompt, and the app appears
   in the Start menu.
2. **The folder picker,** and that the plan opens by itself on the second launch.
3. **Two machines.** Open the plan on both: the second gets the up-front dialog
   naming the first. Close the first; the second becomes editable within about a
   minute.

---

## Running it afterwards

```bash
npm run build:dist   # a hosted deployment; fails without a backend configured
npm run build:folder # a folder deployment, plus the desktop update channel
npm run build:desktop# assemble dist-desktop/, the frontend inside the installer
npm test             # local UI, shared folder, desktop shell, hosted UI, permissions
npm run test:rust    # the plan and lock rules; needs no webview and no display
npm run serve        # http://localhost:8123, using config.js as committed
```

Every push to the default branch redeploys. Other branches get a preview URL,
which shares the same Supabase project — so a preview build writes to real
data. Use a second Supabase project for previews if that matters to you.

## Costs

Free at this scale, and the ceilings are generous:

- **Cloudflare** — unlimited bandwidth; 100,000 Worker requests/day on the
  free plan, which static assets served from cache barely touch.
- **Supabase free tier** — 500 MB database, 1 GB file storage, 50,000 monthly
  active users. A programme plan is a few hundred kilobytes; attachments are
  what will eventually push you over, and they are stored outside the
  document precisely so that stays predictable.

A free Supabase project **pauses after a week with no traffic**. It comes back
on the next request, but the first person in that morning waits a few seconds.
Paid plans do not pause.

## Backups

Every backup is a row in `project_backups`, so they survive a lost laptop.
Retention is per project (**Settings → Backups**), and the server prunes to it.

That is *your* backup of a plan's history — not a backup of the database. For
that, Supabase takes daily snapshots on paid plans; on the free tier, export
what you care about (**Import / Export → JSON**) or run `pg_dump` on a
schedule.
