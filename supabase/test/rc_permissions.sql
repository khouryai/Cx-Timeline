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

/* The other spellings of a *person*, which the look-ahead's Resource row is
   full of: "R. Okafor" one week and "Okafor" the next. Reference data like any
   other — everybody reads it, only an administrator writes it — because a name
   nobody has mapped is a person missing from the picture, and everybody has to
   be able to see the same picture. */
select refuses(:'carol',
  format('insert into public.rc_person_alias (person_id, alias) values (%L, %L)',
         :'p_carol', 'C. Nwosu'),
  'a member mapping a spelling to a person');

select act_as(:'alice');
insert into public.rc_locations (name, code) values ('Yard 3', 'Y3');
select assert(
  (select count(*) from public.rc_locations) = 3,
  'an administrator can add a location'
);
insert into public.rc_person_alias (person_id, alias) values (:'p_carol', 'C. Nwosu');
select assert((select person_id from public.rc_person_alias where alias = 'C. Nwosu') = :'p_carol',
  'an administrator can say which spelling is whose');
select act_as(:'carol');
select assert((select count(*) from public.rc_person_alias) = 1,
  'and everybody can read it, so everybody sees the same picture');
select act_as(:'alice');

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
-- And the code, which is what the 4WLA's Location column is actually filled in
-- with: that sheet says "T12", not "TPSS 12". Without this the whole column
-- resolved to nothing on a register that was otherwise complete.
select assert(public.rc_resolve_location('T12')       = :'loc12', 'and so does the location code');
select assert(public.rc_resolve_location('t-12')      = :'loc12', 'folded the same way as a name');
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

/* A member asks; an administrator answers.
   Booking was administrators-only, which made the commonest thing anybody wants
   from this module something they had to get somebody else to type — so it went
   into the 4WLA instead, or nowhere. The status is the whole permission: a
   member may write `requested` for themselves and nothing else, so a request
   cannot approve itself and nobody can ask on somebody else's behalf. */
select refuses(:'carol',
  format('insert into public.rc_leave (person_id, start_date, end_date) values (%L, %L, %L)',
         :'p_carol', '2026-09-14', '2026-09-15'),
  'a member booking their own leave as approved');
select refuses(:'carol',
  format('insert into public.rc_leave (person_id, start_date, end_date, status)
          values (%L, %L, %L, ''requested'')', :'p_dan', '2026-09-14', '2026-09-15'),
  'a member asking for somebody else''s leave');

select act_as(:'carol');
insert into public.rc_leave (person_id, start_date, end_date, status)
values (:'p_carol', date '2026-09-14', date '2026-09-15', 'requested');
select assert((select count(*) from public.rc_leave where status = 'requested') = 1,
  'a member can ask for their own leave');
select id as leave_carol from public.rc_leave where person_id = :'p_carol' \gset

-- Asking has to be something you can take back, or people learn not to ask.
-- Cancelling is the only status a member can write, which is what stops the
-- update policy being a way to approve yourself.
select refuses(:'carol',
  format('update public.rc_leave set status = ''approved'' where id = %L', :'leave_carol'),
  'a member approving their own request');
update public.rc_leave set status = 'cancelled' where id = :'leave_carol';
select assert((select status from public.rc_leave where id = :'leave_carol') = 'cancelled',
  'but they can withdraw it');
select refuses(:'carol',
  format('delete from public.rc_leave where id = %L', :'leave_carol'),
  'a member deleting a leave row outright');

select act_as(:'alice');
update public.rc_leave set status = 'approved' where id = :'leave_carol';
select assert((select status from public.rc_leave where id = :'leave_carol') = 'approved',
  'an administrator answers it');

select act_as(:'carol');
select assert((select count(*) from public.rc_leave) = 2, 'and they can see both');

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
         :'p_dan', '2026-09-01', 'Somebody else''s day'),
  'a member planning somebody else''s day');

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
  'a member revising somebody else''s plan');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'A member plans their own days'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

/* The office day, the other project, the task the 4WLA says nothing about. A
   member could already say what they had *done* and not what they were going
   to do, which left the one person who knows their own week unable to write
   any of it down. */
select act_as(:'carol');
insert into public.rc_plan_entries (person_id, work_date, task)
values (:'p_carol', date '2026-09-10', 'Office — as-built markups');
select assert((select count(*) from public.rc_plan_current
                where person_id = :'p_carol' and work_date = date '2026-09-10') = 1,
  'a member can plan their own day');

/* Several tasks on one day, which is the normal shape of a shift: a test to
   witness in the morning and a cable pull after it. Both are current — nothing
   supersedes anything — and every view reads a day as a list. */
insert into public.rc_plan_entries (person_id, work_date, task)
values (:'p_carol', date '2026-09-10', 'Witness the IXL regression run');
select assert((select count(*) from public.rc_plan_current
                where person_id = :'p_carol' and work_date = date '2026-09-10') = 2,
  'a day can carry more than one task, and both are current');

/* And they can correct it. Writing a day somebody then cannot fix is the "no
   way back" trap this schema avoids everywhere else. */
select id as mine from public.rc_plan_current
  where person_id = :'p_carol' and task = 'Office — as-built markups' \gset
select public.rc_supersede_plan(:'mine', null, 'Office — as-built markups and the RFI log', null)
  as mine2 \gset
select assert((select task from public.rc_plan_entries where id = :'mine2')
                = 'Office — as-built markups and the RFI log',
  'a member can revise their own day');
select assert((select supersedes_id from public.rc_plan_entries where id = :'mine2') = :'mine',
  'and it supersedes rather than edits, like every other revision');

/* And they can take it back.
   "Delete my task" with the record kept, which is the only shape a delete can
   take on a table with no DELETE grant: a tombstone superseding the original,
   and `rc_plan_current` drops the pair. The schedule stops showing the day; the
   table still says it was planned and then withdrawn, by whom and when. */
select public.rc_withdraw_plan(:'mine2') as gone \gset
select assert((select count(*) from public.rc_plan_current
                where person_id = :'p_carol' and work_date = date '2026-09-10') = 1,
  'a member can withdraw their own day, and it leaves the schedule');
select assert((select withdrawn from public.rc_plan_entries where id = :'gone'),
  'as a tombstone rather than a deletion');
select assert((select count(*) from public.rc_plan_entries
                where person_id = :'p_carol' and work_date = date '2026-09-10') = 4,
  'so every version of that day is still on the record');
select refuses(:'carol',
  format('select public.rc_withdraw_plan(%L)', :'gone'),
  'withdrawing the same entry twice');
select refuses(:'carol',
  format('select public.rc_withdraw_plan(%L)', :'plan2'),
  'a member withdrawing somebody else''s day');

select act_as(:'alice');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'The sheet moves a task to somebody else'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

/* A stored entry linked to a look-ahead row is somebody confirming or
   overriding what the sheet said. When the next read of that sheet names a
   different person on the same row the work has moved — and leaving the entry
   against the original person is how somebody turns up for a shift that is not
   theirs while the person who now has it has a blank against their name. */
insert into public.rc_plan_entries (person_id, work_date, task)
values (:'p_dan', date '2026-09-24', 'Witness the TPSS energisation');
select id as moving from public.rc_plan_current where work_date = date '2026-09-24' \gset

select refuses(:'carol',
  format('select public.rc_reassign_plan(%L, %L)', :'moving', :'p_carol'),
  'a member reassigning a day to themselves');
-- `refuses()` leaves the claim set to whoever it acted as.
select act_as(:'alice');

select public.rc_reassign_plan(:'moving', :'p_carol') as moved \gset
select assert((select person_id from public.rc_plan_entries where id = :'moved') = :'p_carol',
  'an administrator moves it to the person the sheet now names');
select assert((select reassigned_from from public.rc_plan_entries where id = :'moved') = :'p_dan',
  'and the new row says where it came from, so it can be badged as moved');
select assert((select supersedes_id from public.rc_plan_entries where id = :'moved') = :'moving',
  'the outgoing row stays, like every other revision');
select assert((select count(*) from public.rc_plan_current
                where work_date = date '2026-09-24') = 1,
  'and only one of them is the plan');

-- A re-read that changed nothing must write nothing, or every ingest would fill
-- the history with revisions saying the same thing.
select refuses(:'alice',
  format('select public.rc_reassign_plan(%L, %L)', :'moved', :'p_carol'),
  'moving a day to the person who already has it');
select refuses(:'alice',
  format('select public.rc_reassign_plan(%L, %L)', :'moving', :'p_carol'),
  'moving a day that has already been revised');

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

-- A correction is a new row pointing at the old one, and the old one stays.
-- What every reader sees is `rc_actuals_current`; the table keeps what was
-- first said, because the change is itself a fact about the evidence.
select public.rc_record_actual(
  gen_random_uuid(), :'p_dan', date '2026-09-01', 'completed', :'cat_field', :'loc12',
  'finished after all', null, null, null, null, 'day', null, null, :'act2') as act2b \gset
select assert((select count(*) from public.rc_actuals) = 3,
  'correcting an outcome writes a new row');
select assert((select count(*) from public.rc_actuals_current) = 2,
  'and the view still shows one outcome per person per day');
select assert(
  (select status from public.rc_actuals_current where person_id = :'p_dan' and work_date = date '2026-09-01')
    = 'completed',
  'which is the corrected one');
select assert((select supersedes_id from public.rc_actuals where id = :'act2b') = :'act2',
  'pointing at the row it corrects');
select assert((select status from public.rc_actuals where id = :'act2') = 'partial',
  'while the first answer is still on the record');

-- Two people correcting one outcome: the second is told, not silently overruled.
select refuses(:'alice',
  format('select public.rc_record_actual(%L, %L, %L, %L, null, null, null, null, null, null, null, %L, null, null, %L)',
         gen_random_uuid(), :'p_dan', '2026-09-01', 'carried', 'day', :'act2'),
  'correcting an outcome that has already been corrected');
-- And a "correction" cannot move somebody else's evidence under one's own name.
select refuses(:'alice',
  format('select public.rc_record_actual(%L, %L, %L, %L, null, null, null, null, null, null, null, %L, null, null, %L)',
         gen_random_uuid(), :'p_carol', '2026-09-01', 'completed', 'day', :'act2b'),
  'correcting an outcome onto a different person');
select act_as(:'alice');

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
do $$ begin raise notice 'A photograph of what was said'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

-- The picture goes up before the row, under a name generated on the client,
-- because this table has no UPDATE grant and so the path cannot be attached
-- afterwards.
select act_as(:'carol');
insert into storage.objects (bucket_id, name)
  values ('evidence', '44444444-4444-4444-4444-444444444444.jpg');
select public.rc_record_actual(
  '44444444-4444-4444-4444-444444444444'::uuid, :'p_carol', date '2026-09-08',
  'partial', :'cat_field', :'loc12', 'North end left to pull', null, null,
  null, null, 'day', null, 'evidence/44444444-4444-4444-4444-444444444444.jpg') as act_ev \gset
select assert(
  (select evidence_path from public.rc_actuals where id = :'act_ev')
    = 'evidence/44444444-4444-4444-4444-444444444444.jpg',
  'an outcome can carry the photograph taken with it');
select assert(
  (select note from public.rc_actuals where id = :'act_ev') = 'North end left to pull',
  'and what is left of the task, in the words somebody said it in');

-- Editing the note after the meeting must not lose the photograph taken
-- during it: a correction with no picture of its own inherits the old one.
select public.rc_record_actual(
  gen_random_uuid(), :'p_carol', date '2026-09-08',
  'partial', :'cat_field', :'loc12', 'North end left to pull — south end done', null, null,
  null, null, 'day', null, null, :'act_ev') as act_ev2 \gset
select assert(
  (select evidence_path from public.rc_actuals where id = :'act_ev2')
    = 'evidence/44444444-4444-4444-4444-444444444444.jpg',
  'a corrected note keeps the photograph');
select assert(
  (select note from public.rc_actuals_current where person_id = :'p_carol' and work_date = date '2026-09-08')
    = 'North end left to pull — south end done',
  'and the view reads the corrected words');
select act_as(:'alice');
select assert(
  (select count(*) from public.rc_effort where person_id = :'p_carol' and work_date = date '2026-09-08') = 1,
  'and the report counts the day once, not once per correction');

-- Anybody signed in can see it: a picture only its author can open is not
-- evidence of anything.
select act_as(:'dave');
select assert(
  (select count(*) from storage.objects where bucket_id = 'evidence') = 1,
  'a viewer can open the evidence attached to an outcome');
select refuses(:'dave',
  $q$insert into storage.objects (bucket_id, name) values ('evidence', 'forged.jpg')$q$,
  'a viewer uploading evidence of their own');

-- And the SAR bucket stays what it was: the deputy's, not the team's.
select refuses(:'carol',
  $q$insert into storage.objects (bucket_id, name) values ('sars', 'SAR-1.pdf')$q$,
  'a member uploading a SAR');
select act_as(:'alice');
insert into storage.objects (bucket_id, name) values ('sars', 'inbox/SAR-1.pdf');
select assert((select count(*) from storage.objects where bucket_id = 'sars') = 1,
  'an administrator files one');
select act_as(:'carol');
select assert((select count(*) from storage.objects where bucket_id = 'sars') = 0,
  'and a member cannot read it');

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
select assert((select count(*) from public.rc_effort) = 7,
  'an administrator sees the effort history');
select assert(
  (select signal from public.rc_effort where id = :'act3') = 'health',
  'a block is a project-health signal, never an individual one');
select assert(
  (select signal from public.rc_effort where id = :'act1') = 'performance',
  'a completion is a performance signal');

-- Enforced by the policy, not by hiding a menu item: a member calling the API
-- directly gets nothing back.
select act_as(:'carol');
select assert((select count(*) from public.rc_effort) = 0,
  'a member sees none of it, even reading the view directly');
-- Nine, not seven: two of them are corrections, and the table keeps the rows
-- they corrected. Only the view narrows.
select assert((select count(*) from public.rc_actuals) = 9,
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

/* The calendar is the team's. It is what the field team is being asked to do,
   and while it was administrators-only the people named on it were the only
   people who could not look at it. */
select act_as(:'carol');
select assert((select count(*) from public.rc_lookahead_snapshots) = 1,
  'a member can read the 4WLA snapshot');
select assert((select count(*) from public.rc_lookahead_rows) = 1,
  'and the rows derived from it');
select refuses(:'carol',
  format('insert into public.rc_lookahead_snapshots (file_hash, sheet_name, grid)
          values (%L, %L, ''{}''::jsonb)', 'hash-two', '4WLA'),
  'a member writing to the look-ahead register');

/* The register *around* the calendar is a different thing: ingest runs, change
   events and SARs are the evidence base for a delay claim. */
select assert((select count(*) from public.rc_change_events) = 0,
  'a member sees none of the change register');
select act_as(:'alice');

-- The metadata view is what every screen reads instead of the grids, so it has
-- to answer with the same numbers and refuse the same people. (`refuses()`
-- leaves the session as the person it tried, so this says who is asking.)
select act_as(:'alice');
select assert((select row_count from public.rc_lookahead_snapshot_meta where id = :'snap1') = 0,
  'the snapshot list carries the row count without the grid');
select assert((select count(*) from public.rc_lookahead_snapshot_meta) = 1,
  'and an administrator sees every snapshot on it');
/* The view is `security_invoker`, so it follows the table — which the team can
   now read. What it must not do is *leak* more than the table: the grids stay
   off it, and the two counts are all it adds. */
select act_as(:'carol');
select assert((select count(*) from public.rc_lookahead_snapshot_meta) = 1,
  'a member reads the snapshot list through the view, as they do the table');
select act_as(:'alice');

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
do $$ begin raise notice 'The cancellation log'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');
insert into public.rc_legend (argb, meaning, role, valid_from)
values ('FF0000', 'Cancellation', 'shift', date '2026-02-02');

-- Two reads. The second still shows the Monday and Tuesday and adds the
-- Wednesday, stored as the bare colour because it was read before red was
-- mapped; a Day Shift beside them is not a cancellation.
insert into public.rc_lookahead_snapshots (file_hash, sheet_name, grid, taken_at)
values ('hash-cx-1', '4WLA', '{"rows":[]}'::jsonb, timestamptz '2026-09-07 08:00+00'),
       ('hash-cx-2', '4WLA', '{"rows":[]}'::jsonb, timestamptz '2026-09-08 08:00+00');
select id as cx1 from public.rc_lookahead_snapshots where file_hash = 'hash-cx-1' \gset
select id as cx2 from public.rc_lookahead_snapshots where file_hash = 'hash-cx-2' \gset
insert into public.rc_lookahead_rows (snapshot_id, week_start, row_key, raw_location, raw_label, cells) values
  (:'cx1', date '2026-09-07', 'cx|a', 'TPSS 12', 'Cable pull',
   '{"2026-09-07":"Cancellation","2026-09-08":"Cancellation","2026-09-09":"Day Shift"}'::jsonb),
  (:'cx2', date '2026-09-07', 'cx|b', 'TPSS 12', 'Cable pull',
   '{"2026-09-07":"Cancellation","2026-09-08":"Cancellation","2026-09-09":"#FF0000"}'::jsonb);

select assert((select count(*) from public.rc_cancelled_days where raw_label = 'Cable pull') = 3,
  'every red day is in the log once, however many reads showed it');
select assert((select reads from public.rc_cancelled_days
                where raw_label = 'Cable pull' and day = date '2026-09-07') = 2,
  'with how many reads showed it');
select assert((select count(*) from public.rc_cancelled_days
                where raw_label = 'Cable pull' and day = date '2026-09-09') = 1,
  'a day stored as the bare red is a cancellation once red is mapped as one');

insert into public.rc_cancellation_notes (raw_label, raw_location, start_date, end_date, party, reason)
values ('Cable pull', 'TPSS 12', date '2026-09-07', date '2026-09-09', 'BART', 'Possession withdrawn');
select id as cx_note from public.rc_cancellation_notes where raw_label = 'Cable pull' \gset

select refuses(:'alice',
  format('update public.rc_cancellation_notes set party = %L where id = %L', 'Hitachi', :'cx_note'),
  'editing why something was cancelled');
select refuses(:'alice',
  format('delete from public.rc_cancellation_notes where id = %L', :'cx_note'),
  'deleting it');
select refuses(:'alice',
  format('insert into public.rc_cancellation_notes (raw_label, start_date, end_date, party) values (%L, %L, %L, %L)',
         'Cable pull', '2026-09-07', '2026-09-07', 'Contractor'),
  'a party that is not BART, Hitachi or Other');
select act_as(:'alice');

insert into public.rc_cancellation_notes (raw_label, raw_location, start_date, end_date, party, reason, supersedes_id)
values ('Cable pull', 'TPSS 12', date '2026-09-07', date '2026-09-09', 'Hitachi', 'Our crew was reallocated', :'cx_note');
select assert((select count(*) from public.rc_cancellation_notes) = 2,
  'a correction is an additional row');

select refuses(:'carol',
  format('insert into public.rc_cancellation_notes (raw_label, start_date, end_date, party) values (%L, %L, %L, %L)',
         'Cable pull', '2026-09-07', '2026-09-07', 'BART'),
  'a member recording whose cancellation it was');
select act_as(:'carol');
select assert((select count(*) from public.rc_cancellation_notes) = 0,
  'and a member cannot read the judgements');
select assert((select count(*) from public.rc_cancelled_days where raw_label = 'Cable pull') = 3,
  'though the red days themselves are the 4WLA, which is theirs to read');
select act_as(:'alice');

-- Leave the register as the sections below expect it: their counts know
-- nothing of these two reads or of red being mapped this early.
delete from public.rc_lookahead_snapshots where id in (:'cx1', :'cx2');
delete from public.rc_legend where argb = 'FF0000' and valid_from = date '2026-02-02';

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
select assert((select count(*) from public.rc_leave) = 2,
  'and who is on leave');
-- Three: Dan's revised day, and the two tasks Carol planned for herself on the
-- tenth. A viewer reads the whole plan and writes none of it.
select assert((select count(*) from public.rc_plan_current) = 3,
  'and the current plan');
select assert((select count(*) from public.rc_actuals) = 9,
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
-- A viewer cannot even ask. `rc_can_act_for()` is false for them, which is the
-- same line that stops them recording their own outcome — asking for leave is a
-- write and a viewer writes nothing.
select refuses(:'dave',
  format('insert into public.rc_leave (person_id, start_date, end_date, status)
          values (%L, %L, %L, ''requested'')', :'p_dave', '2026-09-14', '2026-09-15'),
  'a viewer asking for their own leave');
select refuses(:'dave',
  format('insert into public.rc_locations (name) values (%L)', 'Invented'),
  'a viewer adding reference data');

/* The KPIs and the claim evidence stay with the two administrators, enforced
   by the policy rather than by hiding a tab. The *calendar* is not evidence —
   it is what the team is being asked to do, and a viewer reads it like anybody
   else on the team. */
select assert((select count(*) from public.rc_effort) = 0,
  'a viewer sees no KPI history');
select assert((select count(*) from public.rc_lookahead_snapshots) = 1,
  'but does read the 4WLA, which is what they are being asked to do');
select assert((select count(*) from public.rc_change_events) = 0,
  'and none of the change register around it');
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
select assert((select count(*) from public.rc_actuals) = 10, 'which goes through');

/* Only their own — of both. The promotion carries the plan with it now, which
   is the point of the role: somebody who can say what they did can say what
   they are going to do. Neither reaches anybody else's row. */
select refuses(:'dave',
  format('select public.rc_record_actual(%L, %L, %L, %L)',
         gen_random_uuid(), :'p_dan', '2026-09-08', 'completed'),
  'a member recording for somebody else');
insert into public.rc_plan_entries (person_id, work_date, task)
values (:'p_dave', date '2026-09-09', 'Next week');
select assert((select count(*) from public.rc_plan_current where person_id = :'p_dave') = 1,
  'and their own plan goes through with it');
select refuses(:'dave',
  format('insert into public.rc_plan_entries (person_id, work_date, task) values (%L, %L, %L)',
         :'p_dan', '2026-09-09', 'Not theirs'),
  'a member planning somebody else''s day');

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

/* And a member can follow it. The row is what the block is evidence *against*,
   so a member reading their own blocked day and not the row it names would be
   reading half a sentence. */
select act_as(:'carol');
select assert((select count(*) from public.rc_lookahead_rows where id = :'la_row') = 1,
  'and a member can read the row it points into');
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

/* Carol may revise `rev_second`, because it is her own day — that is proved
   above. What she may not do is reach across to somebody else's, which is the
   half of the rule that matters here. */
insert into public.rc_plan_entries (person_id, work_date, task)
values (:'p_dan', '2026-09-22', 'Dan''s day');
select id as dans_day from public.rc_plan_current where work_date = '2026-09-22' \gset
select refuses(:'carol',
  format('select public.rc_supersede_plan(%L, null, %L, null)', :'dans_day', 'A member rewriting somebody else''s plan'),
  'a member revising a day that is not theirs');
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
select assert((select count(*) from public.rc_settings) = 2, 'and the settings');
select assert((select value from public.rc_settings where key = 'cancellation_log_from') = '2026-09-01',
  'the cancellation log starts in September unless somebody says otherwise');
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
-- Neither an account nor an invitation. The only case with genuinely nothing to
-- attach and nothing on its way, and so the only one that refuses.
select refuses(:'alice',
  format('select public.rc_link_account(%L, %L)', :'p_erin', 'nobody@example.com'),
  'linking an address that has neither an account nor an invitation');
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

/*
 * An address that is invited and has not signed up yet.
 *
 * This used to refuse, with "no account exists for x — invite them first", and
 * that was the commonest answer by a wide margin *and* the wrong sentence: they
 * had been invited, and there was nothing the administrator could do about the
 * rest. The invitation is aimed at the roster row instead and null comes back,
 * meaning "arranged, not linked".
 */
select public.rc_invite('waiting@example.com', 'member');
select assert(public.rc_link_account(:'p_erin', 'Waiting@Example.com ') is null,
  'linking an invited address that has not signed up yet is arranged, not refused');
select assert(
  (select person_id from public.rc_invitations where email = 'waiting@example.com') = :'p_erin',
  'and the invitation now points at that roster row');
reset role;
insert into auth.users (email) values ('waiting@example.com');
select assert(
  (select user_id from public.rc_people where id = :'p_erin')
    = (select id from auth.users where email = 'waiting@example.com'),
  'so signing up lands the account on the row it was aimed at');
select assert((select role from public.rc_people where id = :'p_erin') = 'member',
  'with the role the invitation carried');
set role authenticated;
select act_as(:'alice');

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

-- ── Deleting a reference row, and refusing to ─────────────────────────────
-- Retire keeps the history and is the right answer for anybody who has been
-- here. Delete is for a row that was never meant, and the refusal is the whole
-- design: `rc_plan_entries` and `rc_actuals` cascade on `person_id`, so an
-- unguarded delete would take a year of evidence with it at the database.
select act_as(:'alice');

select refuses(:'alice',
  format('select public.rc_delete_person(%L)', :'p_dan'),
  'deleting somebody with outcomes recorded against them');
select assert((select count(*) from public.rc_people where id = :'p_dan') = 1,
  'so they are still there to be retired instead');

select refuses(:'alice',
  format('select public.rc_delete_location(%L)', :'loc12'),
  'deleting a location work has been recorded at');
select refuses(:'alice',
  format('select public.rc_delete_person(%L)', gen_random_uuid()),
  'deleting nobody');

-- A row nothing points at is the case this exists for.
insert into public.rc_people (name, role) values ('Typo Twice', 'member');
select id as p_typo from public.rc_people where name = 'Typo Twice' \gset
select public.rc_delete_person(:'p_typo');
select assert((select count(*) from public.rc_people where id = :'p_typo') = 0,
  'a person nothing has been recorded against is deleted outright');

insert into public.rc_locations (name, code) values ('Mistyped Yard', 'MY1');
select id as loc_typo from public.rc_locations where name = 'Mistyped Yard' \gset
insert into public.rc_location_alias (location_id, alias) values (:'loc_typo', 'Mispelt Yard');
select public.rc_delete_location(:'loc_typo');
select assert((select count(*) from public.rc_locations where id = :'loc_typo') = 0,
  'and so is a location nothing names');
select assert((select count(*) from public.rc_location_alias where location_id = :'loc_typo') = 0,
  'its spellings going with it, because they mean nothing without it');

insert into public.rc_legend (argb, meaning, role, valid_from)
values ('ABCDEF', 'Mapped by mistake', 'shift', date '2026-01-01');
select id as leg_typo from public.rc_legend where argb = 'ABCDEF' \gset
select public.rc_delete_legend(:'leg_typo');
select assert((select count(*) from public.rc_legend where id = :'leg_typo') = 0,
  'a colour mapped by mistake goes back to being unmapped');

-- Not a member's to do, whatever the row.
insert into public.rc_people (name, role) values ('Spare', 'member');
select id as p_spare from public.rc_people where name = 'Spare' \gset
select refuses(:'carol',
  format('select public.rc_delete_person(%L)', :'p_spare'),
  'a member deleting somebody off the roster');
-- `refuses()` leaves the claim set to whoever it acted as.
select act_as(:'alice');

-- The same guard `rc_set_role` makes, for the same reason: there has to be
-- somebody left who can administer it.
select public.rc_set_role(:'p_bob', 'member');
select refuses(:'alice',
  format('select public.rc_delete_person(%L)', :'p_alice'),
  'deleting the only administrator left');
select public.rc_set_role(:'p_bob', 'admin');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'What somebody did, in words'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');

-- What they did, in words — on a day with nothing planned it is the only
-- statement of the work there is — and a correction can change it.
select public.rc_record_actual(
  '23232323-2323-2323-2323-232323232323'::uuid, :'p_dan', date '2026-12-02',
  'completed', :'cat_field', null, null, null, null, null, null, 'day', null, null, null,
  'Pulled cable at the north end') as act_task \gset
select assert((select task from public.rc_actuals where id = :'act_task') = 'Pulled cable at the north end',
  'an outcome says what somebody actually did');
select public.rc_record_actual(
  '24242424-2424-2424-2424-242424242424'::uuid, :'p_dan', date '2026-12-02',
  'completed', null, null, null, null, null, null, null, 'day', null, null, :'act_task',
  'Terminated cable at the north end') as act_task2 \gset
select assert((select task from public.rc_actuals_current where person_id = :'p_dan' and work_date = date '2026-12-02')
  = 'Terminated cable at the north end', 'and correcting it is a new row the readers see');
select assert((select task from public.rc_actuals where id = :'act_task') = 'Pulled cable at the north end',
  'while the first answer stays underneath');

reset role;
do $$ begin raise notice ''; raise notice 'All resource calendar checks passed.'; end $$;
