import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Service-role Supabase client. SERVER-ONLY — uses SUPABASE_SERVICE_ROLE_KEY,
 * which bypasses Row Level Security. Only use in trusted server contexts (e.g.
 * the cron-guarded push-due route that must read every user's reminders).
 * NEVER import this into a client component.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}
