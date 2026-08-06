-- ══════════════════════════════════════════════════════════════════════════
-- Permission model tests.
--
-- The read-only role is a security control, so it is tested the way a security
-- control has to be: by *being* each user and confirming the database refuses
-- the writes it should. Every check runs as `authenticated`, never as the
-- table owner, because row-level security does not apply to the owner and a
-- test that skipped that would pass while proving nothing.
--
--   npm run test:sql
-- ══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\set QUIET on

create or replace function assert(ok boolean, what text)
returns void language plpgsql as $$
begin
  if ok is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice '  ok  %', what;
end;
$$;

-- Run `body` as `who` and report whether the database refused it.
--
-- Refusal takes two shapes and the test has to accept both. An INSERT that
-- fails WITH CHECK raises, but an UPDATE or DELETE whose USING clause excludes
-- the row simply matches nothing and reports success on zero rows. Checking
-- only for an exception would have passed a policy that let viewers write.
-- (The client has to reason about this too, which is why every save in the
-- application goes through save_project(), where the refusal is explicit.)
create or replace function refuses(who uuid, body text, what text)
returns void language plpgsql as $$
declare
  raised   boolean := false;
  affected bigint  := 0;
begin
  perform set_config('request.jwt.claim.sub', who::text, false);
  begin
    execute body;
    get diagnostics affected = row_count;
  exception when others then
    raised := true;
  end;
  if not raised and affected > 0 then
    raise exception 'FAILED: % — the operation was ALLOWED (% row(s))', what, affected;
  end if;
  raise notice '  ok  refused: %  [%]', what,
    case when raised then 'error' else 'no rows' end;
end;
$$;

-- `false` = session-level, not transaction-local. psql autocommits every
-- statement, so a transaction-local setting would be gone before the next one
-- and every check would run as nobody.
create or replace function act_as(who uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', who::text, false);
end;
$$;

-- ── Cast ──────────────────────────────────────────────────────────────────
insert into auth.users (email) values
  ('alice@example.com'), ('bob@example.com'),
  ('carol@example.com'), ('dave@example.com');

select id as alice from auth.users where email = 'alice@example.com' \gset
select id as bob   from auth.users where email = 'bob@example.com'   \gset
select id as carol from auth.users where email = 'carol@example.com' \gset
select id as dave  from auth.users where email = 'dave@example.com'  \gset

do $$ begin raise notice 'Profiles'; end $$;
select assert(
  (select count(*) from public.profiles) = 4,
  'a profile row appears for every account'
);

-- Everything from here runs without owner privileges, so RLS is live.
set role authenticated;

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Creating a project'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');
insert into public.projects (owner_id, name, doc)
values (:'alice', 'Line 1 Commissioning', '{"name":"Line 1 Commissioning","objects":[{"id":"a"},{"id":"b"}]}'::jsonb);

select id as proj from public.projects where name = 'Line 1 Commissioning' \gset

select assert(
  (select role from public.project_members where project_id = :'proj' and user_id = :'alice') = 'owner',
  'the creator becomes owner automatically'
);
select assert(public.owns_project(:'proj'), 'owns_project agrees');
select assert(public.can_write_project(:'proj'), 'the owner may write');

-- You cannot create a project owned by somebody else.
select refuses(:'alice',
  format('insert into public.projects (owner_id, name, doc) values (%L, %L, %L)',
         :'bob', 'Not mine', '{}'),
  'creating a project owned by another user'
);

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Sharing'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');
select public.share_project(:'proj', 'bob@example.com', 'editor');
select public.share_project(:'proj', 'CAROL@example.com', 'viewer');  -- case/space tolerant

select assert(
  (select role from public.project_members where project_id = :'proj' and user_id = :'bob') = 'editor',
  'an editor can be added by email'
);
select assert(
  (select role from public.project_members where project_id = :'proj' and user_id = :'carol') = 'viewer',
  'a viewer can be added, email case-insensitively'
);
select assert(
  (select count(*) from public.list_project_members(:'proj')) = 3,
  'the member list shows all three'
);

select refuses(:'alice',
  format('select public.share_project(%L, %L, %L)', :'proj', 'nobody@example.com', 'viewer'),
  'sharing with an address that has no account'
);
select refuses(:'alice',
  format('select public.share_project(%L, %L, %L)', :'proj', 'dave@example.com', 'superuser'),
  'granting a role that does not exist'
);

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Viewer is read-only'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'carol');
select assert(
  (select count(*) from public.projects where id = :'proj') = 1,
  'a viewer can read the project'
);
select assert(public.project_role(:'proj') = 'viewer', 'their role reads back as viewer');
select assert(not public.can_write_project(:'proj'), 'can_write_project says no');

-- The whole point. Each of these is a way a viewer might try to write.
select refuses(:'carol',
  format('update public.projects set name = %L where id = %L', 'Hijacked', :'proj'),
  'a viewer updating the project row directly'
);
select refuses(:'carol',
  format('select public.save_project(%L, %L::jsonb, %L::bigint)', :'proj', '{"objects":[]}', 1),
  'a viewer calling save_project'
);
select refuses(:'carol',
  format('delete from public.projects where id = %L', :'proj'),
  'a viewer deleting the project'
);
select refuses(:'carol',
  format('insert into public.project_backups (project_id, doc) values (%L, %L)', :'proj', '{}'),
  'a viewer writing a backup'
);
select refuses(:'carol',
  format('insert into public.project_members (project_id, user_id, role) values (%L, %L, %L)',
         :'proj', :'dave', 'editor'),
  'a viewer sharing the project onwards'
);
select refuses(:'carol',
  format('update public.project_members set role = %L where project_id = %L and user_id = %L',
         'owner', :'proj', :'carol'),
  'a viewer promoting themselves to owner'
);
select refuses(:'carol',
  format('select public.share_project(%L, %L, %L)', :'proj', 'dave@example.com', 'viewer'),
  'a viewer calling share_project'
);

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Editor can write but not share'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'bob');
select assert(public.can_write_project(:'proj'), 'an editor may write');
select assert(not public.owns_project(:'proj'), 'an editor is not an owner');

select rev as r1 from public.projects where id = :'proj' \gset
select public.save_project(:'proj', '{"name":"Line 1 Commissioning","objects":[{"id":"a"}]}'::jsonb, :'r1') as r2 \gset
select assert(:'r2'::bigint = :'r1'::bigint + 1, 'a save bumps the revision');
select assert(
  (select object_count from public.projects where id = :'proj') = 1,
  'the object count is maintained from the document'
);

insert into public.project_backups (project_id, doc, reason)
values (:'proj', '{"objects":[]}'::jsonb, 'manual');
select assert(
  (select count(*) from public.project_backups where project_id = :'proj') = 1,
  'an editor may take a backup'
);

select refuses(:'bob',
  format('select public.share_project(%L, %L, %L)', :'proj', 'dave@example.com', 'viewer'),
  'an editor sharing the project'
);
select refuses(:'bob',
  format('delete from public.projects where id = %L', :'proj'),
  'an editor deleting the project'
);

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Concurrency'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select refuses(:'bob',
  format('select public.save_project(%L, %L::jsonb, %L::bigint)', :'proj', '{"objects":[]}', :'r1'),
  'saving against a stale revision'
);

select act_as(:'bob');
select rev as r3 from public.projects where id = :'proj' \gset
select public.save_project(:'proj', '{"objects":[]}'::jsonb, 0) as r4 \gset
select assert(:'r4'::bigint = :'r3'::bigint + 1, 'revision 0 forces the write through');

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'A stranger sees nothing'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'dave');
select assert((select count(*) from public.projects) = 0, 'the project is invisible');
select assert((select count(*) from public.project_backups) = 0, 'its backups are invisible');
select assert((select count(*) from public.project_members) = 0, 'its membership is invisible');
select assert((select count(*) from public.list_my_projects()) = 0, 'it is not in their project list');
select assert(public.project_role(:'proj') is null, 'they have no role');
select assert(
  (select count(*) from public.list_project_members(:'proj')) = 0,
  'they cannot enumerate its members'
);
select refuses(:'dave',
  format('select public.save_project(%L, %L::jsonb, 0::bigint)', :'proj', '{"objects":[]}'),
  'a stranger saving the project'
);

-- Profiles must not be a directory of everyone who ever signed up.
select assert(
  (select count(*) from public.profiles) = 1,
  'a stranger sees only their own profile'
);
select act_as(:'carol');
select assert(
  (select count(*) from public.profiles) = 3,
  'a member sees the profiles of the people on their project, and no more'
);

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'The project list'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'carol');
select assert(
  (select role from public.list_my_projects() where id = :'proj') = 'viewer',
  'the list reports the caller''s own role'
);
select assert(
  (select owner_email from public.list_my_projects() where id = :'proj') = 'alice@example.com',
  'the list names the owner'
);
select assert(
  (select member_count from public.list_my_projects() where id = :'proj') = 3,
  'the list counts members'
);

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Retention'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'bob');
insert into public.project_backups (project_id, doc, created_at)
select :'proj', '{"objects":[]}'::jsonb, now() - (n || ' hours')::interval
from generate_series(1, 9) n;
select assert(
  (select count(*) from public.project_backups where project_id = :'proj') = 10,
  'ten backups exist'
);
select public.prune_backups(:'proj', 4) as pruned \gset
select assert(:'pruned'::int = 6, 'pruning removes the excess');
select assert(
  (select count(*) from public.project_backups where project_id = :'proj') = 4,
  'the newest four are kept'
);
select refuses(:'carol',
  format('select public.prune_backups(%L, 1)', :'proj'),
  'a viewer pruning backups'
);

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Removing access'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'alice');
select public.unshare_project(:'proj', :'carol');
select act_as(:'carol');
select assert((select count(*) from public.projects) = 0, 'a removed viewer loses sight of it');

select refuses(:'alice',
  format('select public.unshare_project(%L, %L)', :'proj', :'alice'),
  'removing the only owner'
);

-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice 'Attachment storage'; end $$;
-- ══════════════════════════════════════════════════════════════════════════

select act_as(:'bob');
insert into storage.objects (bucket_id, name) values ('attachments', :'proj' || '/file-1.pdf');
select assert(
  (select count(*) from storage.objects) = 1,
  'an editor may upload into their project''s folder'
);

select act_as(:'dave');
select assert((select count(*) from storage.objects) = 0, 'a stranger cannot see the file');
select refuses(:'dave',
  format('insert into storage.objects (bucket_id, name) values (%L, %L)',
         'attachments', :'proj' || '/sneaky.pdf'),
  'a stranger uploading into someone else''s project folder'
);

select act_as(:'alice');
select public.share_project(:'proj', 'carol@example.com', 'viewer');
select act_as(:'carol');
select assert((select count(*) from storage.objects) = 1, 'a viewer may download attachments');
select refuses(:'carol',
  format('insert into storage.objects (bucket_id, name) values (%L, %L)',
         'attachments', :'proj' || '/nope.pdf'),
  'a viewer uploading an attachment'
);
select refuses(:'carol',
  format('delete from storage.objects where name = %L', :'proj' || '/file-1.pdf'),
  'a viewer deleting an attachment'
);


-- ══════════════════════════════════════════════════════════════════════════
do $$ begin raise notice E'\nInvitation-only sign-up'; end $$;
-- ══════════════════════════════════════════════════════════════════════════
-- Sign-up goes through GoTrue, not through PostgREST, so the interface has no
-- say in it: anyone holding the public key can POST to /auth/v1/signup. These
-- checks insert into auth.users directly, which is the closest thing to that
-- request, and confirm the trigger is what stops it.

reset role;

select assert(
  (select is_admin from public.profiles where email = 'alice@example.com'),
  'the first account created is an administrator'
);
select assert(
  not (select is_admin from public.profiles where email = 'bob@example.com'),
  'later accounts are not'
);

-- The uninvited are refused, whatever they know.
select refuses(:'alice',
  format('insert into auth.users (email) values (%L)', 'stranger@example.com'),
  'signing up without an invitation'
);
select assert(
  not exists (select 1 from auth.users where email = 'stranger@example.com'),
  'and no account is left behind'
);

set role authenticated;

-- ── Only administrators invite ────────────────────────────────────────────
select act_as(:'bob');
select refuses(:'bob',
  format('select public.invite_user(%L, %L)', 'friend@example.com', 'editor'),
  'a non-administrator inviting someone'
);
select refuses(:'bob',
  format('select public.list_invitations()'),
  'a non-administrator reading the invitation list'
);
select assert(
  (select count(*) from public.list_accounts()) = 0,
  'a non-administrator cannot enumerate accounts'
);
select refuses(:'bob',
  format('update public.profiles set is_admin = true where id = %L', :'bob'),
  'a user making themselves an administrator'
);

select act_as(:'alice');
select public.invite_user('newstarter@example.com', 'editor', 'Signalling engineer');
select assert(
  (select count(*) from public.list_invitations()) = 1,
  'an administrator can invite'
);
select refuses(:'alice',
  format('select public.invite_user(%L)', 'not-an-email'),
  'inviting something that is not an email address'
);
select refuses(:'alice',
  format('select public.invite_user(%L)', 'bob@example.com'),
  'inviting somebody who already has an account'
);

-- ── The invited can join, once ────────────────────────────────────────────
reset role;
insert into auth.users (email) values ('newstarter@example.com');
select assert(
  exists (select 1 from public.profiles where email = 'newstarter@example.com'),
  'an invited address can create its account'
);
select assert(
  (select accepted_at is not null from public.invitations where email = 'newstarter@example.com'),
  'the invitation is marked used'
);
select assert(
  not (select is_admin from public.profiles where email = 'newstarter@example.com'),
  'and they are not an administrator'
);

-- A used invitation is not a reusable key.
delete from auth.users where email = 'newstarter@example.com';
select refuses(:'alice',
  format('insert into auth.users (email) values (%L)', 'newstarter@example.com'),
  'reusing an invitation that has already been accepted'
);

-- Nor is an expired one.
set role authenticated;
select act_as(:'alice');
select public.invite_user('late@example.com');
reset role;
update public.invitations set expires_at = now() - interval '1 day' where email = 'late@example.com';
select refuses(:'alice',
  format('insert into auth.users (email) values (%L)', 'late@example.com'),
  'accepting an invitation that has expired'
);

-- ── Revoking ──────────────────────────────────────────────────────────────
set role authenticated;
select act_as(:'alice');
select public.invite_user('changed-my-mind@example.com');
select public.revoke_invitation('changed-my-mind@example.com');
reset role;
select refuses(:'alice',
  format('insert into auth.users (email) values (%L)', 'changed-my-mind@example.com'),
  'signing up after the invitation was revoked'
);

-- ── Administrators ────────────────────────────────────────────────────────
set role authenticated;
select act_as(:'alice');
select public.set_admin(:'bob', true);
select act_as(:'bob');
select assert(public.is_admin(), 'a promoted user becomes an administrator');
select assert(
  (select count(*) from public.list_accounts()) >= 4,
  'and can now see every account'
);

select act_as(:'alice');
select public.set_admin(:'bob', false);
select act_as(:'bob');
select assert(not public.is_admin(), 'and can be demoted again');

-- The last administrator cannot lock everyone out.
select act_as(:'alice');
select refuses(:'alice',
  format('select public.set_admin(%L, false)', :'alice'),
  'the only administrator demoting themselves'
);

reset role;
do $$ begin raise notice E'\nAll permission checks passed.'; end $$;
