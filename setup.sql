-- Safe to run multiple times. Run in Supabase → SQL Editor → New query.

-- Drop and recreate cleanly
drop table if exists venues cascade;

create table venues (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  name        text        not null,
  location    text,
  website_url text,
  capacity    integer,
  price_min   integer,
  price_max   integer,
  status      text        not null default 'considering',
  rating      integer,
  notes       text,
  added_by    uuid
);

-- Row Level Security
alter table venues enable row level security;

drop policy if exists "read"   on venues;
drop policy if exists "insert" on venues;
drop policy if exists "update" on venues;
drop policy if exists "delete" on venues;

create policy "read"   on venues for select using (auth.role() = 'authenticated');
create policy "insert" on venues for insert with check (auth.role() = 'authenticated');
create policy "update" on venues for update using (auth.role() = 'authenticated');
create policy "delete" on venues for delete using (auth.role() = 'authenticated');
