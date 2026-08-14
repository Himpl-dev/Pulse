-- Run this in the Supabase SQL editor (Project > SQL Editor > New query).
-- Locks the dashboard down to signed-in users only, and adds the logs table.

-- 1. Logs table: quick notes about an individual's behaviour/progress.
create table if not exists logs (
  id uuid primary key,
  person_id text not null,
  note text not null,
  tag text,
  created_at timestamptz not null default now()
);

-- 2. Lock every table down to signed-in users only.
alter table projects enable row level security;
alter table tasks enable row level security;
alter table logs enable row level security;

-- projects/tasks already have a wide-open "allow all" policy (using (true)) from
-- the original setup script. RLS OR's permissive policies together, so it has to
-- be dropped or it would keep letting anyone in regardless of the policy below.
drop policy if exists "allow all" on projects;
drop policy if exists "authenticated only" on projects;
create policy "authenticated only" on projects
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "allow all" on tasks;
drop policy if exists "authenticated only" on tasks;
create policy "authenticated only" on tasks
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated only" on logs;
create policy "authenticated only" on logs
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 3. After running this, go to Authentication > Providers > Email in the
--    Supabase dashboard and turn OFF "Allow new users to sign up" so nobody
--    else can register an account. Then go to Authentication > Users and
--    manually add yourself (jamie.himpleman@bytronic.com) with a password.
