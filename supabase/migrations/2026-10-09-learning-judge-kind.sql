-- Learning: allow the meaning check's calls in the AI-call ledger.
--
-- The judge (lib/learning/judge.ts, gpt-oss-20b) reads each lesson sentence
-- next to its source passage. Every call is logged and counted in the daily
-- cap, under its own kind rather than mislabelled as a 'write'.
-- APPLY-ONCE in the Supabase SQL Editor. Re-runnable.
alter table public.learning_ai_calls drop constraint if exists learning_ai_calls_kind_check, add constraint learning_ai_calls_kind_check check (kind in ('plan', 'search', 'write', 'judge'));
