import type { ReactNode } from "react";

/** Shared frame: centered SVG + title + subtitle, with optional action below. */
function EmptyShell({
  svg,
  title,
  subtitle,
  hint,
  action,
}: {
  svg: ReactNode;
  title: string;
  subtitle: string;
  /** Optional suggestion chip rendered between subtitle and action. */
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="text-accent/60">{svg}</div>
      <p className="mt-5 text-[15px] font-medium text-muted-foreground">
        {title}
      </p>
      <p className="mt-1 max-w-xs text-[13px] text-muted-foreground/60">
        {subtitle}
      </p>
      {hint && (
        <span className="mt-3 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs text-accent">
          {hint}
        </span>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const svgProps = {
  width: 64,
  height: 64,
  viewBox: "0 0 64 64",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function EmptyTasks({ action }: { action?: ReactNode }) {
  return (
    <EmptyShell
      title="No tasks yet"
      subtitle="Create your first task to start organizing your day"
      hint="Try: 'Review weekly goals'"
      action={action}
      svg={
        <svg {...svgProps} aria-hidden>
          <rect x="14" y="14" width="36" height="36" rx="9" />
          <path d="M24 32l6 6 12-13" />
        </svg>
      }
    />
  );
}

export function EmptyNotes({ action }: { action?: ReactNode }) {
  return (
    <EmptyShell
      title="No notes yet"
      subtitle="Write your first note — Prism can generate flashcards from it"
      action={action}
      svg={
        <svg {...svgProps} aria-hidden>
          <path d="M16 16h22a6 6 0 016 6v26H22a6 6 0 01-6-6V16z" />
          <path d="M16 16a6 6 0 016 6v26" />
          <path d="M28 27h12M28 34h9" />
        </svg>
      }
    />
  );
}

export function EmptyReminders({ action }: { action?: ReactNode }) {
  return (
    <EmptyShell
      title="No reminders set"
      subtitle="Set a reminder to stay on track"
      action={action}
      svg={
        <svg {...svgProps} aria-hidden>
          <path d="M24 26a8 8 0 0116 0c0 9 4 12 4 12H20s4-3 4-12z" />
          <path d="M29 46a3 3 0 006 0" />
          <path d="M14 24c1-3 3-5 5-6M50 24c-1-3-3-5-5-6" />
        </svg>
      }
    />
  );
}

export function EmptyCards({ action }: { action?: ReactNode }) {
  return (
    <EmptyShell
      title="No flashcards yet"
      subtitle="Add your first flashcard or import from a note, PDF, or YouTube video"
      action={action}
      svg={
        <svg {...svgProps} aria-hidden>
          <rect x="14" y="22" width="30" height="22" rx="5" />
          <path d="M22 18h22a5 5 0 015 5v17" />
          <path d="M22 33h14" />
        </svg>
      }
    />
  );
}
