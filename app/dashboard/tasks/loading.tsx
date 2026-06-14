// Instant skeleton for the Tasks page. Tokens only; no data hooks.
const TAB_WIDTHS = ["w-16", "w-16", "w-20", "w-16"];

export default function TasksLoading() {
  return (
    <div className="animate-pulse">
      {/* PageHeader: title + action button */}
      <div className="flex items-center justify-between">
        <div className="h-10 w-40 rounded-lg bg-surface-raised" />
        <div className="h-9 w-28 rounded-lg bg-surface-raised" />
      </div>

      {/* Filter tabs */}
      <div className="mt-5 flex gap-2">
        {TAB_WIDTHS.map((w, i) => (
          <div key={i} className={`h-8 ${w} rounded-lg bg-surface-raised`} />
        ))}
      </div>

      {/* Task cards — surface body with a raised priority stripe on the left */}
      <div className="mt-5 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex h-20 w-full overflow-hidden rounded-xl bg-surface"
          >
            <div className="w-1 bg-surface-raised" />
            <div className="flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
