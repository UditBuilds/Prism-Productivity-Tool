"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Repeat2,
  Flame,
  Trophy,
  AlertTriangle,
  Brain,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAnalytics } from "@/hooks/useSRS";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-06-05" → "5 Jun" without timezone-shifting the civil date. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number.parseInt(d, 10)} ${MONTHS[Number.parseInt(m, 10) - 1]}`;
}

function masteryToneClass(pct: number): string {
  if (pct >= 70) return "text-success";
  if (pct >= 40) return "text-warning";
  return "text-danger";
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground sm:text-sm">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function AnalyticsPanel({ streak }: { streak: number }) {
  const { data, isLoading, isError, refetch } = useAnalytics();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-4">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="mt-3 h-7 w-12" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="mt-4 h-[220px] w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Couldn't load analytics"
        description="Something went wrong fetching your learning stats."
        action={
          <Button variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const stats: { label: string; value: string | number; icon: LucideIcon }[] = [
    { label: "Total Reviews", value: data.totalReviews, icon: Repeat2 },
    { label: "Current Streak", value: streak === 1 ? "1 day" : `${streak} days`, icon: Flame },
    { label: "Mastered Cards", value: data.masteredCount, icon: Trophy },
    { label: "Need Work", value: data.needWorkCount, icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {/* Activity chart */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold text-foreground">
          Review Activity — Last 30 Days
        </h3>
        {data.totalReviews === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Brain className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Complete your first review session to see your activity.
            </p>
          </div>
        ) : (
          <div className="mt-4 h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.dailyActivity}
                margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="hsl(var(--border))"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  interval={4}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.5rem",
                    fontSize: "12px",
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                  labelFormatter={(label) => shortDate(String(label))}
                  formatter={(value) => [`${value}`, "Reviews"]}
                />
                <Bar dataKey="count" fill="#7C3AED" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Deck performance table */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Deck Performance
        </h3>
        {data.deckPerformance.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No cards yet — generate or add cards to see deck performance.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Deck</th>
                  <th className="pb-2 pr-4 text-right font-medium">Cards</th>
                  <th className="pb-2 pr-4 text-right font-medium">Avg Ease</th>
                  <th className="pb-2 text-right font-medium">Mastery %</th>
                </tr>
              </thead>
              <tbody>
                {data.deckPerformance.map((deck) => (
                  <tr
                    key={deck.deckName}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="max-w-[12rem] truncate py-2 pr-4 font-medium text-foreground">
                      {deck.deckName}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                      {deck.total}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                      {deck.avgEase.toFixed(1)}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right font-semibold tabular-nums",
                        masteryToneClass(deck.masteryPct)
                      )}
                    >
                      {deck.masteryPct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
