-- ============================================================================
-- Prism demo account — nightly wipe + reseed
-- ============================================================================
--
-- WHAT THIS IS
-- A single SQL function, public.reset_demo_account(), plus the pg_cron job that
-- calls it at 03:00 IST. Running it returns the demo account to a fixed,
-- lived-in state: every row it owns is deleted, then the seed set below is
-- re-inserted.
--
-- WHY DIRECT SQL AND NOT AN API ROUTE
-- This mirrors `prism-log-prune` (jobid 15), the one existing Supabase Cron job
-- that does its work in the database rather than posting to Vercel. The other
-- three jobs (prism-tiny-wins, prism-recurring-tasks, prism-push-due) use
-- net.http_post because they need application code — web-push, the AI client.
-- Reseeding needs none of that, and the direct-SQL shape is strictly better
-- here:
--
--   * net.http_post is fire-and-forget. A "succeeded" row in
--     cron.job_run_details only means the request was QUEUED; the real status
--     hides in net._http_response. A direct call puts the true outcome in
--     cron.job_run_details itself — prism-log-prune's rows read "DELETE 1440".
--   * No cron secret in a header, no Vercel cold start, no route to keep in
--     sync with the schema.
--
-- SCHEDULE — 21:30 UTC, NOT 03:00 UTC
-- pg_cron schedules are evaluated in the database timezone, and this database
-- is UTC (verified: current_setting('TimeZone') = 'UTC'). So `30 21 * * *` is
-- 03:00 IST the following morning. The existing jobs confirm the convention:
-- prism-tiny-wins runs `30 15 * * *`, which is the 21:00 IST daily summary its
-- route is documented as. Writing `0 3 * * *` here would fire at 08:30 IST.
--
-- DATES ARE RELATIVE, NOT ABSOLUTE
-- Every date is derived from the IST civil day at run time, so the demo reads
-- as "this week" forever. Absolute dates would drift: within a month the
-- workout history would slide out of the analysis window and every task would
-- show as months overdue.
--
-- IST CORRECTNESS
-- The app anchors tasks.due_date at noon IST, which is 06:30:00+00. The SQL
-- equivalent used throughout this file is
--     (<date> + time '12:00') at time zone 'Asia/Kolkata'
-- verified against the live database to produce exactly 06:30:00+00, matching
-- lib/date.ts istCivilDateToNoonIso (Date.UTC(y, m-1, d, 6, 30)).
--
-- KNOWN, ACCEPTED TRADEOFF
-- If someone is using the demo when the reset fires, their in-flight work
-- disappears and they see the fresh seed on next load. There is no session
-- coordination and none is wanted — the account is a display case, not storage.
--
-- HOW TO APPLY: see the bottom of this file. This file is a reference; nothing
-- in it exists in the database until it is run in the Supabase SQL Editor.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The reset function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_demo_account()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  -- The demo account, created by hand in the Supabase dashboard with Auto
  -- Confirm on (public signups are closed and stay closed).
  demo_id    constant uuid := 'eac085cc-54df-4414-9c43-08a6ce84ecea';
  demo_email constant text := 'demo@prismapp.dev';

  actual_email text;
  d0           date;      -- today, as an IST civil day
  n_tasks      integer;
  n_sets       integer;
BEGIN
  -- --------------------------------------------------------------------
  -- GUARD. Every statement below filters on demo_id, but a UUID typo in a
  -- later edit would silently retarget all of them at once. Proving the id
  -- still resolves to the demo address turns that class of mistake into an
  -- abort instead of a data loss: no real account can ever match, because no
  -- real account has this email.
  -- --------------------------------------------------------------------
  SELECT email INTO actual_email FROM auth.users WHERE id = demo_id;

  IF actual_email IS DISTINCT FROM demo_email THEN
    RAISE EXCEPTION
      'reset_demo_account aborted: % does not resolve to % (found: %)',
      demo_id, demo_email, coalesce(actual_email, '<no such user>');
  END IF;

  d0 := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  -- --------------------------------------------------------------------
  -- WIPE. Children before parents. Every predicate is `user_id = demo_id`
  -- and nothing else — no date ranges, no NOT IN, no joins that could widen
  -- the scope.
  -- --------------------------------------------------------------------
  DELETE FROM reminders           WHERE user_id = demo_id;
  DELETE FROM workout_sets        WHERE user_id = demo_id;
  DELETE FROM session_exercises   WHERE user_id = demo_id;
  DELETE FROM workout_sessions    WHERE user_id = demo_id;
  DELETE FROM template_sets       WHERE user_id = demo_id;
  DELETE FROM template_exercises  WHERE user_id = demo_id;
  DELETE FROM workout_templates   WHERE user_id = demo_id;
  DELETE FROM srs_reviews         WHERE user_id = demo_id;
  DELETE FROM srs_cards           WHERE user_id = demo_id;
  DELETE FROM tasks               WHERE user_id = demo_id;
  DELETE FROM recurring_tasks     WHERE user_id = demo_id;
  DELETE FROM plans               WHERE user_id = demo_id;
  DELETE FROM notes               WHERE user_id = demo_id;
  DELETE FROM focus_sessions      WHERE user_id = demo_id;
  DELETE FROM focus_categories    WHERE user_id = demo_id;
  DELETE FROM countdowns          WHERE user_id = demo_id;
  DELETE FROM mood_logs           WHERE user_id = demo_id;
  DELETE FROM streak_freeze_logs  WHERE user_id = demo_id;
  DELETE FROM youtube_note_jobs   WHERE user_id = demo_id;
  -- Cleared too: a visitor who granted notifications leaves a subscription
  -- behind, and without this they accumulate forever on an account nobody
  -- owns.
  DELETE FROM push_subscriptions  WHERE user_id = demo_id;

  UPDATE profiles
     SET display_name = 'Demo',
         timezone     = 'Asia/Kolkata',
         streak_freezes = 3,
         updated_at   = now()
   WHERE id = demo_id;

  -- --------------------------------------------------------------------
  -- SEED: plans
  -- --------------------------------------------------------------------
  INSERT INTO plans (id, user_id, title, description, status, target_date, created_at, updated_at)
  VALUES
    ('11111111-0000-4000-8000-000000000001', demo_id,
     'Ship Prism v1',
     'Close out the last of the polish work and get the public build out.',
     'active', d0 + 21, now() - interval '30 days', now() - interval '2 days'),
    ('11111111-0000-4000-8000-000000000002', demo_id,
     'Strength block - autumn',
     'Four sessions a week, add load every second session.',
     'active', d0 + 45, now() - interval '28 days', now() - interval '2 days');

  -- --------------------------------------------------------------------
  -- SEED: tasks
  --
  -- due_date is ALWAYS the noon-IST anchor (06:30:00+00), matching lib/date.ts
  -- istCivilDateToNoonIso. The mix is deliberate; each slice drives a different
  -- surface:
  --   2 overdue  -> the dashboard overdue query (.lt startOfToday)
  --   4 today    -> "Due Today"
  --   5 future   -> "Upcoming" (window [00:00 IST tomorrow, +30 days))
  --   8 done     -> "Done This Week", productivity, weekly review - all of
  --                 which bucket on completed_at, never updated_at
  -- --------------------------------------------------------------------
  INSERT INTO tasks (user_id, title, description, status, priority, due_date, plan_id, created_at, updated_at, completed_at)
  SELECT
    demo_id,
    t.title,
    t.description,
    t.status,
    t.priority,
    CASE WHEN t.due_offset IS NULL THEN NULL
         ELSE ((d0 + t.due_offset) + time '12:00') AT TIME ZONE 'Asia/Kolkata'
    END,
    t.plan_id,
    now() - (t.created_days_ago || ' days')::interval,
    now() - (t.created_days_ago || ' days')::interval,
    CASE WHEN t.done_offset IS NULL THEN NULL
         ELSE ((d0 + t.done_offset) + time '17:20') AT TIME ZONE 'Asia/Kolkata'
    END
  FROM (VALUES
    -- still open, due date already past
    ('Reply to the design feedback thread', 'Three comments on the spacing pass are still unanswered.', 'todo',        'high',   -3, 9,  NULL::integer, '11111111-0000-4000-8000-000000000001'::uuid),
    ('Book the dentist appointment',        NULL,                                                       'todo',        'medium', -1, 6,  NULL,          NULL),
    -- due today
    ('Finish the quarterly report draft',   'Numbers are in, it needs the summary section.',            'in_progress', 'high',    0, 5,  NULL,          '11111111-0000-4000-8000-000000000001'),
    ('Review pull request #47',             NULL,                                                       'todo',        'medium',  0, 3,  NULL,          '11111111-0000-4000-8000-000000000001'),
    ('Call the bank about the new card',    NULL,                                                       'todo',        'low',     0, 4,  NULL,          NULL),
    ('Water the plants',                    NULL,                                                       'todo',        'low',     0, 2,  NULL,          NULL),
    -- upcoming
    ('Prep notes for the team retro',       'Two wins, one thing to change.',                           'todo',        'medium',  1, 4,  NULL,          '11111111-0000-4000-8000-000000000001'),
    ('Submit the expense claims',           NULL,                                                       'todo',        'medium',  2, 7,  NULL,          NULL),
    ('Renew the gym membership',            NULL,                                                       'todo',        'low',     4, 8,  NULL,          '11111111-0000-4000-8000-000000000002'),
    ('Deload week - drop volume by 40%',    'Planned break after the current block.',                   'todo',        'medium',  6, 10, NULL,          '11111111-0000-4000-8000-000000000002'),
    ('Quarterly review with manager',       NULL,                                                       'todo',        'high',    9, 11, NULL,          NULL),
    -- completed this week
    ('Draft the launch email',              NULL,                                                       'done',        'high',   -1, 8,  -1,            '11111111-0000-4000-8000-000000000001'),
    ('Update the README screenshots',       NULL,                                                       'done',        'medium', -1, 7,  -1,            '11111111-0000-4000-8000-000000000001'),
    ('Grocery run',                         NULL,                                                       'done',        'low',    -2, 4,  -2,            NULL),
    ('Refactor the auth guard',             'Split the redirect logic out of the layout.',              'done',        'medium', -2, 9,  -2,            '11111111-0000-4000-8000-000000000001'),
    ('Pay the electricity bill',            NULL,                                                       'done',        'medium', -3, 6,  -3,            NULL),
    ('Ship the offline-sync fix',           NULL,                                                       'done',        'high',   -4, 12, -4,            '11111111-0000-4000-8000-000000000001'),
    ('Write the weekly summary',            NULL,                                                       'done',        'low',    -5, 6,  -5,            NULL),
    ('Clear the inbox',                     NULL,                                                       'done',        'low',    -6, 8,  -6,            NULL)
  ) AS t(title, description, status, priority, due_offset, created_days_ago, done_offset, plan_id);

  GET DIAGNOSTICS n_tasks = ROW_COUNT;

  -- --------------------------------------------------------------------
  -- SEED: notes
  --
  -- `summary` is written explicitly on the Revisit notes. The app normally
  -- generates it with Groq on save, but the dashboard Revisit widget is a
  -- Server Component that only READS the column. Seeding it keeps the reset
  -- from depending on an AI call that can rate-limit - the account is on
  -- Groq's 8,000 TPM free tier, and a reset that half-fails at 3am with
  -- nobody watching is the worst possible shape.
  --
  -- EVERY REVISIT `content` MUST EXCEED 600 CHARACTERS, or seeding `summary`
  -- is pointless. lib/notes/revisit-summary.ts:23 sets
  -- SUMMARY_THRESHOLD_CHARS = 600 and `needsSummary` compares with a strict
  -- `>`; below that, `revisitPreview` returns mode "raw" and renders the
  -- markdown itself, so the summary column is never read. The first version
  -- of this seed wrote three notes of 345, 514 and 347 characters and the
  -- summaries below sat unused - the widget showed a `##` heading and a wall
  -- of prose where the shipped feature shows one tight paragraph, which on a
  -- demo of an "AI-native" app is the wrong thing to hide.
  --
  -- scripts/test-demo-seed.mjs parses these literals and asserts the length,
  -- so a future edit that trims a note back under the threshold fails there
  -- rather than silently in the UI.
  -- --------------------------------------------------------------------
  INSERT INTO notes (id, user_id, title, content, tags, kind, summary, created_at, updated_at)
  VALUES
    ('22222222-0000-4000-8000-000000000001', demo_id,
     'Spaced repetition, in one paragraph',
     E'## The idea\n\nReviewing something just before you would have forgotten it pushes it further into long-term memory. Review too early and the repetition is wasted; too late and you are relearning from scratch.\n\n## SM-2\n\nEvery card carries an ease factor and an interval. Rate a card well and the interval multiplies by the ease. Rate it badly and the interval collapses back to a day while the ease drops slightly.\n\n- Quality 0-5 drives both numbers\n- Ease never falls below 1.3\n- A lapse resets repetitions, not ease\n\n## The first two intervals are fixed\n\nOne day, then six. Only from the third review does the ease factor start compounding, so a brand new card is scheduled identically whether you found it obvious or barely knew it. The algorithm has nothing to go on yet.\n\n## What a lapse actually costs\n\nAnything below "ok" sends the interval back to a single day and the repetition count to zero. The ease factor moves by a fraction of a point. That asymmetry is deliberate: one bad night should cost you the schedule, not the card.',
     ARRAY['learning','srs'], 'revisit',
     E'- Spaced repetition schedules a review just before the point of forgetting: earlier wastes the rep, later means relearning from scratch.\n- SM-2 fixes the first two intervals at one day and six, and only compounds by the ease factor from the third review onward.\n- A lapse drops the interval to a day and zeroes the repetition count, but moves the ease by a fraction — one bad night costs the schedule, not the card.',
     now() - interval '19 days', now() - interval '3 days'),

    ('22222222-0000-4000-8000-000000000002', demo_id,
     'Progressive overload without the spreadsheet',
     E'## What actually matters\n\nThe top set is the signal. Everything before it is a ramp, and averaging the ramp back in only hides whether the hard set moved.\n\n## Practical rules\n\n- Add load only when the top set is clean\n- Two sessions at the same weight is information, not failure\n- A lighter week after a heavy block is planned, not a regression\n\n## Why not volume\n\nVolume needs weight and reps on every set, and reps are the first thing that stops getting written down once the set is actually hard. Take the heaviest set instead and a ramp of 60 x 15, 80 x 6, 90 x 2 reduces to 90 — the openers discarded exactly as they should be, with nothing to configure.\n\n## Reading a drop\n\nA lighter session is information, not a fault. Deload, poor sleep, a different rep target, a machine someone else was using: the numbers cannot tell you which. Treat a drop as a question, and only call it a trend once it has happened twice.',
     ARRAY['training'], 'revisit',
     E'- Judge progress on the top set alone: warmup sets are a ramp, and averaging them in hides whether the hard set actually moved.\n- Volume needs reps on every set, which is the first thing to stop being logged, so the heaviest set is the sturdier metric.\n- A lighter session is a question — deload, sleep, rep target — not a verdict, and not a trend until it happens twice.',
     now() - interval '12 days', now() - interval '2 days'),

    ('22222222-0000-4000-8000-000000000003', demo_id,
     'Why offline-first is mostly about writes',
     E'## Reads are the easy half\n\nA cache serves reads. The hard part is what happens to a write made with no connection: it has to survive a reload, replay in order, and never fire twice.\n\n## The trap\n\nCallbacks handed in at the call site do not survive serialisation. Only the queued write itself is stored, so anything that must happen afterwards has to live inside it rather than beside it.\n\n## Pausing is a three-way condition\n\nA write pauses instead of failing only when focus, connectivity and the queue all agree it should. Any one of them saying otherwise turns a pause into an error — which is why a backgrounded tab quietly holds work that the tab in front of you would have dropped.\n\n## Testing it honestly\n\nToggling an online flag proves nothing, because the first request is attempted regardless. The server has to genuinely stop answering, and the retry ladder has to be allowed to finish before the result means anything.',
     ARRAY['engineering','offline'], 'revisit',
     E'- Offline reads are the easy half; a cache covers them. The real problem is a write made with no connection.\n- That write has to survive a page reload, replay in the right order, and never fire twice, and per-call callbacks are not serialised alongside it.\n- Whether a write pauses or errors depends on focus, connectivity and the queue together — any one of them flips the outcome.',
     now() - interval '6 days', now() - interval '1 days'),

    ('22222222-0000-4000-8000-000000000004', demo_id,
     'Ask about the retro format',
     'The current one runs too long. Try the two-column version next time.',
     ARRAY['work'], 'spark', NULL,
     now() - interval '4 days', now() - interval '4 days'),

    ('22222222-0000-4000-8000-000000000005', demo_id,
     'Coffee place near the station',
     'The one with the green awning - opens at 7.',
     ARRAY[]::text[], 'spark', NULL,
     now() - interval '2 days', now() - interval '2 days'),

    ('22222222-0000-4000-8000-000000000006', demo_id,
     'Book idea: quiet interfaces',
     'Collect the screens that get out of the way. Most of them share one trick - they refuse to rank everything.',
     ARRAY['writing'], 'spark', NULL,
     now() - interval '1 days', now() - interval '1 days');

  -- --------------------------------------------------------------------
  -- SEED: reminders
  --
  -- task_id stays NULL on every row. The dashboard Upcoming list excludes
  -- task-linked reminders (.is("task_id", null)) because the task's own row
  -- already represents them - linking these would make them invisible there,
  -- which is the opposite of what a demo wants.
  -- --------------------------------------------------------------------
  INSERT INTO reminders (user_id, title, body, remind_at, is_sent, created_at)
  VALUES
    (demo_id, 'Stand-up call', 'Daily, 15 minutes.',
     ((d0 + 1) + time '09:45') AT TIME ZONE 'Asia/Kolkata', false, now() - interval '3 days'),
    (demo_id, 'Pick up the parcel', 'Locker closes at 8pm.',
     ((d0 + 2) + time '18:00') AT TIME ZONE 'Asia/Kolkata', false, now() - interval '1 days'),
    (demo_id, 'Physio appointment', NULL,
     ((d0 + 5) + time '11:30') AT TIME ZONE 'Asia/Kolkata', false, now() - interval '6 days'),
    (demo_id, 'Weekly review', 'Half an hour, Sunday evening.',
     ((d0 - 2) + time '20:00') AT TIME ZONE 'Asia/Kolkata', true, now() - interval '9 days');

  -- --------------------------------------------------------------------
  -- SEED: countdowns
  -- Future-dated only. The dashboard filters .gte(target_date, today), so a
  -- past countdown would sort first and permanently occupy a slot.
  -- --------------------------------------------------------------------
  INSERT INTO countdowns (user_id, title, target_date, emoji, created_at)
  VALUES
    (demo_id, 'Product launch',   d0 + 12, '🚀', now() - interval '20 days'),
    (demo_id, 'Trip to Kerala',   d0 + 34, '🌴', now() - interval '15 days'),
    (demo_id, 'Half marathon',    d0 + 61, '🏃', now() - interval '25 days');

  -- --------------------------------------------------------------------
  -- SEED: mood logs (one row per IST day, matching the unique constraint)
  -- Today is deliberately LEFT UNLOGGED so a visitor meets the check-in
  -- prompt rather than a filled-in summary - it is the interactive bit.
  -- --------------------------------------------------------------------
  INSERT INTO mood_logs (user_id, mood, note, logged_date, created_at)
  SELECT demo_id, m.mood, m.note, d0 - m.days_ago,
         ((d0 - m.days_ago) + time '21:10') AT TIME ZONE 'Asia/Kolkata'
  FROM (VALUES
    ('good',     'Solid focus in the morning.', 1),
    ('great',    'Hit a bench PR.',             2),
    ('neutral',  NULL,                          3),
    ('tired',    'Slept badly.',                4),
    ('good',     NULL,                          5),
    ('good',     'Cleared the backlog.',        6),
    ('stressed', 'Deadline moved up.',          7),
    ('neutral',  NULL,                          8),
    ('good',     NULL,                          9),
    ('great',    'Long walk, no screens.',     10)
  ) AS m(mood, note, days_ago);

  -- --------------------------------------------------------------------
  -- SEED: focus sessions
  -- Only completed = true rows count toward analytics minutes, categories and
  -- the peak-hour / best-weekday insights, and those insights return null
  -- under 3 completed sessions. 14 rows across 10 days clears that comfortably.
  -- --------------------------------------------------------------------
  INSERT INTO focus_sessions (user_id, category, duration_minutes, completed, started_at, ended_at, created_at)
  SELECT
    demo_id, f.category, f.duration_minutes, true,
    ((d0 - f.days_ago) + f.start_time) AT TIME ZONE 'Asia/Kolkata',
    ((d0 - f.days_ago) + f.start_time) AT TIME ZONE 'Asia/Kolkata' + (f.duration_minutes || ' minutes')::interval,
    ((d0 - f.days_ago) + f.start_time) AT TIME ZONE 'Asia/Kolkata'
  FROM (VALUES
    ('Deep Work', 50, 0,  time '09:30'),
    ('Work',      25, 0,  time '14:00'),
    ('Deep Work', 50, 1,  time '10:00'),
    ('Reading',   25, 1,  time '21:00'),
    ('Work',      50, 2,  time '11:15'),
    ('Study',     25, 2,  time '16:30'),
    ('Deep Work', 50, 3,  time '09:45'),
    ('Work',      25, 4,  time '15:00'),
    ('Reading',   25, 4,  time '22:00'),
    ('Deep Work', 50, 5,  time '10:30'),
    ('Study',     50, 6,  time '19:00'),
    ('Work',      25, 7,  time '13:30'),
    ('Deep Work', 50, 8,  time '09:15'),
    ('Reading',   25, 10, time '20:30')
  ) AS f(category, duration_minutes, days_ago, start_time);

  -- --------------------------------------------------------------------
  -- SEED: SRS cards
  --
  -- next_review split across past / today / future on purpose: the dashboard
  -- REVIEW counter and the Learn page both read the due count, so an
  -- all-future deck would show a zero and read as broken.
  -- Two cards carry note_id, which is what gives a deck its "From: <note>"
  -- chip (the dominant source note of the deck).
  -- --------------------------------------------------------------------
  INSERT INTO srs_cards (user_id, note_id, front, back, deck_name, interval_days, ease_factor, repetitions, next_review, last_reviewed, created_at, updated_at)
  SELECT
    demo_id, c.note_id, c.front, c.back, c.deck_name,
    c.interval_days, c.ease_factor, c.repetitions,
    now() + (c.due_in_days || ' days')::interval,
    CASE WHEN c.repetitions = 0 THEN NULL
         ELSE now() - ((c.interval_days) || ' days')::interval
    END,
    now() - interval '18 days',
    now() - interval '3 days'
  FROM (VALUES
    ('What problem does spaced repetition solve?', 'Forgetting. It schedules the review just before recall would fail, so each repetition buys the most retention.', 'Learning', 4,  2.5, 3, -2, '22222222-0000-4000-8000-000000000001'::uuid),
    ('What two numbers does SM-2 track per card?', 'An ease factor and an interval.',                                                                                  'Learning', 6,  2.6, 4, -1, '22222222-0000-4000-8000-000000000001'),
    ('What is the SM-2 ease floor?',               '1.3 - it never drops below that no matter how many lapses.',                                                       'Learning', 3,  2.3, 2,  0, '22222222-0000-4000-8000-000000000001'),
    ('What happens to repetitions on a lapse?',    'They reset to zero. The ease factor only drops slightly.',                                                         'Learning', 2,  2.2, 2,  0, '22222222-0000-4000-8000-000000000001'),
    ('Which set carries the progression signal?',  'The top set - the heaviest set of that exercise that day.',                                                        'Training', 5,  2.5, 3, -1, '22222222-0000-4000-8000-000000000002'),
    ('When should load go up?',                    'When the top set is clean. Two sessions at the same weight is information, not failure.',                          'Training', 7,  2.7, 4,  1, '22222222-0000-4000-8000-000000000002'),
    ('Is a lighter week a regression?',            'Not when it is planned. A deload after a heavy block is recovery.',                                                'Training', 9,  2.8, 5,  3, '22222222-0000-4000-8000-000000000002'),
    ('Why are offline WRITES the hard part?',      'They must survive a reload, replay in order, and never fire twice. Reads are just a cache.',                       'Engineering', 4, 2.5, 3, -3, NULL),
    ('What does TanStack dehydration keep?',       'mutationKey, state, scope and meta. Per-call callbacks are dropped.',                                              'Engineering', 2, 2.1, 1,  0, NULL),
    ('Where must post-write work live?',           'Inside the mutation variables, not in a call-site onSuccess.',                                                     'Engineering', 5, 2.4, 2,  2, NULL),
    ('What is the IST offset?',                    'UTC+5:30, fixed, no DST.',                                                                                        'Engineering', 12, 2.9, 6, 5, NULL),
    ('Why anchor a due date at noon?',             'So no timezone shift can move it across a day boundary.',                                                         'Engineering', 8, 2.6, 4,  4, NULL)
  ) AS c(front, back, deck_name, interval_days, ease_factor, repetitions, due_in_days, note_id);

  -- --------------------------------------------------------------------
  -- SEED: workouts
  --
  -- THIS IS THE PART WITH A HARD REQUIREMENT ON IT. The progressive-overload
  -- view only shows movement for an exercise logged on 2+ distinct IST days;
  -- below that threshold every row renders as a bare baseline under the line
  -- "No exercise logged twice yet", which is exactly the not-quite-working
  -- look the demo has to avoid.
  --
  -- The seed below is 11 sessions over 28 days, and 9 of its 11 exercises are
  -- logged on 3 or 4 separate days with the load climbing each time.
  --
  -- EVERY NAME IS AN EXACT lib/exercise-library.ts ENTRY. Body part is
  -- resolved by an exact exerciseKey match against that static library, so an
  -- invented name silently lands in "Other" instead of the group it trains -
  -- the live account already has that defect with "Crunch" and "Lateral Raise
  -- Drop Set".
  --
  -- Shoulders is trained ONCE, 21 days back, and Core not at all. That is
  -- deliberate: the lagging-body-part analysis needs something to find, and
  -- these two give it both shapes - a stale group with a real date, and a
  -- group reading "Nothing in the last 180 days".
  -- --------------------------------------------------------------------

  -- one session row per training day
  INSERT INTO workout_sessions (id, user_id, performed_on, status, started_at, ended_at, created_at)
  SELECT
    ('33333333-0000-4000-8000-0000000000' || lpad(s.n::text, 2, '0'))::uuid,
    demo_id,
    d0 - s.days_ago,
    'completed',
    ((d0 - s.days_ago) + time '18:30') AT TIME ZONE 'Asia/Kolkata',
    ((d0 - s.days_ago) + time '19:40') AT TIME ZONE 'Asia/Kolkata',
    ((d0 - s.days_ago) + time '18:30') AT TIME ZONE 'Asia/Kolkata'
  FROM (VALUES
    (1,28),(2,26),(3,24),(4,21),(5,19),(6,17),(7,14),(8,10),(9,7),(10,4),(11,2)
  ) AS s(n, days_ago);

  -- the exercises performed in each session
  DROP TABLE IF EXISTS demo_seed_sets;
  CREATE TEMP TABLE demo_seed_sets ON COMMIT DROP AS
  SELECT * FROM (VALUES
    -- days_ago, exercise, ex_position, set_index, weight_kg, reps
    (28, 'Flat Bench Press',        1, 1, 60.0, 10), (28, 'Flat Bench Press',        1, 2, 70.0, 8),  (28, 'Flat Bench Press',        1, 3, 75.0, 6),
    (28, 'Incline Dumbbell Press',  2, 1, 22.5, 12), (28, 'Incline Dumbbell Press',  2, 2, 25.0, 10),
    (28, 'Tricep Pushdown',         3, 1, 25.0, 15), (28, 'Tricep Pushdown',         3, 2, 30.0, 12),

    (26, 'Deadlift',                1, 1, 80.0, 8),  (26, 'Deadlift',                1, 2, 90.0, 6),  (26, 'Deadlift',                1, 3, 100.0, 4),
    (26, 'Lat Pulldown',            2, 1, 45.0, 12), (26, 'Lat Pulldown',            2, 2, 50.0, 10),
    (26, 'Barbell Curl',            3, 1, 20.0, 12), (26, 'Barbell Curl',            3, 2, 22.5, 10),

    (24, 'Squat',                   1, 1, 70.0, 10), (24, 'Squat',                   1, 2, 80.0, 8),  (24, 'Squat',                   1, 3, 85.0, 6),
    (24, 'Leg Press',               2, 1, 120.0, 12),(24, 'Leg Press',               2, 2, 140.0, 10),
    (24, 'Leg Curl',                3, 1, 35.0, 12), (24, 'Leg Curl',                3, 2, 40.0, 10),

    (21, 'Overhead Press',          1, 1, 35.0, 10), (21, 'Overhead Press',          1, 2, 40.0, 8),
    (21, 'Lateral Raise',           2, 1, 8.0, 15),  (21, 'Lateral Raise',           2, 2, 10.0, 12),

    (19, 'Flat Bench Press',        1, 1, 65.0, 10), (19, 'Flat Bench Press',        1, 2, 75.0, 8),  (19, 'Flat Bench Press',        1, 3, 80.0, 6),
    (19, 'Incline Dumbbell Press',  2, 1, 25.0, 12), (19, 'Incline Dumbbell Press',  2, 2, 27.5, 9),
    (19, 'Tricep Pushdown',         3, 1, 30.0, 15), (19, 'Tricep Pushdown',         3, 2, 32.5, 11),

    (17, 'Deadlift',                1, 1, 90.0, 8),  (17, 'Deadlift',                1, 2, 100.0, 6), (17, 'Deadlift',                1, 3, 105.0, 4),
    (17, 'Lat Pulldown',            2, 1, 50.0, 12), (17, 'Lat Pulldown',            2, 2, 55.0, 9),
    (17, 'Barbell Curl',            3, 1, 22.5, 12), (17, 'Barbell Curl',            3, 2, 25.0, 9),

    (14, 'Squat',                   1, 1, 80.0, 10), (14, 'Squat',                   1, 2, 85.0, 8),  (14, 'Squat',                   1, 3, 90.0, 6),
    (14, 'Leg Press',               2, 1, 140.0, 12),(14, 'Leg Press',               2, 2, 150.0, 10),
    (14, 'Leg Curl',                3, 1, 40.0, 12), (14, 'Leg Curl',                3, 2, 45.0, 9),

    (10, 'Flat Bench Press',        1, 1, 70.0, 10), (10, 'Flat Bench Press',        1, 2, 80.0, 8),  (10, 'Flat Bench Press',        1, 3, 85.0, 5),
    (10, 'Incline Dumbbell Press',  2, 1, 27.5, 11), (10, 'Incline Dumbbell Press',  2, 2, 30.0, 8),
    (10, 'Tricep Pushdown',         3, 1, 32.5, 14), (10, 'Tricep Pushdown',         3, 2, 35.0, 10),

    (7,  'Deadlift',                1, 1, 100.0, 8), (7,  'Deadlift',                1, 2, 110.0, 5), (7,  'Deadlift',                1, 3, 115.0, 3),
    (7,  'Lat Pulldown',            2, 1, 55.0, 11), (7,  'Lat Pulldown',            2, 2, 60.0, 8),
    (7,  'Barbell Curl',            3, 1, 25.0, 11), (7,  'Barbell Curl',            3, 2, 27.5, 8),

    (4,  'Squat',                   1, 1, 85.0, 10), (4,  'Squat',                   1, 2, 90.0, 8),  (4,  'Squat',                   1, 3, 95.0, 5),
    (4,  'Leg Press',               2, 1, 150.0, 12),(4,  'Leg Press',               2, 2, 160.0, 9),
    (4,  'Leg Curl',                3, 1, 45.0, 12), (4,  'Leg Curl',                3, 2, 50.0, 8),

    (2,  'Flat Bench Press',        1, 1, 75.0, 10), (2,  'Flat Bench Press',        1, 2, 85.0, 6),  (2,  'Flat Bench Press',        1, 3, 90.0, 3),
    (2,  'Incline Dumbbell Press',  2, 1, 30.0, 10), (2,  'Incline Dumbbell Press',  2, 2, 32.5, 7),
    (2,  'Tricep Pushdown',         3, 1, 35.0, 14), (2,  'Tricep Pushdown',         3, 2, 37.5, 9)
  ) AS v(days_ago, exercise, ex_position, set_index, weight_kg, reps);

  INSERT INTO session_exercises (id, user_id, session_id, display_name, exercise_key, position, created_at)
  SELECT
    gen_random_uuid(),
    demo_id,
    ws.id,
    g.exercise,
    -- exerciseKey(): trim, lowercase, collapse internal whitespace
    lower(regexp_replace(btrim(g.exercise), '\s+', ' ', 'g')),
    g.ex_position,
    ws.started_at
  FROM (
    SELECT DISTINCT days_ago, exercise, ex_position FROM demo_seed_sets
  ) AS g
  JOIN workout_sessions ws
    ON ws.user_id = demo_id AND ws.performed_on = d0 - g.days_ago;

  -- One capture_id per (session, exercise): a capture is one logging action,
  -- and logging an exercise is exactly that. Generated once per
  -- session_exercise so every set of that exercise shares it.
  WITH captures AS (
    SELECT se.id AS se_id, gen_random_uuid() AS capture_id
    FROM session_exercises se
    WHERE se.user_id = demo_id
  )
  INSERT INTO workout_sets (user_id, capture_id, raw_input, performed_at, exercise, weight_kg, reps, set_index, session_exercise_id, created_at)
  SELECT
    demo_id,
    c.capture_id,
    format('%s %skg x %s', s.exercise, trim(trailing '.' from trim(trailing '0' from s.weight_kg::text)), s.reps),
    ((d0 - s.days_ago) + time '18:30') AT TIME ZONE 'Asia/Kolkata'
      + ((s.ex_position - 1) * interval '14 minutes')
      + ((s.set_index - 1) * interval '3 minutes'),
    s.exercise,
    s.weight_kg,
    s.reps,
    s.set_index,
    se.id,
    ((d0 - s.days_ago) + time '18:30') AT TIME ZONE 'Asia/Kolkata'
  FROM demo_seed_sets s
  JOIN workout_sessions ws
    ON ws.user_id = demo_id AND ws.performed_on = d0 - s.days_ago
  JOIN session_exercises se
    ON se.user_id = demo_id AND se.session_id = ws.id AND se.display_name = s.exercise
  JOIN captures c ON c.se_id = se.id;

  GET DIAGNOSTICS n_sets = ROW_COUNT;

  DROP TABLE IF EXISTS demo_seed_sets;

  RETURN format(
    'demo account reset for IST %s: %s tasks, %s workout sets',
    d0, n_tasks, n_sets
  );
END;
$function$;

-- Nobody but the cron job (and a superuser running it by hand) should be able
-- to wipe the demo account. SECURITY DEFINER makes the default PUBLIC execute
-- grant dangerous, so it is revoked explicitly.
REVOKE ALL ON FUNCTION public.reset_demo_account() FROM public;
REVOKE ALL ON FUNCTION public.reset_demo_account() FROM anon;
REVOKE ALL ON FUNCTION public.reset_demo_account() FROM authenticated;


-- ----------------------------------------------------------------------------
-- 2. The cron job
--
-- 21:30 UTC = 03:00 IST. See the schedule note in the header - the database is
-- UTC, so `0 3 * * *` here would fire at 08:30 IST.
--
-- cron.schedule() upserts by job name, so re-running this is safe and is also
-- how you change the schedule later.
-- ----------------------------------------------------------------------------
SELECT cron.schedule(
  'prism-demo-reset',
  '30 21 * * *',
  $cron$ SELECT public.reset_demo_account(); $cron$
);


-- ----------------------------------------------------------------------------
-- 3. Verification - run these ONE AT A TIME
--
-- The Supabase SQL Editor only shows the result of the LAST statement in a
-- batch, so pasting the whole block silently discards every answer but the
-- final one.
-- ----------------------------------------------------------------------------

-- (a) the function exists
--   SELECT proname, prosecdef FROM pg_proc
--    WHERE proname = 'reset_demo_account';

-- (b) the job is registered, active, and on the right schedule
--   SELECT jobid, jobname, schedule, active, command
--     FROM cron.job WHERE jobname = 'prism-demo-reset';

-- (c) run it by hand once
--   SELECT public.reset_demo_account();

-- (d) what landed, per table
--   SELECT 'tasks' t, count(*) FROM tasks WHERE user_id = 'eac085cc-54df-4414-9c43-08a6ce84ecea'
--   UNION ALL SELECT 'notes', count(*) FROM notes WHERE user_id = 'eac085cc-54df-4414-9c43-08a6ce84ecea'
--   UNION ALL SELECT 'workout_sets', count(*) FROM workout_sets WHERE user_id = 'eac085cc-54df-4414-9c43-08a6ce84ecea'
--   ORDER BY 1;

-- (e) after the first scheduled run, the real outcome (not just "queued" -
--     this job returns its own status because it does not use net.http_post)
--   SELECT status, return_message, start_time
--     FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'prism-demo-reset')
--    ORDER BY start_time DESC LIMIT 5;
