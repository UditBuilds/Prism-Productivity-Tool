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
    <div className="mb-6 flex items-center gap-3">
      {Icon && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-950/50">
          <Icon className="h-[18px] w-[18px] text-violet-400" />
        </div>
      )}
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold text-white">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-[#666]">{subtitle}</p>}
      </div>
      {actions && (
        <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
