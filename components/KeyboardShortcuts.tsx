"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Keyboard } from "lucide-react";

import { useUIStore } from "@/store/ui.store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "?", action: "Show this help" },
  { keys: "Ctrl+K", action: "Quick search (coming soon)" },
  { keys: "n", action: "New task" },
  { keys: "t", action: "Go to Tasks" },
  { keys: "l", action: "Go to Learn" },
  { keys: "f", action: "Go to Focus" },
  { keys: "d", action: "Go to Dashboard" },
  { keys: "Space", action: "Flip flashcard (in review)" },
  { keys: "1–4", action: "Grade flashcard (in review)" },
  { keys: "Esc", action: "Close modal / dialog" },
];

/** True when the keystroke belongs to a form field, not a global shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Global dashboard hotkeys: `?` opens the cheat-sheet; single letters navigate.
 * All ignore modifier combos and keystrokes inside form fields, and stay inert
 * while any Radix dialog is open (so `n` in a modal can't hijack the page).
 */
export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const openCreateTask = useUIStore((s) => s.openCreateTask);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      // Radix sets aria-hidden on the app root behind open dialogs; the open
      // dialog itself renders in a portal with role="dialog".
      if (document.querySelector("[role='dialog'][data-state='open']")) {
        return;
      }

      switch (e.key) {
        case "?":
          e.preventDefault();
          setOpen(true);
          break;
        case "n":
          e.preventDefault();
          openCreateTask();
          if (pathname !== "/dashboard/tasks") router.push("/dashboard/tasks");
          break;
        case "t":
          e.preventDefault();
          router.push("/dashboard/tasks");
          break;
        case "l":
          e.preventDefault();
          router.push("/dashboard/learn");
          break;
        case "f":
          e.preventDefault();
          router.push("/dashboard/focus");
          break;
        case "d":
          e.preventDefault();
          router.push("/dashboard");
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname, openCreateTask]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-accent" />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Available anywhere in the dashboard.
          </DialogDescription>
        </DialogHeader>
        <ul className="stagger-children space-y-1">
          {SHORTCUTS.map((s) => (
            <li
              key={s.keys}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-raised/60"
            >
              <span className="text-muted-foreground">{s.action}</span>
              <kbd className="rounded border border-border/70 bg-background/50 px-1.5 py-0.5 font-sans text-[11px] font-medium text-foreground">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
