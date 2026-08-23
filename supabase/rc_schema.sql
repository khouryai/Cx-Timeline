-- ══════════════════════════════════════════════════════════════════════════
-- Resource Calendar — hosted schema
--
-- Run this in the Supabase SQL editor after `schema.sql`. It is idempotent, so
-- re-running it after an edit is safe.
--
-- This is a *separate module* from the timeline, and the separation is the
-- point rather than an accident of layout. The timeline's plan is proprietary
-- and never leaves its OneDrive folder; everything here is non-proprietary and
-- lives in Postgres so the deputy and the team can reach it from a browser.
-- Nothing in this file references `projects`, and nothing in `schema.sql`
-- references anything here.
--
-- The shape is relational rather than one jsonb document, unlike the plan.
-- That is deliberate: the reports have to answer arbitrary date ranges grouped
-- by person, category or location, and two people have to edit concurrently.
-- A document blob guarded by a single revision counter can do neither.
--
-- Two roles:
--
--   admin    Alex and the deputy — everything, including the KPI history
--   member   a field-team account: their own actuals, and no KPI reads
--
-- Enforcement is row-level security, never the UI. Three rules run through the
-- whole file and each one is load-bearing:
--
--   * The evidence tables are INSERT-only at the *policy* level. A delay claim
--     rests on who decided what and when, so an annotation is superseded by a
--     new row rather than edited, and the database is what makes that true.
--   * Plans and actuals are append-only for the same reason. "The plan changed
--     the evening before" is itself evidence, and an UPDATE would erase it.
--   * A refused UPDATE or DELETE matches no rows and reports success, so every
--     write a caller must be able to trust goes through a function that raises.
-- ══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ══════════════════════════════════════════════════════════════════════════
-- Who
-- ══════════════════════════════════════════════════════════════════════════

-- A person on the team. `user_id` is null for somebody who is scheduled but
-- has no account — which in v1 is everybody except the two administrators.
-- Scheduling someone must never require giving them a login.
create table if not exists public.rc_people (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid unique references auth.users(id) on delete set null,
  name              text not null,
  email             text,
  title             text,
  subsystem         text,
  role              text not null default 'member' check (role in ('admin', 'member')),
  -- Never delete a leaver: their history has to stay for the reports while
  -- they drop out of every assignment picker.
  active            boolean not null default true,
  -- ISO weekday numbers, 1 = Monday. A four-day contract is {1,2,3,4}.
  working_days      smallint[] not null default '{1,2,3,4,5}',
  entitlement_days  numeric(5,1) not null default 0,
  leave_year_start  date,
  created_at        timestamptz not null default now()
);

create index if not exists rc_people_active_idx on public.rc_people (active);

-- ══════════════════════════════════════════════════════════════════════════
-- Vocabularies
--
-- Every one of these is a table rather than free text, and for one reason:
-- the reports group by them. "doc" and "documentation" typed on different days
-- are two categories to a database and one to a human, and the drift is
-- invisible until a rollup is quietly wrong.
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.rc_locations (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,
  code     text,
  active   boolean not null default true
);

-- The look-ahead and the SARs spell locations differently — "TPSS 12",
-- "TPSS-12", "Traction Power 12" — and every match in the ingestion keys on
-- location. Without this the matching fails silently on exactly the rows that
-- matter. Aliases are folded (case and punctuation) before comparison.
create table if not exists public.rc_location_alias (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.rc_locations(id) on delete cascade,
  alias       text not null,
  unique (alias)
);

create table if not exists public.rc_categories (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  sort   integer not null default 0,
  active boolean not null default true
);

-- Who is answerable for a block or a cancellation. A table, not a string,
-- because "blocked by BART" is a number somebody will eventually have to
-- defend.
create table if not exists public.rc_parties (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  active boolean not null default true
);

create table if not exists public.rc_leave_kinds (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  color  text,
  counts_against_entitlement boolean not null default true,
  active boolean not null default true
);

-- The legend the look-ahead's cell colours are read against. Versioned,
-- because if BART ever changes it, every earlier snapshot must still be
-- interpreted with the legend that was in force when it was taken.
create table if not exists public.rc_legend (
  id         uuid primary key default gen_random_uuid(),
  valid_from date not null default current_date,
  argb       text not null,
  meaning    text not null,
  active     boolean not null default true,
  unique (valid_from, argb)
);

-- ══════════════════════════════════════════════════════════════════════════
-- Leave
-- ══════════════════════════════════════════════════════════════════════════

-- Absence is a different fact from "carried over" or "reassigned", and keeping
-- it separate is the whole point: without it, someone being away is silently
-- distributed across the performance statuses and their numbers suffer for it.
create table if not exists public.rc_leave (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.rc_people(id) on delete cascade,
  start_date date not null,
  end_date   date not null,
  kind_id    uuid references public.rc_leave_kinds(id),
  status     text not null default 'approved'
             check (status in ('requested', 'approved', 'declined', 'cancelled')),
  -- Half-day leave is the first thing anyone asks for and retrofitting it is a
  -- migration, so the fields exist from the start even though nothing shows
  -- them yet.
  start_portion text not null default 'full' check (start_portion in ('full', 'pm')),
  end_portion   text not null default 'full' check (end_portion in ('full', 'am')),
  note       text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists rc_leave_person_idx on public.rc_leave (person_id, start_date, end_date);

-- ══════════════════════════════════════════════════════════════════════════
-- The look-ahead register
-- ══════════════════════════════════════════════════════════════════════════

-- Every attempt to read the file, successful or not. Ingestion only happens
-- when the desktop app is open, so coverage has gaps — and a gap that is not
-- recorded looks exactly like a week in which nothing changed. This table is
-- what lets the change view say "no snapshot between the 3rd and the 11th"
-- instead of showing a smooth history that is not true.
create table if not exists public.rc_ingest_runs (
  id         uuid primary key default gen_random_uuid(),
  ran_at     timestamptz not null default now(),
  file_hash  text,
  file_mtime timestamptz,
  outcome    text not null check (outcome in ('unchanged', 'snapshot', 'missing', 'conflict', 'error')),
  note       text
);

create table if not exists public.rc_lookahead_snapshots (
  id         uuid primary key default gen_random_uuid(),
  taken_at   timestamptz not null default now(),
  -- OneDrive stamps a file when it *syncs*, not when it was edited, so the two
  -- times are different facts and evidence has to say which is which.
  file_mtime timestamptz,
  file_hash  text not null,
  legend_at  date,
  sheet_name text not null,
  -- The parsed grid, which is the durable record. Classification is derived
  -- from it, so refining the rules later means re-deriving rather than
  -- migrating history. The .xlsx bytes stay in the OneDrive archive; the
  -- workbook is never uploaded, because it carries every other tab, hidden
  -- row and forgotten pasted sheet along with the part we want.
  grid       jsonb not null,
  unique (file_hash)
);

create table if not exists public.rc_lookahead_rows (
  id            uuid primary key default gen_random_uuid(),
  snapshot_id   uuid not null references public.rc_lookahead_snapshots(id) on delete cascade,
  week_start    date not null,
  -- The true spreadsheet row number, for diagnosis. Never an array position:
  -- blank and hidden rows mean the nth row in the file is not row n.
  sheet_row     integer,
  -- Identity across snapshots, since the look-ahead has no stable IDs and its
  -- activity text is explicitly unreliable. Location + week + subsystem +
  -- ordinal is the best available, and inserting a row mid-group will produce
  -- a false removed/added pair — which is what the manual relink is for.
  row_key       text not null,
  location_id   uuid references public.rc_locations(id),
  -- Kept even when the location resolves, so an unknown spelling can be mapped
  -- retroactively without re-parsing every snapshot.
  raw_location  text,
  raw_label     text,
  subsystem     text,
  cells         jsonb not null default '{}'::jsonb,
  bart_marks    jsonb not null default '{}'::jsonb
);

create index if not exists rc_la_rows_snapshot_idx on public.rc_lookahead_rows (snapshot_id);
create index if not exists rc_la_rows_key_idx      on public.rc_lookahead_rows (week_start, row_key);

create table if not exists public.rc_change_events (
  id            uuid primary key default gen_random_uuid(),
  from_snapshot uuid references public.rc_lookahead_snapshots(id) on delete cascade,
  to_snapshot   uuid references public.rc_lookahead_snapshots(id) on delete cascade,
  kind          text not null check (kind in (
                  'scope_added', 'scope_removed', 'cancellation',
                  'resource_changed', 'shift_changed',
                  -- The window rolling forward is not scope, and work falling
                  -- off the back is not a removal. Classifying them as such
                  -- would book phantom additions every week and count finished
                  -- work as deleted — inflating the very numbers a claim would
                  -- rest on. They are recorded, and excluded from the KPIs.
                  'window_advanced', 'window_retired',
                  'location_shift')),
  week_start    date,
  row_key       text,
  location_id   uuid references public.rc_locations(id),
  before        jsonb,
  after         jsonb,
  detected_at   timestamptz not null default now()
);

create index if not exists rc_change_week_idx on public.rc_change_events (week_start);
create index if not exists rc_change_kind_idx on public.rc_change_events (kind, detected_at);

-- Human judgements on a change: who caused a cancellation, which removal and
-- addition were really one crew moving site. These are exactly what a claim
-- gets challenged on, so they are attributed, timestamped and never edited —
-- a correction is a new row pointing at the old one.
create table if not exists public.rc_change_annotations (
  id              uuid primary key default gen_random_uuid(),
  change_event_id uuid not null references public.rc_change_events(id) on delete cascade,
  kind            text not null check (kind in ('responsibility', 'relink', 'note')),
  party_id        uuid references public.rc_parties(id),
  linked_event_id uuid references public.rc_change_events(id),
  note            text,
  author          uuid not null default auth.uid() references auth.users(id),
  created_at      timestamptz not null default now(),
  supersedes_id   uuid references public.rc_change_annotations(id)
);

create index if not exists rc_annot_event_idx on public.rc_change_annotations (change_event_id);

-- ══════════════════════════════════════════════════════════════════════════
-- Site Access Requests
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.rc_sars (
  id               uuid primary key default gen_random_uuid(),
  sar_number       text not null,
  revision         integer not null default 1,
  location_id      uuid references public.rc_locations(id),
  raw_location     text,
  week_start       date,
  start_at         timestamptz,
  end_at           timestamptz,
  authorized_hours numeric(6,2),
  -- Path in the Storage bucket. The PDF *is* uploaded, unlike the look-ahead
  -- workbook: it has to open in the deputy's browser and carries nothing
  -- proprietary.
  storage_path     text,
  -- An amended SAR never overwrites the record of what was authorised when.
  superseded_by    uuid references public.rc_sars(id),
  created_at       timestamptz not null default now(),
  unique (sar_number, revision)
);

-- One SAR routinely authorises several concurrent scope rows at a location —
-- DCS, ATS and IXL in the same week — so this is many-to-many by design, and
-- several links is the expected result rather than an ambiguity.
create table if not exists public.rc_sar_links (
  id              uuid primary key default gen_random_uuid(),
  sar_id          uuid not null references public.rc_sars(id) on delete cascade,
  lookahead_row_id uuid not null references public.rc_lookahead_rows(id) on delete cascade,
  confirmed_by    uuid references auth.users(id),
  confirmed_at    timestamptz not null default now(),
  unique (sar_id, lookahead_row_id)
);

-- ══════════════════════════════════════════════════════════════════════════
-- Plan and actuals
-- ══════════════════════════════════════════════════════════════════════════

-- What somebody was scheduled to do. Append-only: revising a day inserts a row
-- pointing at the one it replaces, because a plan that changed the evening
-- before is a fact worth keeping rather than an edit to discard.
create table if not exists public.rc_plan_entries (
  id               uuid primary key default gen_random_uuid(),
  person_id        uuid not null references public.rc_people(id) on delete cascade,
  -- A calendar date, never a timestamp. A night shift belongs to the day it
  -- starts on, and a timezone must not be able to move it.
  work_date        date not null,
  shift            text not null default 'day' check (shift in ('day', 'night', 'possession')),
  location_id      uuid references public.rc_locations(id),
  task             text,
  category_id      uuid references public.rc_categories(id),
  lookahead_row_id uuid references public.rc_lookahead_rows(id) on delete set null,
  supersedes_id    uuid references public.rc_plan_entries(id),
  created_by       uuid not null default auth.uid() references auth.users(id),
  created_at       timestamptz not null default now()
);

create index if not exists rc_plan_person_date_idx on public.rc_plan_entries (person_id, work_date);
create index if not exists rc_plan_date_idx        on public.rc_plan_entries (work_date);

-- The current plan: the latest entry for a person and day that nothing else
-- supersedes. Every read wants this; the table underneath keeps the history.
create or replace view public.rc_plan_current as
  select p.*
    from public.rc_plan_entries p
   where not exists (
           select 1 from public.rc_plan_entries newer
            where newer.supersedes_id = p.id
         );

-- What actually happened, captured live in the huddle.
create table if not exists public.rc_actuals (
  id             uuid primary key default gen_random_uuid(),
  -- Generated on the client before the row is sent. The huddle is at a fixed
  -- time whether or not the network is up, so entries queue locally and replay
  -- afterwards; the unique constraint is what makes replaying one twice safe.
  client_uuid    uuid not null unique,
  plan_entry_id  uuid references public.rc_plan_entries(id) on delete set null,
  person_id      uuid not null references public.rc_people(id) on delete cascade,
  work_date      date not null,
  shift          text not null default 'day' check (shift in ('day', 'night', 'possession')),
  status         text not null check (status in (
                   -- Performance signals: these count toward an individual's
                   -- efficiency.
                   'completed', 'partial', 'carried',
                   -- Neutral signals: programme health, never individual
                   -- performance. Somebody blocked by BART did not underperform.
                   'blocked', 'reassigned',
                   -- Not a performance signal at all.
                   'absent')),
  category_id    uuid references public.rc_categories(id),
  location_id    uuid references public.rc_locations(id),
  note           text,
  blocked_reason text,
  blocked_party_id uuid references public.rc_parties(id),
  -- A task carried five days is one stuck item, not five failures by one
  -- person. The chain groups them so the reports count it once, and rank it
  -- by age — which is the more useful number anyway.
  carry_chain_id uuid,
  created_by     uuid not null default auth.uid() references auth.users(id),
  created_at     timestamptz not null default now(),
  -- The spec makes a reason and a responsible party mandatory on a block, so
  -- the database makes them mandatory. A validation message is something a
  -- person dismisses at 3:07pm; a constraint is not.
  constraint rc_actuals_blocked_needs_reason check (
    status <> 'blocked'
    or (blocked_reason is not null and btrim(blocked_reason) <> '' and blocked_party_id is not null)
  )
);

create index if not exists rc_actuals_person_date_idx on public.rc_actuals (person_id, work_date);
create index if not exists rc_actuals_date_idx        on public.rc_actuals (work_date);
create index if not exists rc_actuals_chain_idx       on public.rc_actuals (carry_chain_id);

-- ══════════════════════════════════════════════════════════════════════════
-- Helpers
--
-- SECURITY DEFINER so they step outside row-level security. A policy on
-- rc_people that queried rc_people would recurse, and the error it raises does
-- not say so.
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.rc_me()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.rc_people where user_id = auth.uid() and active limit 1;
$$;

create or replace function public.rc_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rc_people
     where user_id = auth.uid() and role = 'admin' and active
  );
$$;

-- True when the caller may act for this person: an administrator may act for
-- anyone, a member only for themselves.
create or replace function public.rc_can_act_for(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.rc_is_admin() or p_person = public.rc_me();
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- Row-level security
-- ══════════════════════════════════════════════════════════════════════════

alter table public.rc_people             enable row level security;
alter table public.rc_locations          enable row level security;
alter table public.rc_location_alias     enable row level security;
alter table public.rc_categories         enable row level security;
alter table public.rc_parties            enable row level security;
alter table public.rc_leave_kinds        enable row level security;
alter table public.rc_legend             enable row level security;
alter table public.rc_leave              enable row level security;
alter table public.rc_ingest_runs        enable row level security;
alter table public.rc_lookahead_snapshots enable row level security;
alter table public.rc_lookahead_rows     enable row level security;
alter table public.rc_change_events      enable row level security;
alter table public.rc_change_annotations enable row level security;
alter table public.rc_sars               enable row level security;
alter table public.rc_sar_links          enable row level security;
alter table public.rc_plan_entries       enable row level security;
alter table public.rc_actuals            enable row level security;

-- ── Reference data ────────────────────────────────────────────────────────
-- Everyone signed in may read it: a member has to see location and category
-- names to make any sense of their own row. Only administrators may change it.

do $$
declare t text;
begin
  foreach t in array array['rc_people', 'rc_locations', 'rc_location_alias',
                           'rc_categories', 'rc_parties', 'rc_leave_kinds', 'rc_legend']
  loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format(
      'create policy %1$s_read on public.%1$s for select to authenticated using (true)', t);

    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format(
      'create policy %1$s_write on public.%1$s for all to authenticated
         using (public.rc_is_admin()) with check (public.rc_is_admin())', t);
  end loop;
end;
$$;

-- ── Leave ─────────────────────────────────────────────────────────────────
-- Readable by everyone (the schedule is not a secret from the people in it),
-- writable only by administrators.

drop policy if exists rc_leave_read on public.rc_leave;
create policy rc_leave_read on public.rc_leave
  for select to authenticated using (true);

drop policy if exists rc_leave_write on public.rc_leave;
create policy rc_leave_write on public.rc_leave
  for all to authenticated
  using (public.rc_is_admin()) with check (public.rc_is_admin());

-- ── The look-ahead register — administrators only ─────────────────────────
-- This is the evidence base for delay claims, and a member has no business in
-- it. Note the annotations, which are INSERT and SELECT only: no update
-- policy and no delete policy exist, so neither is possible for anyone going
-- through the API, administrator included.

do $$
declare t text;
begin
  foreach t in array array['rc_ingest_runs', 'rc_lookahead_snapshots', 'rc_lookahead_rows',
                           'rc_change_events', 'rc_sars', 'rc_sar_links']
  loop
    execute format('drop policy if exists %1$s_admin on public.%1$s', t);
    execute format(
      'create policy %1$s_admin on public.%1$s for all to authenticated
         using (public.rc_is_admin()) with check (public.rc_is_admin())', t);
  end loop;
end;
$$;

drop policy if exists rc_change_annotations_read on public.rc_change_annotations;
create policy rc_change_annotations_read on public.rc_change_annotations
  for select to authenticated using (public.rc_is_admin());

-- Insert only, and only as yourself. Correcting an annotation means inserting
-- one that supersedes it, so the record of who decided what, and when, cannot
-- be quietly rewritten a year later when it matters.
drop policy if exists rc_change_annotations_insert on public.rc_change_annotations;
create policy rc_change_annotations_insert on public.rc_change_annotations
  for insert to authenticated
  with check (public.rc_is_admin() and author = auth.uid());

-- ── Plan and actuals ──────────────────────────────────────────────────────

drop policy if exists rc_plan_read on public.rc_plan_entries;
create policy rc_plan_read on public.rc_plan_entries
  for select to authenticated using (true);

-- Append-only: an insert policy and nothing else. Superseding is an insert.
drop policy if exists rc_plan_insert on public.rc_plan_entries;
create policy rc_plan_insert on public.rc_plan_entries
  for insert to authenticated
  with check (public.rc_is_admin() and created_by = auth.uid());

-- A member sees the whole team's actuals — the huddle happens in front of
-- everyone, so there is nothing to hide — but may only write their own.
drop policy if exists rc_actuals_read on public.rc_actuals;
create policy rc_actuals_read on public.rc_actuals
  for select to authenticated using (true);

drop policy if exists rc_actuals_insert on public.rc_actuals;
create policy rc_actuals_insert on public.rc_actuals
  for insert to authenticated
  with check (public.rc_can_act_for(person_id) and created_by = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- Reporting
--
-- Every number is derived on the way out. Nothing here is stored, so nothing
-- here can go stale, and refining a definition never means a migration.
-- ══════════════════════════════════════════════════════════════════════════

-- A carry chain counted once, with its age — rather than once per day carried,
-- which would punish one person five times for one stuck task.
create or replace view public.rc_carry_chains as
  select carry_chain_id,
         person_id,
         min(work_date)      as first_seen,
         max(work_date)      as last_seen,
         count(*)            as carries,
         max(work_date) - min(work_date) as age_days
    from public.rc_actuals
   where carry_chain_id is not null
     and status = 'carried'
   group by carry_chain_id, person_id;

-- The KPI base. Restricted to administrators, in the database rather than by
-- hiding a menu item — a member calling the API directly gets nothing.
--
-- `security_invoker` matters: without it the view would run as its owner and
-- hand every member the whole history through a view that looks harmless.
create or replace view public.rc_effort with (security_invoker = true) as
  select a.id,
         a.person_id,
         p.name        as person_name,
         p.subsystem,
         a.work_date,
         a.shift,
         a.status,
         a.category_id,
         c.name        as category_name,
         a.location_id,
         l.name        as location_name,
         a.blocked_party_id,
         a.carry_chain_id,
         -- Which family a status belongs to. Performance and programme health
         -- are never averaged together: one measures the team, the other
         -- measures what was done to it.
         case
           when a.status in ('completed', 'partial', 'carried') then 'performance'
           when a.status in ('blocked', 'reassigned')           then 'health'
           else 'absence'
         end as signal
    from public.rc_actuals a
    join public.rc_people p on p.id = a.person_id
    left join public.rc_categories c on c.id = a.category_id
    left join public.rc_locations  l on l.id = a.location_id
   where public.rc_is_admin();

-- Work planned into a location and week with no SAR against it — access that
-- was never confirmed. Nothing else in the system surfaces this, and it is the
-- most useful thing the two registers can be asked together.
create or replace view public.rc_rows_without_sar with (security_invoker = true) as
  select r.id, r.week_start, r.location_id, r.raw_location, r.raw_label, r.snapshot_id
    from public.rc_lookahead_rows r
   where public.rc_is_admin()
     and not exists (select 1 from public.rc_sar_links k where k.lookahead_row_id = r.id);

-- The mirror: access booked for work that has since gone.
create or replace view public.rc_sars_without_rows with (security_invoker = true) as
  select s.id, s.sar_number, s.revision, s.week_start, s.location_id, s.raw_location
    from public.rc_sars s
   where public.rc_is_admin()
     and s.superseded_by is null
     and not exists (select 1 from public.rc_sar_links k where k.sar_id = s.id);

-- ══════════════════════════════════════════════════════════════════════════
-- Writes that must be able to fail loudly
--
-- A refused UPDATE or DELETE matches nothing and reports success, so anything
-- a caller has to trust goes through a function that raises instead.
-- ══════════════════════════════════════════════════════════════════════════

-- Revise a plan entry by superseding it. Returns the new row's id.
--
-- Note the output columns are prefixed. A `returns table (id uuid)` would make
-- a bare `id` inside the body resolve to the OUT parameter rather than the
-- column, and the failure is at runtime rather than at creation — which has
-- already cost this project two bugs.
create or replace function public.rc_supersede_plan(
  p_entry       uuid,
  p_location    uuid,
  p_task        text,
  p_category    uuid,
  p_shift       text default 'day'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row public.rc_plan_entries;
  new_id  uuid;
begin
  if not public.rc_is_admin() then
    raise exception 'read only: only an administrator may change the plan'
      using errcode = '42501';
  end if;

  select * into old_row from public.rc_plan_entries where id = p_entry;
  if not found then
    raise exception 'no such plan entry: %', p_entry using errcode = 'P0002';
  end if;

  if exists (select 1 from public.rc_plan_entries where supersedes_id = p_entry) then
    raise exception 'plan entry % has already been revised', p_entry using errcode = '40001';
  end if;

  insert into public.rc_plan_entries
    (person_id, work_date, shift, location_id, task, category_id,
     lookahead_row_id, supersedes_id, created_by)
  values
    (old_row.person_id, old_row.work_date, coalesce(p_shift, old_row.shift),
     p_location, p_task, p_category, old_row.lookahead_row_id, p_entry, auth.uid())
  returning id into new_id;

  return new_id;
end;
$$;

-- Record a huddle outcome. Idempotent on `client_uuid`, so the offline queue
-- can replay without fear; returns the row that ended up stored either way.
create or replace function public.rc_record_actual(
  p_client_uuid uuid,
  p_person      uuid,
  p_date        date,
  p_status      text,
  p_category    uuid default null,
  p_location    uuid default null,
  p_note        text default null,
  p_blocked_reason text default null,
  p_blocked_party  uuid default null,
  p_carry_chain uuid default null,
  p_plan_entry  uuid default null,
  p_shift       text default 'day'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
  new_id   uuid;
begin
  if not public.rc_can_act_for(p_person) then
    raise exception 'read only: you may only record your own outcomes'
      using errcode = '42501';
  end if;

  select id into existing from public.rc_actuals where client_uuid = p_client_uuid;
  if found then
    return existing;
  end if;

  if p_status = 'blocked'
     and (p_blocked_reason is null or btrim(p_blocked_reason) = '' or p_blocked_party is null) then
    raise exception 'a blocked outcome needs a reason and a responsible party'
      using errcode = '23514';
  end if;

  insert into public.rc_actuals
    (client_uuid, plan_entry_id, person_id, work_date, shift, status, category_id,
     location_id, note, blocked_reason, blocked_party_id, carry_chain_id, created_by)
  values
    (p_client_uuid, p_plan_entry, p_person, p_date, p_shift, p_status, p_category,
     p_location, p_note, p_blocked_reason, p_blocked_party, p_carry_chain, auth.uid())
  returning id into new_id;

  return new_id;
end;
$$;

-- Resolve a location spelling to a record, through the alias table. Returns
-- null rather than inventing one: an unknown spelling belongs in a queue for
-- somebody to map, not in a row that silently claims to be somewhere.
create or replace function public.rc_resolve_location(p_raw text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with folded as (select lower(regexp_replace(coalesce(p_raw, ''), '[^a-zA-Z0-9]', '', 'g')) as key)
  select coalesce(
    (select l.id from public.rc_locations l, folded f
      where lower(regexp_replace(l.name, '[^a-zA-Z0-9]', '', 'g')) = f.key
        and f.key <> '' limit 1),
    (select a.location_id from public.rc_location_alias a, folded f
      where lower(regexp_replace(a.alias, '[^a-zA-Z0-9]', '', 'g')) = f.key
        and f.key <> '' limit 1)
  );
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- Grants
-- ══════════════════════════════════════════════════════════════════════════

revoke all on function public.rc_me()                                   from public, anon;
revoke all on function public.rc_is_admin()                             from public, anon;
revoke all on function public.rc_can_act_for(uuid)                      from public, anon;
revoke all on function public.rc_resolve_location(text)                 from public, anon;
revoke all on function public.rc_supersede_plan(uuid, uuid, text, uuid, text) from public, anon;
revoke all on function public.rc_record_actual(uuid, uuid, date, text, uuid, uuid, text, text, uuid, uuid, uuid, text) from public, anon;

grant execute on function public.rc_me()                                to authenticated;
grant execute on function public.rc_is_admin()                          to authenticated;
grant execute on function public.rc_can_act_for(uuid)                   to authenticated;
grant execute on function public.rc_resolve_location(text)              to authenticated;
grant execute on function public.rc_supersede_plan(uuid, uuid, text, uuid, text) to authenticated;
grant execute on function public.rc_record_actual(uuid, uuid, date, text, uuid, uuid, text, text, uuid, uuid, uuid, text) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['rc_people', 'rc_locations', 'rc_location_alias', 'rc_categories',
                           'rc_parties', 'rc_leave_kinds', 'rc_legend', 'rc_leave',
                           'rc_ingest_runs', 'rc_lookahead_snapshots', 'rc_lookahead_rows',
                           'rc_change_events', 'rc_sars', 'rc_sar_links']
  loop
    execute format('revoke all on public.%s from public, anon', t);
    execute format('grant select, insert, update, delete on public.%s to authenticated', t);
  end loop;
end;
$$;

-- The append-only tables get no UPDATE or DELETE grant at all — and the revoke
-- has to name `authenticated`, not just public and anon, or the privilege
-- survives and the refusal falls back to row-level security.
--
-- That distinction is the whole point. Without the grant, an UPDATE raises. With
-- it, RLS excludes the row instead, the statement matches nothing, and the
-- driver reports success — so a caller who edited an annotation would be told
-- it worked. This is the same trap `save_project()` exists to avoid, and it
-- matters more here: these rows are what a delay claim rests on.
revoke all on public.rc_plan_entries       from public, anon, authenticated;
revoke all on public.rc_actuals            from public, anon, authenticated;
revoke all on public.rc_change_annotations from public, anon, authenticated;

grant select, insert on public.rc_plan_entries       to authenticated;
grant select, insert on public.rc_actuals            to authenticated;
grant select, insert on public.rc_change_annotations to authenticated;

revoke all on public.rc_plan_current, public.rc_carry_chains, public.rc_effort,
              public.rc_rows_without_sar, public.rc_sars_without_rows from public, anon;
grant select on public.rc_plan_current, public.rc_carry_chains, public.rc_effort,
                public.rc_rows_without_sar, public.rc_sars_without_rows to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- Seed vocabularies
--
-- Only ever inserted when missing, so a project that has renamed them keeps
-- its own.
-- ══════════════════════════════════════════════════════════════════════════

insert into public.rc_categories (name, sort)
select v.name, v.sort from (values
  ('Documentation', 10), ('Engineering', 20), ('Field Work', 30),
  ('Testing', 40), ('Troubleshooting', 50)
) as v(name, sort)
where not exists (select 1 from public.rc_categories where name = v.name);

insert into public.rc_parties (name)
select v.name from (values ('Hitachi'), ('BART'), ('Other team'), ('Vendor')) as v(name)
where not exists (select 1 from public.rc_parties where name = v.name);

insert into public.rc_leave_kinds (name, color, counts_against_entitlement)
select v.name, v.color, v.counts from (values
  ('Annual leave', '#3a76e8', true),
  ('Sick',         '#e0803a', false),
  ('TOIL',         '#16a571', true),
  ('Training',     '#9333d9', false),
  ('Parental',     '#0d9488', false),
  ('Unpaid',       '#6b7280', false)
) as v(name, color, counts)
where not exists (select 1 from public.rc_leave_kinds where name = v.name);
