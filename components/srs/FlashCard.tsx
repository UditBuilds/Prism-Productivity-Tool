"use client";

import { cn } from "@/lib/utils";
import { renderMarkdown } from "@/lib/markdown";

/** Heuristic: does this text use markdown syntax worth rendering? */
function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s*(#{1,6}\s|[-*]\s|\d+\.\s|>)|\*\*|`|\[[^\]]+\]\(/.test(text);
}

/**
 * Card body. Plain Q&A is centered for focus; structured/markdown content is
 * left-aligned within a readable measure so long answers and lists stay legible.
 */
function CardContent({ text, className }: { text: string; className?: string }) {
  if (looksLikeMarkdown(text)) {
    return (
      <div
        className={cn("prose-preview w-full max-w-prose text-left", className)}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
      />
    );
  }
  return (
    <p className={cn("max-w-prose whitespace-pre-wrap text-center", className)}>
      {text}
    </p>
  );
}

/** The quiet "Question" / "Answer" label with a status dot. */
function FaceLabel({ children, accent }: { children: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          accent ? "bg-accent" : "bg-muted-foreground/40"
        )}
      />
      <span
        className={cn(
          "text-[11px] font-medium uppercase tracking-[0.18em]",
          accent ? "text-accent/70" : "text-muted-foreground/60"
        )}
      >
        {children}
      </span>
    </div>
  );
}

export function FlashCard({
  front,
  back,
  isFlipped,
  onFlip,
}: {
  front: string;
  back: string;
  isFlipped: boolean;
  onFlip: () => void;
}) {
  const bodyClass =
    "text-xl font-medium leading-relaxed text-foreground sm:text-2xl sm:leading-relaxed";

  return (
    <div className="card-scene h-80 w-full sm:h-[22rem]">
      <button
        type="button"
        onClick={onFlip}
        aria-label={isFlipped ? "Show question" : "Reveal answer"}
        className={cn(
          "card-3d h-full w-full cursor-pointer text-left outline-none",
          isFlipped && "flipped"
        )}
      >
        {/* Front (question) */}
        <div className="card-face flex flex-col overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-surface-raised to-surface p-6 shadow-xl shadow-black/30 sm:p-8">
          <FaceLabel>Question</FaceLabel>
          <div className="flex flex-1 items-center justify-center overflow-y-auto py-5">
            <CardContent text={front} className={bodyClass} />
          </div>
          {!isFlipped && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/50">
              <span>Tap to reveal</span>
              <kbd className="hidden rounded border border-border/70 bg-background/40 px-1.5 font-sans text-[10px] font-medium text-muted-foreground/60 sm:inline">
                Space
              </kbd>
            </div>
          )}
        </div>

        {/* Back (answer) — a whisper of the themeable accent */}
        <div className="card-face back flex flex-col overflow-hidden rounded-2xl border border-accent/25 bg-gradient-to-b from-surface-raised to-surface p-6 shadow-xl shadow-black/30 ring-1 ring-inset ring-accent/10 sm:p-8">
          <FaceLabel accent>Answer</FaceLabel>
          <div className="flex flex-1 items-center justify-center overflow-y-auto py-5">
            <CardContent text={back} className={bodyClass} />
          </div>
        </div>
      </button>
    </div>
  );
}
