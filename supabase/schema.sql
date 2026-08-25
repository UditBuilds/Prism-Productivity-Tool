


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', 'User')
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


-- Binds handle_new_user() to auth.users so a profiles row is created on signup.
-- This trigger exists in the live database but was missing here, so schema.sql
-- did not reproduce a working deployment. NOTE: pg_dump of the public schema
-- will NOT re-emit a trigger owned by auth.users -- re-add this by hand if this
-- file is ever regenerated from a dump.
CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company" "text" NOT NULL,
    "role" "text" NOT NULL,
    "date_applied" "date" DEFAULT CURRENT_DATE NOT NULL,
    "reference_url" "text",
    "status" "text" DEFAULT 'applied'::"text" NOT NULL,
    "last_contact_date" "date",
    "last_nudge_date" "date",
    "last_nudge_message_id" bigint,
    "follow_up_count" integer DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "applications_status_check" CHECK (("status" = ANY (ARRAY['applied'::"text", 'interviewing'::"text", 'rejected'::"text", 'ghosted'::"text", 'offered'::"text", 'accepted'::"text", 'withdrawn'::"text"])))
);


ALTER TABLE "public"."applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."countdowns" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "target_date" "date" NOT NULL,
    "emoji" "text" DEFAULT '🎯'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."countdowns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."focus_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#3b82f6'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."focus_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."focus_sessions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "category" "text" DEFAULT 'Study'::"text" NOT NULL,
    "duration_minutes" integer NOT NULL,
    "completed" boolean DEFAULT false,
    "started_at" timestamp with time zone DEFAULT "now"(),
    "ended_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "subcategory" "text",
    "elapsed_seconds" integer
);


ALTER TABLE "public"."focus_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_listings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "company" "text" NOT NULL,
    "source" "text" NOT NULL,
    "source_url" "text" NOT NULL,
    "location" "text",
    "description" "text",
    "relevance_score" integer,
    "relevance_reason" "text",
    "discovered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_to_user" boolean DEFAULT false NOT NULL,
    CONSTRAINT "job_listings_relevance_score_check" CHECK ((("relevance_score" >= 1) AND ("relevance_score" <= 10))),
    CONSTRAINT "job_listings_source_check" CHECK (("source" = ANY (ARRAY['yc'::"text", 'wellfound'::"text", 'remoteok'::"text", 'weworkremotely'::"text"])))
);


ALTER TABLE "public"."job_listings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mood_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "mood" "text" NOT NULL,
    "note" "text",
    "logged_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "mood_logs_mood_check" CHECK (("mood" = ANY (ARRAY['great'::"text", 'good'::"text", 'neutral'::"text", 'tired'::"text", 'stressed'::"text"])))
);


ALTER TABLE "public"."mood_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" DEFAULT ''::"text",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "kind" "text",
    CONSTRAINT "notes_kind_check" CHECK (("kind" = ANY (ARRAY['spark'::"text", 'revisit'::"text"])))
);


ALTER TABLE "public"."notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plans" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'active'::"text",
    "target_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "plans_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text",
    "avatar_url" "text",
    "timezone" "text" DEFAULT 'Asia/Kolkata'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "streak_freezes" integer DEFAULT 3 NOT NULL,
    "freeze_week_start" "date" DEFAULT CURRENT_DATE
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_delivery_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "invocation_id" "uuid" NOT NULL,
    "event" "text" NOT NULL,
    "reminder_id" "uuid",
    "subscription_endpoint" "text",
    "reminders_matched" integer,
    "status_code" integer,
    "ok" boolean,
    "error_text" "text",
    CONSTRAINT "push_delivery_log_event_check" CHECK (("event" = ANY (ARRAY['auth_fail'::"text", 'invocation'::"text", 'attempt'::"text", 'prune'::"text", 'mark_sent'::"text"])))
);


ALTER TABLE "public"."push_delivery_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_health" (
    "id" boolean DEFAULT true NOT NULL,
    "last_invocation_at" timestamp with time zone,
    "last_delivery_at" timestamp with time zone,
    CONSTRAINT "push_health_id_check" CHECK ("id")
);


ALTER TABLE "public"."push_health" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recurring_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "days_of_week" integer[] DEFAULT '{0,1,2,3,4,5,6}'::integer[] NOT NULL
);


ALTER TABLE "public"."recurring_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminders" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "remind_at" timestamp with time zone NOT NULL,
    "is_sent" boolean DEFAULT false,
    "task_id" "uuid",
    "note_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."srs_cards" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "note_id" "uuid",
    "front" "text" NOT NULL,
    "back" "text" NOT NULL,
    "deck_name" "text" DEFAULT 'Default'::"text",
    "interval_days" integer DEFAULT 1,
    "ease_factor" double precision DEFAULT 2.5,
    "repetitions" integer DEFAULT 0,
    "next_review" timestamp with time zone DEFAULT "now"(),
    "last_reviewed" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."srs_cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."srs_reviews" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "card_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "rating" integer NOT NULL,
    "reviewed_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "srs_reviews_rating_check" CHECK ((("rating" >= 0) AND ("rating" <= 5)))
);


ALTER TABLE "public"."srs_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."streak_freeze_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "frozen_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."streak_freeze_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'todo'::"text",
    "priority" "text" DEFAULT 'medium'::"text",
    "due_date" timestamp with time zone,
    "plan_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "recurring_task_id" "uuid",
    CONSTRAINT "tasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "tasks_status_check" CHECK (("status" = ANY (ARRAY['todo'::"text", 'in_progress'::"text", 'done'::"text"])))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_sets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "capture_id" "uuid" NOT NULL,
    "raw_input" "text" NOT NULL,
    "performed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "exercise" "text",
    "weight_kg" numeric,
    "reps" integer,
    "set_index" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."workout_sets" OWNER TO "postgres";


ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."countdowns"
    ADD CONSTRAINT "countdowns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."focus_categories"
    ADD CONSTRAINT "focus_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."focus_categories"
    ADD CONSTRAINT "focus_categories_user_id_name_key" UNIQUE ("user_id", "name");



ALTER TABLE ONLY "public"."focus_sessions"
    ADD CONSTRAINT "focus_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_listings"
    ADD CONSTRAINT "job_listings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_listings"
    ADD CONSTRAINT "job_listings_source_url_key" UNIQUE ("source_url");



ALTER TABLE ONLY "public"."mood_logs"
    ADD CONSTRAINT "mood_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mood_logs"
    ADD CONSTRAINT "mood_logs_user_id_logged_date_key" UNIQUE ("user_id", "logged_date");



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plans"
    ADD CONSTRAINT "plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_delivery_log"
    ADD CONSTRAINT "push_delivery_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_health"
    ADD CONSTRAINT "push_health_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_endpoint_key" UNIQUE ("user_id", "endpoint");



ALTER TABLE ONLY "public"."recurring_tasks"
    ADD CONSTRAINT "recurring_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."srs_cards"
    ADD CONSTRAINT "srs_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."srs_reviews"
    ADD CONSTRAINT "srs_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."streak_freeze_logs"
    ADD CONSTRAINT "streak_freeze_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."streak_freeze_logs"
    ADD CONSTRAINT "streak_freeze_logs_user_id_frozen_date_key" UNIQUE ("user_id", "frozen_date");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_sets"
    ADD CONSTRAINT "workout_sets_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_listings_undiscovered" ON "public"."job_listings" USING "btree" ("discovered_at" DESC) WHERE ("sent_to_user" = false);



CREATE INDEX "idx_nudge_candidates" ON "public"."applications" USING "btree" ("status", "date_applied") WHERE ("status" = 'applied'::"text");



CREATE INDEX "idx_push_delivery_log_created_at" ON "public"."push_delivery_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_push_delivery_log_invocation" ON "public"."push_delivery_log" USING "btree" ("invocation_id");



CREATE UNIQUE INDEX "idx_recurring_tasks_active_title" ON "public"."recurring_tasks" USING "btree" ("user_id", "lower"(TRIM(BOTH FROM "title"))) WHERE "is_active";



CREATE UNIQUE INDEX "idx_tasks_recurring_unique_per_day" ON "public"."tasks" USING "btree" ("recurring_task_id", "due_date") WHERE ("recurring_task_id" IS NOT NULL);



CREATE INDEX "workout_sets_user_performed_idx" ON "public"."workout_sets" USING "btree" ("user_id", "performed_at" DESC);



CREATE OR REPLACE TRIGGER "t_notes" BEFORE UPDATE ON "public"."notes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "t_plans" BEFORE UPDATE ON "public"."plans" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "t_profiles" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "t_srs_cards" BEFORE UPDATE ON "public"."srs_cards" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "t_tasks" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



ALTER TABLE ONLY "public"."countdowns"
    ADD CONSTRAINT "countdowns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."focus_categories"
    ADD CONSTRAINT "focus_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."focus_sessions"
    ADD CONSTRAINT "focus_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mood_logs"
    ADD CONSTRAINT "mood_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plans"
    ADD CONSTRAINT "plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_tasks"
    ADD CONSTRAINT "recurring_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."srs_cards"
    ADD CONSTRAINT "srs_cards_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."srs_cards"
    ADD CONSTRAINT "srs_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."srs_reviews"
    ADD CONSTRAINT "srs_reviews_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."srs_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."srs_reviews"
    ADD CONSTRAINT "srs_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."streak_freeze_logs"
    ADD CONSTRAINT "streak_freeze_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_recurring_task_id_fkey" FOREIGN KEY ("recurring_task_id") REFERENCES "public"."recurring_tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_sets"
    ADD CONSTRAINT "workout_sets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Users can delete own focus categories" ON "public"."focus_categories" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own recurring tasks" ON "public"."recurring_tasks" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own focus categories" ON "public"."focus_categories" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own freeze logs" ON "public"."streak_freeze_logs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own recurring tasks" ON "public"."recurring_tasks" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can select own focus categories" ON "public"."focus_categories" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can select own freeze logs" ON "public"."streak_freeze_logs" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can select own recurring tasks" ON "public"."recurring_tasks" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own focus categories" ON "public"."focus_categories" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own recurring tasks" ON "public"."recurring_tasks" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."countdowns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."focus_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."focus_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."job_listings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mood_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own_countdowns" ON "public"."countdowns" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own_focus_sessions" ON "public"."focus_sessions" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own_mood_logs" ON "public"."mood_logs" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own_notes" ON "public"."notes" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own_plans" ON "public"."plans" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own_profiles" ON "public"."profiles" USING (("auth"."uid"() = "id"));



CREATE POLICY "own_push_subscriptions" ON "public"."push_subscriptions" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own_reminders" ON "public"."reminders" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own_srs_cards" ON "public"."srs_cards" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own_srs_reviews" ON "public"."srs_reviews" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own_tasks" ON "public"."tasks" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_delivery_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_health" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recurring_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."srs_cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."srs_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."streak_freeze_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workout_sets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workout_sets_delete_own" ON "public"."workout_sets" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "workout_sets_insert_own" ON "public"."workout_sets" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "workout_sets_select_own" ON "public"."workout_sets" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "workout_sets_update_own" ON "public"."workout_sets" FOR UPDATE USING (("auth"."uid"() = "user_id"));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."applications" TO "anon";
GRANT ALL ON TABLE "public"."applications" TO "authenticated";
GRANT ALL ON TABLE "public"."applications" TO "service_role";



GRANT ALL ON TABLE "public"."countdowns" TO "anon";
GRANT ALL ON TABLE "public"."countdowns" TO "authenticated";
GRANT ALL ON TABLE "public"."countdowns" TO "service_role";



GRANT ALL ON TABLE "public"."focus_categories" TO "anon";
GRANT ALL ON TABLE "public"."focus_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."focus_categories" TO "service_role";



GRANT ALL ON TABLE "public"."focus_sessions" TO "anon";
GRANT ALL ON TABLE "public"."focus_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."focus_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."job_listings" TO "anon";
GRANT ALL ON TABLE "public"."job_listings" TO "authenticated";
GRANT ALL ON TABLE "public"."job_listings" TO "service_role";



GRANT ALL ON TABLE "public"."mood_logs" TO "anon";
GRANT ALL ON TABLE "public"."mood_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."mood_logs" TO "service_role";



GRANT ALL ON TABLE "public"."notes" TO "anon";
GRANT ALL ON TABLE "public"."notes" TO "authenticated";
GRANT ALL ON TABLE "public"."notes" TO "service_role";



GRANT ALL ON TABLE "public"."plans" TO "anon";
GRANT ALL ON TABLE "public"."plans" TO "authenticated";
GRANT ALL ON TABLE "public"."plans" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."push_delivery_log" TO "anon";
GRANT ALL ON TABLE "public"."push_delivery_log" TO "authenticated";
GRANT ALL ON TABLE "public"."push_delivery_log" TO "service_role";



GRANT ALL ON TABLE "public"."push_health" TO "anon";
GRANT ALL ON TABLE "public"."push_health" TO "authenticated";
GRANT ALL ON TABLE "public"."push_health" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."recurring_tasks" TO "anon";
GRANT ALL ON TABLE "public"."recurring_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."recurring_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."reminders" TO "anon";
GRANT ALL ON TABLE "public"."reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."reminders" TO "service_role";



GRANT ALL ON TABLE "public"."srs_cards" TO "anon";
GRANT ALL ON TABLE "public"."srs_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."srs_cards" TO "service_role";



GRANT ALL ON TABLE "public"."srs_reviews" TO "anon";
GRANT ALL ON TABLE "public"."srs_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."srs_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."streak_freeze_logs" TO "anon";
GRANT ALL ON TABLE "public"."streak_freeze_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."streak_freeze_logs" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON TABLE "public"."workout_sets" TO "anon";
GRANT ALL ON TABLE "public"."workout_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_sets" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







