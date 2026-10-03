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

-- 11. Private HR advisor conversations. Strictest RLS in the app: a single
--     policy scoped to auth.uid() = auth_user_id covers select/insert/update/
--     delete, so nobody — including other management accounts — has any path
--     to another user's rows. id is generated client-side (crypto.randomUUID()),
--     matching how logs/task_comments already do it.
create table if not exists hr_messages (
  id uuid primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
alter table hr_messages enable row level security;
drop policy if exists "own messages only" on hr_messages;
create policy "own messages only" on hr_messages
  for all using (auth.uid() = auth_user_id) with check (auth.uid() = auth_user_id);

-- 12. Project Manager advisor conversations. Same private-per-user shape as
-- hr_messages (block 11) — not something the user asked to make different,
-- and it's the safer default for a new chat feature until asked otherwise.
create table if not exists pm_messages (
  id uuid primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
alter table pm_messages enable row level security;
drop policy if exists "own messages only" on pm_messages;
create policy "own messages only" on pm_messages
  for all using (auth.uid() = auth_user_id) with check (auth.uid() = auth_user_id);

-- 13. Sales advisor conversations. Same private-per-user shape as
-- hr_messages/pm_messages (blocks 11-12).
create table if not exists sales_messages (
  id uuid primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
alter table sales_messages enable row level security;
drop policy if exists "own messages only" on sales_messages;
create policy "own messages only" on sales_messages
  for all using (auth.uid() = auth_user_id) with check (auth.uid() = auth_user_id);

-- 14. Engineer/Technician advisor: private per-user chat (same shape as
-- hr_messages/pm_messages/sales_messages) plus an optional attachment on a
-- user message, pointing at a file in the new eng_drawings storage bucket.
create table if not exists eng_messages (
  id uuid primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  attachment_path text,
  attachment_name text,
  created_at timestamptz not null default now()
);
alter table eng_messages enable row level security;
drop policy if exists "own messages only" on eng_messages;
create policy "own messages only" on eng_messages
  for all using (auth.uid() = auth_user_id) with check (auth.uid() = auth_user_id);

-- Private storage bucket for uploaded technical drawings/photos, one folder
-- per user ("<auth_user_id>/<filename>") so RLS scopes access the same way
-- as everything else here — nobody sees another user's uploads, management
-- included.
insert into storage.buckets (id, name, public)
values ('eng_drawings', 'eng_drawings', false)
on conflict (id) do nothing;

drop policy if exists "own eng_drawings only" on storage.objects;
create policy "own eng_drawings only" on storage.objects
  for all using (bucket_id = 'eng_drawings' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'eng_drawings' and (storage.foldername(name))[1] = auth.uid()::text);

-- 15. Multiple attachments per engineer message — a multi-page PDF gets
-- converted to up to 5 page images client-side (see src/pdfToImages.js) and
-- sent as several images in one message. Additive: the old attachment_path/
-- attachment_name columns from block 14 stay as-is for existing single-image
-- rows; new rows use this array field instead.
alter table eng_messages add column if not exists attachments jsonb;

-- 16. Personal work notes — a private scratchpad, optionally tagged to a
-- project, that feeds into the Documentation agent (see DocumentationPanel's
-- "insert my notes" button). No AI call involved in note-taking itself, so
-- no serverless-timeout concerns here. Private-per-user, same shape as the
-- hr/pm/sales/eng_messages tables.
create table if not exists user_notes (
  id uuid primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  project_id text,
  content text not null,
  created_at timestamptz not null default now()
);
alter table user_notes enable row level security;
drop policy if exists "own notes only" on user_notes;
create policy "own notes only" on user_notes
  for all using (auth.uid() = auth_user_id) with check (auth.uid() = auth_user_id);

-- 17. World Map: AI-inferred travel history, cached here rather than
-- computed live on every page view. api/travel-map-refresh.js reads
-- projects+tasks (already broadly visible to everyone — deliberately NOT
-- reading logs/user_notes, which are private/restricted) and has Claude
-- infer who likely worked where and roughly when, replacing this table's
-- contents each time "Refresh" is run. Open read/write to any authenticated
-- user, matching projects/tasks' own openness — there's no privacy reason
-- to restrict this since it's derived entirely from already-shared data,
-- and this is the one place in the app meant to be visible to everyone
-- (bragging-rights leaderboard), unlike every other agent's private
-- per-user table.
create table if not exists travel_entries (
  id uuid primary key,
  member_id text not null,
  country text not null,
  city text,
  customer_id text,
  project_id text,
  start_date date,
  end_date date,
  note text,
  created_at timestamptz not null default now()
);
alter table travel_entries enable row level security;
drop policy if exists "shared travel entries" on travel_entries;
create policy "shared travel entries" on travel_entries
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 18. Site Reports: generated documents from the Documentation agent were
-- previously throwaway (generate, view, download, gone) — this persists the
-- "site-report" template specifically, with its Site Details captured as
-- real columns (not just buried in the generated markdown) so
-- api/travel-map-refresh.js can read exactly who was on site, where, and
-- when, without having to parse prose. Open like projects/tasks/logs — this
-- is operational documentation, not a private conversation.
create table if not exists site_reports (
  id uuid primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  project_id text,
  site_name text not null,
  report_date date,
  arrival_time text,
  departure_time text,
  engineer_ids jsonb not null default '[]'::jsonb,
  document text not null,
  created_at timestamptz not null default now()
);
alter table site_reports enable row level security;
drop policy if exists "authenticated only" on site_reports;
create policy "authenticated only" on site_reports
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 19. Logs locked in the app for now (2026-10-01) — see LOGS_LOCKED in
--    src/App.jsx. Raised as an HR/data-handling concern: entries have no
--    author, the person they're about can never see them, and note text
--    was being sent to a third-party AI to summarize. Clearing what's there
--    since nobody could consent to or review it while the feature was live.
--    Run this once in the SQL Editor — the table and its RLS are left in
--    place so the feature can be reinstated properly later.
delete from logs;

-- 20. Shared skill list for the new Skill Matrix on the Team tab. Skills were
--    previously free-text names typed straight into team_members.skills, so
--    the same skill could end up spelled differently by different people,
--    which makes a matrix view useless (it can't tell two spellings are the
--    same column). This table is the canonical list everyone picks a name
--    from when assigning a skill to a member. team_members.skills keeps its
--    existing [{name, level}] shape — this doesn't migrate it, just gives
--    future entries a shared source of names. Readable by everyone (matrix
--    is visible team-wide, matching skills already being visible on Team
--    today); adding to the list is management-only, matching every other
--    "editing the team" action in this schema.
create table if not exists skills (
  id uuid primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);
alter table skills enable row level security;
drop policy if exists "read skills" on skills;
drop policy if exists "management inserts skills" on skills;
create policy "read skills" on skills
  for select using (auth.role() = 'authenticated');
create policy "management inserts skills" on skills
  for insert with check (exists (select 1 from app_roles r where r.auth_user_id = auth.uid() and r.access_tier = 'management'));

-- Seed the list from skill names already in use on existing team members,
-- so the matrix isn't empty on first load.
insert into skills (id, name)
select gen_random_uuid(), name
from (
  select distinct s->>'name' as name
  from team_members, jsonb_array_elements(skills) as s
) existing_names
on conflict (name) do nothing;

-- 21. Skill matrix v2: the real skill list from the team's skills sheet.
--     Each skill has a category, a 0-4 target level, a critical flag and a
--     priority. Per-person levels move out of team_members.skills (jsonb) into
--     member_skills so editing one cell is a single-row upsert. The old jsonb
--     column is left in place and no longer read by the app.
alter table skills add column if not exists category text not null default 'Other';
alter table skills add column if not exists description text;
alter table skills add column if not exists target_level int not null default 0 check (target_level between 0 and 4);
alter table skills add column if not exists critical boolean not null default false;
alter table skills add column if not exists priority text not null default 'Medium' check (priority in ('High', 'Medium', 'Low'));
alter table skills add column if not exists sort_order int not null default 0;

create table if not exists member_skills (
  member_id text not null references team_members(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  level int not null check (level between 0 and 4),
  primary key (member_id, skill_id)
);
alter table member_skills enable row level security;
drop policy if exists "read member skills" on member_skills;
drop policy if exists "management writes member skills" on member_skills;
create policy "read member skills" on member_skills
  for select using (auth.role() = 'authenticated');
create policy "management writes member skills" on member_skills
  for all using (exists (select 1 from app_roles r where r.auth_user_id = auth.uid() and r.access_tier = 'management'))
  with check (exists (select 1 from app_roles r where r.auth_user_id = auth.uid() and r.access_tier = 'management'));

-- Reseed the skill list from the sheet. member_skills is cleared first so
-- nothing references a skill row being removed.
delete from member_skills;
delete from skills;

insert into skills (id, name, category, description, target_level, critical, priority, sort_order) values
(gen_random_uuid(), 'Industrial networking (IP addressing, subnets)', 'Core Engineering', 'Configure and troubleshoot IP networking for cameras, PCs, PLCs and edge devices.', 4, true, 'High', 1),
(gen_random_uuid(), 'Ethernet troubleshooting', 'Core Engineering', 'Diagnose link/port/cable issues; identify intermittent comms faults.', 4, true, 'High', 2),
(gen_random_uuid(), 'PLC communication (Modbus TCP)', 'Core Engineering', 'Set up and validate PLC to device comms using Modbus TCP.', 1, true, 'High', 3),
(gen_random_uuid(), 'Digital I/O integration', 'Core Engineering', 'Wire and validate digital inputs/outputs and alarm signals.', 3, false, 'Medium', 4),
(gen_random_uuid(), 'Analogue I/O integration', 'Core Engineering', 'Wire and validate analogue signals and scaling.', 3, false, 'Medium', 5),
(gen_random_uuid(), 'Control panel build awareness', 'Core Engineering', 'Read drawings and validate cabinet wiring/layout against design intent.', 4, true, 'High', 6),
(gen_random_uuid(), 'Thermal camera commissioning (e.g., FLIR)', 'Vision Systems', 'Commission thermal vision systems, verify measurement and outputs.', 1, true, 'High', 7),
(gen_random_uuid(), 'ROI configuration and optimisation', 'Vision Systems', 'Set, adjust and validate regions of interest after install changes.', 1, true, 'Medium', 8),
(gen_random_uuid(), 'Lens selection / working distance', 'Vision Systems', 'Assess mounting distance/FOV and select lens approach.', 3, false, 'Medium', 9),
(gen_random_uuid(), 'Barcode reading / code quality', 'Vision Systems', 'Configure readers and tune for reliable code reading.', 4, true, 'High', 10),
(gen_random_uuid(), 'Cognex DataMan setup & backups', 'Vision Systems', 'Use setup tools, create/restore backups, replace/mount readers.', 4, true, 'High', 11),
(gen_random_uuid(), 'Cognex MVT / Logistics inspection concepts', 'Vision Systems', 'Understand MVT concepts and practical commissioning/maintenance needs.', 4, true, 'High', 12),
(gen_random_uuid(), 'Cognex MHDS / dimensioning concepts', 'Vision Systems', 'Understand single/multi-head dimensioners, maintenance and backups.', 4, true, 'High', 13),
(gen_random_uuid(), '3D vision inspection (general)', 'Vision Systems', 'Awareness of 3D vision use-cases and integration considerations.', 3, false, 'Medium', 14),
(gen_random_uuid(), 'Deep learning vision (deployment awareness)', 'Vision Systems', 'Understand where AI/deep learning inspection is applied and constraints.', 1, false, 'Medium', 15),
(gen_random_uuid(), 'Hyperspectral / multispectral inspection awareness', 'Vision Systems', 'Awareness of multispectral/hyperspectral inspection contexts.', 2, false, 'Medium', 16),
(gen_random_uuid(), 'Edge device configuration (e.g., RevPi)', 'System Integration', 'Configure edge controllers and validate runtime behaviour.', 3, true, 'High', 17),
(gen_random_uuid(), 'USB deployment workflows', 'System Integration', 'Prepare, validate and deploy configuration files via USB.', 4, true, 'High', 18),
(gen_random_uuid(), 'Alarm/Interlock logic validation', 'System Integration', 'Test alarms using thresholds/forced triggers; validate outputs.', 4, true, 'High', 19),
(gen_random_uuid(), 'Customer interface validation', 'System Integration', 'Confirm outputs/communications to customer systems/HMI.', 4, true, 'Medium', 20),
(gen_random_uuid(), 'Data handoff / plant monitoring integration', 'System Integration', 'Support integration of inspection data into plant monitoring systems.', 4, true, 'High', 21),
(gen_random_uuid(), 'System backups & restore process', 'System Integration', 'Create and manage backups; verify recovery.', 4, true, 'High', 22),
(gen_random_uuid(), 'MOXA digital module configuration', 'Industrial IO & Comms', 'Configure digital MOXA I/O modules, verify heartbeat outputs.', 3, true, 'High', 23),
(gen_random_uuid(), 'MOXA analogue module configuration', 'Industrial IO & Comms', 'Configure analogue MOXA I/O modules and troubleshoot faults.', 3, true, 'High', 24),
(gen_random_uuid(), 'Watchdog/heartbeat troubleshooting', 'Industrial IO & Comms', 'Investigate watchdog intervals and signal behaviour.', 4, true, 'High', 25),
(gen_random_uuid(), 'Multimeter validation of outputs', 'Industrial IO & Comms', 'Use meter checks to confirm pulse/IO states.', 4, true, 'High', 26),
(gen_random_uuid(), 'Modbus mapping and register verification', 'Industrial IO & Comms', 'Verify register presence, address mapping, and missing entries.', 3, false, 'Medium', 27),
(gen_random_uuid(), 'Camera mounting and positioning', 'Installation & Mechanical', 'Set camera mounting position; consider heat exposure and FOV.', 4, true, 'High', 28),
(gen_random_uuid(), 'Frame installation / relocation', 'Installation & Mechanical', 'Install frames/arches; relocate camera systems safely.', 4, true, 'High', 29),
(gen_random_uuid(), 'Cable management & cabinet housekeeping', 'Installation & Mechanical', 'Dress and route cables, terminate/label, improve accessibility.', 4, true, 'High', 30),
(gen_random_uuid(), 'Panel device mounting', 'Installation & Mechanical', 'Mount control panels/devices in new locations; ensure secure fixing.', 4, true, 'High', 31),
(gen_random_uuid(), 'MEWP / working at height awareness', 'Installation & Mechanical', 'Operate safely with MEWP access constraints and permits.', 4, true, 'High', 32),
(gen_random_uuid(), 'SAT execution', 'Commissioning & Testing', 'Run acceptance testing, retest discrepancies, prepare sign-off.', 4, true, 'High', 33),
(gen_random_uuid(), 'Commissioning under production constraints', 'Commissioning & Testing', 'Plan and execute work around production windows and access limits.', 4, true, 'High', 34),
(gen_random_uuid(), 'Fault finding / root cause analysis', 'Commissioning & Testing', 'Structured troubleshooting, isolate fault sources, document actions.', 4, true, 'High', 35),
(gen_random_uuid(), 'System performance validation', 'Commissioning & Testing', 'Verify stability, accuracy and repeatability of measurements.', 4, true, 'High', 36),
(gen_random_uuid(), 'Customer sign-off support', 'Commissioning & Testing', 'Support final checks and evidence for customer acceptance.', 4, true, 'High', 37),
(gen_random_uuid(), 'Site report writing', 'Documentation & Reporting', 'Write clear structured site reports with status, issues, actions.', 4, true, 'High', 38),
(gen_random_uuid(), 'RAMS / method statement preparation', 'Documentation & Reporting', 'Prepare and update RAMS/method statements for site work.', 4, true, 'High', 39),
(gen_random_uuid(), 'Measurement reports', 'Documentation & Reporting', 'Capture dimensions and compile measurement documents.', 4, true, 'High', 40),
(gen_random_uuid(), 'O&M manual creation', 'Documentation & Reporting', 'Create operation & maintenance documentation for delivered systems.', 3, true, 'High', 41),
(gen_random_uuid(), 'Photo/visual evidence capture', 'Documentation & Reporting', 'Capture and share photos/footage to support investigations.', 4, true, 'High', 42),
(gen_random_uuid(), 'Scope confirmation before visits', 'Customer & Project Coordination', 'Confirm scope, prerequisites and planned works with customer.', 4, false, 'Medium', 43),
(gen_random_uuid(), 'Commissioning readiness & scheduling', 'Customer & Project Coordination', 'Coordinate commissioning dates and prerequisites.', 3, false, 'Medium', 44),
(gen_random_uuid(), 'Stakeholder communication', 'Customer & Project Coordination', 'Communicate clearly with customer, internal stakeholders and vendors.', 4, true, 'High', 45),
(gen_random_uuid(), 'Training delivery on site', 'Customer & Project Coordination', 'Deliver training with restricted access requirements.', 3, true, 'High', 46),
(gen_random_uuid(), 'Change control / expectation management', 'Customer & Project Coordination', 'Flag scope/cost impacts (e.g., weekend work) and align decisions.', 3, true, 'High', 47),
(gen_random_uuid(), 'Export documentation (ACID/CargoX/NAFEZA)', 'Logistics & Compliance', 'Coordinate export documentation requirements for shipments.', 3, false, 'Low', 48),
(gen_random_uuid(), 'Shipping coordination (courier/air freight)', 'Logistics & Compliance', 'Work with freight partners; ensure correct mode and documents.', 3, false, 'Low', 49),
(gen_random_uuid(), 'Packing/labeling/palletisation', 'Logistics & Compliance', 'Dismantle, palletise, label and prepare systems for shipping.', 4, true, 'Medium', 50),
(gen_random_uuid(), 'Delivery discrepancy handling', 'Logistics & Compliance', 'Handle missing delivery / proof, escalate and share evidence.', 4, false, 'Medium', 51),
(gen_random_uuid(), 'Seal integrity inspection (SealCheck DL awareness)', 'Bytronic Solutions Knowledge', 'Understand seal inspection risks and solution intent.', 3, false, 'Medium', 52),
(gen_random_uuid(), 'Pack content & BOM verification (PackCheck DL awareness)', 'Bytronic Solutions Knowledge', 'Understand right product/right pack verification and compliance intent.', 4, true, 'Medium', 53),
(gen_random_uuid(), 'Food safety thermal compliance (TempComply awareness)', 'Bytronic Solutions Knowledge', 'Understand continuous temperature measurement compliance intent.', 3, false, 'Medium', 54),
(gen_random_uuid(), 'PPE compliance inspection (PPEComply awareness)', 'Bytronic Solutions Knowledge', 'Understand PPE/workwear vision compliance use-case.', 4, true, 'Medium', 55),
(gen_random_uuid(), 'Early fire detection / asset protection (TempCheck awareness)', 'Bytronic Solutions Knowledge', 'Understand early fire detection monitoring approach and integration.', 4, false, 'Medium', 56),
(gen_random_uuid(), 'On-site leadership / task ownership', 'Leadership & Ways of Working', 'Lead on-site activities, prioritise, and coordinate work packages.', 4, true, 'High', 57),
(gen_random_uuid(), 'Mentoring and knowledge transfer', 'Leadership & Ways of Working', 'Coach engineers and share best practice.', 4, true, 'High', 58),
(gen_random_uuid(), 'Safety culture and compliance', 'Leadership & Ways of Working', 'Promote safe systems of work, PPE compliance, and site rules.', 4, true, 'High', 59),
(gen_random_uuid(), 'Continuous improvement', 'Leadership & Ways of Working', 'Capture issues and drive improvements to standards, templates, kits.', 4, true, 'High', 60);

-- Levels from the sheet (0-4), matched to team members by name. Jamie has no
-- levels yet; he can fill his own in from the matrix.
with levels(skill_name, riaz, salman, maxwell) as (values
('Industrial networking (IP addressing, subnets)', 3, 1, 1),
('Ethernet troubleshooting', 2, 1, 1),
('PLC communication (Modbus TCP)', 1, 1, 1),
('Digital I/O integration', 1, 1, 1),
('Analogue I/O integration', 1, 1, 1),
('Control panel build awareness', 4, 2, 2),
('Thermal camera commissioning (e.g., FLIR)', 1, 1, 1),
('ROI configuration and optimisation', 1, 1, 1),
('Lens selection / working distance', 1, 0, 0),
('Barcode reading / code quality', 3, 1, 1),
('Cognex DataMan setup & backups', 4, 2, 2),
('Cognex MVT / Logistics inspection concepts', 4, 1, 1),
('Cognex MHDS / dimensioning concepts', 2, 0, 0),
('3D vision inspection (general)', 2, 2, 2),
('Deep learning vision (deployment awareness)', 1, 0, 0),
('Hyperspectral / multispectral inspection awareness', 0, 0, 0),
('Edge device configuration (e.g., RevPi)', 3, 0, 0),
('USB deployment workflows', 3, 2, 2),
('Alarm/Interlock logic validation', 4, 4, 4),
('Customer interface validation', 3, 2, 2),
('Data handoff / plant monitoring integration', 2, 2, 2),
('System backups & restore process', 4, 2, 2),
('MOXA digital module configuration', 1, 1, 1),
('MOXA analogue module configuration', 1, 1, 1),
('Watchdog/heartbeat troubleshooting', 1, 1, 1),
('Multimeter validation of outputs', 3, 1, 1),
('Modbus mapping and register verification', 0, 0, 0),
('Camera mounting and positioning', 3, 3, 3),
('Frame installation / relocation', 4, 3, 3),
('Cable management & cabinet housekeeping', 3, 2, 2),
('Panel device mounting', 4, 3, 3),
('MEWP / working at height awareness', 4, 4, 4),
('SAT execution', 2, 0, 0),
('Commissioning under production constraints', 3, 2, 1),
('Fault finding / root cause analysis', 2, 2, 2),
('System performance validation', 4, 4, 4),
('Customer sign-off support', 0, 0, 0),
('Site report writing', 2, 2, 2),
('RAMS / method statement preparation', 1, 1, 1),
('Measurement reports', 4, 4, 4),
('O&M manual creation', 0, 0, 0),
('Photo/visual evidence capture', 4, 4, 4),
('Scope confirmation before visits', 3, 3, 3),
('Commissioning readiness & scheduling', 0, 0, 0),
('Stakeholder communication', 3, 2, 2),
('Training delivery on site', 1, 1, 1),
('Change control / expectation management', 0, 0, 0),
('Export documentation (ACID/CargoX/NAFEZA)', 0, 0, 0),
('Shipping coordination (courier/air freight)', 0, 0, 0),
('Packing/labeling/palletisation', 2, 2, 2),
('Delivery discrepancy handling', 1, 1, 1),
('Seal integrity inspection (SealCheck DL awareness)', 1, 1, 1),
('Pack content & BOM verification (PackCheck DL awareness)', 1, 1, 1),
('Food safety thermal compliance (TempComply awareness)', 1, 1, 1),
('PPE compliance inspection (PPEComply awareness)', 3, 3, 3),
('Early fire detection / asset protection (TempCheck awareness)', 1, 1, 1),
('On-site leadership / task ownership', 3, 2, 2),
('Mentoring and knowledge transfer', 3, 1, 1),
('Safety culture and compliance', 1, 1, 1),
('Continuous improvement', 3, 3, 3)
)
insert into member_skills (member_id, skill_id, level)
select t.id, s.id, x.level
from levels l
join skills s on s.name = l.skill_name
cross join lateral (values
  ('Riaz Ahmed', l.riaz),
  ('Salman Salman', l.salman),
  ('Maxwell Taylor', l.maxwell)
) as x(member_name, level)
join team_members t on t.name = x.member_name;

-- 22. Monthly admin tasks (25th to 5th). admin_key marks a generated task as
--     "this template, for this person, in this period", so generating again
--     for the same period never creates a duplicate.
alter table tasks add column if not exists admin_key text unique;

-- 23. Level-up decisions. The app suggests a level-up once enough completed
--     tasks build a skill; only the team lead can approve or reject it. Each
--     decision is logged here, and the count of completed tasks restarts from
--     the decision date.
create table if not exists skill_level_decisions (
  id uuid primary key,
  member_id text not null references team_members(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  from_level int not null,
  to_level int not null,
  decision text not null check (decision in ('approved', 'rejected')),
  decided_at timestamptz not null default now()
);
alter table skill_level_decisions enable row level security;
drop policy if exists "read skill decisions" on skill_level_decisions;
drop policy if exists "management writes skill decisions" on skill_level_decisions;
create policy "read skill decisions" on skill_level_decisions
  for select using (auth.role() = 'authenticated');
create policy "management writes skill decisions" on skill_level_decisions
  for insert with check (exists (select 1 from app_roles r where r.auth_user_id = auth.uid() and r.access_tier = 'management'));
