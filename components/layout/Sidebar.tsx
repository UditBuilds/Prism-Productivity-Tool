"use client";

import { memo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, type LucideIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { navItems, isNavActive } from "./nav-config";
import { NavBadge, useNavBadgeCounts } from "./NavBadges";
import { UserAvatar } from "@/components/shared/UserAvatar";

/**
 * One sidebar nav row, memoized. Props are primitives (the specific badge
 * count — never the whole badges object, whose reference changes every render),
 * so React.memo's shallow compare bails out for the items whose `active`/`badge`
 * didn't actually change. A pathname change or badge-cache touch then re-renders
 * only the 1–2 affected rows, not all 10.
 */
const NavItem = memo(function NavItem({
  href,
  icon: Icon,
  label,
  active,
  badge,
  badgeColor,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  badge?: number;
  badgeColor?: "violet" | "amber";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium hover:translate-x-0.5",
        active
          ? "bg-[linear-gradient(to_right,rgb(var(--accent-rgb)/0.18),transparent)] text-accent"
          : "text-muted-foreground hover:bg-[linear-gradient(to_right,rgb(var(--accent-rgb)/0.08),transparent)] hover:text-foreground"
      )}
    >
      {/* Glow dot marker on the active pill */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent shadow-glow-accent-sm transition-opacity",
          active ? "opacity-100" : "opacity-0"
        )}
      />
      <Icon
        className={cn(
          "h-[18px] w-[18px] shrink-0",
          active ? "text-accent" : "opacity-80"
        )}
      />
      {label}
      {badgeColor && <NavBadge count={badge ?? 0} color={badgeColor} />}
    </Link>
  );
});

export function Sidebar({ displayName }: { displayName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const badges = useNavBadgeCounts();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-background md:flex">
      <div className="flex h-16 items-center border-b border-border/60 px-6">
        <Link
          href="/dashboard"
          className="text-gradient-animated text-xl font-bold tracking-tight drop-shadow-[0_0_12px_rgb(var(--accent-rgb)/0.35)]"
        >
          PRISM
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-3">
        {navItems.map((item) => {
          const isLearn = item.href === "/dashboard/learn";
          const isReminders = item.href === "/dashboard/reminders";
          // Pass the specific primitive count (not the badges object, whose
          // reference changes every render) so memo can bail out per item.
          return (
            <NavItem
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={isNavActive(pathname, item.href)}
              badge={
                isLearn
                  ? badges.learn
                  : isReminders
                    ? badges.reminders
                    : undefined
              }
              badgeColor={isLearn ? "violet" : isReminders ? "amber" : undefined}
            />
          );
        })}
      </nav>

      <div className="mt-auto border-t border-border/60 p-3 pt-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-raised">
          <UserAvatar name={displayName} glow />
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {displayName}
          </p>
          <button
            onClick={handleLogout}
            aria-label="Log out"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-raised hover:text-danger"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </aside>
  );
}
