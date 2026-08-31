-- Put the schema back to the shape a project created earlier in this project's
-- life actually has, so `migrate.sql` can be tested against the thing it is
-- for rather than against a database that never needed it.
--
-- This is the state somebody is in when "could not update the legend" appears:
-- the interface sends `role`, and the register has no such column.

alter table public.rc_legend drop column if exists role;
alter table public.rc_people drop column if exists scheduled;
drop table if exists public.rc_settings;
drop table if exists public.rc_invitations cascade;

-- And a role check that has never heard of a viewer, so read-only access is
-- refused by the constraint rather than by any policy.
alter table public.rc_people drop constraint if exists rc_people_role_check;
alter table public.rc_people
  add constraint rc_people_role_check check (role in ('admin', 'member'));

-- The views select `*`, so a column cannot be dropped underneath them.
-- `rc_schema.sql` recreates both.
drop view if exists public.rc_plan_current cascade;
drop view if exists public.rc_carry_chains cascade;
drop view if exists public.rc_effort cascade;

alter table public.rc_plan_entries drop column if exists carry_chain_id;
alter table public.rc_actuals      drop column if exists lookahead_row_id;
alter table public.rc_actuals      drop column if exists evidence_path;
drop table if exists public.rc_blockers cascade;
drop function if exists public.rc_record_actual(
  uuid, uuid, date, text, uuid, uuid, text, text, uuid, uuid, uuid, text, uuid);
drop function if exists public.rc_record_actual(
  uuid, uuid, date, text, uuid, uuid, text, text, uuid, uuid, uuid, text, uuid, text);
