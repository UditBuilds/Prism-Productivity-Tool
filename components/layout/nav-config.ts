import {
  LayoutDashboard,
  CheckSquare,
  FileText,
  Target,
  Brain,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Tasks", href: "/dashboard/tasks", icon: CheckSquare },
  { label: "Notes", href: "/dashboard/notes", icon: FileText },
  { label: "Plans", href: "/dashboard/plans", icon: Target },
  { label: "Learn", href: "/dashboard/learn", icon: Brain },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

// Mobile bottom bar shows 5 (Plans omitted per spec).
export const mobileNavItems: NavItem[] = navItems.filter(
  (item) => item.href !== "/dashboard/plans"
);

export function isNavActive(pathname: string, href: string): boolean {
  return href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname.startsWith(href);
}

export function titleForPath(pathname: string): string {
  if (pathname === "/dashboard") return "Dashboard";
  const match = navItems.find(
    (item) => item.href !== "/dashboard" && pathname.startsWith(item.href)
  );
  return match?.label ?? "Dashboard";
}
