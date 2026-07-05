import { cn, getInitials } from "@/lib/utils";

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-11 w-11 text-sm",
} as const;

export interface UserAvatarProps {
  name: string;
  size?: keyof typeof SIZES;
  /** Accent-gradient ring wrapper (Settings profile treatment). */
  gradientRing?: boolean;
  /** Soft glow + accent ring (Sidebar/TopBar treatment). */
  glow?: boolean;
  className?: string;
}

/**
 * Initials-in-circle avatar shared by Sidebar, TopBar, and Settings.
 * Presentational only — interactive wrappers (dropdown triggers) supply their
 * own button semantics around it.
 */
export function UserAvatar({
  name,
  size = "md",
  gradientRing = false,
  glow = false,
  className,
}: UserAvatarProps) {
  const circle = (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-accent/15 font-semibold text-accent",
        SIZES[size],
        glow && "shadow-glow-accent-sm ring-1 ring-accent/30",
        !gradientRing && className
      )}
    >
      {getInitials(name)}
    </div>
  );

  if (!gradientRing) return circle;
  return (
    <div
      className={cn(
        "rounded-full bg-accent-gradient p-[2px] shadow-glow-accent-sm",
        className
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-surface font-semibold text-accent",
          SIZES[size]
        )}
      >
        {getInitials(name)}
      </div>
    </div>
  );
}
