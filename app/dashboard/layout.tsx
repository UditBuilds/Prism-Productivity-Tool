import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { TopBar } from "@/components/layout/TopBar";
import { NotificationChecker } from "@/components/reminders/NotificationChecker";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { FloatingTimer } from "@/components/focus/FloatingTimer";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const displayName = profile?.display_name ?? "User";
  const email = user.email ?? "";

  return (
    <div className="min-h-screen bg-background">
      <Sidebar displayName={displayName} />
      <div className="md:pl-60">
        <TopBar displayName={displayName} email={email} />
        <main className="mx-auto max-w-6xl px-4 py-6 pb-[calc(6rem_+_env(safe-area-inset-bottom))] md:px-8 md:pb-10">
          {children}
        </main>
      </div>
      <MobileNav />
      <InstallPrompt />
      <NotificationChecker />
      <FloatingTimer />
    </div>
  );
}
