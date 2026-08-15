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

-- 4. Team members table, so the roster can be edited from the app instead of
--    being hardcoded. Seeded with the four people already baked into the app
--    so existing task/log assignments keep resolving to the same person.
create table if not exists team_members (
  id text primary key,
  name text not null,
  role text not null default 'Team member',
  color text not null,
  initials text not null,
  skills jsonb not null default '[]'::jsonb
);

insert into team_members (id, name, role, color, initials, skills) values
  ('m1', 'Jamie Himpleman', 'Team lead', '#9B8CF2', 'JH', '[{"name":"Cognex C1","level":"Certified"},{"name":"Cognex Insight Spreadsheet","level":"Basic"},{"name":"Zebra Aurora","level":"Basic + Advanced"}]'),
  ('m2', 'Riaz Ahmed', 'Operator', '#5B8DEF', 'RA', '[{"name":"Cognex C1","level":"Certified"},{"name":"Cognex Insight Spreadsheet","level":"Basic"}]'),
  ('m3', 'Maxwell Taylor', 'Operator', '#45C4A0', 'MT', '[]'),
  ('m4', 'Salman Salman', 'Operator', '#F2A93B', 'SS', '[]')
on conflict (id) do nothing;

alter table team_members enable row level security;
drop policy if exists "authenticated only" on team_members;
create policy "authenticated only" on team_members
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 5. Role update: Jamie is team lead, everyone else is an operator. The insert
--    above uses "on conflict do nothing" so it won't touch rows that already
--    exist — run this once to update the roles already seeded in production.
update team_members set role = 'Team lead' where id = 'm1';
update team_members set role = 'Operator' where id in ('m2', 'm3', 'm4');
