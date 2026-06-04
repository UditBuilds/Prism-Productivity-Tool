"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn, getInitials } from "@/lib/utils";
import { navItems, isNavActive } from "./nav-config";

export function Sidebar({ displayName }: { displayName: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-16 items-center px-6">
        <Link
          href="/dashboard"
          className="text-2xl font-bold tracking-tight text-accent"
        >
          PRISM
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {navItems.map((item) => {
          const active = isNavActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg border-l-[3px] border-transparent px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-accent bg-accent/15 text-accent"
                  : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/20 text-sm font-semibold text-accent">
            {getInitials(displayName)}
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {displayName}
          </p>
          <button
            onClick={handleLogout}
            aria-label="Log out"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-raised hover:text-danger"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </aside>
  );
}
