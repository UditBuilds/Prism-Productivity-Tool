import {
  LayoutDashboard,
  CheckSquare,
  FileText,
  Target,
  Bell,
  Calendar,
  Timer,
  Brain,
  CalendarCheck,
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
  { label: "Reminders", href: "/dashboard/reminders", icon: Bell },
  { label: "Calendar", href: "/dashboard/calendar", icon: Calendar },
  { label: "Focus", href: "/dashboard/focus", icon: Timer },
  { label: "Learn", href: "/dashboard/learn", icon: Brain },
  { label: "Review", href: "/dashboard/review", icon: CalendarCheck },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

// Mobile bottom bar shows 5. Plans/Reminders/Calendar/Review/Settings are
// omitted to keep the bar uncrowded at 375px — Reminders stays reachable via
// the TopBar bell; Calendar, Weekly Review and Settings via the avatar dropdown.
const MOBILE_EXCLUDED = [
  "/dashboard/plans",
  "/dashboard/reminders",
  "/dashboard/calendar",
  "/dashboard/review",
  "/dashboard/settings",
];
export const mobileNavItems: NavItem[] = navItems.filter(
  (item) => !MOBILE_EXCLUDED.includes(item.href)
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
