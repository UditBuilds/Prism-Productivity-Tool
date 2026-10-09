"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api/client";
import type {
  AdvanceResult,
  LessonView,
  StepAction,
  TopicDetail,
  TopicSummary,
} from "@/lib/learning/types";

/**
 * Learning is ONLINE-ONLY (decision 9), so none of this follows the app's
 * offline pattern on purpose:
 *   - no key here is in PERSISTED_QUERY_KEYS, so nothing is restored from
 *     IndexedDB as if it were current;
 *   - no mutation is registered in lib/offline-mutations.ts;
 *   - networkMode "always" with no retries: the app's default mutation mode
 *     ("offlineFirst" + retry 3) would quietly pause a request offline and
 *     replay it later. Here a request made offline fails at once, the screen
 *     says so, and the text Udit typed stays in its field.
 * Every read is a POST — see lib/learning/reads.ts for why.
 */

export const learningKeys = {
  all: ["learning"] as const,
  topics: ["learning", "topics"] as const,
  topic: (id: string) => ["learning", "topic", id] as const,
  lesson: (stepId: string) => ["learning", "lesson", stepId] as const,
};

/** The message for a failed learning request: offline is said plainly. */
export function learningErrorMessage(err: unknown): string {
  const offline =
    (typeof navigator !== "undefined" && navigator.onLine === false) ||
    err instanceof TypeError; // fetch() rejects with a TypeError when there is no network
  if (offline) return "You're offline. Learning needs a connection. Nothing you typed is lost.";
  return err instanceof Error && err.message ? err.message : "Something went wrong. Try again.";
}

const queryDefaults = { networkMode: "always" as const, retry: 0, staleTime: 5_000 };

export function useLearningTopics() {
  return useQuery({
    queryKey: learningKeys.topics,
    queryFn: () => apiFetch<{ topics: TopicSummary[] }>("/api/learning/topics/list", "POST", {}),
    select: (d) => d.topics,
    ...queryDefaults,
  });
}

export function useLearningTopic(topicId: string) {
  return useQuery({
    queryKey: learningKeys.topic(topicId),
    queryFn: () => apiFetch<TopicDetail>("/api/learning/topics/get", "POST", { topicId }),
    ...queryDefaults,
  });
}

export function useLearningLesson(stepId: string) {
  return useQuery({
    queryKey: learningKeys.lesson(stepId),
    queryFn: () => apiFetch<LessonView>("/api/learning/lesson", "POST", { stepId }),
    ...queryDefaults,
  });
}

const mutationDefaults = { networkMode: "always" as const, retry: 0 };

export function useCreateTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title: string) =>
      apiFetch<TopicDetail & { retryAfterSeconds?: number }>("/api/learning/topics/create", "POST", { title }),
    onSuccess: (detail) => {
      qc.setQueryData(learningKeys.topic(detail.topic.id), detail);
      qc.invalidateQueries({ queryKey: learningKeys.topics });
    },
    ...mutationDefaults,
  });
}

export function usePlanTopic(topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<TopicDetail & { retryAfterSeconds?: number }>("/api/learning/topics/plan", "POST", { topicId }),
    onSuccess: (detail) => {
      qc.setQueryData(learningKeys.topic(topicId), detail);
      qc.invalidateQueries({ queryKey: learningKeys.topics });
    },
    ...mutationDefaults,
  });
}

export function useArchiveTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { topicId: string; archived: boolean }) =>
      apiFetch<{ id: string }>("/api/learning/topics/archive", "POST", v),
    onSettled: () => qc.invalidateQueries({ queryKey: learningKeys.all }),
    ...mutationDefaults,
  });
}

export function useUpdateStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { stepId: string; action: StepAction; note?: string }) =>
      apiFetch<{ stepId: string }>("/api/learning/steps/update", "POST", v),
    onSuccess: (_d, v) => {
      // "open" changes only the reading point; the screen does not need a refetch for it.
      if (v.action === "open") return;
      qc.invalidateQueries({ queryKey: learningKeys.all });
    },
    ...mutationDefaults,
  });
}

export type JobState =
  | { phase: "idle" }
  | { phase: "working" }
  | { phase: "waiting"; until: number; reason: "ai_busy" | "busy" }
  | { phase: "budget"; until: number }
  | { phase: "groq_daily" }
  | { phase: "offline"; message: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drives POST /api/learning/advance while a topic or lesson screen is open:
 * one lesson per call, until the server says there is nothing to write.
 * Nothing here is job state — the server reads the rows every time — so
 * closing the screen just stops the loop, and opening it again resumes.
 * `kick()` restarts it after an action that creates work (Redo, This is
 * wrong, Try again, opening a lesson).
 */
export function useLearningJob(topicId: string | null, focusStepId: string | null = null) {
  const qc = useQueryClient();
  const [state, setState] = useState<JobState>({ phase: "idle" });
  const [runId, setRunId] = useState(0);
  const runningRef = useRef(false);

  const kick = useCallback(() => setRunId((n) => n + 1), []);

  // Coming back online restarts a loop that stopped on a failed request.
  useEffect(() => {
    window.addEventListener("online", kick);
    return () => window.removeEventListener("online", kick);
  }, [kick]);

  useEffect(() => {
    if (!topicId) return;
    let cancelled = false;
    // A wait that ends early when the screen closes or the loop is restarted.
    const wait = async (ms: number) => {
      const end = Date.now() + ms;
      while (!cancelled && Date.now() < end) await sleep(Math.min(250, end - Date.now()));
    };
    const refresh = (stepId?: string) => {
      qc.invalidateQueries({ queryKey: learningKeys.topic(topicId) });
      qc.invalidateQueries({ queryKey: learningKeys.topics });
      if (stepId) qc.invalidateQueries({ queryKey: learningKeys.lesson(stepId) });
      if (focusStepId && focusStepId !== stepId) qc.invalidateQueries({ queryKey: learningKeys.lesson(focusStepId) });
    };

    (async () => {
      // One loop per screen, even under Strict Mode's double effect run.
      while (runningRef.current && !cancelled) await sleep(200);
      if (cancelled) return;
      runningRef.current = true;
      let busyTries = 0;
      try {
        while (!cancelled) {
          setState({ phase: "working" });
          // The claim happens in the first moments of the request; refetch
          // soon after so the step on screen shows "Writing".
          const peek = setTimeout(() => !cancelled && refresh(), 1500);
          let r: AdvanceResult;
          try {
            r = await apiFetch<AdvanceResult>("/api/learning/advance", "POST", { topicId, stepId: focusStepId });
          } catch (err) {
            clearTimeout(peek);
            if (!cancelled) setState({ phase: "offline", message: learningErrorMessage(err) });
            return;
          }
          clearTimeout(peek);
          if (cancelled) return;
          if (r.kind === "wrote" || r.kind === "failed") {
            busyTries = 0;
            refresh(r.stepId);
            continue;
          }
          if (r.kind === "busy") {
            if (++busyTries > 30) break;
            setState({ phase: "waiting", until: Date.now() + 4000, reason: "busy" });
            refresh();
            await wait(4000);
            continue;
          }
          if (r.kind === "waiting") {
            setState({ phase: "waiting", until: Date.now() + r.retryAfterSeconds * 1000, reason: "ai_busy" });
            refresh();
            await wait(r.retryAfterSeconds * 1000);
            continue;
          }
          if (r.kind === "budget") {
            setState({ phase: "budget", until: Date.now() + r.retryAfterSeconds * 1000 });
            return;
          }
          if (r.kind === "groq_daily") {
            setState({ phase: "groq_daily" });
            return;
          }
          break; // idle, not_found, error
        }
        if (!cancelled) {
          setState({ phase: "idle" });
          refresh();
        }
      } finally {
        runningRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [topicId, focusStepId, runId, qc]);

  return { state, kick };
}
