-- Run once in Supabase SQL Editor to enable the Resource Guru integration.
-- OAuth credentials and cached schedule data are accessed only by server
-- functions using SUPABASE_SERVICE_ROLE_KEY; browser clients get no policies.

create table if not exists resource_guru_connections (
  id text primary key,
  account_slug text not null,
  connected_by uuid references auth.users(id) on delete set null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table resource_guru_connections enable row level security;
revoke all on table resource_guru_connections from anon, authenticated;
grant all on table resource_guru_connections to service_role;

create table if not exists resource_guru_syncs (
  id text primary key,
  account_slug text not null,
  bookings jsonb not null default '[]'::jsonb,
  tasks jsonb not null default '[]'::jsonb,
  resources jsonb not null default '[]'::jsonb,
  projects jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null,
  booking_count integer not null default 0,
  task_count integer not null default 0
);

alter table resource_guru_syncs enable row level security;
alter table resource_guru_syncs
  add column if not exists resources jsonb not null default '[]'::jsonb,
  add column if not exists projects jsonb not null default '[]'::jsonb;
revoke all on table resource_guru_syncs from anon, authenticated;
grant all on table resource_guru_syncs to service_role;
