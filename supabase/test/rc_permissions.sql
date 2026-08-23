-- ══════════════════════════════════════════════════════════════════════════
-- Resource Calendar permission tests.
--
-- Same discipline as `permissions.sql`: every check runs as `authenticated`
-- rather than as the table owner, because row-level security does not apply to
-- the owner and a suite that forgot that would pass while proving nothing.
--
-- Three properties here are not merely access control, they are the evidentiary
-- basis of a delay claim, and each gets tested as such:
--
--   * plans and actuals are append-only — no UPDATE, no DELETE, for anyone
--   * an annotation is superseded, never edited
--   * a blocked outcome without a reason and a responsible party is refused
--     by the database, not by a dialog somebody dismisses
--
-- Runs after `permissions.sql`, and reuses the assert/refuses/act_as helpers
-- and the four accounts it created.
--
--   npm run test:sql
-- ══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\set QUIET on

select id as alice from auth.users where email = 'alice@example.com' \gset
select id as bob   from auth.users where email = 'bob@example.com'   \gset
select id as carol from auth.users where email = 'carol@example.com' \gset
select id as dave  from auth.users where email = 'dave@example.com'  \gset

-- ── Cast ──────────────────────────────────────────────────────────────────
-- Seeded as the owner, which is how the first administrator comes to exist in
-- a real deployment too: somebody runs it in the SQL editor. There is no way
-- to bootstrap it through the API, and there should not be.
--
-- Dan has no account at all. Being schedulable must never require a login —
-- in v1 that is true of the whole field team.
insert into public.rc_people (user_id, name, email, title, subsystem, role) values
  (:'alice', 'Alex',  'alice@example.com', 'Commissioning Manager', 'ATS',  'admin'),
  (:'bob',   'Deputy','bob@example.com',   'Deputy Manager',        'IXL',  'admin'),
  (:'carol', 'Carol', 'carol@example.com', 'Test Engineer',         'SCADA','member');
insert into public.rc_people (name, title, subsystem) values ('Dan', 'Field Technician', 'Wayside');
insert into public.rc_people (name, active) values ('Erin', false);

select id as p_alice from public.rc_people where name = 'Alex'  \gset
select id as p_carol from public.rc_people where name = 'Carol' \gset
select id as p_dan   from public.rc_people where name = 'Dan'   \gset

insert into public.rc_locations (name, code) values ('TPSS 12', 'T12'), ('Station 6 Platform', 'S6P');
select id as loc12 from public.rc_locations where name = 'TPSS 12' \gset
insert into public.rc_location_alias (location_id, alias) values (:'loc12', 'Traction Power 12');

select id as cat_field from public.rc_categories where name = 'Field Work' \gset
select id as party_bart from public.rc_parties where name = 'BART' \gset

set role authenticated;

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Who is an administrator'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');
select assert(public.rc_is_admin(), 'Alex is an administrator');
select assert(public.rc_me() = :'p_alice', 'rc_me finds their person row');

select act_as(:'carol');
select assert(not public.rc_is_admin(), 'a member is not an administrator');
select assert(public.rc_me() = :'p_carol', 'rc_me works for a member too');
select assert(public.rc_can_act_for(:'p_carol'), 'a member may act for themselves');
select assert(not public.rc_can_act_for(:'p_dan'), 'but not for somebody else');

-- Somebody with an account but no person row is nobody here.
select act_as(:'dave');
select assert(public.rc_me() is null, 'an account with no person row resolves to nobody');
select assert(not public.rc_is_admin(), 'and is certainly not an administrator');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Reference data'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'carol');
select assert(
  (select count(*) from public.rc_locations) = 2,
  'a member can read the locations'
);
select assert(
  (select count(*) from public.rc_people where active) = 4,
  'and the roster — the schedule is not a secret from the people in it'
);

select refuses(:'carol',
  format('insert into public.rc_locations (name) values (%L)', 'Invented Yard'),
  'a member adding a location');
select refuses(:'carol',
  format('update public.rc_categories set name = %L where id = %L', 'Renamed', :'cat_field'),
  'a member renaming a category');

select act_as(:'alice');
insert into public.rc_locations (name, code) values ('Yard 3', 'Y3');
select assert(
  (select count(*) from public.rc_locations) = 3,
  'an administrator can add a location'
);

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Resolving a location spelling'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

-- Every match in the ingestion keys on location, and the look-ahead and the
-- SARs spell them differently. Folding case and punctuation is what stops the
-- matching failing silently on exactly the rows that matter.
select assert(public.rc_resolve_location('TPSS 12')   = :'loc12', 'an exact name resolves');
select assert(public.rc_resolve_location('TPSS-12')   = :'loc12', 'punctuation is folded away');
select assert(public.rc_resolve_location('tpss12')    = :'loc12', 'so is case and spacing');
select assert(public.rc_resolve_location('Traction Power 12') = :'loc12', 'an alias resolves');
select assert(public.rc_resolve_location('Nowhere Yard') is null,
  'an unknown spelling resolves to nothing rather than inventing a location');
select assert(public.rc_resolve_location('') is null, 'and so does an empty one');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Leave'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');
insert into public.rc_leave (person_id, start_date, end_date, status)
values (:'p_dan', date '2026-09-07', date '2026-09-11', 'approved');
select assert((select count(*) from public.rc_leave) = 1, 'an administrator can book leave');

select refuses(:'carol',
  format('insert into public.rc_leave (person_id, start_date, end_date) values (%L, %L, %L)',
         :'p_carol', '2026-09-14', '2026-09-15'),
  'a member booking their own leave');

select act_as(:'carol');
select assert((select count(*) from public.rc_leave) = 1, 'but they can see it');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'The plan is append-only'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');
insert into public.rc_plan_entries (person_id, work_date, location_id, task, category_id)
values (:'p_dan', date '2026-09-01', :'loc12', 'Cable pull S6–S7', :'cat_field');
select id as plan1 from public.rc_plan_entries where task = 'Cable pull S6–S7' \gset

select assert((select count(*) from public.rc_plan_current) = 1,
  'a new entry is the current plan');

select refuses(:'carol',
  format('insert into public.rc_plan_entries (person_id, work_date, task) values (%L, %L, %L)',
         :'p_carol', '2026-09-01', 'Something else'),
  'a member writing the plan');

-- No UPDATE and no DELETE exist for anybody, administrator included. "The plan
-- changed the evening before" is itself delay evidence, and an update would
-- erase it.
select refuses(:'alice',
  format('update public.rc_plan_entries set task = %L where id = %L', 'Rewritten', :'plan1'),
  'an administrator editing a plan entry in place');
select refuses(:'alice',
  format('delete from public.rc_plan_entries where id = %L', :'plan1'),
  'an administrator deleting a plan entry');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Revising the plan supersedes it'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');
select public.rc_supersede_plan(:'plan1', :'loc12', 'Cable pull S6–S7 (night)', :'cat_field', 'night') as plan2 \gset

select assert((select count(*) from public.rc_plan_entries) = 2,
  'the revision is a second row, not an edit');
select assert((select count(*) from public.rc_plan_current) = 1,
  'and only one of them is current');
select assert((select id from public.rc_plan_current) = :'plan2',
  'the current one is the revision');
select assert(
  (select supersedes_id from public.rc_plan_entries where id = :'plan2') = :'plan1',
  'which points back at what it replaced');
select assert(
  (select shift from public.rc_plan_entries where id = :'plan2') = 'night',
  'a night shift is carried on the entry');

-- Two people revising the same entry would otherwise both succeed and leave
-- two "current" rows, which the view could not choose between.
select refuses(:'alice',
  format('select public.rc_supersede_plan(%L, null, %L, null)', :'plan1', 'Again'),
  'revising the same entry twice');
select refuses(:'carol',
  format('select public.rc_supersede_plan(%L, null, %L, null)', :'plan2', 'Not yours'),
  'a member revising the plan');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Recording what actually happened'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'carol');
select public.rc_record_actual(
  '11111111-1111-1111-1111-111111111111'::uuid, :'p_carol', date '2026-09-01',
  'completed', :'cat_field', :'loc12') as act1 \gset
select assert((select count(*) from public.rc_actuals) = 1,
  'a member can record their own outcome');

-- The huddle happens at a fixed time whether or not the network does, so
-- entries queue on the client and replay afterwards. Replaying one twice has
-- to be harmless.
select public.rc_record_actual(
  '11111111-1111-1111-1111-111111111111'::uuid, :'p_carol', date '2026-09-01',
  'completed', :'cat_field', :'loc12') as act1b \gset
select assert(:'act1b' = :'act1', 'replaying a queued entry returns the same row');
select assert((select count(*) from public.rc_actuals) = 1, 'and does not write a second one');

select refuses(:'carol',
  format('select public.rc_record_actual(%L, %L, %L, %L)',
         gen_random_uuid(), :'p_dan', '2026-09-01', 'completed'),
  'a member recording somebody else''s outcome');

select act_as(:'alice');
select public.rc_record_actual(
  '22222222-2222-2222-2222-222222222222'::uuid, :'p_dan', date '2026-09-01',
  'partial', :'cat_field', :'loc12') as act2 \gset
select assert((select count(*) from public.rc_actuals) = 2,
  'an administrator can record for anyone');

-- Append-only, for the same reason as the plan.
select refuses(:'alice',
  format('update public.rc_actuals set status = %L where id = %L', 'completed', :'act2'),
  'editing an outcome after the fact');
select refuses(:'alice',
  format('delete from public.rc_actuals where id = %L', :'act2'),
  'deleting an outcome');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'A block needs a reason and somebody answerable'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

-- "Blocked by BART" is a number that will eventually have to be defended, so
-- an unattributed one is refused by the database rather than by a validation
-- message dismissed at 3:07pm.
select refuses(:'alice',
  format('select public.rc_record_actual(%L, %L, %L, %L)',
         gen_random_uuid(), :'p_dan', '2026-09-02', 'blocked'),
  'a blocked outcome with no reason and no party');
select refuses(:'alice',
  format('select public.rc_record_actual(%L, %L, %L, %L, null, null, null, %L)',
         gen_random_uuid(), :'p_dan', '2026-09-02', 'blocked', 'No access'),
  'a blocked outcome with a reason but nobody answerable');
select refuses(:'alice',
  format($fmt$insert into public.rc_actuals (client_uuid, person_id, work_date, status)
              values (%L, %L, %L, 'blocked')$fmt$,
         gen_random_uuid(), :'p_dan', '2026-09-02'),
  'the same, inserted straight into the table');

select act_as(:'alice');
select public.rc_record_actual(
  '33333333-3333-3333-3333-333333333333'::uuid, :'p_dan', date '2026-09-02',
  'blocked', :'cat_field', :'loc12', null, 'Possession released late', :'party_bart') as act3 \gset
select assert(
  (select blocked_party_id from public.rc_actuals where id = :'act3') = :'party_bart',
  'a properly attributed block is accepted');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'One stuck task is one event, not five'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');
select public.rc_record_actual(gen_random_uuid(), :'p_dan', date '2026-09-03',
  'carried', :'cat_field', :'loc12', null, null, null,
  '44444444-4444-4444-4444-444444444444'::uuid);
select public.rc_record_actual(gen_random_uuid(), :'p_dan', date '2026-09-04',
  'carried', :'cat_field', :'loc12', null, null, null,
  '44444444-4444-4444-4444-444444444444'::uuid);
select public.rc_record_actual(gen_random_uuid(), :'p_dan', date '2026-09-07',
  'carried', :'cat_field', :'loc12', null, null, null,
  '44444444-4444-4444-4444-444444444444'::uuid);

select assert((select count(*) from public.rc_carry_chains) = 1,
  'three days of one carried task are one chain');
select assert((select carries from public.rc_carry_chains) = 3,
  'the chain knows how many times it was carried');
-- 3rd to 7th September: four days old, though it was only carried three times.
-- Age and count are different facts, and age is the one worth ranking by.
select assert((select age_days from public.rc_carry_chains) = 4,
  'and how old it is — the more useful number of the two');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'KPI history is administrators only'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');
select assert((select count(*) from public.rc_effort) = 6,
  'an administrator sees the effort history');
select assert(
  (select signal from public.rc_effort where id = :'act3') = 'health',
  'a block is a programme-health signal, never an individual one');
select assert(
  (select signal from public.rc_effort where id = :'act1') = 'performance',
  'a completion is a performance signal');

-- Enforced by the policy, not by hiding a menu item: a member calling the API
-- directly gets nothing back.
select act_as(:'carol');
select assert((select count(*) from public.rc_effort) = 0,
  'a member sees none of it, even reading the view directly');
select assert((select count(*) from public.rc_actuals) = 6,
  'though the raw outcomes are open — the huddle happens in front of everyone');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'The look-ahead register'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');
insert into public.rc_lookahead_snapshots (file_hash, sheet_name, grid)
values ('hash-one', '4WLA', '{"rows":[]}'::jsonb);
select id as snap1 from public.rc_lookahead_snapshots where file_hash = 'hash-one' \gset

insert into public.rc_lookahead_rows (snapshot_id, week_start, sheet_row, row_key, location_id, raw_location, raw_label)
values (:'snap1', date '2026-08-31', 12, '2026-08-31|TPSS 12|ATS|0', :'loc12', 'TPSS-12', 'ATS integration');
select id as row1 from public.rc_lookahead_rows where snapshot_id = :'snap1' \gset

select assert((select sheet_row from public.rc_lookahead_rows where id = :'row1') = 12,
  'the true spreadsheet row number is kept, not an array position');

select refuses(:'carol',
  'select 1 from public.rc_lookahead_snapshots where file_hash = ''hash-one''',
  'a member reading the look-ahead register');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Work with no confirmed access'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');
select assert((select count(*) from public.rc_rows_without_sar) = 1,
  'a look-ahead row with no SAR is work planned without confirmed access');

insert into public.rc_sars (sar_number, location_id, week_start, authorized_hours)
values ('SAR-12345', :'loc12', date '2026-08-31', 8.0);
select id as sar1 from public.rc_sars where sar_number = 'SAR-12345' \gset

select assert((select count(*) from public.rc_sars_without_rows) = 1,
  'and before it is linked, the SAR is access booked for nothing');

insert into public.rc_sar_links (sar_id, lookahead_row_id, confirmed_by)
values (:'sar1', :'row1', :'alice');

select assert((select count(*) from public.rc_rows_without_sar) = 0,
  'linking clears the first');
select assert((select count(*) from public.rc_sars_without_rows) = 0,
  'and the second');

-- One SAR routinely covers several concurrent scope rows at a location, so a
-- second link is the expected result rather than a conflict.
insert into public.rc_lookahead_rows (snapshot_id, week_start, row_key, location_id, raw_label)
values (:'snap1', date '2026-08-31', '2026-08-31|TPSS 12|IXL|0', :'loc12', 'IXL static');
select id as row2 from public.rc_lookahead_rows where raw_label = 'IXL static' \gset
insert into public.rc_sar_links (sar_id, lookahead_row_id) values (:'sar1', :'row2');
select assert(
  (select count(*) from public.rc_sar_links where sar_id = :'sar1') = 2,
  'one SAR can authorise several rows at the same location and week');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'A judgement is superseded, never edited'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');
insert into public.rc_change_events (kind, week_start, row_key, location_id)
values ('cancellation', date '2026-08-31', '2026-08-31|TPSS 12|ATS|0', :'loc12');
select id as evt1 from public.rc_change_events where kind = 'cancellation' \gset

insert into public.rc_change_annotations (change_event_id, kind, party_id, note)
values (:'evt1', 'responsibility', :'party_bart', 'Possession withdrawn');
select id as ann1 from public.rc_change_annotations where change_event_id = :'evt1' \gset

-- This is the record a claim gets challenged on. If it could be quietly
-- rewritten a year later, it would be worth nothing.
select refuses(:'alice',
  format('update public.rc_change_annotations set note = %L where id = %L', 'Actually us', :'ann1'),
  'editing an annotation');
select refuses(:'alice',
  format('delete from public.rc_change_annotations where id = %L', :'ann1'),
  'deleting an annotation');

-- A correction is a new row pointing at the old one.
insert into public.rc_change_annotations (change_event_id, kind, party_id, note, supersedes_id)
values (:'evt1', 'responsibility', :'party_bart', 'Corrected: withdrawn by us', :'ann1');
select assert(
  (select count(*) from public.rc_change_annotations where change_event_id = :'evt1') = 2,
  'a correction is an additional row');

select refuses(:'carol',
  format('insert into public.rc_change_annotations (change_event_id, kind, note) values (%L, %L, %L)',
         :'evt1', 'note', 'me too'),
  'a member annotating a change event');
select act_as(:'carol');
select assert((select count(*) from public.rc_change_annotations) = 0,
  'and a member cannot read them either');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'The window moving is not a change of scope'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');
insert into public.rc_change_events (kind, week_start) values
  ('window_advanced', date '2026-09-28'),
  ('window_retired',  date '2026-08-24'),
  ('scope_added',     date '2026-09-07');

-- A four-week window rolling forward would otherwise book a batch of phantom
-- additions every week, and work falling off the back would count as deleted
-- scope — inflating the very numbers a claim would rest on.
select assert(
  (select count(*) from public.rc_change_events
    where kind in ('scope_added', 'scope_removed', 'cancellation')) = 2,
  'only real scope movement counts toward the change KPIs');
select assert(
  (select count(*) from public.rc_change_events
    where kind in ('window_advanced', 'window_retired')) = 2,
  'the window moving is recorded, and recorded separately');

reset role;
do $$ begin raise notice ''; raise notice 'All resource calendar checks passed.'; end $$;
