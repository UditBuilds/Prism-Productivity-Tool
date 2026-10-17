-- Daily Planner v1: anchors, one plan per user per IST day, and the plan's items.
--
-- PROPOSED, NOT YET RUN. Udit runs this in the Supabase SQL Editor after
-- reviewing it. supabase/schema.sql gets the same shape when the PR lands.
--
-- Re-runnable: tables use IF NOT EXISTS, policies are dropped before they are
-- created, and the function is CREATE OR REPLACE.

-- 1. Anchors: the fixed daily items ("Gym, Mon/Wed/Fri"). Data, not code.
--    days_of_week uses the same numbering as recurring_tasks and istWeekday():
--    0 = Sunday ... 6 = Saturday, in IST.
--    follows_anchor_id = "place me directly after that anchor" (the Instagram
--    post after the gym). NULL for everything else.
CREATE TABLE IF NOT EXISTS public.plan_anchors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  days_of_week integer[] NOT NULL,
  position integer NOT NULL DEFAULT 0,
  follows_anchor_id uuid REFERENCES public.plan_anchors(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT plan_anchors_title_check
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT plan_anchors_days_check
    CHECK (cardinality(days_of_week) BETWEEN 1 AND 7
           AND days_of_week <@ ARRAY[0,1,2,3,4,5,6]),
  CONSTRAINT plan_anchors_not_self_check
    CHECK (follows_anchor_id IS NULL OR follows_anchor_id <> id)
);

CREATE INDEX IF NOT EXISTS plan_anchors_user_active_idx
  ON public.plan_anchors (user_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS plan_anchors_follows_idx
  ON public.plan_anchors (follows_anchor_id) WHERE follows_anchor_id IS NOT NULL;

-- 2. One plan per user per IST day. plan_date is the IST civil date.
--    notified_at / push_sent / push_failed are the database proof that the
--    11:00 push went out, and the guard that stops a re-run pushing twice.
CREATE TABLE IF NOT EXISTS public.daily_plans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  plan_date date NOT NULL,
  source text NOT NULL,
  reason text NOT NULL,
  accepted_at timestamptz,
  notified_at timestamptz,
  push_sent integer,
  push_failed integer,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT daily_plans_source_check CHECK (source IN ('ai', 'fallback')),
  CONSTRAINT daily_plans_user_date_key UNIQUE (user_id, plan_date)
);

-- 3. The items in a plan. title is a snapshot, so the history still reads
--    after the task or anchor behind it is deleted (its id goes NULL).
--    Status words: 'dropped' is for a task, 'skipped' is for an anchor — the
--    brief's "dropping an anchor is recorded as skipped today".
--    moved_to is the IST date an item was moved to (always plan_date + 1 in v1);
--    tomorrow's plan picks up moved anchors by reading it.
CREATE TABLE IF NOT EXISTS public.daily_plan_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  plan_id uuid REFERENCES public.daily_plans(id) ON DELETE CASCADE NOT NULL,
  position integer NOT NULL,
  kind text NOT NULL,
  anchor_id uuid REFERENCES public.plan_anchors(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  moved_to date,
  status_changed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT daily_plan_items_kind_check CHECK (kind IN ('anchor', 'task')),
  CONSTRAINT daily_plan_items_status_check
    CHECK (status IN ('planned', 'moved', 'dropped', 'skipped')),
  -- A task item never carries an anchor id, and the reverse. Either id may be
  -- NULL after its source row is deleted.
  CONSTRAINT daily_plan_items_source_check
    CHECK ((kind = 'task' AND anchor_id IS NULL)
        OR (kind = 'anchor' AND task_id IS NULL)),
  CONSTRAINT daily_plan_items_drop_word_check
    CHECK ((status <> 'skipped' OR kind = 'anchor')
       AND (status <> 'dropped' OR kind = 'task')),
  CONSTRAINT daily_plan_items_moved_check
    CHECK ((status = 'moved') = (moved_to IS NOT NULL)),
  CONSTRAINT daily_plan_items_position_key UNIQUE (plan_id, position)
);

CREATE INDEX IF NOT EXISTS daily_plan_items_user_idx
  ON public.daily_plan_items (user_id);
CREATE INDEX IF NOT EXISTS daily_plan_items_task_idx
  ON public.daily_plan_items (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS daily_plan_items_anchor_idx
  ON public.daily_plan_items (anchor_id) WHERE anchor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS daily_plan_items_moved_to_idx
  ON public.daily_plan_items (user_id, moved_to) WHERE status = 'moved';

-- 4. RLS, split by command, same predicate the live tables use.
ALTER TABLE public.plan_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plan_anchors_select_own ON public.plan_anchors;
DROP POLICY IF EXISTS plan_anchors_insert_own ON public.plan_anchors;
DROP POLICY IF EXISTS plan_anchors_update_own ON public.plan_anchors;
DROP POLICY IF EXISTS plan_anchors_delete_own ON public.plan_anchors;
CREATE POLICY plan_anchors_select_own ON public.plan_anchors
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY plan_anchors_insert_own ON public.plan_anchors
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY plan_anchors_update_own ON public.plan_anchors
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY plan_anchors_delete_own ON public.plan_anchors
  FOR DELETE USING (auth.uid() = user_id);

-- No DELETE policy on plans or items: drop is a status, never a delete. The
-- auth.users cascade still removes them when an account is deleted.
DROP POLICY IF EXISTS daily_plans_select_own ON public.daily_plans;
DROP POLICY IF EXISTS daily_plans_insert_own ON public.daily_plans;
DROP POLICY IF EXISTS daily_plans_update_own ON public.daily_plans;
CREATE POLICY daily_plans_select_own ON public.daily_plans
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY daily_plans_insert_own ON public.daily_plans
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY daily_plans_update_own ON public.daily_plans
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS daily_plan_items_select_own ON public.daily_plan_items;
DROP POLICY IF EXISTS daily_plan_items_insert_own ON public.daily_plan_items;
DROP POLICY IF EXISTS daily_plan_items_update_own ON public.daily_plan_items;
CREATE POLICY daily_plan_items_select_own ON public.daily_plan_items
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY daily_plan_items_insert_own ON public.daily_plan_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY daily_plan_items_update_own ON public.daily_plan_items
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_anchors TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.daily_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.daily_plan_items TO authenticated;
GRANT ALL ON public.plan_anchors, public.daily_plans, public.daily_plan_items
  TO service_role;

-- 5. Create a plan and all its items in ONE transaction, idempotently.
--    The 11:00 cron and a dashboard open can race; the loser gets the winner's
--    plan back, and a plan row can never exist without its items.
--    SECURITY INVOKER: called with a user's session, RLS still applies, so a
--    caller cannot write a plan for anyone else. The cron calls it with the
--    service role.
CREATE OR REPLACE FUNCTION public.create_daily_plan(
  p_user_id uuid,
  p_plan_date date,
  p_source text,
  p_reason text,
  p_items jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
BEGIN
  INSERT INTO public.daily_plans (user_id, plan_date, source, reason)
  VALUES (p_user_id, p_plan_date, p_source, p_reason)
  ON CONFLICT (user_id, plan_date) DO NOTHING
  RETURNING id INTO v_plan_id;

  IF v_plan_id IS NULL THEN
    -- Someone else created today's plan first. Its items were written in the
    -- same transaction as its row, so it is already complete.
    SELECT id INTO v_plan_id
    FROM public.daily_plans
    WHERE user_id = p_user_id AND plan_date = p_plan_date;
    RETURN v_plan_id;
  END IF;

  INSERT INTO public.daily_plan_items
    (user_id, plan_id, position, kind, anchor_id, task_id, title)
  SELECT p_user_id,
         v_plan_id,
         (item->>'position')::integer,
         item->>'kind',
         (item->>'anchor_id')::uuid,
         (item->>'task_id')::uuid,
         item->>'title'
  FROM jsonb_array_elements(p_items) AS item;

  RETURN v_plan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_daily_plan(uuid, date, text, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_daily_plan(uuid, date, text, text, jsonb)
  TO authenticated, service_role;
