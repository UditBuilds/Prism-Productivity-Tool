"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { mobileNavItems, isNavActive } from "./nav-config";
import { NavBadge, useNavBadgeCounts } from "./NavBadges";

export function MobileNav() {
  const pathname = usePathname();
  const badges = useNavBadgeCounts();

  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 flex border-t border-border/60 bg-background/80 backdrop-blur-xl md:hidden">
      {mobileNavItems.map((item) => {
        const active = isNavActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium tracking-wide active:scale-95",
              active ? "text-accent" : "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "relative flex h-8 w-14 items-center justify-center rounded-full",
                active && "bg-accent/[0.12]"
              )}
            >
              {/* Glow dot above the active icon */}
              <span
                aria-hidden
                className={cn(
                  "absolute left-1/2 top-0 h-1 w-1 -translate-x-1/2 -translate-y-1 rounded-full bg-accent shadow-glow-accent-sm transition-opacity",
                  active ? "opacity-100" : "opacity-0"
                )}
              />
              <Icon
                className={cn("h-[22px] w-[22px]", active && "fill-accent/20")}
                strokeWidth={active ? 2.25 : 2}
              />
              {item.href === "/dashboard/learn" && (
                <NavBadge
                  count={badges.learn}
                  color="violet"
                  className="right-1.5 top-0"
                />
              )}
              {item.href === "/dashboard/reminders" && (
                <NavBadge
                  count={badges.reminders}
                  color="amber"
                  className="right-1.5 top-0"
                />
              )}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
