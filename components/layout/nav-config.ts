import {
  LayoutDashboard,
  CheckSquare,
  FileText,
  Target,
  Bell,
  Calendar,
  Dumbbell,
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
  { label: "Workout", href: "/dashboard/workout", icon: Dumbbell },
  { label: "Focus", href: "/dashboard/focus", icon: Timer },
  { label: "Learn", href: "/dashboard/learn", icon: Brain },
  { label: "Review", href: "/dashboard/review", icon: CalendarCheck },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

// Mobile bottom bar shows 5, and the order here is the order there: with Focus
// excluded, Workout inherits the fourth slot rather than needing to be moved
// into it. Workout earns the slot over Focus on use — Focus is a deliberate
// sit-down at a desk, where reaching two taps deeper costs nothing; a set is
// logged standing between reps.
//
// Escape routes for everything omitted, verified against TopBar.tsx:
//   Reminders — the bell button (a direct router.push, not a menu)
//   Calendar, Weekly Review, Settings, Focus — the avatar dropdown
//   Plans     — NOT reachable on mobile. Pre-existing gap, not introduced
//               here; it is in neither the bell nor the dropdown.
const MOBILE_EXCLUDED = [
  "/dashboard/plans",
  "/dashboard/reminders",
  "/dashboard/calendar",
  "/dashboard/focus",
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
