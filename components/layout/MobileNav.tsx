"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { mobileNavItems, isNavActive } from "./nav-config";

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 flex border-t border-[#1A1A1A] bg-[#0A0A0A]/90 backdrop-blur-xl md:hidden">
      {mobileNavItems.map((item) => {
        const active = isNavActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium active:scale-95",
              active ? "text-violet-400" : "text-muted-foreground"
            )}
          >
            <Icon
              className={cn("h-6 w-6", active && "fill-violet-500/20")}
              strokeWidth={active ? 2.25 : 2}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
