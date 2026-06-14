// Instant skeleton for the dashboard home (a server component that awaits
// Supabase) — shown while its data loads. Tokens only; no data hooks.
export default function DashboardLoading() {
  return (
    <div className="animate-pulse">
      {/* Greeting */}
      <div className="pt-2">
        <div className="h-8 w-48 rounded-lg bg-surface-raised" />
      </div>

      {/* Daily check-in */}
      <div className="mt-5 h-16 w-full rounded-xl bg-surface-raised" />

      {/* KPI grid (2×2 / 4-up) */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-surface-raised" />
        ))}
      </div>

      {/* Due Today */}
      <div className="mt-8 h-5 w-32 rounded bg-surface-raised" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-14 w-full rounded-xl bg-surface-raised" />
        ))}
      </div>

      {/* Upcoming */}
      <div className="mt-8 h-5 w-24 rounded bg-surface-raised" />
      <div className="mt-3 h-16 w-full rounded-xl bg-surface-raised" />
    </div>
  );
}
