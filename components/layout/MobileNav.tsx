"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { mobileNavItems, isNavActive } from "./nav-config";

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface md:hidden">
      {mobileNavItems.map((item) => {
        const active = isNavActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
              active ? "text-accent" : "text-muted-foreground"
            )}
          >
            <Icon
              className={cn("h-5 w-5", active && "fill-accent/20")}
              strokeWidth={active ? 2.25 : 2}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
