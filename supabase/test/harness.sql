-- Minimal stand-ins for the pieces Supabase provides, so `schema.sql` can be
-- executed and its policies exercised against a plain PostgreSQL instance.
-- This file is for `npm run test:sql` only; it is never run against Supabase.

create extension if not exists pgcrypto;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Supabase exposes the caller's id through this. Locally it reads a GUC that
-- the tests set, which is how a test can "become" a given user.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table if not exists storage.buckets (
  id     text primary key,
  name   text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name      text not null,
  owner     uuid
);

-- Supabase ships storage.objects with RLS already on. The stub has to match,
-- or the policies in schema.sql would look like they work while the table was
-- actually wide open.
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/')
$$;

-- The two roles the policies are written against.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

grant usage on schema public, auth, storage to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
