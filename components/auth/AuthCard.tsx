import { cn } from "@/lib/utils";

/**
 * Shared shell for the auth pages: gradient-bordered card with a fade-up
 * entrance, plus a shake when `shake` flips true (submit error).
 */
export function AuthCard({
  children,
  shake = false,
}: {
  children: React.ReactNode;
  shake?: boolean;
}) {
  return (
    <div
      className={cn(
        "gradient-border animate-fade-up rounded-xl p-8 shadow-xl",
        shake && "animate-shake"
      )}
    >
      {children}
    </div>
  );
}

/** Animated PRISM wordmark + tagline + per-page subtitle. */
export function AuthHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div className={cn("text-center", subtitle ? "mb-8" : "mb-1")}>
      <h1 className="text-gradient-animated inline-block text-3xl font-bold tracking-tight drop-shadow-[0_0_16px_rgb(var(--accent-rgb)/0.35)]">
        PRISM
      </h1>
      <p className="mt-1 text-xs text-muted-foreground/80">
        ✨ AI-native productivity
      </p>
      {subtitle && (
        <p className="mt-4 text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
