-- Telegram bot, phase 1: at most one Telegram message per reminder.
--
-- Apply-once file for the Supabase SQL Editor — the exact text approved in
-- the PR's review and run there by Udit. supabase/schema.sql carries the same
-- shape for a from-scratch rebuild.
--
-- /api/push/due runs every minute and selects, sends, then marks — with
-- nothing stopping two overlapping runs sending the same reminder. For the
-- owner's Telegram reminders a run INSERTS a claim here first (unique on
-- reminder_id), records telegram_message_id the moment Telegram accepts the
-- message, and gives the claim back when nothing was delivered. A claim older
-- than 5 minutes may be taken over; one that already has a
-- telegram_message_id is marked delivered and never sent again.
-- See lib/telegram/reminder-claims.ts.
--
-- Re-runnable: IF NOT EXISTS, and policies are dropped before they are made.

CREATE TABLE IF NOT EXISTS public.reminder_send_claims (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  reminder_id uuid REFERENCES public.reminders(id) ON DELETE CASCADE NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  telegram_message_id bigint,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT reminder_send_claims_reminder_key UNIQUE (reminder_id)
);
CREATE INDEX IF NOT EXISTS reminder_send_claims_user_idx ON public.reminder_send_claims (user_id);
ALTER TABLE public.reminder_send_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reminder_send_claims_select_own ON public.reminder_send_claims;
DROP POLICY IF EXISTS reminder_send_claims_insert_own ON public.reminder_send_claims;
DROP POLICY IF EXISTS reminder_send_claims_update_own ON public.reminder_send_claims;
DROP POLICY IF EXISTS reminder_send_claims_delete_own ON public.reminder_send_claims;
CREATE POLICY reminder_send_claims_select_own ON public.reminder_send_claims FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY reminder_send_claims_insert_own ON public.reminder_send_claims FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY reminder_send_claims_update_own ON public.reminder_send_claims FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY reminder_send_claims_delete_own ON public.reminder_send_claims FOR DELETE USING (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_send_claims TO authenticated;
GRANT ALL ON public.reminder_send_claims TO service_role;
