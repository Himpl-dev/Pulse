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

-- 6. Task comments, so context on a task doesn't only live in someone's head.
create table if not exists task_comments (
  id uuid primary key,
  task_id text not null,
  author_id text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table task_comments enable row level security;
drop policy if exists "authenticated only" on task_comments;
create policy "authenticated only" on task_comments
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 7. Recurring tasks: 'none' | 'weekly' | 'monthly'. When a task with a repeat
--    set is moved to Done, the app creates the next occurrence automatically.
alter table tasks add column if not exists repeat text not null default 'none';

-- 8. Task start dates, for the Gantt view on the Timeline tab. NULL for every
--    existing row (and left optional going forward) — the app renders those
--    as a single-day marker at `due` rather than guessing a start date.
alter table tasks add column if not exists start_date date;

-- 9. Management vs. operator access tiers. A user with no row here is an
--    operator by default (fail-safe) — only management accounts need a row.
--    Deliberately no insert/update/delete policy for `authenticated`: role
--    assignment only ever happens via this SQL editor (or the service role),
--    so the anon-key client can never write its own row and self-elevate.
--
--    After running this, find your auth user's UUID under Authentication >
--    Users and run:
--      insert into app_roles (auth_user_id, access_tier) values ('<uuid>', 'management');
--    Operator accounts need nothing beyond a login — no row required.
create table if not exists app_roles (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  access_tier text not null default 'operator' check (access_tier in ('management', 'operator'))
);
alter table app_roles enable row level security;
drop policy if exists "read own role" on app_roles;
create policy "read own role" on app_roles
  for select using (auth.uid() = auth_user_id);

-- Logs are management-only from here on. Replaces the "any authenticated
-- user" policy from block 2 above.
drop policy if exists "authenticated only" on logs;
drop policy if exists "management only" on logs;
create policy "management only" on logs
  for all using (exists (select 1 from app_roles r where r.auth_user_id = auth.uid() and r.access_tier = 'management'))
  with check (exists (select 1 from app_roles r where r.auth_user_id = auth.uid() and r.access_tier = 'management'));

-- 10. Team roster stays visible to everyone (operators need to see who's
--     assigned what), but editing it — add/remove/update a person — is now
--     management-only, replacing block 4's single "any authenticated user"
--     policy that covered reads and writes alike.
drop policy if exists "authenticated only" on team_members;
drop policy if exists "read team" on team_members;
drop policy if exists "management inserts team" on team_members;
drop policy if exists "management updates team" on team_members;
drop policy if exists "management deletes team" on team_members;
create policy "read team" on team_members
  for select using (auth.role() = 'authenticated');
create policy "management inserts team" on team_members
  for insert with check (exists (select 1 from app_roles r where r.auth_user_id = auth.uid() and r.access_tier = 'management'));
create policy "management updates team" on team_members
  for update using (exists (select 1 from app_roles r where r.auth_user_id = auth.uid() and r.access_tier = 'management'))
  with check (exists (select 1 from app_roles r where r.auth_user_id = auth.uid() and r.access_tier = 'management'));
create policy "management deletes team" on team_members
  for delete using (exists (select 1 from app_roles r where r.auth_user_id = auth.uid() and r.access_tier = 'management'));
