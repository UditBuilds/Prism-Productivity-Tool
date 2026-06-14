// Instant skeleton for the Notes page. Tokens only; no data hooks.
export default function NotesLoading() {
  return (
    <div className="animate-pulse">
      {/* PageHeader: title + action button */}
      <div className="flex items-center justify-between">
        <div className="h-10 w-40 rounded-lg bg-surface-raised" />
        <div className="h-9 w-28 rounded-lg bg-surface-raised" />
      </div>

      {/* Search bar */}
      <div className="mt-5 h-10 w-full rounded-lg bg-surface-raised" />

      {/* Note cards */}
      <div className="mt-5 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 w-full rounded-xl bg-surface-raised" />
        ))}
      </div>
    </div>
  );
}
