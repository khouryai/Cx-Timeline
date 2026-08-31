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
-- Read-only: on the team, signs in, and writes nothing at all.
insert into public.rc_people (user_id, name, email, title, subsystem, role) values
  (:'dave', 'Dave', 'dave@example.com', 'Signalling Technician', 'IXL', 'viewer');
insert into public.rc_people (name, active) values ('Erin', false);

-- Scheduling is a different fact from permission, and the column says so: it
-- defaults to true for everybody, whatever they may do. The file stands down
-- the administrators that already exist when it is applied — a one-time step
-- for a project that has been running — but nothing derives one from the other
-- afterwards, so an administrator who does take shifts stays in the meeting.
select assert((select bool_and(scheduled) from public.rc_people),
  'everybody is scheduled unless somebody says otherwise');

select act_as(:'alice');
update public.rc_people set scheduled = false where role = 'admin';
select assert((select count(*) from public.rc_people where scheduled) = 4,
  'and standing the managers down leaves the people who take shifts');
select assert((select count(*) from public.rc_people where role = 'admin' and not scheduled) = 2,
  'without touching a single permission');
select assert(public.rc_is_admin(), 'they administer it exactly as before');
reset role;
set role authenticated;

select id as p_alice from public.rc_people where name = 'Alex'  \gset
select id as p_carol from public.rc_people where name = 'Carol' \gset
select id as p_dan   from public.rc_people where name = 'Dan'   \gset
select id as p_dave  from public.rc_people where name = 'Dave'  \gset

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

select act_as(:'dave');
select assert(public.rc_my_role() = 'viewer', 'a viewer knows their own role');
select assert(not public.rc_is_admin(), 'and is certainly not an administrator');
-- The distinction that makes read-only real. A viewer *has* a person row, so
-- comparing ids alone would let them write their own outcomes.
select assert(not public.rc_can_act_for(public.rc_me()),
  'a viewer may not even act for themselves');

-- Somebody with an account but no person row at all. A real answer rather than
-- an error: they can sign in and the application tells them they are not on
-- this team.
select act_as(gen_random_uuid());
select assert(public.rc_me() is null, 'an account with no person row resolves to nobody');
select assert(public.rc_my_role() is null, 'and has no role');
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
  (select count(*) from public.rc_people where active) = 5,
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

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'A viewer reads the schedule and writes nothing'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'dave');

-- What the team is for: who is where, and what happened.
select assert((select count(*) from public.rc_people where active) > 0,
  'a viewer can read the roster');
select assert((select count(*) from public.rc_locations) > 0,
  'and the locations');
select assert((select count(*) from public.rc_leave) = 1,
  'and who is on leave');
select assert((select count(*) from public.rc_plan_current) = 1,
  'and the current plan');
select assert((select count(*) from public.rc_actuals) = 6,
  'and what actually happened');

-- Everything a read-only account must not be able to do. Note the second one:
-- refusing to let somebody record *their own* outcome is the entire difference
-- between a viewer and a member.
select refuses(:'dave',
  format('select public.rc_record_actual(%L, %L, %L, %L)',
         gen_random_uuid(), :'p_dan', '2026-09-08', 'completed'),
  'a viewer recording somebody else''s outcome');
select refuses(:'dave',
  format('select public.rc_record_actual(%L, %L, %L, %L)',
         gen_random_uuid(), :'p_dave', '2026-09-08', 'completed'),
  'a viewer recording their own outcome');
select refuses(:'dave',
  format('insert into public.rc_actuals (client_uuid, person_id, work_date, status)
          values (%L, %L, %L, ''completed'')', gen_random_uuid(), :'p_dave', '2026-09-08'),
  'a viewer inserting an outcome straight into the table');
select refuses(:'dave',
  format('insert into public.rc_plan_entries (person_id, work_date, task) values (%L, %L, %L)',
         :'p_dave', '2026-09-08', 'Something'),
  'a viewer writing the plan');
select refuses(:'dave',
  format('insert into public.rc_leave (person_id, start_date, end_date) values (%L, %L, %L)',
         :'p_dave', '2026-09-14', '2026-09-15'),
  'a viewer booking their own leave');
select refuses(:'dave',
  format('insert into public.rc_locations (name) values (%L)', 'Invented'),
  'a viewer adding reference data');

-- The KPIs and the claim evidence stay with the two administrators, enforced
-- by the policy rather than by hiding a tab.
select assert((select count(*) from public.rc_effort) = 0,
  'a viewer sees no KPI history');
select assert((select count(*) from public.rc_lookahead_snapshots) = 0,
  'nor the look-ahead register');
select assert((select count(*) from public.rc_change_annotations) = 0,
  'nor anybody''s judgement about who caused what');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Promoting a viewer is one UPDATE'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

-- The upgrade path: letting somebody fill in their own outcomes later needs no
-- migration and no redeploy.
select act_as(:'alice');
update public.rc_people set role = 'member' where id = :'p_dave';

select act_as(:'dave');
select assert(public.rc_my_role() = 'member', 'they are a member now');
select assert(public.rc_can_act_for(:'p_dave'), 'and may record their own outcome');
select public.rc_record_actual(
  '55555555-5555-5555-5555-555555555555'::uuid, :'p_dave', date '2026-09-08', 'completed');
select assert((select count(*) from public.rc_actuals) = 7, 'which goes through');

-- But only their own, and still not the plan: setting next week's tasks stays
-- with an administrator, because the supersede chain assumes one author.
select refuses(:'dave',
  format('select public.rc_record_actual(%L, %L, %L, %L)',
         gen_random_uuid(), :'p_dan', '2026-09-08', 'completed'),
  'a member recording for somebody else');
select refuses(:'dave',
  format('insert into public.rc_plan_entries (person_id, work_date, task) values (%L, %L, %L)',
         :'p_dave', '2026-09-09', 'Next week'),
  'a member writing their own plan');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice E'\nA stuck job is one chain, not five failures'; end $$;
-- ══════════════════════════════════════════════════════════════════════════
-- The chain is keyed on the plan entry a carry came from. Rolling the task
-- into tomorrow makes a *new* entry, so without carrying the chain across the
-- roll the next carry starts again — and a five-day stuck job reads as five
-- separate failures charged to one person, which is the exact opposite of what
-- the chain exists to do.

select act_as(:'alice');
insert into public.rc_plan_entries (person_id, work_date, task, location_id, category_id)
values (:'p_carol', '2026-09-14', 'Cable pull', :'loc12', :'cat_field');
select id as chain_day1 from public.rc_plan_current
 where task = 'Cable pull' and work_date = '2026-09-14' \gset

select public.rc_record_actual(
  '66666666-6666-6666-6666-666666666666'::uuid, :'p_carol', date '2026-09-14',
  'carried', null, null, null, null, null, :'chain_day1', :'chain_day1');

-- Rolled forward, carrying the chain with it.
insert into public.rc_plan_entries (person_id, work_date, task, location_id, carry_chain_id)
values (:'p_carol', '2026-09-15', 'Cable pull', :'loc12', :'chain_day1');
select id as chain_day2 from public.rc_plan_current
 where task = 'Cable pull' and work_date = '2026-09-15' \gset

select public.rc_record_actual(
  '77777777-7777-7777-7777-777777777777'::uuid, :'p_carol', date '2026-09-15',
  'carried', null, null, null, null, null, :'chain_day1', :'chain_day2');

select assert(
  (select count(*) from public.rc_carry_chains where carry_chain_id = :'chain_day1') = 1,
  'two days of one stuck job are one chain');
select assert(
  (select carries from public.rc_carry_chains where carry_chain_id = :'chain_day1') = 2,
  'and the chain knows it has been carried twice');
select assert(
  (select age_days from public.rc_carry_chains where carry_chain_id = :'chain_day1') = 1,
  'and how long it has been running, which is the number worth ranking on');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice E'\nA block can name the row it was blocked against'; end $$;
-- ══════════════════════════════════════════════════════════════════════════
-- "Blocked by BART" is an assertion. "Blocked on the row BART themselves
-- scheduled for that location that week" is a document. Optional, and only
-- ever set by hand — matching on activity text is forbidden here.

insert into public.rc_lookahead_snapshots (file_hash, sheet_name, grid)
values ('hash-block', '4WLA', '{}'::jsonb);
select id as snap_b from public.rc_lookahead_snapshots where file_hash = 'hash-block' \gset
insert into public.rc_lookahead_rows (snapshot_id, week_start, sheet_row, row_key, location_id, raw_label)
values (:'snap_b', '2026-09-14', 42, 'k-block', :'loc12', 'IXL Regression Testing');
select id as la_row from public.rc_lookahead_rows where row_key = 'k-block' \gset

select public.rc_record_actual(
  '88888888-8888-8888-8888-888888888888'::uuid, :'p_carol', date '2026-09-16',
  'blocked', null, :'loc12', null, 'Possession released late', :'party_bart',
  null, null, 'day', :'la_row');

select assert(
  (select lookahead_row_id from public.rc_actuals
    where client_uuid = '88888888-8888-8888-8888-888888888888') = :'la_row',
  'a block points at the look-ahead row it was blocked against');

select act_as(:'carol');
select assert((select count(*) from public.rc_lookahead_rows) = 0,
  'though a member cannot read the register it points into');
select act_as(:'alice');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice E'\nA blocker has an owner, a date and an end'; end $$;
-- ══════════════════════════════════════════════════════════════════════════
-- A blocked outcome says a day was lost. Who is chasing it, by when, and
-- whether it is still true is what turns a list of grievances into a list of
-- obstacles — and the history of that chase is the sentence a claim is built
-- from, so it is appended to and never edited.

select act_as(:'alice');
insert into public.rc_blockers (person_id, location_id, summary, party_id, raised_on)
values (:'p_carol', :'loc12', 'Possession released two hours late', :'party_bart', '2026-09-14');
select id as blk from public.rc_blockers where summary like 'Possession released%' \gset

select assert((select state from public.rc_blockers_current where id = :'blk') = 'open',
  'a blocker with nothing said about it yet is open');
select assert((select owner_id from public.rc_blockers_current where id = :'blk') is null,
  'and nobody is chasing it, which is the point of asking');

insert into public.rc_blocker_updates (blocker_id, owner_id, due_date, note)
values (:'blk', :'p_alice', '2026-09-18', 'Raised with BART ops');
select assert((select owner_id from public.rc_blockers_current where id = :'blk') = :'p_alice',
  'somebody takes it on');
select assert((select due_date from public.rc_blockers_current where id = :'blk') = '2026-09-18',
  'with a date it is expected by');

insert into public.rc_blocker_updates (blocker_id, state, note)
values (:'blk', 'resolved', 'Possession confirmed for the 19th');
select assert((select state from public.rc_blockers_current where id = :'blk') = 'resolved',
  'and closing it is another row, not an edit');
select assert((select count(*) from public.rc_blocker_updates where blocker_id = :'blk') = 2,
  'every step of the chase is still on the record');
select assert((select owner_id from public.rc_blockers_current where id = :'blk') is null,
  'the latest row is the state, including what it does not say');

-- The history is the evidence, so it cannot be rewritten. A refused UPDATE
-- would match nothing and report success, which is why the privilege is gone
-- rather than merely the policy.
select refuses(:'alice',
  format('update public.rc_blocker_updates set note = %L where blocker_id = %L',
         'Actually it was our fault', :'blk'),
  'an administrator rewriting the history of a blocker');
select refuses(:'alice',
  format('delete from public.rc_blockers where id = %L', :'blk'),
  'and deleting the blocker outright');

-- The person blocked is usually the first to know it cleared, so they may act
-- on their own; somebody else's is not theirs to close.
select act_as(:'carol');
insert into public.rc_blocker_updates (blocker_id, state, note)
values (:'blk', 'open', 'Still not released');
select assert((select state from public.rc_blockers_current where id = :'blk') = 'open',
  'the person blocked can reopen their own');
select assert((select count(*) from public.rc_blocker_updates where blocker_id = :'blk') = 3,
  'and reopening is a third row rather than undoing the second');
select refuses(:'carol',
  format('insert into public.rc_blockers (person_id, summary) values (%L, %L)',
         :'p_dan', 'Speaking for somebody else'),
  'a member raising a blocker against somebody else');
select assert((select count(*) from public.rc_blockers_current) = 1,
  'and everybody can see the ones that are open — a blocker nobody sees is one nobody chases');
select act_as(:'alice');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice E'\nA revised plan keeps what it was'; end $$;
-- ══════════════════════════════════════════════════════════════════════════
-- Never an update: the outgoing row stays and the new one points at it, so
-- "the plan changed the evening before the shift" is something the record can
-- still say. The chain comes across with it, or a revision would restart the
-- count on a stuck job the same way rolling one forward used to.

select act_as(:'alice');
insert into public.rc_plan_entries (person_id, work_date, task, location_id, carry_chain_id)
values (:'p_carol', '2026-09-21', 'Cable pull', :'loc12', :'chain_day1');
select id as rev_first from public.rc_plan_current
 where work_date = '2026-09-21' and task = 'Cable pull' \gset

select public.rc_supersede_plan(:'rev_first', :'loc12', 'Cable pull — night shift', null, 'night')
  as rev_second \gset

select assert((select count(*) from public.rc_plan_entries where work_date = '2026-09-21') = 2,
  'both versions are on the record');
select assert((select count(*) from public.rc_plan_current where work_date = '2026-09-21') = 1,
  'but only the live one is the plan');
select assert(
  (select task from public.rc_plan_current where work_date = '2026-09-21') = 'Cable pull — night shift',
  'and it is the revision');
select assert(
  (select carry_chain_id from public.rc_plan_current where work_date = '2026-09-21') = :'chain_day1',
  'the carry chain comes across, so a stuck job does not restart its count');

-- Two people revising the same entry: one of them has to be told, not
-- silently lose. A refused UPDATE would have matched nothing and reported
-- success, which is why this is a function.
select refuses(:'alice',
  format('select public.rc_supersede_plan(%L, null, %L, null)', :'rev_first', 'Third opinion'),
  'revising an entry somebody has already revised');

select act_as(:'carol');
select refuses(:'carol',
  format('select public.rc_supersede_plan(%L, null, %L, null)', :'rev_second', 'A member rewriting the plan'),
  'a member revising the plan at all');
select act_as(:'alice');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice E'\nThe legend, and which sheet to read'; end $$;
-- ══════════════════════════════════════════════════════════════════════════
-- Both are reference data with one sharp edge: they decide how every future
-- snapshot is *interpreted*. A member who could edit either could change what
-- a colour means under a claim that has already been made.

select act_as(:'alice');
insert into public.rc_legend (argb, meaning) values
  ('FFFF00', 'Day Shift'), ('FF0000', 'Cancellation'), ('000000', 'Blanket Shift');
select assert((select count(*) from public.rc_legend) = 3, 'an administrator maps the colours');
select assert((select bool_and(role = 'shift') from public.rc_legend),
  'and a colour is work unless somebody says otherwise');

-- What a colour *does*, separately from what it is called. The look-ahead
-- greys most of its calendar for structure, and no wording of the meaning
-- fixes that — "not scheduled" is still a meaning.
insert into public.rc_legend (argb, meaning, role) values
  ('7F7F7F', 'Not scheduled', 'ignore'), ('D9D9D9', 'Section divider', 'divider');
select assert((select count(*) from public.rc_legend where role <> 'shift') = 2,
  'shading and section bands are marked as what they are');
select refuses(:'alice',
  format('insert into public.rc_legend (argb, meaning, role) values (%L, %L, %L)',
         'ABCDEF', 'Something', 'whatever'),
  'a role the calendar would not know what to do with');
select assert((select value from public.rc_settings where key = 'lookahead_sheet') = '4WLA',
  'and the sheet to read has a default rather than a constant in the source');

select act_as(:'carol');
select assert((select count(*) from public.rc_legend) = 5,
  'a member can read the legend — their own row is drawn against it');
select assert((select count(*) from public.rc_settings) = 1, 'and the settings');
select refuses(:'carol',
  format('insert into public.rc_legend (argb, meaning) values (%L, %L)', '3399FF', 'Day Shift'),
  'a member mapping a colour');
select refuses(:'carol',
  'update public.rc_legend set meaning = ''Night Shift'' where argb = ''FFFF00''',
  'a member changing what a colour already means');
select refuses(:'carol',
  'update public.rc_settings set value = ''Sheet1'' where key = ''lookahead_sheet''',
  'a member pointing the read at a different sheet');

-- Retiring rather than deleting, for the same reason as everywhere else here:
-- every snapshot already read against that colour still has to mean what it
-- meant at the time.
select act_as(:'alice');
update public.rc_legend set active = false where argb = '000000';
select assert((select count(*) from public.rc_legend where active) = 4,
  'a retired colour leaves the active legend');
select assert((select count(*) from public.rc_legend) = 5,
  'but stays on the record, because snapshots were read against it');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice E'\nAccounts, invitations and roles'; end $$;
-- ══════════════════════════════════════════════════════════════════════════
-- Sign-up goes through GoTrue rather than PostgREST, so the interface has no
-- say in it: anybody holding the public key can POST to /auth/v1/signup. These
-- checks insert into `auth.users` directly, which is the closest thing to that
-- request, and confirm the trigger is what refuses it.
--
-- Both registers exist in this database — the timeline's `invitations` and the
-- calendar's `rc_invitations` — because a calendar deployment applies both
-- files. That is precisely the case `rc_enforce_invitation()` was written for,
-- and the checks below are what prove one gate serves both.

select id as p_bob  from public.rc_people where name = 'Deputy' \gset
select id as p_erin from public.rc_people where name = 'Erin'   \gset

-- ── Only administrators invite ────────────────────────────────────────────
select act_as(:'carol');
select refuses(:'carol',
  format('select public.rc_invite(%L)', 'friend@example.com'),
  'a member inviting somebody');
select assert((select count(*) from public.rc_list_invitations()) = 0,
  'a member reads an empty invitation list rather than everybody''s address');
select refuses(:'carol',
  format('select public.rc_revoke_invitation(%L)', 'friend@example.com'),
  'a member revoking an invitation');
select refuses(:'carol',
  format('select public.rc_link_account(%L, %L)', :'p_dan', 'carol@example.com'),
  'a member attaching an account to a roster row');
select refuses(:'carol',
  format('select public.rc_set_role(%L, %L)', :'p_carol', 'admin'),
  'a member promoting themselves');
-- And not around the function either: the role lives on a table with a policy.
select refuses(:'carol',
  format('update public.rc_people set role = ''admin'' where id = %L', :'p_carol'),
  'a member writing the role straight onto the row');

-- ── Inviting ──────────────────────────────────────────────────────────────
select act_as(:'alice');
select public.rc_invite('newtech@example.com', 'viewer', :'p_dan', 'Field technician');
select assert((select count(*) from public.rc_list_invitations()) = 1,
  'an administrator can invite');
select refuses(:'alice',
  format('select public.rc_invite(%L)', 'not-an-email'),
  'inviting something that is not an email address');
select refuses(:'alice',
  format('select public.rc_invite(%L)', 'carol@example.com'),
  'inviting somebody who already has an account');
select refuses(:'alice',
  format('select public.rc_invite(%L, %L)', 'spare@example.com', 'superuser'),
  'inviting somebody to a role that does not exist');

-- ── The invited can join, and land where they were invited to ─────────────
-- This is the whole point of carrying the role and the person on the
-- invitation: somebody joins and is on the team, with the right permissions,
-- without an administrator opening the SQL editor.
reset role;
insert into auth.users (email) values ('newtech@example.com');
select id as u_newtech from auth.users where email = 'newtech@example.com' \gset

select assert((select user_id from public.rc_people where id = :'p_dan') = :'u_newtech',
  'an invited account attaches to the roster row it was invited for');
select assert((select role from public.rc_people where id = :'p_dan') = 'viewer',
  'with the role the invitation named');
select assert((select email from public.rc_people where id = :'p_dan') = 'newtech@example.com',
  'and the address it was sent to');
select assert(
  (select accepted_at is not null from public.rc_invitations where email = 'newtech@example.com'),
  'and the invitation is marked used');
select assert((select count(*) from public.rc_list_invitations()) = 0,
  'so it leaves the pending list');

-- An invitation that names nobody still puts them on the team. Somebody who
-- can sign in but is on nobody's roster sees an explanation and nothing else,
-- which is a worse first day than simply being on it.
set role authenticated;
select act_as(:'alice');
select public.rc_invite('graduate@example.com', 'member');
reset role;
insert into auth.users (email) values ('graduate@example.com');
select assert(
  exists (select 1 from public.rc_people
           where email = 'graduate@example.com' and role = 'member' and user_id is not null),
  'an invitation naming no roster row creates one');

-- ── The uninvited are refused, whatever they know ─────────────────────────
select refuses(:'alice',
  format('insert into auth.users (email) values (%L)', 'stranger2@example.com'),
  'signing up for the calendar without an invitation');
select assert(not exists (select 1 from auth.users where email = 'stranger2@example.com'),
  'and no account is left behind');

-- A used invitation is not a reusable key.
delete from auth.users where email = 'graduate@example.com';
select refuses(:'alice',
  format('insert into auth.users (email) values (%L)', 'graduate@example.com'),
  'reusing an invitation that has already been accepted');

-- Nor is a lapsed one.
set role authenticated;
select act_as(:'alice');
select public.rc_invite('late2@example.com');
reset role;
update public.rc_invitations set expires_at = now() - interval '1 day'
 where email = 'late2@example.com';
select refuses(:'alice',
  format('insert into auth.users (email) values (%L)', 'late2@example.com'),
  'accepting a calendar invitation that has expired');

-- Re-inviting reopens it, which is what an administrator will actually do when
-- somebody says the link stopped working.
set role authenticated;
select act_as(:'alice');
select public.rc_invite('late2@example.com', 'viewer');
select assert(
  (select count(*) from public.rc_list_invitations() where pending_email = 'late2@example.com') = 1,
  'and re-inviting them reopens it');
reset role;
insert into auth.users (email) values ('late2@example.com');
select assert(exists (select 1 from public.rc_people where email = 'late2@example.com'),
  'so the second attempt goes through');

-- ── Revoking ──────────────────────────────────────────────────────────────
set role authenticated;
select act_as(:'alice');
select public.rc_invite('changed-my-mind2@example.com');
select public.rc_revoke_invitation('changed-my-mind2@example.com');
reset role;
select refuses(:'alice',
  format('insert into auth.users (email) values (%L)', 'changed-my-mind2@example.com'),
  'signing up after the calendar invitation was revoked');

-- ── Linking an account that already exists ────────────────────────────────
-- Somebody who signed up before their roster row did. Without this the only
-- way to attach the two is the SQL editor, every time somebody joins.
update public.rc_people set user_id = null where id = :'p_dan';
set role authenticated;
select act_as(:'alice');
select refuses(:'alice',
  format('select public.rc_link_account(%L, %L)', :'p_erin', 'nobody@example.com'),
  'linking an address that has no account');
select refuses(:'alice',
  format('select public.rc_link_account(%L, %L)', :'p_erin', 'carol@example.com'),
  'linking an account that already belongs to somebody else');
select refuses(:'alice',
  format('select public.rc_link_account(%L, %L)', gen_random_uuid(), 'newtech@example.com'),
  'linking an account to nobody');
select assert(public.rc_link_account(:'p_dan', 'NewTech@Example.com ') = :'u_newtech',
  'an administrator can attach an existing account to a roster row');
select assert((select user_id from public.rc_people where id = :'p_dan') = :'u_newtech',
  'and the link is on the row');

-- ── Changing a role ───────────────────────────────────────────────────────
select public.rc_set_role(:'p_dave', 'viewer');
select assert((select role from public.rc_people where id = :'p_dave') = 'viewer',
  'an administrator can change a role');
select refuses(:'alice',
  format('select public.rc_set_role(%L, %L)', :'p_dave', 'superuser'),
  'setting a role that does not exist');
select refuses(:'alice',
  format('select public.rc_set_role(%L, %L)', gen_random_uuid(), 'member'),
  'changing the role of nobody');

-- The guard that matters. A refused UPDATE matches nothing and reports
-- success, so an administrator who demoted the last administrator by accident
-- would be told it worked — and nobody could put it back.
select public.rc_set_role(:'p_bob', 'member');
select refuses(:'alice',
  format('select public.rc_set_role(%L, %L)', :'p_alice', 'member'),
  'demoting the only administrator left');
select assert((select role from public.rc_people where id = :'p_alice') = 'admin',
  'so there is still somebody who can administer it');
select public.rc_set_role(:'p_bob', 'admin');
select act_as(:'bob');
select assert(public.rc_is_admin(), 'and a promoted person is an administrator again');

reset role;
do $$ begin raise notice ''; raise notice 'All resource calendar checks passed.'; end $$;
