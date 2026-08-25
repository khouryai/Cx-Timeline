-- ══════════════════════════════════════════════════════════════════════════
-- Bring an existing resource-calendar project up to date.
--
-- `rc_schema.sql` is written to be re-runnable, but there is one thing it
-- cannot do: `create table if not exists` does exactly nothing to a table that
-- already exists, so every column added since your project was created is
-- silently missing. The interface then sends a field Postgres has never heard
-- of — which is what "could not update the legend" is: the register has no
-- `role` column yet, so saying a colour is shading fails at the database.
--
-- This file fixes the *shapes*. Run it first, then run `rc_schema.sql`, which
-- brings the functions, policies and grants with it.
--
--   1. supabase/migrate.sql      ← this file, fixes columns and constraints
--   2. supabase/rc_schema.sql    ← then this, for everything else
--
-- Safe to run twice, and safe to run on a project that is already current:
-- every step checks before it acts and nothing here drops data.
--
-- If you also run the timeline in this project, `schema.sql` goes *before*
-- both of them — and never after, or its sign-up gate replaces the calendar's
-- and locks out everybody the calendar invited.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── Roles: a viewer reads the schedule and writes nothing ─────────────────
-- Added when read-only team access arrived. A project created before that has
-- a constraint allowing only 'admin' and 'member', so setting somebody to
-- 'viewer' is refused by the check rather than by any policy.
alter table public.rc_people drop constraint if exists rc_people_role_check;
alter table public.rc_people
  add constraint rc_people_role_check check (role in ('admin', 'member', 'viewer'));

-- ── Who is scheduled, as distinct from what they may do ───────────────────
-- The huddle and the week plan filter on this, never on the role: a manager
-- runs the meeting rather than taking work from it, but an administrator who
-- *does* take shifts must not vanish from the meeting because of a promotion.
alter table public.rc_people
  add column if not exists scheduled boolean not null default true;

-- Stand the existing managers down, once. Skipped entirely if anybody has
-- already been stood down, so re-running never overrules a decision you made.
do $$
begin
  if not exists (select 1 from public.rc_people where not scheduled) then
    update public.rc_people set scheduled = false where role = 'admin';
  end if;
end
$$;

-- ── What a colour *does*, as distinct from what it is called ──────────────
-- This is the one that has been failing. The look-ahead greys most of its
-- calendar for layout, and no wording of the meaning fixes that — "not
-- scheduled" is still a meaning — so the register has to say whether a colour
-- is work at all.
alter table public.rc_legend
  add column if not exists role text not null default 'shift';
alter table public.rc_legend drop constraint if exists rc_legend_role_check;
alter table public.rc_legend
  add constraint rc_legend_role_check check (role in ('shift', 'divider', 'ignore'));

-- ── Which sheet to read ───────────────────────────────────────────────────
-- A table rather than a constant in the source: the tab gets renamed by
-- whoever maintains the workbook, and a renamed tab must mean a field somebody
-- edits, not a redeploy.
create table if not exists public.rc_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.rc_settings (key, value) values ('lookahead_sheet', '4WLA')
on conflict (key) do nothing;

alter table public.rc_settings enable row level security;
drop policy if exists rc_settings_read on public.rc_settings;
create policy rc_settings_read on public.rc_settings
  for select to authenticated using (true);
drop policy if exists rc_settings_write on public.rc_settings;
create policy rc_settings_write on public.rc_settings
  for all to authenticated
  using (public.rc_is_admin()) with check (public.rc_is_admin());
grant select, insert, update, delete on public.rc_settings to authenticated;

-- ── Invitations ───────────────────────────────────────────────────────────
-- Only the table, so `rc_schema.sql` can create the functions over it. Sign-up
-- goes through GoTrue rather than PostgREST, which is why the gate that uses
-- this is a trigger on `auth.users` and not anything the interface does.
create table if not exists public.rc_invitations (
  email            text primary key,
  role_hint        text not null default 'viewer',
  person_id        uuid references public.rc_people(id) on delete set null,
  note             text,
  invited_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '30 days',
  accepted_at      timestamptz,
  accepted_user_id uuid references auth.users(id) on delete set null
);

alter table public.rc_invitations drop constraint if exists rc_invitations_role_hint_check;
alter table public.rc_invitations
  add constraint rc_invitations_role_hint_check
  check (role_hint in ('admin', 'member', 'viewer'));

alter table public.rc_invitations enable row level security;
grant select, insert, update, delete on public.rc_invitations to authenticated;

/*
 * Drop the account functions before `rc_schema.sql` recreates them.
 *
 * `create or replace function` refuses to change a return type, and these all
 * return a `table (...)` whose columns have been renamed since — the outputs
 * are prefixed now, because a `returns table (email text)` makes a bare
 * `email` in the body resolve to the OUT parameter and `on conflict (email)`
 * then fails at runtime rather than at creation. Dropping first is what turns
 * "cannot change return type of existing function" into a clean apply.
 */
drop function if exists public.rc_invite(text, text, uuid, text);
drop function if exists public.rc_list_invitations();
drop function if exists public.rc_revoke_invitation(text);
drop function if exists public.rc_link_account(uuid, text);
drop function if exists public.rc_set_role(uuid, text);

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- What you should see
--
-- Every row should say "ok". Anything else means that step did not take, and
-- the message says which.
-- ══════════════════════════════════════════════════════════════════════════

select 'rc_people.scheduled' as what,
       case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'rc_people' and column_name = 'scheduled'
       ) then 'ok' else 'MISSING' end as state
union all
select 'rc_legend.role',
       case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'rc_legend' and column_name = 'role'
       ) then 'ok' else 'MISSING' end
union all
select 'rc_settings',
       case when to_regclass('public.rc_settings') is not null then 'ok' else 'MISSING' end
union all
select 'rc_invitations',
       case when to_regclass('public.rc_invitations') is not null then 'ok' else 'MISSING' end
union all
select 'viewer role allowed',
       case when pg_get_constraintdef(oid) like '%viewer%' then 'ok' else 'MISSING' end
  from pg_constraint where conname = 'rc_people_role_check'
union all
select 'managers stood down',
       coalesce((select count(*)::text || ' not scheduled' from public.rc_people where not scheduled), '0');
