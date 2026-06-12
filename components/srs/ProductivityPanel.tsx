"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  BarChart3,
  CalendarCheck,
  Clock,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useProductivityAnalytics } from "@/hooks/useProductivity";
import type { WeekStats } from "@/app/api/analytics/productivity/route";
import { categoryChartColor } from "@/components/focus/categories";
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

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

const chartTooltipStyle = {
  backgroundColor: "#111111",
  border: "1px solid #2A2A2A",
  borderRadius: "8px",
  fontSize: "12px",
} as const;

/* ── Week-over-week comparison tile ─────────────────────────────── */

function CompareTile({
  label,
  current,
  previous,
  format,
}: {
  label: string;
  current: number;
  previous: number;
  format: (v: number) => string;
}) {
  const diff = current - previous;
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-white">
        {format(current)}
      </p>
      <p
        className={cn(
          "mt-1.5 flex items-center gap-1 text-xs",
          direction === "up"
            ? "text-success"
            : direction === "down"
              ? "text-warning/80"
              : "text-muted-foreground/60"
        )}
      >
        {direction === "up" ? (
          <TrendingUp className="h-3.5 w-3.5 shrink-0" />
        ) : direction === "down" ? (
          <TrendingDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Minus className="h-3.5 w-3.5 shrink-0" />
        )}
        <span>
          {direction === "flat"
            ? "Same as last week"
            : `${diff > 0 ? "+" : "−"}${format(Math.abs(diff))} vs last week`}
        </span>
      </p>
    </div>
  );
}

/* ── Panel ───────────────────────────────────────────────────────── */

export function ProductivityPanel() {
  const { data, isLoading, isError, refetch } = useProductivityAnalytics();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-4">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="mt-3 h-7 w-16" />
              <Skeleton className="mt-2 h-3 w-3/4" />
            </div>
          ))}
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-5">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="mt-4 h-[200px] w-full rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Couldn't load productivity data"
        description="Something went wrong fetching your trends."
        action={
          <Button variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const noData =
    data.totalSessions === 0 &&
    data.totalTasksCompleted === 0 &&
    data.thisWeek.reviewsDone === 0 &&
    data.lastWeek.reviewsDone === 0;

  if (noData) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No productivity data yet"
        description="Complete a focus session, finish a task, or review some cards — your trends will show up here."
      />
    );
  }

  const { thisWeek, lastWeek } = data;
  const tiles: {
    label: string;
    key: keyof WeekStats;
    format: (v: number) => string;
  }[] = [
    { label: "Focus Time", key: "focusMinutes", format: formatMinutes },
    { label: "Tasks Done", key: "tasksCompleted", format: String },
    { label: "Cards Reviewed", key: "reviewsDone", format: String },
    { label: "Active Days", key: "activeDays", format: (v) => `${v} / 7` },
  ];

  const showInsights =
    data.mostProductiveDay !== null || data.mostProductiveHour !== null;

  return (
    <div className="space-y-6">
      {/* 1. This week vs last week */}
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((tile) => (
          <CompareTile
            key={tile.key}
            label={tile.label}
            current={thisWeek[tile.key]}
            previous={lastWeek[tile.key]}
            format={tile.format}
          />
        ))}
      </div>

      {/* 2. Focus activity — last 30 days */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold text-foreground">
          Focus Activity — Last 30 Days
        </h3>
        {data.totalSessions === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No completed focus sessions yet.
          </p>
        ) : (
          <div className="mt-4 h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.dailyFocus}
                margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
              >
                <defs>
                  <linearGradient id="focusBarGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style={{ stopColor: "rgb(var(--accent-rgb))", stopOpacity: 1 }} />
                    <stop offset="100%" style={{ stopColor: "rgb(var(--accent-hover-rgb))", stopOpacity: 0.55 }} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#1A1A1A" />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  interval={4}
                  tick={{ fill: "#555", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "#1A1A1A" }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "#555", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255, 255, 255, 0.04)" }}
                  contentStyle={chartTooltipStyle}
                  labelStyle={{ color: "#F5F5F5" }}
                  labelFormatter={(label) => shortDate(String(label))}
                  formatter={(value) => [formatMinutes(Number(value)), "Focus"]}
                />
                <Bar dataKey="minutes" fill="url(#focusBarGradient)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* 3. Focus by category */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold text-foreground">
          Focus by Category
        </h3>
        {data.categoryBreakdown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No completed focus sessions yet.
          </p>
        ) : (
          <>
            <div className="mx-auto mt-2 h-[190px] w-full max-w-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.categoryBreakdown}
                    dataKey="totalMinutes"
                    nameKey="category"
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={2}
                    stroke="#0E0E0E"
                    strokeWidth={2}
                  >
                    {data.categoryBreakdown.map((slice) => (
                      <Cell
                        key={slice.category}
                        fill={categoryChartColor(slice.category)}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={{ color: "#F5F5F5" }}
                    formatter={(value, name) => [
                      formatMinutes(Number(value)),
                      String(name),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-3 space-y-1.5">
              {data.categoryBreakdown.map((slice) => (
                <li
                  key={slice.category}
                  className="flex items-center gap-2.5 text-sm"
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: categoryChartColor(slice.category) }}
                  />
                  <span className="min-w-0 truncate text-foreground">
                    {slice.category}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                    {formatMinutes(slice.totalMinutes)}
                  </span>
                  <span className="w-10 shrink-0 text-right tabular-nums text-xs text-muted-foreground/60">
                    {slice.percentage}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* 4. Daily tasks completed — last 30 days */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold text-foreground">
          Tasks Completed — Last 30 Days
        </h3>
        {data.totalTasksCompleted === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No completed tasks in the last 30 days.
          </p>
        ) : (
          <div className="mt-4 h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data.dailyTasks}
                margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
              >
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#1A1A1A" />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  interval={4}
                  tick={{ fill: "#555", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "#1A1A1A" }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "#555", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip
                  cursor={{ stroke: "rgba(255, 255, 255, 0.12)" }}
                  contentStyle={chartTooltipStyle}
                  labelStyle={{ color: "#F5F5F5" }}
                  labelFormatter={(label) => shortDate(String(label))}
                  formatter={(value) => [`${value}`, "Tasks"]}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#10B981"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "#10B981", stroke: "#0E0E0E" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* 5. Insights */}
      {showInsights && (
        <div className="flex flex-wrap gap-2">
          {data.mostProductiveDay !== null && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground">
              <CalendarCheck className="h-3.5 w-3.5 text-accent" />
              Most productive:{" "}
              <span className="font-medium text-foreground">
                {data.mostProductiveDay}
              </span>
            </span>
          )}
          {data.mostProductiveHour !== null && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5 text-accent" />
              Peak focus hour:{" "}
              <span className="font-medium text-foreground">
                {formatHour(data.mostProductiveHour)}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
