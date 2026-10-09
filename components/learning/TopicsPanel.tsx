"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, BookOpen, ChevronRight, GraduationCap, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { DEMO_REFUSAL, TOPIC_TITLE_MAX } from "@/lib/learning/constants";
import type { TopicSummary } from "@/lib/learning/types";
import {
  learningErrorMessage,
  useArchiveTopic,
  useCreateTopic,
  useLearningTopics,
} from "@/hooks/useLearning";
import {
  BLOCK_NAME,
  EYEBROW,
  FOCUS,
  ICON_CIRCLE,
  META,
  PRIMARY_PILL,
  ROW_PILL,
  SCREEN_IN,
  SECONDARY_PILL,
} from "./ui";

const SUGGESTION = "Python for AI work, from zero";

export function topicStateLine(t: TopicSummary): string {
  if (t.status === "planning") return "Planning the steps…";
  if (t.status === "failed") return t.error_message ?? "Planning failed. Open it to try again.";
  const parts = [`${t.counts.ready} of ${t.counts.steps} lessons ready`];
  if (t.counts.writing > 0) parts.push("writing");
  if (t.counts.failed > 0) parts.push(`${t.counts.failed} failed`);
  return parts.join(" · ");
}

function TopicIcon({ topic }: { topic: TopicSummary }) {
  if (topic.status === "planning" || topic.counts.writing > 0) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-raised text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
      </span>
    );
  }
  if (topic.status === "failed" || topic.counts.failed > 0) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AlertCircle className="h-4 w-4" aria-hidden />
      </span>
    );
  }
  return (
    <span className={ICON_CIRCLE}>
      <BookOpen className="h-4 w-4" aria-hidden />
    </span>
  );
}

function TopicRow({ topic }: { topic: TopicSummary }) {
  return (
    <li>
      <Link
        href={`/dashboard/learn/topics/${topic.id}`}
        className={cn("flex min-h-[64px] items-center gap-3 py-3", FOCUS, "rounded-lg")}
      >
        <TopicIcon topic={topic} />
        <span className="min-w-0 flex-1">
          <span className={cn(BLOCK_NAME, "block truncate")}>{topic.title}</span>
          <span className={cn(META, "mt-0.5 block", topic.status === "failed" && "text-danger")}>
            {topicStateLine(topic)}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

function ArchivedRow({ topic }: { topic: TopicSummary }) {
  const archive = useArchiveTopic();
  return (
    <li className="flex min-h-[64px] items-center gap-3 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-raised text-muted-foreground">
        <BookOpen className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn(BLOCK_NAME, "block truncate text-muted-foreground")}>{topic.title}</span>
        <span className={cn(META, "mt-0.5 block")}>
          {archive.isError ? learningErrorMessage(archive.error) : "Archived"}
        </span>
      </span>
      <button
        type="button"
        className={ROW_PILL}
        disabled={archive.isPending}
        onClick={() => archive.mutate({ topicId: topic.id, archived: false })}
      >
        {archive.isPending ? "Bringing back…" : "Bring back"}
      </button>
    </li>
  );
}

export function TopicsPanel() {
  const router = useRouter();
  const topics = useLearningTopics();
  const create = useCreateTopic();
  const [title, setTitle] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const demo = topics.isError && topics.error instanceof Error && topics.error.message === DEMO_REFUSAL;
  const active = (topics.data ?? []).filter((t) => !t.archived_at);
  const archived = (topics.data ?? []).filter((t) => t.archived_at);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = title.trim();
    if (!value || create.isPending) return;
    // The field is cleared only on success: a failed request keeps the text.
    create.mutate(value, {
      onSuccess: (detail) => {
        setTitle("");
        router.push(`/dashboard/learn/topics/${detail.topic.id}`);
      },
    });
  }

  return (
    <section className={cn("mt-4 max-w-2xl", SCREEN_IN)} aria-labelledby="topics-heading">
      <div className="flex items-start gap-3">
        <span className={ICON_CIRCLE}>
          <GraduationCap className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="topics-heading" className={BLOCK_NAME}>
            Topics
          </h2>
          <p className={cn(META, "mt-0.5")}>
            Type what you want to learn. The AI plans the steps and writes each lesson from web sources.
          </p>
        </div>
      </div>

      {demo ? (
        <p className={cn(META, "mt-4 rounded-2xl bg-surface p-4")} role="status">
          {DEMO_REFUSAL}
        </p>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label htmlFor="topic-title" className="sr-only">
            What do you want to learn?
          </label>
          <input
            id="topic-title"
            name="topic"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={TOPIC_TITLE_MAX}
            autoComplete="off"
            placeholder={`e.g. ${SUGGESTION}…`}
            className={cn(
              "h-12 w-full rounded-2xl border border-input bg-background px-4 text-base text-foreground placeholder:text-muted-foreground",
              FOCUS
            )}
          />
          <button type="submit" className={PRIMARY_PILL} disabled={create.isPending || !title.trim()}>
            {create.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                Planning the steps…
              </>
            ) : (
              "Plan this topic"
            )}
          </button>
          {create.isError && (
            <p className={cn(META, "text-danger")} role="alert" aria-live="polite">
              {learningErrorMessage(create.error)}
            </p>
          )}
        </form>
      )}

      {!demo && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className={EYEBROW}>Your topics</h3>
          {topics.isPending ? (
            <ul className="mt-1 divide-y divide-border" aria-busy="true" aria-label="Loading topics">
              {Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="flex min-h-[64px] items-center gap-3 py-3">
                  <span className="h-9 w-9 rounded-full bg-surface-raised" />
                  <span className="flex-1 space-y-2">
                    <span className="block h-3.5 w-2/3 rounded bg-surface-raised" />
                    <span className="block h-3 w-1/3 rounded bg-surface-raised" />
                  </span>
                </li>
              ))}
            </ul>
          ) : topics.isError ? (
            <div className="mt-3 space-y-3" role="alert">
              <p className={META}>{learningErrorMessage(topics.error)}</p>
              <button type="button" className={SECONDARY_PILL} onClick={() => topics.refetch()}>
                Try again
              </button>
            </div>
          ) : active.length === 0 ? (
            <div className="mt-3 space-y-3">
              <p className={META}>No topics yet. Start with one idea you want to understand.</p>
              <button type="button" className={SECONDARY_PILL} onClick={() => setTitle(SUGGESTION)}>
                {SUGGESTION}
              </button>
            </div>
          ) : (
            <ul className="mt-1 divide-y divide-border">
              {active.map((t) => (
                <TopicRow key={t.id} topic={t} />
              ))}
            </ul>
          )}

          {archived.length > 0 && (
            <div className="mt-2 border-t border-border pt-2">
              <button
                type="button"
                className={cn("flex h-11 items-center text-[13px] font-semibold text-muted-foreground", FOCUS, "rounded-lg")}
                aria-expanded={showArchived}
                onClick={() => setShowArchived((v) => !v)}
              >
                {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
              </button>
              {showArchived && (
                <ul className="divide-y divide-border">
                  {archived.map((t) => (
                    <ArchivedRow key={t.id} topic={t} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
