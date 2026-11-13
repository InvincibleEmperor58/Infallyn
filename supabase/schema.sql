-- ============================================================================
-- Infallyn — Supabase schema (run once, in the SQL editor)
--
-- The server stores CIPHERTEXT ONLY. Every row is sealed client-side with a
-- random 32-byte "space key" that Supabase never receives:
--   * entities.payload  = AES-256-GCM(entity JSON)  under the space key
--   * media objects     = AES-256-GCM(photo bytes)  under the space key
--   * spaces.key_wrap   = the space key itself, sealed with PBKDF2(sync
--                         passphrase, kdf_salt) — useless without the passphrase
--
-- Row access is scoped by auth.uid() (email one-time-code sign-in), so the
-- anon key alone cannot read anybody's rows.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- spaces
-- one row per user: holds the salt + the passphrase-wrapped space key
create table if not exists public.spaces (
  owner      uuid primary key references auth.users (id) on delete cascade,
  kdf_salt   text        not null,
  key_wrap   jsonb       not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------- entities
-- every syncable thing: item | card | review | session | settings | shelves |
-- flags | meta. LWW clock is a monotonic millisecond value from the client.
create table if not exists public.entities (
  owner      uuid   not null references auth.users (id) on delete cascade,
  kind       text   not null,
  id         text   not null,
  lww        bigint not null,
  deleted    boolean not null default false,
  payload    text    not null default '',
  updated_at timestamptz not null default now(),
  primary key (owner, kind, id)
);

create index if not exists entities_owner_lww_idx on public.entities (owner, lww);

-- ---------------------------------------------------------------- media
-- metadata for encrypted blobs living in the infallyn-media bucket
create table if not exists public.media (
  owner        uuid   not null references auth.users (id) on delete cascade,
  media_id     text   not null,
  lww          bigint not null,
  deleted      boolean not null default false,
  mime         text   not null default 'application/octet-stream',
  iv           text   not null default '',
  bytes        integer,
  storage_path text   not null,
  primary key (owner, media_id)
);

-- ----------------------------------------------------------------- RLS
alter table public.spaces   enable row level security;
alter table public.entities enable row level security;
alter table public.media    enable row level security;

drop policy if exists spaces_own   on public.spaces;
drop policy if exists entities_own on public.entities;
drop policy if exists media_own    on public.media;

create policy spaces_own on public.spaces
  for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

create policy entities_own on public.entities
  for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

create policy media_own on public.media
  for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- ------------------------------------------------------------- storage
-- private bucket; objects are keyed <auth.uid()>/<mediaId>
insert into storage.buckets (id, name, public)
values ('infallyn-media', 'infallyn-media', false)
on conflict (id) do nothing;

drop policy if exists infallyn_media_read   on storage.objects;
drop policy if exists infallyn_media_write  on storage.objects;
drop policy if exists infallyn_media_update on storage.objects;
drop policy if exists infallyn_media_delete on storage.objects;

create policy infallyn_media_read on storage.objects
  for select to authenticated
  using (bucket_id = 'infallyn-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy infallyn_media_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'infallyn-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy infallyn_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'infallyn-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'infallyn-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy infallyn_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'infallyn-media' and (storage.foldername(name))[1] = auth.uid()::text);
