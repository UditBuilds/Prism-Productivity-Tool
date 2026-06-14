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

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          timezone: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          content?: string;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          content?: string;
          tags?: string[];
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// Convenience row aliases
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Plan = Database["public"]["Tables"]["plans"]["Row"];
export type Task = Database["public"]["Tables"]["tasks"]["Row"];
export type Note = Database["public"]["Tables"]["notes"]["Row"];
export type Reminder = Database["public"]["Tables"]["reminders"]["Row"];
export type SrsCard = Database["public"]["Tables"]["srs_cards"]["Row"];
export type SrsReview = Database["public"]["Tables"]["srs_reviews"]["Row"];
export type PushSubscriptionRow =
  Database["public"]["Tables"]["push_subscriptions"]["Row"];
export type FocusSession =
  Database["public"]["Tables"]["focus_sessions"]["Row"];
export type Countdown = Database["public"]["Tables"]["countdowns"]["Row"];
export type MoodLog = Database["public"]["Tables"]["mood_logs"]["Row"];
