// Hand-authored to match the Supabase schema (see supabase/schema.sql).
// Keep in sync with the database. Used to type all Supabase clients.
// `Relationships: []` is required for supabase-js to recognize each table type.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";
export type PlanStatus = "active" | "completed" | "archived";
export type MoodValue = "great" | "good" | "neutral" | "tired" | "stressed";
export type YoutubeNoteJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

/**
 * Mirrors workout_sessions_status_check in the database.
 *
 * There is deliberately no "abandoned" state. A session nobody finished stays
 * `active` forever and History shows it as such: the app cannot know whether a
 * day was abandoned or simply never closed, and nothing downstream depends on
 * the distinction (analysis reads workout_sets, not sessions).
 */
export type WorkoutSessionStatus = "active" | "completed";

/**
 * Mirrors reminders_delivery_status_check in the database.
 *
 * The boolean `is_sent` answers "was this delivered". It cannot answer "was
 * this ever going to be", which is why a third state exists: a reminder that
 * comes due while the user has no rows in push_subscriptions has nothing to be
 * delivered to. `skipped_no_device` is that outcome, and it is TERMINAL for the
 * cron — /api/push/due stops re-matching the row.
 *
 * It is deliberately not `is_sent = true`. Nothing was sent. The Reminders
 * list, the card badge and the calendar feed all read `is_sent` as "delivered",
 * so flipping it to close the retry loop would make three surfaces lie about
 * what happened.
 */
export type ReminderDeliveryStatus =
  | "pending"
  | "delivered"
  | "skipped_no_device";

export interface Database {
  public: {
    Tables: {
      /**
       * Invite codes redeemed by POST /api/signup. RLS is ON with NO policies,
       * so neither `anon` nor `authenticated` can read or write a row — the
       * service-role client in that route is the only thing that touches this
       * table. It is typed here (rather than reached through an `as any`
       * escape hatch like push_health) because the redemption is an
       * update-if-unused whose filters are worth type-checking.
       */
      invite_codes: {
        Row: {
          id: string;
          code: string;
          used: boolean;
          used_by: string | null;
          created_at: string;
          used_at: string | null;
        };
        Insert: {
          id?: string;
          code: string;
          used?: boolean;
          used_by?: string | null;
          created_at?: string;
          used_at?: string | null;
        };
        Update: {
          id?: string;
          code?: string;
          used?: boolean;
          used_by?: string | null;
          created_at?: string;
          used_at?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          timezone: string;
          created_at: string;
          updated_at: string;
          streak_freezes: number;
          freeze_week_start: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
          streak_freezes?: number;
          freeze_week_start?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
          streak_freezes?: number;
          freeze_week_start?: string;
        };
        Relationships: [];
      };
      plans: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string | null;
          status: PlanStatus;
          target_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          description?: string | null;
          status?: PlanStatus;
          target_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          description?: string | null;
          status?: PlanStatus;
          target_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string | null;
          status: TaskStatus;
          priority: TaskPriority;
          due_date: string | null;
          plan_id: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
          // Nullable FK to recurring_tasks. Optional here so optimistic Task
          // literals (e.g. hooks/useTasks.ts) need not set it.
          recurring_task_id?: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          description?: string | null;
          status?: TaskStatus;
          priority?: TaskPriority;
          due_date?: string | null;
          plan_id?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
          recurring_task_id?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          description?: string | null;
          status?: TaskStatus;
          priority?: TaskPriority;
          due_date?: string | null;
          plan_id?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
          recurring_task_id?: string | null;
        };
        Relationships: [];
      };
      recurring_tasks: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          priority: TaskPriority;
          is_active: boolean;
          created_at: string;
          // IST weekday numbers (0=Sun … 6=Sat) the template spawns on.
          days_of_week: number[];
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          priority?: TaskPriority;
          is_active?: boolean;
          created_at?: string;
          days_of_week?: number[];
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          priority?: TaskPriority;
          is_active?: boolean;
          created_at?: string;
          days_of_week?: number[];
        };
        Relationships: [];
      };
      notes: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          content: string;
          tags: string[];
          // null = pre-feature note (behaves as a plain Spark, never rewritten)
          kind: "spark" | "revisit" | null;
          // AI-generated key points, shown by the dashboard's Revisit widget
          // in place of a long note's full body. null = not generated (short
          // note, generation failed, or created by a path that doesn't
          // summarize) — the widget falls back to a truncated excerpt and
          // never blocks on a live call. See lib/notes/revisit-summary.ts.
          summary: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          content?: string;
          tags?: string[];
          kind?: "spark" | "revisit" | null;
          summary?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          content?: string;
          tags?: string[];
          kind?: "spark" | "revisit" | null;
          summary?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reminders: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          body: string | null;
          remind_at: string;
          is_sent: boolean;
          delivery_status: ReminderDeliveryStatus;
          task_id: string | null;
          note_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          body?: string | null;
          remind_at: string;
          is_sent?: boolean;
          delivery_status?: ReminderDeliveryStatus;
          task_id?: string | null;
          note_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          body?: string | null;
          remind_at?: string;
          is_sent?: boolean;
          delivery_status?: ReminderDeliveryStatus;
          task_id?: string | null;
          note_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      srs_cards: {
        Row: {
          id: string;
          user_id: string;
          note_id: string | null;
          front: string;
          back: string;
          deck_name: string;
          interval_days: number;
          ease_factor: number;
          repetitions: number;
          next_review: string;
          last_reviewed: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          note_id?: string | null;
          front: string;
          back: string;
          deck_name?: string;
          interval_days?: number;
          ease_factor?: number;
          repetitions?: number;
          next_review?: string;
          last_reviewed?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          note_id?: string | null;
          front?: string;
          back?: string;
          deck_name?: string;
          interval_days?: number;
          ease_factor?: number;
          repetitions?: number;
          next_review?: string;
          last_reviewed?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      srs_reviews: {
        Row: {
          id: string;
          card_id: string;
          user_id: string;
          rating: number;
          reviewed_at: string;
        };
        Insert: {
          id?: string;
          card_id: string;
          user_id: string;
          rating: number;
          reviewed_at?: string;
        };
        Update: {
          id?: string;
          card_id?: string;
          user_id?: string;
          rating?: number;
          reviewed_at?: string;
        };
        Relationships: [];
      };
      focus_sessions: {
        Row: {
          id: string;
          user_id: string;
          category: string;
          duration_minutes: number;
          completed: boolean;
          started_at: string;
          ended_at: string | null;
          created_at: string;
          elapsed_seconds: number | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          category?: string;
          duration_minutes: number;
          completed?: boolean;
          started_at?: string;
          ended_at?: string | null;
          created_at?: string;
          elapsed_seconds?: number | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          category?: string;
          duration_minutes?: number;
          completed?: boolean;
          started_at?: string;
          ended_at?: string | null;
          created_at?: string;
          elapsed_seconds?: number | null;
        };
        Relationships: [];
      };
      focus_categories: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          color: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          color: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          color?: string;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      countdowns: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          target_date: string;
          emoji: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          target_date: string;
          emoji?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          target_date?: string;
          emoji?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      mood_logs: {
        Row: {
          id: string;
          user_id: string;
          mood: MoodValue;
          note: string | null;
          logged_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          mood: MoodValue;
          note?: string | null;
          logged_date: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          mood?: MoodValue;
          note?: string | null;
          logged_date?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // One row per SET. Rows logged from the same capture share a capture_id
      // and carry the same raw_input, so the original shorthand survives
      // independently of how well it parsed. Every parsed field is nullable by
      // design — a row can exist with raw_input alone when the AI parse fails
      // or finds nothing, and then be corrected by hand.
      workout_sets: {
        Row: {
          id: string;
          user_id: string;
          capture_id: string;
          raw_input: string;
          performed_at: string;
          exercise: string | null;
          weight_kg: number | null;
          reps: number | null;
          set_index: number | null;
          created_at: string;
          // Where this set sits inside its day's session. Nullable for two
          // distinct reasons: rows written before durable sessions existed
          // (until the backfill runs), and rows whose parse found no exercise
          // name — those belong to the day but name no exercise, so there is
          // no session_exercise for them to point at.
          //
          // The FK is ON DELETE SET NULL: reorganising a session must never
          // destroy the sets under it.
          session_exercise_id: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          capture_id: string;
          raw_input: string;
          performed_at?: string;
          exercise?: string | null;
          weight_kg?: number | null;
          reps?: number | null;
          set_index?: number | null;
          created_at?: string;
          session_exercise_id?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          capture_id?: string;
          raw_input?: string;
          performed_at?: string;
          exercise?: string | null;
          weight_kg?: number | null;
          reps?: number | null;
          set_index?: number | null;
          created_at?: string;
          session_exercise_id?: string | null;
        };
        Relationships: [];
      };
      // One row per training DAY, not per capture. A day's sets arrive in as
      // many captures as the user felt like making (the real table has a
      // 3-capture day and an 8-capture day, because sets get logged as they
      // happen) — the session is what those captures add up to.
      //
      // `performed_on` is the IST CIVIL day, and a UNIQUE index on
      // (user_id, performed_on) is what lets POST /api/workouts resolve-or-
      // create it atomically instead of racing a select-then-insert.
      workout_sessions: {
        Row: {
          id: string;
          user_id: string;
          /** IST civil day, "YYYY-MM-DD". */
          performed_on: string;
          status: WorkoutSessionStatus;
          template_id: string | null;
          notes: string | null;
          started_at: string | null;
          ended_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          performed_on: string;
          status?: WorkoutSessionStatus;
          template_id?: string | null;
          notes?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          performed_on?: string;
          status?: WorkoutSessionStatus;
          template_id?: string | null;
          notes?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // One row per exercise within a session. `exercise_key` is
      // exerciseKey(display_name) — the same case- and whitespace-insensitive
      // identity groupSetsByExercise uses — and carries a UNIQUE index with
      // session_id, so an exercise returned to later in the day folds into the
      // row it already has rather than opening a second one.
      session_exercises: {
        Row: {
          id: string;
          user_id: string;
          session_id: string;
          display_name: string;
          exercise_key: string | null;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          session_id: string;
          display_name: string;
          exercise_key?: string | null;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          session_id?: string;
          display_name?: string;
          exercise_key?: string | null;
          position?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      workout_templates: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      template_exercises: {
        Row: {
          id: string;
          user_id: string;
          template_id: string;
          display_name: string;
          exercise_key: string | null;
          position: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          template_id: string;
          display_name: string;
          exercise_key?: string | null;
          position?: number;
        };
        Update: {
          id?: string;
          user_id?: string;
          template_id?: string;
          display_name?: string;
          exercise_key?: string | null;
          position?: number;
        };
        Relationships: [];
      };
      // A template prescribes TARGETS per set rather than listing exercises: a
      // bare list gives the logging UI nothing to show as a target, and barely
      // improves on the repeat-session chips that already exist.
      template_sets: {
        Row: {
          id: string;
          user_id: string;
          template_exercise_id: string;
          set_number: number;
          target_reps: number | null;
          target_weight_kg: number | null;
          target_note: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          template_exercise_id: string;
          set_number: number;
          target_reps?: number | null;
          target_weight_kg?: number | null;
          target_note?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          template_exercise_id?: string;
          set_number?: number;
          target_reps?: number | null;
          target_weight_kg?: number | null;
          target_note?: string | null;
        };
        Relationships: [];
      };
      streak_freeze_logs: {
        Row: {
          id: string;
          user_id: string;
          frozen_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          frozen_date: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          frozen_date?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      // One row per YouTube -> note generation job. The transcript itself is
      // NOT stored: /api/youtube/notes/continue re-derives the chunk list from
      // the video each time it needs one (in-memory cached per warm instance),
      // so this row only has to carry progress and the markdown assembled so
      // far. completed_chunks + chunks_failed is the index of the next
      // unprocessed chunk, which is what makes resume-after-reload exact.
      youtube_note_jobs: {
        Row: {
          id: string;
          user_id: string;
          video_id: string;
          video_title: string | null;
          video_url: string;
          total_chunks: number;
          completed_chunks: number;
          chunks_failed: number;
          partial_content: string;
          status: YoutubeNoteJobStatus;
          error_message: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          video_id: string;
          video_title?: string | null;
          video_url: string;
          total_chunks: number;
          completed_chunks?: number;
          chunks_failed?: number;
          partial_content?: string;
          status?: YoutubeNoteJobStatus;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          video_id?: string;
          video_title?: string | null;
          video_url?: string;
          total_chunks?: number;
          completed_chunks?: number;
          chunks_failed?: number;
          partial_content?: string;
          status?: YoutubeNoteJobStatus;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// Convenience row aliases
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export interface StreakFreezeLog {
  id: string;
  user_id: string;
  frozen_date: string; // DATE as ISO string (YYYY-MM-DD)
  created_at: string;
}
export type Plan = Database["public"]["Tables"]["plans"]["Row"];
export type Task = Database["public"]["Tables"]["tasks"]["Row"];
export type RecurringTask =
  Database["public"]["Tables"]["recurring_tasks"]["Row"];
export type Note = Database["public"]["Tables"]["notes"]["Row"];
export type Reminder = Database["public"]["Tables"]["reminders"]["Row"];
export type SrsCard = Database["public"]["Tables"]["srs_cards"]["Row"];
export type SrsReview = Database["public"]["Tables"]["srs_reviews"]["Row"];
export type PushSubscriptionRow =
  Database["public"]["Tables"]["push_subscriptions"]["Row"];
export type FocusSession =
  Database["public"]["Tables"]["focus_sessions"]["Row"];
export type FocusCategory =
  Database["public"]["Tables"]["focus_categories"]["Row"];
export type Countdown = Database["public"]["Tables"]["countdowns"]["Row"];
export type MoodLog = Database["public"]["Tables"]["mood_logs"]["Row"];
export type WorkoutSet = Database["public"]["Tables"]["workout_sets"]["Row"];
export type WorkoutSession =
  Database["public"]["Tables"]["workout_sessions"]["Row"];
export type SessionExercise =
  Database["public"]["Tables"]["session_exercises"]["Row"];
export type WorkoutTemplate =
  Database["public"]["Tables"]["workout_templates"]["Row"];
export type TemplateExercise =
  Database["public"]["Tables"]["template_exercises"]["Row"];
export type TemplateSet =
  Database["public"]["Tables"]["template_sets"]["Row"];
export type YoutubeNoteJob =
  Database["public"]["Tables"]["youtube_note_jobs"]["Row"];
