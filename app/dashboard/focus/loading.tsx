// Instant skeleton for the Focus page. Tokens only; no data hooks.
export default function FocusLoading() {
  return (
    <div className="animate-pulse">
      {/* PageHeader */}
      <div className="h-9 w-32 rounded-lg bg-surface-raised" />

      {/* Timer ring */}
      <div className="mx-auto mt-10 h-40 w-40 rounded-full bg-surface-raised" />

      {/* Category pills */}
      <div className="mt-8 flex justify-center gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-9 w-20 rounded-lg bg-surface-raised" />
        ))}
      </div>

      {/* Start button */}
      <div className="mx-auto mt-8 h-12 w-32 rounded-xl bg-surface-raised" />
    </div>
  );
}
