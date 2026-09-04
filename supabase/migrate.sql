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
-- If you only ever run one of them, run `rc_schema.sql`: it converges on its
-- own and cannot leave anything missing. This file adds the column shapes that
-- one cannot, so a project that has been around a while wants both.
--
-- Safe to run twice, safe to run on a project that is already current, and
-- safe to run *alone* — every statement here is additive. Nothing in this file
-- drops anything, which was not always true and is the reason the note below
-- about the account functions exists.
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

-- ── A carry chain has to survive being rolled forward ─────────────────────
-- The chain is keyed on the plan entry a carry came from, so rolling a stuck
-- task into tomorrow made a new entry and the next carry started a new chain:
-- five days of one stuck job read as five separate failures by one person,
-- which is the exact opposite of what the chain is for.
alter table public.rc_plan_entries
  add column if not exists carry_chain_id uuid;

-- ── A block can name the look-ahead row it belongs to ─────────────────────
alter table public.rc_actuals
  add column if not exists lookahead_row_id uuid
  references public.rc_lookahead_rows(id) on delete set null;

-- ── A photograph of what was said ─────────────────────────────────────────
-- Keyed on the client uuid rather than the row's own id: this table has no
-- UPDATE grant, so the picture goes up first under a name generated on the
-- client and the row is written knowing where it is.
alter table public.rc_actuals
  add column if not exists evidence_path text;

-- ── A blocked day now has an owner, a date and an end ─────────────────────
-- Created by `rc_schema.sql`; nothing to alter here, since both tables are new.
-- Listed so the verification below can say whether they arrived.

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
 * Nothing is dropped here any more.
 *
 * This file used to drop the five account functions and `rc_record_actual`,
 * because `create or replace function` refuses to change a return type or a
 * parameter list and every one of them had changed. It relied on you running
 * `rc_schema.sql` straight afterwards to put them back — so running the file
 * named "migrate" on its own, which is the obvious thing to do with it, left a
 * project with no `rc_list_invitations` at all and an Accounts tab that died
 * on "could not find the function public.rc_list_invitations in the schema
 * cache".
 *
 * A migration that can leave the database worse than it found it is not one.
 * The drops now live in `rc_schema.sql`, immediately above the creates they
 * belong to, so that file converges on its own and no order of anything can
 * end anywhere but correct. This file only changes column and constraint
 * shapes, and every statement in it is additive.
 */

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- What you should see
--
-- Every row should say "ok". Anything else means that step did not take, and
-- the message says which.
-- ══════════════════════════════════════════════════════════════════════════

select 'account functions' as what,
       case when (
         select count(distinct proname) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('rc_invite', 'rc_list_invitations', 'rc_revoke_invitation',
                              'rc_link_account', 'rc_set_role', 'rc_record_actual',
                              'rc_supersede_plan', 'rc_resolve_location')
       ) = 8 then 'ok' else 'RUN rc_schema.sql — the application will fail without these' end as state
union all
select 'rc_people.scheduled',
       case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'rc_people' and column_name = 'scheduled'
       ) then 'ok' else 'MISSING' end
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
select 'rc_plan_entries.carry_chain_id',
       case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'rc_plan_entries'
            and column_name = 'carry_chain_id'
       ) then 'ok' else 'MISSING' end
union all
select 'rc_actuals.lookahead_row_id',
       case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'rc_actuals'
            and column_name = 'lookahead_row_id'
       ) then 'ok' else 'MISSING' end
union all
select 'rc_actuals.evidence_path',
       case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'rc_actuals'
            and column_name = 'evidence_path'
       ) then 'ok' else 'MISSING' end
union all
select 'rc_blockers',
       case when to_regclass('public.rc_blockers') is not null then 'ok' else 'MISSING' end
union all
select 'managers stood down',
       coalesce((select count(*)::text || ' not scheduled' from public.rc_people where not scheduled), '0');
