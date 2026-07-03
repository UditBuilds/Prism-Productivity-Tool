import type { LucideIcon } from "lucide-react";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  icon?: LucideIcon;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  icon: Icon,
}: PageHeaderProps) {
  return (
    <div className="mb-6 flex items-center gap-3.5">
      {Icon && (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 shadow-glow-accent-sm">
          <Icon className="h-[18px] w-[18px] text-accent" />
        </div>
      )}
      <div className="min-w-0">
        <h1 className="text-gradient truncate text-xl font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground/80">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
