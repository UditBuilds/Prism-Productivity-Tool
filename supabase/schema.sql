-- PRISM database schema — run once in the Supabase SQL editor.
-- All tables have RLS enabled; user_id on every table; profiles auto-created on signup.

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- PROFILES
create table profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  display_name text,
  avatar_url text,
  timezone text default 'Asia/Kolkata',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- PLANS (created before tasks so tasks can FK to it)
create table plans (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  description text,
  status text check (status in ('active','completed','archived')) default 'active',
  target_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- TASKS
create table tasks (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  description text,
  status text check (status in ('todo','in_progress','done')) default 'todo',
  priority text check (priority in ('low','medium','high')) default 'medium',
  due_date timestamptz,
  plan_id uuid references plans(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- NOTES
create table notes (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  content text default '',
  tags text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- REMINDERS
create table reminders (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  body text,
  remind_at timestamptz not null,
  is_sent boolean default false,
  task_id uuid references tasks(id) on delete set null,
  note_id uuid references notes(id) on delete set null,
  created_at timestamptz default now()
);

-- SRS CARDS
create table srs_cards (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  note_id uuid references notes(id) on delete set null,
  front text not null,
  back text not null,
  deck_name text default 'Default',
  interval_days integer default 1,
  ease_factor float default 2.5,
  repetitions integer default 0,
  next_review timestamptz default now(),
  last_reviewed timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- SRS REVIEW HISTORY
create table srs_reviews (
  id uuid default uuid_generate_v4() primary key,
  card_id uuid references srs_cards(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  rating integer check (rating >= 0 and rating <= 5) not null,
  reviewed_at timestamptz default now()
);

-- ROW LEVEL SECURITY — enable on every table
alter table profiles enable row level security;
alter table plans enable row level security;
alter table tasks enable row level security;
alter table notes enable row level security;
alter table reminders enable row level security;
alter table srs_cards enable row level security;
alter table srs_reviews enable row level security;

-- RLS POLICIES
create policy "own_profiles"
  on profiles for all using (auth.uid() = id);

create policy "own_plans"
  on plans for all using (auth.uid() = user_id);

create policy "own_tasks"
  on tasks for all using (auth.uid() = user_id);

create policy "own_notes"
  on notes for all using (auth.uid() = user_id);

create policy "own_reminders"
  on reminders for all using (auth.uid() = user_id);

create policy "own_srs_cards"
  on srs_cards for all using (auth.uid() = user_id);

create policy "own_srs_reviews"
  on srs_reviews for all using (auth.uid() = user_id);

-- AUTO-CREATE PROFILE ON SIGNUP
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', 'User')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- AUTO-UPDATE updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger t_profiles before update on profiles
  for each row execute procedure update_updated_at();
create trigger t_plans before update on plans
  for each row execute procedure update_updated_at();
create trigger t_tasks before update on tasks
  for each row execute procedure update_updated_at();
create trigger t_notes before update on notes
  for each row execute procedure update_updated_at();
create trigger t_srs_cards before update on srs_cards
  for each row execute procedure update_updated_at();

-- PUSH SUBSCRIPTIONS (Web Push — added in Session 8)
create table push_subscriptions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz default now(),
  unique(user_id, endpoint)
);

alter table push_subscriptions enable row level security;

create policy "own_push_subscriptions"
  on push_subscriptions for all using (auth.uid() = user_id);

-- STREAK FREEZE PROTECTION (auto-applied, 3 per IST week)
-- Extra columns on profiles track the weekly freeze budget. streak_freezes is
-- replenished to 3 at the start of each IST week (Monday); freeze_week_start
-- records the Monday the current budget belongs to. Both are written by
-- /api/srs/analytics, which auto-consumes at most one freeze per calculation
-- to cover a single-day gap in the SRS review streak.
alter table profiles
  add column if not exists streak_freezes int not null default 3,
  add column if not exists freeze_week_start date not null default current_date;

-- One row per IST date a freeze covered. The unique (user_id, frozen_date)
-- constraint backs the INSERT … ON CONFLICT DO NOTHING idempotency in the
-- analytics route, so re-calling it never double-logs or double-spends.
create table if not exists streak_freeze_logs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  frozen_date date not null,
  created_at timestamptz default now(),
  unique(user_id, frozen_date)
);

alter table streak_freeze_logs enable row level security;

create policy "own_streak_freeze_logs"
  on streak_freeze_logs for all using (auth.uid() = user_id);

-- FOCUS SESSIONS (focus timer — added in Session 10)
create table if not exists focus_sessions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  category text not null default 'Study',
  duration_minutes integer not null,
  completed boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz default now()
);

alter table focus_sessions enable row level security;

create policy "own_focus_sessions"
  on focus_sessions for all using (auth.uid() = user_id);

-- COUNTDOWNS (event countdowns — added in Session 10)
create table if not exists countdowns (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  target_date date not null,
  emoji text not null default '🎯',
  created_at timestamptz default now()
);

alter table countdowns enable row level security;

create policy "own_countdowns"
  on countdowns for all using (auth.uid() = user_id);

-- MOOD LOGS (daily mood check-in — added in Session 11)
-- One row per user per IST day; the app upserts on (user_id, logged_date).
create table if not exists mood_logs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  mood text not null,
  note text,
  logged_date date not null default current_date,
  created_at timestamptz default now(),
  unique(user_id, logged_date)
);

alter table mood_logs enable row level security;

create policy "own_mood_logs"
  on mood_logs for all using (auth.uid() = user_id);

-- RECURRING TASKS (daily task templates — Session: recurring tasks)
-- A template that /api/cron/recurring-tasks materialises into a real `tasks`
-- row once per IST day (the New Task form also spawns today's instance up front).
-- Stopping repetition flips is_active = false; past/today's instances are kept.
-- priority is TEXT mirroring tasks.priority's allowed values.
create table if not exists recurring_tasks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  priority text not null default 'medium',
  is_active boolean not null default true,
  created_at timestamptz default now()
);

alter table recurring_tasks enable row level security;

-- Own-rows access, split into the four commands (auth.uid() = user_id).
create policy "recurring_tasks_select_own"
  on recurring_tasks for select using (auth.uid() = user_id);
create policy "recurring_tasks_insert_own"
  on recurring_tasks for insert with check (auth.uid() = user_id);
create policy "recurring_tasks_update_own"
  on recurring_tasks for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "recurring_tasks_delete_own"
  on recurring_tasks for delete using (auth.uid() = user_id);

-- Link each spawned task back to its template (null for one-off tasks).
alter table tasks
  add column if not exists recurring_task_id uuid
    references recurring_tasks(id) on delete set null;

-- One spawned task per template per day — backs the cron's idempotent spawn
-- and the form's immediate "today's instance" insert.
create unique index if not exists idx_tasks_recurring_unique_per_day
  on tasks (recurring_task_id, due_date)
  where recurring_task_id is not null;
