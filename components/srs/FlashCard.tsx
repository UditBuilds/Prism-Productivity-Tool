"use client";

import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { renderMarkdown } from "@/lib/markdown";

/** Heuristic: does this text use markdown syntax worth rendering? */
function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s*(#{1,6}\s|[-*]\s|\d+\.\s|>)|\*\*|`|\[[^\]]+\]\(/.test(text);
}

function CardContent({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  if (looksLikeMarkdown(text)) {
    return (
      <div
        className={cn("prose-preview max-w-full text-center", className)}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
      />
    );
  }
  return (
    <p className={cn("whitespace-pre-wrap text-center", className)}>{text}</p>
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
    <div className="card-scene h-72 w-full sm:h-64">
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
        <div className="card-face flex flex-col rounded-xl border border-[#252525] bg-gradient-to-br from-[#161616] to-[#0D0D0D] p-6 font-mono text-foreground shadow-2xl shadow-black/50">
          <span className="text-[10px] tracking-[0.2em] text-[#444]">
            QUESTION
          </span>
          <div className="flex flex-1 items-center justify-center overflow-auto py-2">
            <CardContent
              text={front}
              className="text-lg font-medium leading-relaxed md:text-xl"
            />
          </div>
          {!isFlipped && (
            <span className="flex animate-bounce items-center justify-center gap-1 text-[10px] text-[#333]">
              tap to reveal
              <ChevronDown className="h-2 w-2" />
            </span>
          )}
        </div>

        {/* Back (answer) */}
        <div className="card-face back flex flex-col rounded-xl border border-violet-900/30 bg-gradient-to-br from-[#130D1F] to-[#0D0B14] p-6 font-mono text-foreground shadow-2xl shadow-violet-900/10">
          <span className="text-[10px] tracking-[0.2em] text-violet-500/60">
            ANSWER
          </span>
          <div className="flex flex-1 items-center justify-center overflow-auto py-2">
            <CardContent
              text={back}
              className="text-lg font-medium leading-relaxed text-violet-50"
            />
          </div>
        </div>
      </button>
    </div>
  );
}
