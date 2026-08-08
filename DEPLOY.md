# Deploying CX Timeline

Cloudflare for the site, Supabase for accounts and data. Both free at this
size. About twenty minutes end to end.

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
  the plan in browser storage and Export → JSON to move it.

## Deploying it

1. Leave `config.js` blank — no `supabaseUrl`, no key. That makes the entire
   Supabase path inert; there is no gate and no sign-in.
2. `npm run build`, then publish `index.html`, `app.bundle.js`, `config.js`,
   `css/` and `vendor/` anywhere static. `tools/dist.js` deliberately refuses a
   config with no backend, so copy those files directly rather than using it.
3. Open the site, go to **Import / export → Shared folder → Connect a folder…**
   and pick the synced folder. If it is empty the app offers to write the plan
   you have open into it; if it already holds one, it opens it.
4. Your colleague opens the same URL and picks the same folder on their machine.

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

The lock file is a **courtesy** — a synced folder takes seconds to propagate, so
two people opening at the same moment can both think they hold it. The guarantee
is one layer down: every save re-reads the file's size and modified time first
and refuses if either moved. You may be told to reload; you can never silently
overwrite your colleague. An abandoned lock (a closed lid, a crash) goes stale
after two and a half minutes and the next person can take over.

## Verifying it on your own machine

`npm run test:folder` covers the lock, the read-only handover and the write
guard against a stubbed folder — 26 checks. It cannot cover the file picker,
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

## Running it afterwards

```bash
npm run build:dist   # what Cloudflare runs
npm test             # local UI, shared folder, hosted UI, permission model
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
