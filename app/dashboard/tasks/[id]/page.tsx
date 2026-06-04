import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, AlertCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import {
  priorityStyles,
  statusStyles,
  statusLabel,
} from "@/components/tasks/task-styles";

function formatIstDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

export default async function TaskDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", params.id)
    .single();

  const backLink = (
    <Link
      href="/dashboard/tasks"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Tasks
    </Link>
  );

  if (!task) {
    return (
      <div>
        {backLink}
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-6 py-14 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">
            Task not found
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been deleted, or it doesn&apos;t belong to you.
          </p>
        </div>
      </div>
    );
  }

  let planTitle: string | null = null;
  if (task.plan_id) {
    const { data: plan } = await supabase
      .from("plans")
      .select("title")
      .eq("id", task.plan_id)
      .single();
    planTitle = plan?.title ?? null;
  }

  return (
    <div>
      {backLink}

      <div className="mt-5 rounded-xl border border-border bg-surface p-6">
        <h1
          className={cn(
            "text-xl font-semibold text-foreground",
            task.status === "done" && "text-muted-foreground line-through"
          )}
        >
          {task.title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-xs font-medium capitalize",
              priorityStyles[task.priority]
            )}
          >
            {task.priority} priority
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              statusStyles[task.status]
            )}
          >
            {statusLabel[task.status]}
          </span>
        </div>

        {task.description && (
          <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {task.description}
          </p>
        )}

        <dl className="mt-6 grid grid-cols-1 gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Due date</dt>
            <dd className="mt-0.5 text-foreground">
              {task.due_date ? formatIstDate(task.due_date) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="mt-0.5 text-foreground">{planTitle ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="mt-0.5 text-foreground">
              {formatIstDate(task.created_at)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last updated</dt>
            <dd className="mt-0.5 text-foreground">
              {formatIstDate(task.updated_at)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
