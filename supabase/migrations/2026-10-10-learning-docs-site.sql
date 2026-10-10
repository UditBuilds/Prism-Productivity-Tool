-- Learning: the topic's official documentation site (Udit, 2026-10-10).
--
-- The planner picks it once per topic (lib/learning/plan.ts, e.g.
-- "docs.python.org"); every lesson searches inside it first and uses the open
-- web only when it finds nothing, and a source on any other host is shown as
-- "tutorial site, not official docs". NULL when the topic has no official
-- documentation. A bare host name only: it goes into a search "site:" operator.
--
-- APPLY-ONCE in the Supabase SQL Editor. Re-runnable: when the column already
-- exists the whole clause is skipped.
alter table public.learning_topics
  add column if not exists docs_site text
    constraint learning_topics_docs_site_check
    check (
      char_length(docs_site) <= 253
      and docs_site ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    );
