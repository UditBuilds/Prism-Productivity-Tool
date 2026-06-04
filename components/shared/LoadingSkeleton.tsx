import { Skeleton } from "@/components/ui/skeleton";

/** Renders `count` card-shaped skeletons (animate-pulse via shadcn Skeleton). */
export function LoadingSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-surface p-4"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-4 rounded" />
          </div>
          <Skeleton className="mt-3 h-3 w-1/3" />
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-5 w-14 rounded-md" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
