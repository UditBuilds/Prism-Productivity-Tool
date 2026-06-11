"use client";

import { useState } from "react";

import { getTodaysQuote } from "@/lib/quotes";
import { cn } from "@/lib/utils";

/** Quote of the day — same for everyone, rotates daily. Tap to expand. */
export function QuoteCard() {
  const [expanded, setExpanded] = useState(false);
  const quote = getTodaysQuote();

  return (
    <button
      type="button"
      onClick={() => setExpanded((e) => !e)}
      className="mb-6 flex w-full items-start justify-center gap-2 px-2 text-center sm:px-6"
      aria-label="Quote of the day — tap to expand"
    >
      <span aria-hidden className="-mt-2 select-none text-4xl text-violet-800/40">
        &ldquo;
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block text-sm italic leading-relaxed text-[#666]",
            !expanded && "line-clamp-2"
          )}
        >
          {quote.text}
        </span>
        {quote.author && (
          <span className="mt-1 block text-xs text-[#444]">
            — {quote.author}
          </span>
        )}
      </span>
      <span aria-hidden className="-mt-2 select-none text-4xl text-violet-800/40">
        &rdquo;
      </span>
    </button>
  );
}
