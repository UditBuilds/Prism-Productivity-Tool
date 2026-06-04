import { useQuery } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/database";

export interface CurrentUser {
  id: string;
  email: string;
  profile: Profile | null;
}

/**
 * Current authenticated user + profile, for client components.
 * Server components should read the session directly via the server client.
 */
export function useUser() {
  return useQuery<CurrentUser | null>({
    queryKey: ["user"],
    queryFn: async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      return {
        id: user.id,
        email: user.email ?? "",
        profile: (profile as Profile | null) ?? null,
      };
    },
  });
}
