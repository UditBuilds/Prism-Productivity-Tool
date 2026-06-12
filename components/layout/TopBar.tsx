"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { format } from "date-fns";
import { Bell, Calendar, CalendarCheck, LogOut, User } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { getInitials } from "@/lib/utils";
import { useUpcomingReminders } from "@/hooks/useReminders";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { titleForPath } from "./nav-config";

export function TopBar({
  displayName,
  email,
}: {
  displayName: string;
  email: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const title = titleForPath(pathname);
  const today = format(new Date(), "EEEE, d MMMM");

  // Live clock, ticking every minute. Rendered only after mount to avoid a
  // server/client hydration mismatch.
  const [time, setTime] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setTime(format(new Date(), "h:mm a"));
    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Dot when a pending reminder is due within the next 24 hours.
  const { data: upcoming } = useUpcomingReminders();
  const hasSoonReminder = (upcoming ?? []).some((r) => {
    const at = new Date(r.remind_at).getTime();
    return at <= Date.now() + 24 * 60 * 60 * 1000;
  });

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="pt-safe sticky top-0 z-20 flex h-[calc(4rem_+_env(safe-area-inset-top))] items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur md:px-8">
      <h1 className="text-base font-semibold tracking-tight text-foreground">
        {title}
      </h1>

      <div className="flex items-center gap-2.5">
        <span className="hidden items-center rounded-lg border border-border/70 bg-surface px-3 py-1.5 text-xs text-muted-foreground sm:flex">
          {today}
          {time && (
            <>
              <span className="px-1.5 text-muted-foreground/40">·</span>
              <span className="tabular-nums text-muted-foreground/70">
                {time}
              </span>
            </>
          )}
        </span>

        <button
          type="button"
          aria-label="Reminders"
          onClick={() => router.push("/dashboard/reminders")}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-surface text-muted-foreground outline-none ring-offset-background transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
        >
          <Bell className="h-[18px] w-[18px]" />
          {hasSoonReminder && (
            <span
              aria-hidden
              className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-background"
            />
          )}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Account menu"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent outline-none ring-1 ring-accent/20 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
            >
              {getInitials(displayName)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
              {email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/calendar" className="cursor-pointer">
                <Calendar className="mr-2 h-4 w-4" />
                Calendar
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/review" className="cursor-pointer">
                <CalendarCheck className="mr-2 h-4 w-4" />
                Weekly Review
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings" className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleLogout}
              className="cursor-pointer text-danger focus:text-danger"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
