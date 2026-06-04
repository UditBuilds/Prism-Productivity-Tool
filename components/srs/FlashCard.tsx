"use client";

import { cn } from "@/lib/utils";
import { renderMarkdown } from "@/lib/markdown";

/** Heuristic: does this text use markdown syntax worth rendering? */
function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s*(#{1,6}\s|[-*]\s|\d+\.\s|>)|\*\*|`|\[[^\]]+\]\(/.test(text);
}

function CardContent({ text }: { text: string }) {
  if (looksLikeMarkdown(text)) {
    return (
      <div
        className="prose-preview max-w-full text-center text-base leading-relaxed"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
      />
    );
  }
  return (
    <p className="whitespace-pre-wrap text-center text-lg leading-relaxed">
      {text}
    </p>
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
  return (
    <div className="card-scene h-56 w-full md:h-64">
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
        <div className="card-face flex flex-col items-center justify-center rounded-xl border border-border bg-surface p-6 font-mono text-foreground">
          <div className="flex flex-1 items-center justify-center overflow-auto">
            <CardContent text={front} />
          </div>
          <span className="mt-2 shrink-0 text-xs text-muted-foreground">
            Click to reveal
          </span>
        </div>

        {/* Back (answer) */}
        <div className="card-face back flex items-center justify-center overflow-auto rounded-xl border border-border bg-surface-raised p-6 font-mono text-foreground">
          <CardContent text={back} />
        </div>
      </button>
    </div>
  );
}
