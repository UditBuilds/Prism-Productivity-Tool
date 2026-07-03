"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, Loader2, Play } from "lucide-react";

import { extractVideoId } from "@/lib/youtube/extract";
import type {
  YoutubeAnalyzeError,
  YoutubeAnalyzeSuccess,
} from "@/lib/youtube/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardCountPills } from "@/components/shared/CardCountPills";

const CARD_COUNT_OPTIONS = [3, 5, 8, 12, 16, 20];

interface YoutubeAnalyzerProps {
  onSuccess?: (cardCount: number, deckName: string) => void;
}

type Stage = "idle" | "fetching" | "generating";

interface SuccessState {
  count: number;
  deckName: string;
}

export function YoutubeAnalyzer({ onSuccess }: YoutubeAnalyzerProps) {
  const [url, setUrl] = useState("");
  const [cardCount, setCardCount] = useState(8);
  const [deckName, setDeckName] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<YoutubeAnalyzeError | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const stageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoId = useMemo(() => extractVideoId(url), [url]);
  const busy = stage !== "idle";
  const canGenerate = videoId !== null && !busy;

  async function handleGenerate() {
    if (!canGenerate) return;
    setError(null);
    setSuccess(null);
    setStage("fetching");
    // Cosmetic two-phase label — the single request does fetch then generate.
    stageTimer.current = setTimeout(() => setStage("generating"), 2200);

    try {
      const res = await fetch("/api/youtube/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          cardCount,
          deckName: deckName.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        data: YoutubeAnalyzeSuccess | null;
        error: YoutubeAnalyzeError | string | null;
      };

      if (!res.ok || !json.data) {
        const e = json.error;
        setError(
          e && typeof e === "object"
            ? e
            : {
                code: "NETWORK_ERROR",
                message:
                  typeof e === "string" ? e : "Couldn't generate cards.",
                hint: "",
              }
        );
        return;
      }

      const resolvedDeck = deckName.trim() || json.data.videoTitle;
      const count = json.data.cards.length;
      setSuccess({ count, deckName: resolvedDeck });
      onSuccess?.(count, resolvedDeck);
      // Reset the form for the next video.
      setUrl("");
      setDeckName("");
    } catch {
      setError({
        code: "NETWORK_ERROR",
        message: "Couldn't reach the analyzer — check your connection.",
        hint: "",
      });
    } finally {
      if (stageTimer.current) clearTimeout(stageTimer.current);
      stageTimer.current = null;
      setStage("idle");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent/25">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent shadow-glow-accent-sm">
          <Play className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            YouTube → Flashcards
          </h3>
          <p className="text-xs text-muted-foreground">
            Paste any YouTube URL to generate flashcards
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="yt-url">YouTube URL</Label>
          <Input
            id="yt-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            disabled={busy}
            className="rounded-lg"
          />
          {videoId && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-success" />
              Video detected
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Cards</Label>
            <CardCountPills
              value={cardCount}
              onChange={setCardCount}
              options={CARD_COUNT_OPTIONS}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="yt-deck">Deck</Label>
            <Input
              id="yt-deck"
              value={deckName}
              onChange={(e) => setDeckName(e.target.value)}
              placeholder="Deck name (optional)"
              disabled={busy}
              className="rounded-lg"
            />
          </div>
        </div>

        <Button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="w-full rounded-lg"
        >
          {busy ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              {stage === "fetching"
                ? "Fetching transcript…"
                : "Generating cards…"}
            </>
          ) : (
            "Generate flashcards"
          )}
        </Button>

        {/* Success — subtle, not loud */}
        {success && !busy && (
          <div className="rounded-lg border border-border bg-surface-raised/50 p-3">
            <p className="flex items-center gap-2 text-sm text-foreground">
              <Check className="h-4 w-4 shrink-0 text-success" />
              {success.count} card{success.count === 1 ? "" : "s"} added to
              &ldquo;{success.deckName}&rdquo;
            </p>
            <Link
              href="/dashboard/learn"
              className="mt-1 inline-block pl-6 text-xs text-accent underline underline-offset-2"
            >
              View in Learn ↗
            </Link>
          </div>
        )}

        {/* Error — muted subdued card, never a red alert */}
        {error && !busy && (
          <div className="rounded-lg border border-border bg-surface-raised/50 p-3">
            <p className="flex items-start gap-2 text-sm text-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                {error.message}
                {error.hint && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {error.hint}
                  </span>
                )}
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
