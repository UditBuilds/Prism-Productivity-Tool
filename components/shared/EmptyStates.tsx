import type { ReactNode } from "react";

/** Shared frame: centered SVG + title + subtitle, with optional action below. */
function EmptyShell({
  svg,
  title,
  subtitle,
  action,
}: {
  svg: ReactNode;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex animate-fade-up flex-col items-center justify-center px-6 py-16 text-center">
      <div className="animate-float text-accent/60 [filter:drop-shadow(0_0_12px_rgb(var(--accent-rgb)/0.25))]">
        {svg}
      </div>
      <p className="mt-5 text-[15px] font-medium text-muted-foreground">
        {title}
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground/60">{subtitle}</p>
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
      subtitle="Add your first task to get started"
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
      subtitle="Capture your first idea"
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
      subtitle="Upload a PDF or add cards manually"
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
