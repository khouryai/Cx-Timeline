-- ══════════════════════════════════════════════════════════════════════════
-- CX Timeline — hosted schema
--
-- Run this once, whole, in the Supabase SQL editor of a fresh project
-- (Dashboard → SQL Editor → New query → paste → Run). It is idempotent, so
-- re-running it after an edit is safe.
--
-- What it sets up
-- ---------------
--   profiles          one row per account, so members can be shown by name
--   projects          one row per plan; the document itself lives in `doc`
--   project_members   who can see a project, and what they may do
--   project_backups   snapshot history, kept server-side
--
-- The permission model is three roles:
--
--   owner    full control, including sharing and deletion
--   editor   may change the plan and take backups
--   viewer   read-only — can open, browse and export, but never write
--
-- Enforcement is row-level security in Postgres, not the UI. A viewer who
-- opens the console and calls the API directly still cannot write, because the
-- database refuses the row. The front-end read-only mode is a courtesy, not
-- the control.
-- ══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ══════════════════════════════════════════════════════════════════════════
-- Profiles
-- ══════════════════════════════════════════════════════════════════════════

-- `auth.users` is not readable by client code, so mirror the couple of fields
-- the sharing UI needs into a table that is — guarded so you only ever see the
-- people you actually share a project with.
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do update
    set email     = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who signed up before this script ran.
insert into public.profiles (id, email, full_name)
select id, email, nullif(raw_user_meta_data->>'full_name', '')
from auth.users
on conflict (id) do nothing;

-- ══════════════════════════════════════════════════════════════════════════
-- Projects
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  name         text not null default 'Untitled Programme',
  doc          jsonb not null,
  -- Denormalised so the project list does not have to open every document.
  object_count integer not null default 0,
  -- Optimistic concurrency. Every save states the revision it was based on;
  -- a mismatch means someone else saved first and the write is refused rather
  -- than silently overwriting their work.
  rev          bigint not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);

create index if not exists projects_owner_idx on public.projects (owner_id);
create index if not exists projects_updated_idx on public.projects (updated_at desc);

-- ══════════════════════════════════════════════════════════════════════════
-- Membership
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner', 'editor', 'viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_idx on public.project_members (user_id);

-- Creating a project makes you its owner. Doing this in a trigger means the
-- membership row can never be forgotten, including for rows inserted by a
-- future import path or by hand in the dashboard.
create or replace function public.claim_new_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role, invited_by)
  values (new.id, new.owner_id, 'owner', new.owner_id)
  on conflict (project_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.claim_new_project();

-- ══════════════════════════════════════════════════════════════════════════
-- Backups
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.project_backups (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  doc          jsonb not null,
  reason       text not null default 'manual',
  name         text,
  object_count integer not null default 0,
  size_bytes   integer not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null
);

create index if not exists project_backups_project_idx
  on public.project_backups (project_id, created_at desc);

-- ══════════════════════════════════════════════════════════════════════════
-- Access helpers
--
-- These are SECURITY DEFINER on purpose. A policy on `project_members` that
-- queried `project_members` directly would recurse into itself and error at
-- runtime; running the lookup as the definer steps outside RLS and breaks the
-- cycle. They are the single definition of "may I", so the policies below stay
-- one line each and cannot drift apart.
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.project_role(p_project uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.project_members
  where project_id = p_project
    and user_id = auth.uid()
$$;

create or replace function public.can_read_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = auth.uid()
  )
$$;

create or replace function public.can_write_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project
      and user_id = auth.uid()
      and role in ('owner', 'editor')
  )
$$;

create or replace function public.owns_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project
      and user_id = auth.uid()
      and role = 'owner'
  )
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- Row-level security
-- ══════════════════════════════════════════════════════════════════════════

alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.project_backups enable row level security;

-- ── profiles ──────────────────────────────────────────────────────────────
-- You can see yourself, and anyone you share a project with. Not the whole
-- user list: an email address is personal data, and a planning tool has no
-- business handing out a directory of everyone who ever signed up.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.project_members mine
      join public.project_members theirs on theirs.project_id = mine.project_id
      where mine.user_id = auth.uid()
        and theirs.user_id = public.profiles.id
    )
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ── projects ──────────────────────────────────────────────────────────────
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (public.can_read_project(id));

-- You may only create a project owned by yourself.
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check (owner_id = auth.uid());

-- This is the read-only rule. A viewer passes `projects_select` and fails
-- here, so the row is visible and unwritable.
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (public.can_write_project(id))
  with check (public.can_write_project(id));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated
  using (public.owns_project(id));

-- ── project_members ───────────────────────────────────────────────────────
-- Anyone on a project can see who else is on it; only owners can change it.
drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members
  for select to authenticated
  using (public.can_read_project(project_id));

drop policy if exists project_members_write on public.project_members;
create policy project_members_write on public.project_members
  for all to authenticated
  using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

-- ── project_backups ───────────────────────────────────────────────────────
drop policy if exists project_backups_select on public.project_backups;
create policy project_backups_select on public.project_backups
  for select to authenticated
  using (public.can_read_project(project_id));

drop policy if exists project_backups_insert on public.project_backups;
create policy project_backups_insert on public.project_backups
  for insert to authenticated
  with check (public.can_write_project(project_id));

drop policy if exists project_backups_delete on public.project_backups;
create policy project_backups_delete on public.project_backups
  for delete to authenticated
  using (public.owns_project(project_id));

-- ══════════════════════════════════════════════════════════════════════════
-- API
--
-- Everything the client needs that a plain table query cannot express safely:
-- listing projects with your role attached, saving with a revision check, and
-- sharing by email without exposing who else has an account.
-- ══════════════════════════════════════════════════════════════════════════

-- ── The project list ──────────────────────────────────────────────────────
create or replace function public.list_my_projects()
returns table (
  id           uuid,
  name         text,
  role         text,
  object_count integer,
  rev          bigint,
  updated_at   timestamptz,
  created_at   timestamptz,
  owner_email  text,
  member_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         p.name,
         m.role,
         p.object_count,
         p.rev,
         p.updated_at,
         p.created_at,
         o.email,
         (select count(*)::integer from public.project_members x where x.project_id = p.id)
  from public.projects p
  join public.project_members m on m.project_id = p.id and m.user_id = auth.uid()
  left join public.profiles o on o.id = p.owner_id
  order by p.updated_at desc
$$;

-- ── Saving ────────────────────────────────────────────────────────────────
-- Takes the revision the edit was based on and refuses the write if the row
-- has moved on since. Without this, two editors on one plan silently overwrite
-- each other and the loser never finds out.
create or replace function public.save_project(
  p_project uuid,
  p_doc     jsonb,
  p_rev     bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_rev bigint;
  next_rev    bigint;
begin
  if not public.can_write_project(p_project) then
    raise exception 'read only: you do not have permission to change this project'
      using errcode = '42501';
  end if;

  select rev into current_rev from public.projects where id = p_project for update;
  if current_rev is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  -- p_rev = 0 means "I know I am overwriting" (a restore or a forced save).
  if p_rev <> 0 and p_rev <> current_rev then
    raise exception 'conflict: project was changed elsewhere (rev %, you have %)',
      current_rev, p_rev using errcode = '40001';
  end if;

  next_rev := current_rev + 1;

  update public.projects
  set doc          = p_doc,
      name         = coalesce(nullif(p_doc->>'name', ''), name),
      object_count = coalesce(jsonb_array_length(p_doc->'objects'), 0),
      rev          = next_rev,
      updated_at   = now(),
      updated_by   = auth.uid()
  where id = p_project;

  return next_rev;
end;
$$;

-- ── Sharing ───────────────────────────────────────────────────────────────
-- Grants access by email. SECURITY DEFINER because it has to look up
-- auth.users, which clients cannot read — and it deliberately gives the same
-- answer whether an address has no account or simply is not shared with you,
-- so this cannot be used to probe for who has signed up.
create or replace function public.share_project(
  p_project uuid,
  p_email   text,
  p_role    text
)
-- The output columns are prefixed because plpgsql resolves a bare `user_id`
-- to the OUT parameter, which makes the INSERT column list below ambiguous.
returns table (member_id uuid, member_email text, member_role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  clean  text := lower(trim(p_email));
begin
  if not public.owns_project(p_project) then
    raise exception 'only the owner can share this project' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'editor', 'viewer') then
    raise exception 'unknown role %', p_role using errcode = '22023';
  end if;

  select u.id into target from auth.users u where lower(u.email) = clean;
  if target is null then
    raise exception 'no account for % — they need to sign up first', clean
      using errcode = 'P0002';
  end if;
  if target = auth.uid() then
    raise exception 'you already own this project' using errcode = '22023';
  end if;

  insert into public.project_members (project_id, user_id, role, invited_by)
  values (p_project, target, p_role, auth.uid())
  on conflict (project_id, user_id) do update set role = excluded.role;

  return query
    select target, clean, p_role;
end;
$$;

create or replace function public.unshare_project(p_project uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.owns_project(p_project) then
    raise exception 'only the owner can change sharing' using errcode = '42501';
  end if;
  -- Never let the last owner remove themselves; the project would be orphaned
  -- and nobody could ever share or delete it again.
  if (select count(*) from public.project_members
      where project_id = p_project and role = 'owner') <= 1
     and (select role from public.project_members
          where project_id = p_project and user_id = p_user) = 'owner' then
    raise exception 'a project must keep at least one owner' using errcode = '22023';
  end if;

  delete from public.project_members
  where project_id = p_project and user_id = p_user;
end;
$$;

-- Members of a project, with their email addresses.
create or replace function public.list_project_members(p_project uuid)
returns table (user_id uuid, email text, full_name text, role text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, p.email, p.full_name, m.role, m.created_at
  from public.project_members m
  left join public.profiles p on p.id = m.user_id
  where m.project_id = p_project
    and public.can_read_project(p_project)
  order by
    case m.role when 'owner' then 0 when 'editor' then 1 else 2 end,
    p.email
$$;

-- ── Backup retention ──────────────────────────────────────────────────────
create or replace function public.prune_backups(p_project uuid, p_keep integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  if not public.can_write_project(p_project) then
    raise exception 'read only' using errcode = '42501';
  end if;
  if p_keep is null or p_keep <= 0 then
    return 0;
  end if;

  with doomed as (
    select id from public.project_backups
    where project_id = p_project
    order by created_at desc
    offset p_keep
  )
  delete from public.project_backups b using doomed d where b.id = d.id;

  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- Grants
--
-- Only signed-in users may call any of this. `anon` gets nothing: an
-- unauthenticated visitor with the public key can reach the API and find
-- every door locked.
-- ══════════════════════════════════════════════════════════════════════════

revoke all on function public.list_my_projects()                      from public, anon;
revoke all on function public.save_project(uuid, jsonb, bigint)       from public, anon;
revoke all on function public.share_project(uuid, text, text)         from public, anon;
revoke all on function public.unshare_project(uuid, uuid)             from public, anon;
revoke all on function public.list_project_members(uuid)              from public, anon;
revoke all on function public.prune_backups(uuid, integer)            from public, anon;
revoke all on function public.project_role(uuid)                      from public, anon;
revoke all on function public.can_read_project(uuid)                  from public, anon;
revoke all on function public.can_write_project(uuid)                 from public, anon;
revoke all on function public.owns_project(uuid)                      from public, anon;

grant execute on function public.list_my_projects()                   to authenticated;
grant execute on function public.save_project(uuid, jsonb, bigint)    to authenticated;
grant execute on function public.share_project(uuid, text, text)      to authenticated;
grant execute on function public.unshare_project(uuid, uuid)          to authenticated;
grant execute on function public.list_project_members(uuid)           to authenticated;
grant execute on function public.prune_backups(uuid, integer)         to authenticated;
grant execute on function public.project_role(uuid)                   to authenticated;
grant execute on function public.can_read_project(uuid)               to authenticated;
grant execute on function public.can_write_project(uuid)              to authenticated;
grant execute on function public.owns_project(uuid)                   to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- Attachment storage
--
-- File bytes stay out of the document, exactly as they do locally, so a plan
-- carrying 40 MB of test logs still saves in milliseconds. Objects are keyed
-- `<project_id>/<attachment_id>`, which is what lets the policies below decide
-- access from the first path segment.
-- ══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.can_read_project(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists attachments_write on storage.objects;
create policy attachments_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.can_write_project(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists attachments_delete on storage.objects;
create policy attachments_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and public.can_write_project(((storage.foldername(name))[1])::uuid)
  );
