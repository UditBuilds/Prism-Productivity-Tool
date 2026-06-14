// Instant skeleton for the Learn page. Tokens only; no data hooks.
export default function LearnLoading() {
  return (
    <div className="animate-pulse">
      {/* PageHeader: title + two action buttons */}
      <div className="flex items-center justify-between">
        <div className="h-9 w-32 rounded-lg bg-surface-raised" />
        <div className="flex gap-2">
          <div className="h-9 w-24 rounded-lg bg-surface-raised" />
          <div className="h-9 w-28 rounded-lg bg-surface-raised" />
        </div>
      </div>

      {/* Stat cards (3-up) */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-surface-raised" />
        ))}
      </div>

      {/* Review-all button */}
      <div className="mt-5 h-12 w-full rounded-lg bg-surface-raised" />

      {/* YouTube analyzer card */}
      <div className="mt-8 h-32 w-full rounded-xl bg-surface-raised" />

      {/* Deck cards */}
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-surface-raised" />
        ))}
      </div>
    </div>
  );
}
