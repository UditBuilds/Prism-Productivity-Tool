-- Learning, PR 1: topics, planned steps, AI-written lessons and their sources.
--
-- APPLY-ONCE in the Supabase SQL Editor. Re-runnable: every CREATE is guarded
-- and every policy is dropped before it is created. supabase/schema.sql carries
-- the same shape for a rebuild, but is a reference dump, not a migration.
--
-- Rules the schema itself enforces:
--   - No hard deletes from the app. topics and steps have no DELETE policy; a
--     topic is archived (archived_at) and a step is marked removed (removed_at).
--   - A lesson is saved once. lessons and lesson_sources have SELECT and INSERT
--     policies only, so a rewrite is a NEW lesson row, never an edit.
--   - A content row can only point at its owner's parent row: steps, lessons
--     and lesson_sources each carry a composite foreign key
--     (parent_id, user_id) -> parent (id, user_id).
--     learning_ai_calls deliberately does NOT. It is a cost ledger whose
--     topic_id / step_id are labels with ON DELETE SET NULL, so a spend row
--     outlives what it was spent on. (A composite key here would need the
--     PostgreSQL 15 form ON DELETE SET NULL (topic_id); a plain SET NULL would
--     also null user_id, which is NOT NULL.) It is not needed: a forged label
--     pointing at someone else's topic only mislabels the forger's own row.
--     Nothing is joined through it, RLS reads the row back by user_id alone,
--     and the daily cap sums by user_id.
--   - A stored source is https and was fetched with a 2xx status.
--
-- "Add your own source" (web link, YouTube, PDF) is a follow-up PR with its
-- own migration; nothing here is for it.

begin;

-- ---------------------------------------------------------------------------
-- 1. Topics
-- ---------------------------------------------------------------------------
create table if not exists public.learning_topics (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  status        text not null default 'planning'
                  check (status in ('planning', 'active', 'failed')),
  error_message text,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint learning_topics_id_user_key unique (id, user_id)
);

-- ---------------------------------------------------------------------------
-- 2. Steps (the plan). position orders them inside a topic.
-- ---------------------------------------------------------------------------
create table if not exists public.learning_steps (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  topic_id       uuid not null,
  position       integer not null check (position >= 0),
  title          text not null check (char_length(btrim(title)) between 1 and 200),
  goal           text not null default '' check (char_length(goal) <= 500),
  search_query   text not null check (char_length(btrim(search_query)) between 1 and 300),
  status         text not null default 'pending'
                   check (status in ('pending', 'writing', 'ready', 'failed')),
  error_code     text
                   check (error_code in ('sources_unreachable', 'ungrounded', 'truncated', 'ai_error')),
  error_message  text,
  rewrite_reason text check (rewrite_reason in ('wrong', 'redo')),
  rewrite_note   text check (char_length(rewrite_note) <= 1000),
  claimed_at     timestamptz,
  opened_at      timestamptz,
  removed_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint learning_steps_id_user_key unique (id, user_id),
  constraint learning_steps_topic_position_key unique (topic_id, position),
  constraint learning_steps_topic_owner_fkey foreign key (topic_id, user_id)
    references public.learning_topics (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- 3. Lessons. One row per written version; the newest row is the lesson.
-- ---------------------------------------------------------------------------
create table if not exists public.learning_lessons (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  step_id    uuid not null,
  title      text not null check (char_length(btrim(title)) between 1 and 200),
  summary    text not null check (char_length(summary) <= 400),
  body       text not null check (char_length(body) between 1 and 20000),
  model      text not null check (char_length(model) between 1 and 100),
  reason     text not null default 'first' check (reason in ('first', 'wrong', 'redo')),
  feedback   text check (char_length(feedback) <= 1000),
  created_at timestamptz not null default now(),
  constraint learning_lessons_id_user_key unique (id, user_id),
  constraint learning_lessons_step_owner_fkey foreign key (step_id, user_id)
    references public.learning_steps (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- 4. Sources of a lesson. origin says where the URL came from:
--    'search' = returned by Groq's browser_search tool, then fetched by the server
--    'github' = a public README the server fetched from GitHub
-- ---------------------------------------------------------------------------
create table if not exists public.learning_lesson_sources (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  lesson_id   uuid not null,
  position    integer not null check (position >= 0),
  url         text not null check (url ~ '^https://' and char_length(url) <= 2048),
  title       text not null check (char_length(title) <= 300),
  site_name   text not null check (char_length(site_name) <= 200),
  origin      text not null check (origin in ('search', 'github')),
  http_status integer not null check (http_status between 200 and 299),
  fetched_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  constraint learning_lesson_sources_lesson_position_key unique (lesson_id, position),
  constraint learning_lesson_sources_lesson_owner_fkey foreign key (lesson_id, user_id)
    references public.learning_lessons (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- 5. Every AI call learning makes, successful or not. The daily budget is the
--    sum of total_tokens over the last 24 hours, so it survives cold starts.
-- ---------------------------------------------------------------------------
create table if not exists public.learning_ai_calls (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  topic_id          uuid references public.learning_topics (id) on delete set null,
  step_id           uuid references public.learning_steps (id) on delete set null,
  kind              text not null check (kind in ('plan', 'search', 'write')),
  model             text not null check (char_length(model) between 1 and 100),
  outcome           text not null
                      check (outcome in ('ok', 'rate_limited', 'truncated', 'empty', 'invalid', 'error')),
  prompt_tokens     integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  total_tokens      integer not null default 0 check (total_tokens >= 0),
  pages_opened      integer not null default 0 check (pages_opened >= 0),
  duration_ms       integer not null default 0 check (duration_ms >= 0),
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. Per-user learning settings: GitHub username and the README digest.
-- ---------------------------------------------------------------------------
create table if not exists public.learning_profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users (id) on delete cascade,
  github_username   text
                      check (github_username ~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'),
  project_digest    jsonb not null default '[]'::jsonb
                      check (jsonb_typeof(project_digest) = 'array'),
  digest_updated_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. Indexes (unique constraints above already index topic_id, lesson_id and
--    learning_profiles.user_id).
-- ---------------------------------------------------------------------------
create index if not exists learning_topics_user_created_idx
  on public.learning_topics (user_id, created_at desc);
create index if not exists learning_steps_user_idx
  on public.learning_steps (user_id);
create index if not exists learning_lessons_step_created_idx
  on public.learning_lessons (step_id, created_at desc);
create index if not exists learning_lessons_user_idx
  on public.learning_lessons (user_id);
create index if not exists learning_lesson_sources_user_idx
  on public.learning_lesson_sources (user_id);
create index if not exists learning_ai_calls_user_created_idx
  on public.learning_ai_calls (user_id, created_at desc);
create index if not exists learning_ai_calls_topic_idx
  on public.learning_ai_calls (topic_id);
create index if not exists learning_ai_calls_step_idx
  on public.learning_ai_calls (step_id);

-- ---------------------------------------------------------------------------
-- 8. updated_at triggers (public.update_updated_at already exists).
-- ---------------------------------------------------------------------------
drop trigger if exists t_learning_topics on public.learning_topics;
create trigger t_learning_topics before update on public.learning_topics
  for each row execute function public.update_updated_at();
drop trigger if exists t_learning_steps on public.learning_steps;
create trigger t_learning_steps before update on public.learning_steps
  for each row execute function public.update_updated_at();
drop trigger if exists t_learning_profiles on public.learning_profiles;
create trigger t_learning_profiles before update on public.learning_profiles
  for each row execute function public.update_updated_at();

-- ---------------------------------------------------------------------------
-- 9. Row-level security. (select auth.uid()) is evaluated once per statement
--    instead of once per row - the form PR 83 proposes for the older tables.
-- ---------------------------------------------------------------------------
alter table public.learning_topics enable row level security;
alter table public.learning_steps enable row level security;
alter table public.learning_lessons enable row level security;
alter table public.learning_lesson_sources enable row level security;
alter table public.learning_ai_calls enable row level security;
alter table public.learning_profiles enable row level security;

-- topics: select, insert, update. No delete (archive instead).
drop policy if exists learning_topics_select_own on public.learning_topics;
create policy learning_topics_select_own on public.learning_topics
  for select using ((select auth.uid()) = user_id);
drop policy if exists learning_topics_insert_own on public.learning_topics;
create policy learning_topics_insert_own on public.learning_topics
  for insert with check ((select auth.uid()) = user_id);
drop policy if exists learning_topics_update_own on public.learning_topics;
create policy learning_topics_update_own on public.learning_topics
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- steps: select, insert, update. No delete (removed_at instead).
drop policy if exists learning_steps_select_own on public.learning_steps;
create policy learning_steps_select_own on public.learning_steps
  for select using ((select auth.uid()) = user_id);
drop policy if exists learning_steps_insert_own on public.learning_steps;
create policy learning_steps_insert_own on public.learning_steps
  for insert with check ((select auth.uid()) = user_id);
drop policy if exists learning_steps_update_own on public.learning_steps;
create policy learning_steps_update_own on public.learning_steps
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- lessons: select, insert. Saved once - no update, no delete.
drop policy if exists learning_lessons_select_own on public.learning_lessons;
create policy learning_lessons_select_own on public.learning_lessons
  for select using ((select auth.uid()) = user_id);
drop policy if exists learning_lessons_insert_own on public.learning_lessons;
create policy learning_lessons_insert_own on public.learning_lessons
  for insert with check ((select auth.uid()) = user_id);

-- lesson sources: select, insert. Saved with the lesson, never edited.
drop policy if exists learning_lesson_sources_select_own on public.learning_lesson_sources;
create policy learning_lesson_sources_select_own on public.learning_lesson_sources
  for select using ((select auth.uid()) = user_id);
drop policy if exists learning_lesson_sources_insert_own on public.learning_lesson_sources;
create policy learning_lesson_sources_insert_own on public.learning_lesson_sources
  for insert with check ((select auth.uid()) = user_id);

-- AI-call log: select, insert. An append-only ledger.
drop policy if exists learning_ai_calls_select_own on public.learning_ai_calls;
create policy learning_ai_calls_select_own on public.learning_ai_calls
  for select using ((select auth.uid()) = user_id);
drop policy if exists learning_ai_calls_insert_own on public.learning_ai_calls;
create policy learning_ai_calls_insert_own on public.learning_ai_calls
  for insert with check ((select auth.uid()) = user_id);

-- profiles: select, insert, update.
drop policy if exists learning_profiles_select_own on public.learning_profiles;
create policy learning_profiles_select_own on public.learning_profiles
  for select using ((select auth.uid()) = user_id);
drop policy if exists learning_profiles_insert_own on public.learning_profiles;
create policy learning_profiles_insert_own on public.learning_profiles
  for insert with check ((select auth.uid()) = user_id);
drop policy if exists learning_profiles_update_own on public.learning_profiles;
create policy learning_profiles_update_own on public.learning_profiles
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

commit;
