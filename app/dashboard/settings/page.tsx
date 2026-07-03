"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Loader2, Settings } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { getInitials } from "@/lib/utils";
import { useUser } from "@/hooks/useUser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/PageHeader";
import { NotificationsCard } from "@/components/settings/NotificationsCard";
import { ThemeCard } from "@/components/settings/ThemeCard";

export default function SettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: currentUser, isLoading } = useUser();

  const [displayName, setDisplayName] = useState("");

  // Hydrate the field once the profile loads.
  useEffect(() => {
    if (currentUser?.profile?.display_name != null) {
      setDisplayName(currentUser.profile.display_name);
    }
  }, [currentUser]);

  const save = useMutation({
    mutationFn: async (name: string) => {
      if (!currentUser) throw new Error("Not signed in");
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: name })
        .eq("id", currentUser.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["user"] });
      router.refresh(); // refresh server layout so the sidebar/topbar update
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const trimmed = displayName.trim();
  const original = currentUser?.profile?.display_name ?? "";
  const canSave = !!trimmed && trimmed !== original && !save.isPending;

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Account and preferences"
        icon={Settings}
      />

      <div className="mt-5 max-w-lg rounded-xl border border-border bg-surface p-6">
        <div className="flex items-center gap-3">
          {/* Gradient-ringed avatar */}
          <div className="rounded-full bg-accent-gradient p-[2px] shadow-glow-accent-sm">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-sm font-semibold text-accent">
              {getInitials(currentUser?.profile?.display_name ?? "?")}
            </div>
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Profile</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Update how you appear across PRISM.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="mt-6 space-y-5">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-9 w-32 rounded-lg" />
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave) save.mutate(trimmed);
            }}
            className="mt-6 space-y-5"
          >
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="rounded-lg"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                value={currentUser?.email ?? ""}
                readOnly
                disabled
                className="rounded-lg"
              />
              <p className="text-xs text-muted-foreground">
                Email can&apos;t be changed.
              </p>
            </div>

            <Button type="submit" disabled={!canSave} className="rounded-lg">
              {save.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save changes
            </Button>
          </form>
        )}
      </div>

      <ThemeCard />
      <NotificationsCard />
    </div>
  );
}
