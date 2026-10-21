-- RLS init-plan rewrite, covering indexes for foreign keys, and search_path
-- pinning on the two trigger functions.
--
-- STATUS: PROPOSED — NOT YET APPLIED. Run by hand in the Supabase SQL Editor.
-- Everything above the CHECKS section is one transaction, so it lands whole or
-- not at all. Then run each CHECK query ONE AT A TIME (the editor shows only
-- the last statement's result). Update supabase/schema.sql to match only after
-- the checks pass: schema.sql describes the live database and must not run
-- ahead of it.
--
-- HOW MUCH THIS MATTERS TODAY: very little, and that is the point of doing it
-- now. The Supabase advisors (2026-10-05) flag 46 policies (auth_rls_initplan,
-- WARN) and 15 foreign keys without a covering index (unindexed_foreign_keys,
-- INFO). Every app table is in the hundreds of rows, where Postgres scans
-- sequentially anyway, so no request is measurably slower because of either.
-- Both costs grow with row count; fixing them while the tables are tiny makes
-- every statement below effectively instant.
--
-- 1. auth.uid() -> (select auth.uid()). Written bare, the function is called
--    once PER ROW the policy inspects; wrapped in a scalar subquery Postgres
--    evaluates it once per STATEMENT (an "init plan") and reuses the value.
--    The predicate is the same for every row, so who can see or write what
--    does not change. ALTER POLICY keeps each policy's command and roles; only
--    the expression is replaced. Generated from the live pg_policies rows —
--    every one was exactly "(auth.uid() = user_id)", or "= id" for profiles.
--
-- 2. Indexes on foreign-key columns. Where a query also filters on time, the
--    index leads with the FK and adds that column, so one index serves both
--    the FK and the read (srs_reviews by user then reviewed_at, for the streak
--    and analytics windows). The ones that matter most are the ON DELETE
--    paths: deleting a card cascades to srs_reviews.card_id, and deleting a
--    note / plan / task nulls out reminders.note_id, srs_cards.note_id,
--    tasks.plan_id and reminders.task_id — each a full scan without an index.
--    /api/tasks also looks reminders up by task_id on every task save.
--
-- 3. search_path pinned to '' on handle_new_user() (SECURITY DEFINER) and
--    update_updated_at(). Both bodies already schema-qualify what they touch
--    (public.profiles; now() and coalesce() live in pg_catalog, which is always
--    searched), so behaviour is unchanged; the pin stops a caller's
--    search_path from ever resolving a name differently inside them.

BEGIN;

-- ── 1. RLS policies ────────────────────────────────────────────────────────

-- countdowns
ALTER POLICY "own_countdowns" ON "public"."countdowns" USING ((select auth.uid()) = user_id);  -- ALL

-- focus_categories
ALTER POLICY "Users can delete own focus categories" ON "public"."focus_categories" USING ((select auth.uid()) = user_id);  -- DELETE
ALTER POLICY "Users can insert own focus categories" ON "public"."focus_categories" WITH CHECK ((select auth.uid()) = user_id);  -- INSERT
ALTER POLICY "Users can select own focus categories" ON "public"."focus_categories" USING ((select auth.uid()) = user_id);  -- SELECT
ALTER POLICY "Users can update own focus categories" ON "public"."focus_categories" USING ((select auth.uid()) = user_id);  -- UPDATE

-- focus_sessions
ALTER POLICY "own_focus_sessions" ON "public"."focus_sessions" USING ((select auth.uid()) = user_id);  -- ALL

-- mood_logs
ALTER POLICY "own_mood_logs" ON "public"."mood_logs" USING ((select auth.uid()) = user_id);  -- ALL

-- notes
ALTER POLICY "own_notes" ON "public"."notes" USING ((select auth.uid()) = user_id);  -- ALL

-- plans
ALTER POLICY "own_plans" ON "public"."plans" USING ((select auth.uid()) = user_id);  -- ALL

-- profiles
ALTER POLICY "own_profiles" ON "public"."profiles" USING ((select auth.uid()) = id);  -- ALL

-- push_subscriptions
ALTER POLICY "own_push_subscriptions" ON "public"."push_subscriptions" USING ((select auth.uid()) = user_id);  -- ALL

-- recurring_tasks
ALTER POLICY "Users can delete own recurring tasks" ON "public"."recurring_tasks" USING ((select auth.uid()) = user_id);  -- DELETE
ALTER POLICY "Users can insert own recurring tasks" ON "public"."recurring_tasks" WITH CHECK ((select auth.uid()) = user_id);  -- INSERT
ALTER POLICY "Users can select own recurring tasks" ON "public"."recurring_tasks" USING ((select auth.uid()) = user_id);  -- SELECT
ALTER POLICY "Users can update own recurring tasks" ON "public"."recurring_tasks" USING ((select auth.uid()) = user_id);  -- UPDATE

-- reminders
ALTER POLICY "own_reminders" ON "public"."reminders" USING ((select auth.uid()) = user_id);  -- ALL

-- session_exercises
ALTER POLICY "session_exercises_delete_own" ON "public"."session_exercises" USING ((select auth.uid()) = user_id);  -- DELETE
ALTER POLICY "session_exercises_insert_own" ON "public"."session_exercises" WITH CHECK ((select auth.uid()) = user_id);  -- INSERT
ALTER POLICY "session_exercises_select_own" ON "public"."session_exercises" USING ((select auth.uid()) = user_id);  -- SELECT
ALTER POLICY "session_exercises_update_own" ON "public"."session_exercises" USING ((select auth.uid()) = user_id);  -- UPDATE

-- srs_cards
ALTER POLICY "own_srs_cards" ON "public"."srs_cards" USING ((select auth.uid()) = user_id);  -- ALL

-- srs_reviews
ALTER POLICY "own_srs_reviews" ON "public"."srs_reviews" USING ((select auth.uid()) = user_id);  -- ALL

-- streak_freeze_logs
ALTER POLICY "Users can insert own freeze logs" ON "public"."streak_freeze_logs" WITH CHECK ((select auth.uid()) = user_id);  -- INSERT
ALTER POLICY "Users can select own freeze logs" ON "public"."streak_freeze_logs" USING ((select auth.uid()) = user_id);  -- SELECT

-- tasks
ALTER POLICY "own_tasks" ON "public"."tasks" USING ((select auth.uid()) = user_id);  -- ALL

-- template_exercises
ALTER POLICY "template_exercises_delete_own" ON "public"."template_exercises" USING ((select auth.uid()) = user_id);  -- DELETE
ALTER POLICY "template_exercises_insert_own" ON "public"."template_exercises" WITH CHECK ((select auth.uid()) = user_id);  -- INSERT
ALTER POLICY "template_exercises_select_own" ON "public"."template_exercises" USING ((select auth.uid()) = user_id);  -- SELECT
ALTER POLICY "template_exercises_update_own" ON "public"."template_exercises" USING ((select auth.uid()) = user_id);  -- UPDATE

-- template_sets
ALTER POLICY "template_sets_delete_own" ON "public"."template_sets" USING ((select auth.uid()) = user_id);  -- DELETE
ALTER POLICY "template_sets_insert_own" ON "public"."template_sets" WITH CHECK ((select auth.uid()) = user_id);  -- INSERT
ALTER POLICY "template_sets_select_own" ON "public"."template_sets" USING ((select auth.uid()) = user_id);  -- SELECT
ALTER POLICY "template_sets_update_own" ON "public"."template_sets" USING ((select auth.uid()) = user_id);  -- UPDATE

-- workout_sessions
ALTER POLICY "workout_sessions_delete_own" ON "public"."workout_sessions" USING ((select auth.uid()) = user_id);  -- DELETE
ALTER POLICY "workout_sessions_insert_own" ON "public"."workout_sessions" WITH CHECK ((select auth.uid()) = user_id);  -- INSERT
ALTER POLICY "workout_sessions_select_own" ON "public"."workout_sessions" USING ((select auth.uid()) = user_id);  -- SELECT
ALTER POLICY "workout_sessions_update_own" ON "public"."workout_sessions" USING ((select auth.uid()) = user_id);  -- UPDATE

-- workout_sets
ALTER POLICY "workout_sets_delete_own" ON "public"."workout_sets" USING ((select auth.uid()) = user_id);  -- DELETE
ALTER POLICY "workout_sets_insert_own" ON "public"."workout_sets" WITH CHECK ((select auth.uid()) = user_id);  -- INSERT
ALTER POLICY "workout_sets_select_own" ON "public"."workout_sets" USING ((select auth.uid()) = user_id);  -- SELECT
ALTER POLICY "workout_sets_update_own" ON "public"."workout_sets" USING ((select auth.uid()) = user_id);  -- UPDATE

-- workout_templates
ALTER POLICY "workout_templates_delete_own" ON "public"."workout_templates" USING ((select auth.uid()) = user_id);  -- DELETE
ALTER POLICY "workout_templates_insert_own" ON "public"."workout_templates" WITH CHECK ((select auth.uid()) = user_id);  -- INSERT
ALTER POLICY "workout_templates_select_own" ON "public"."workout_templates" USING ((select auth.uid()) = user_id);  -- SELECT
ALTER POLICY "workout_templates_update_own" ON "public"."workout_templates" USING ((select auth.uid()) = user_id);  -- UPDATE

-- youtube_note_jobs
ALTER POLICY "Users can manage their own youtube note jobs" ON "public"."youtube_note_jobs" USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);  -- ALL

-- ── 2. Foreign-key indexes ─────────────────────────────────────────────────
-- Cascade / SET NULL targets: a parent delete scans these without an index.
CREATE INDEX IF NOT EXISTS "idx_srs_reviews_card_id" ON "public"."srs_reviews" USING "btree" ("card_id");
CREATE INDEX IF NOT EXISTS "idx_reminders_task_id" ON "public"."reminders" USING "btree" ("task_id");
CREATE INDEX IF NOT EXISTS "idx_reminders_note_id" ON "public"."reminders" USING "btree" ("note_id");
CREATE INDEX IF NOT EXISTS "idx_srs_cards_note_id" ON "public"."srs_cards" USING "btree" ("note_id");
CREATE INDEX IF NOT EXISTS "idx_tasks_plan_id" ON "public"."tasks" USING "btree" ("plan_id");
CREATE INDEX IF NOT EXISTS "idx_workout_sessions_template_id" ON "public"."workout_sessions" USING "btree" ("template_id");
CREATE INDEX IF NOT EXISTS "idx_invite_codes_used_by" ON "public"."invite_codes" USING "btree" ("used_by");

-- user_id FKs, shaped for the reads that filter on them.
CREATE INDEX IF NOT EXISTS "idx_srs_reviews_user_reviewed_at" ON "public"."srs_reviews" USING "btree" ("user_id", "reviewed_at");
CREATE INDEX IF NOT EXISTS "idx_focus_sessions_user_started_at" ON "public"."focus_sessions" USING "btree" ("user_id", "started_at");
CREATE INDEX IF NOT EXISTS "idx_countdowns_user_target_date" ON "public"."countdowns" USING "btree" ("user_id", "target_date");
CREATE INDEX IF NOT EXISTS "idx_plans_user_id" ON "public"."plans" USING "btree" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_session_exercises_user_id" ON "public"."session_exercises" USING "btree" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_workout_templates_user_id" ON "public"."workout_templates" USING "btree" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_template_exercises_user_id" ON "public"."template_exercises" USING "btree" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_template_sets_user_id" ON "public"."template_sets" USING "btree" ("user_id");

-- ── 3. Trigger-function search_path ────────────────────────────────────────
ALTER FUNCTION "public"."handle_new_user"() SET search_path = '';
ALTER FUNCTION "public"."update_updated_at"() SET search_path = '';

COMMIT;

-- ── CHECKS — run ONE AT A TIME, after the block above ──────────────────────
--
-- a) No policy still calls auth.uid() bare. Expect 0.
--    SELECT count(*) FROM pg_policies
--    WHERE schemaname = 'public'
--      AND (qual ~ 'auth\.uid\(\) =' OR with_check ~ 'auth\.uid\(\) =');
--
-- b) All 46 policies are still present. Expect 46.
--    SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--
-- c) The 15 new indexes exist. Expect 15.
--    SELECT count(*) FROM pg_indexes
--    WHERE schemaname = 'public' AND indexname IN (
--      'idx_srs_reviews_card_id', 'idx_reminders_task_id', 'idx_reminders_note_id',
--      'idx_srs_cards_note_id', 'idx_tasks_plan_id', 'idx_workout_sessions_template_id',
--      'idx_invite_codes_used_by', 'idx_srs_reviews_user_reviewed_at',
--      'idx_focus_sessions_user_started_at', 'idx_countdowns_user_target_date',
--      'idx_plans_user_id', 'idx_session_exercises_user_id',
--      'idx_workout_templates_user_id', 'idx_template_exercises_user_id',
--      'idx_template_sets_user_id');
--
-- d) Both functions pinned. Expect two rows, each proconfig {search_path=""}.
--    SELECT proname, proconfig FROM pg_proc
--    WHERE pronamespace = 'public'::regnamespace
--      AND proname IN ('handle_new_user', 'update_updated_at');
--
-- e) Dashboard → Advisors → Performance: auth_rls_initplan and
--    unindexed_foreign_keys should both be gone.
--
-- f) In the app, signed in: load the dashboard, create a task, complete it,
--    delete it. That exercises SELECT / INSERT / UPDATE / DELETE through the
--    rewritten tasks and reminders policies.

-- ── NOT INCLUDED — decisions, not fixes ────────────────────────────────────
--
-- handle_new_user() is EXECUTE-able by anon / authenticated (advisors 0028,
-- 0029). It is a trigger function, so a call through /rest/v1/rpc fails before
-- its body runs; the exposure is nil and revoking only quiets the advisor.
-- If wanted:
--    REVOKE EXECUTE ON FUNCTION "public"."handle_new_user"() FROM PUBLIC, "anon", "authenticated";
-- then prove signup still creates a profiles row (docs/DEPLOYMENT.md, "Adding
-- another user") before calling it done.
--
-- push_delivery_log is NOT addressed here. /api/push/due writes an
-- 'invocation' row on every cron tick (~1,440 a day) and nothing in the app
-- reads the table, but Supabase Cron already runs a job meant to trim it
-- (prism-log-prune), which no codebase search can see. Check that job before
-- adding any retention of your own.
--
-- pg_net is installed in the public schema (advisor 0014). Moving it means
-- dropping and recreating the extension underneath the cron jobs that call
-- net.http_post: a scheduled-outage change, not a hygiene one.
