-- Reminder delivery outcome: replace the "retry forever" hole in the boolean.
--
-- WHY: /api/push/due matched every due reminder with is_sent = false and only
-- ever set is_sent = true after a push actually went out. A user with zero rows
-- in push_subscriptions never enters the per-subscription send loop, so nothing
-- is delivered, nothing fails, and is_sent is never written. The row is
-- re-matched on every cron tick, forever. Measured 2026-09-10: one reminder
-- dated 2026-07-23 had been re-matched every minute for seven weeks with zero
-- rows in push_delivery_log.
--
-- The boolean cannot express the third outcome, because there are three:
--   pending           - due or not yet due, still owed a delivery attempt
--   delivered         - a notification actually went out
--   skipped_no_device - came due with no registered device to notify
--
-- skipped_no_device is deliberately NOT is_sent = true. Nothing was sent, and
-- is_sent is read as "was this delivered" by the Reminders list, the card badge
-- and the calendar feed. Marking it true would make all three lie.
--
-- APPLY-ONCE. Run in the Supabase SQL Editor. supabase/schema.sql carries the
-- same shape for a from-scratch rebuild, but is a reference dump and does not
-- alter an existing table.

-- 1. The column. NOT NULL + DEFAULT backfills every existing row to 'pending'.
ALTER TABLE "public"."reminders"
  ADD COLUMN IF NOT EXISTS "delivery_status" "text" NOT NULL DEFAULT 'pending';

-- 2. Constrain it to the three real outcomes. Guarded so the file is re-runnable
--    (ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conname" = 'reminders_delivery_status_check'
      AND "conrelid" = '"public"."reminders"'::"regclass"
  ) THEN
    ALTER TABLE "public"."reminders"
      ADD CONSTRAINT "reminders_delivery_status_check"
      CHECK ("delivery_status" IN ('pending', 'delivered', 'skipped_no_device'));
  END IF;
END
$$;

-- 3. Backfill history: rows already marked sent were genuinely delivered
--    (by the cron, or by the in-app NotificationChecker). Step 1 defaulted them
--    to 'pending'; this corrects them. Idempotent.
UPDATE "public"."reminders"
  SET "delivery_status" = 'delivered'
  WHERE "is_sent" = true AND "delivery_status" <> 'delivered';

-- 4. The cron's scan runs once a minute forever and now filters on both
--    columns. Partial index keeps it reading only the rows still owed work.
CREATE INDEX IF NOT EXISTS "reminders_pending_delivery_idx"
  ON "public"."reminders" ("remind_at")
  WHERE "is_sent" = false AND "delivery_status" = 'pending';

-- 5. push_delivery_log.event is CHECK-constrained to a fixed list, verified
--    against the live database on 2026-09-10:
--      auth_fail, invocation, attempt, prune, mark_sent
--
--    The new 'skip_no_device' row would be REJECTED by that constraint. This
--    step is not optional cleanup: logRow() in /api/push/due wraps its insert
--    in try/catch and only console.errors, so without this the skip would
--    resolve the reminder correctly and then leave no trace whatsoever in the
--    delivery log — the one table that exists to explain what the cron did.
--    Silent, and invisible in the API response.
ALTER TABLE "public"."push_delivery_log"
  DROP CONSTRAINT IF EXISTS "push_delivery_log_event_check";

ALTER TABLE "public"."push_delivery_log"
  ADD CONSTRAINT "push_delivery_log_event_check"
  CHECK ("event" = ANY (ARRAY[
    'auth_fail'::"text",
    'invocation'::"text",
    'attempt'::"text",
    'prune'::"text",
    'mark_sent'::"text",
    'skip_no_device'::"text"
  ]));
