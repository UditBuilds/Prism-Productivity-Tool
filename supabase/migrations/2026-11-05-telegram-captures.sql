-- Telegram bot, phase 1: pending captures.
--
-- Apply-once file for the Supabase SQL Editor — the exact text proposed in
-- the PR's review and run there by Udit. supabase/schema.sql carries the same
-- shape for a from-scratch rebuild.
--
-- One row per Telegram text message the bot read and found something in.
-- `items` holds what Save will write (lib/telegram/capture.ts), with the ids
-- of the rows it creates already chosen, so a double Save writes nothing new.
-- Nothing reaches tasks or reminders until Save. The buttons carry only this
-- row's id: Telegram limits button data to 64 bytes.
--
-- Re-runnable: IF NOT EXISTS, and policies are dropped before they are made.

CREATE TABLE IF NOT EXISTS public.telegram_captures (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  chat_id bigint NOT NULL,
  source_message_id bigint NOT NULL,
  reply_message_id bigint,
  raw_text text NOT NULL,
  items jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT telegram_captures_status_check
    CHECK (status IN ('pending', 'saved', 'cancelled')),
  CONSTRAINT telegram_captures_resolved_check
    CHECK ((status = 'pending') = (resolved_at IS NULL)),
  CONSTRAINT telegram_captures_raw_text_check
    CHECK (char_length(raw_text) BETWEEN 1 AND 4096),
  CONSTRAINT telegram_captures_items_check
    CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 10),
  -- A redelivered Telegram update is read once.
  CONSTRAINT telegram_captures_source_key UNIQUE (chat_id, source_message_id)
);

CREATE INDEX IF NOT EXISTS telegram_captures_user_idx
  ON public.telegram_captures (user_id);

ALTER TABLE public.telegram_captures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_captures_select_own ON public.telegram_captures;
DROP POLICY IF EXISTS telegram_captures_insert_own ON public.telegram_captures;
DROP POLICY IF EXISTS telegram_captures_update_own ON public.telegram_captures;
DROP POLICY IF EXISTS telegram_captures_delete_own ON public.telegram_captures;
CREATE POLICY telegram_captures_select_own ON public.telegram_captures
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY telegram_captures_insert_own ON public.telegram_captures
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY telegram_captures_update_own ON public.telegram_captures
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY telegram_captures_delete_own ON public.telegram_captures
  FOR DELETE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_captures TO authenticated;
GRANT ALL ON public.telegram_captures TO service_role;
