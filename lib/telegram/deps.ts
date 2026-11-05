import type { SupabaseClient } from "@supabase/supabase-js";

import type { PlanEditOutcome } from "@/lib/daily-plan/edit";
import type { DailyPlanView } from "@/lib/daily-plan/view";
import type {
  CaptureAiItem,
  CapturePromptAnchor,
  CapturePromptTask,
} from "@/lib/telegram/capture-schema";
import type { TelegramApi } from "@/lib/telegram/client";
import type { TelegramEnv } from "@/lib/telegram/env";
import type { Database } from "@/types/database";

/**
 * Everything the bot touches outside its own code, passed in rather than
 * imported. The webhook route wires the real ones (service-role client, the
 * Bot API, Groq, the shared plan-edit code); the unit tests wire fakes, so the
 * auth gates, the routing and Save's idempotency are proven without a network.
 *
 * Later phases (evening check-in, progress, voice) add their own handlers on
 * top of this same shape rather than a new route.
 */
export interface BotDeps {
  env: TelegramEnv;
  /** SERVICE ROLE. Every query must filter on env.ownerUserId explicitly. */
  db: SupabaseClient<Database>;
  telegram: TelegramApi;
  plan: {
    /** lib/daily-plan/edit.ts — the dashboard card's own code path. */
    applyEdit(
      db: SupabaseClient<Database>,
      userId: string,
      body: Record<string, unknown>,
      now: string
    ): Promise<PlanEditOutcome>;
    /** lib/daily-plan/server.ts readDailyPlanView. */
    readView(
      db: SupabaseClient<Database>,
      userId: string,
      planId: string
    ): Promise<DailyPlanView | null>;
  };
  ai: {
    /** One request against the shared per-user AI budget (lib/ai/rateLimit.ts). */
    allow(userId: string): boolean;
    /** lib/ai/client.ts parseTelegramCapture. */
    parseCapture(
      text: string,
      ctx: {
        today: string;
        weekday: string;
        clock: string;
        tasks: CapturePromptTask[];
        anchors: CapturePromptAnchor[];
      }
    ): Promise<CaptureAiItem[]>;
  };
  now(): number;
  newId(): string;
}
