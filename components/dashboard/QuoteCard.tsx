"use client";

import { useState } from "react";

import { getTodaysQuote } from "@/lib/quotes";
import { cn } from "@/lib/utils";

/**
 * Quote of the day — rendered as the greeting's quiet subtext, not a block of
 * its own. One calm line; tap to expand long quotes.
 */
export function QuoteCard() {
  const [expanded, setExpanded] = useState(false);
  const quote = getTodaysQuote();

  return (
    <button
      type="button"
      onClick={() => setExpanded((e) => !e)}
      aria-label="Quote of the day — tap to expand"
      className="group mt-1.5 block max-w-2xl text-left"
    >
      <span
        className={cn(
          "text-[13px] italic leading-relaxed text-muted-foreground/60 transition-colors group-hover:text-muted-foreground/80",
          !expanded && "line-clamp-1"
        )}
      >
        &ldquo;{quote.text}&rdquo;
        {quote.author && (
          <span className="not-italic text-muted-foreground/40">
            {" "}
            — {quote.author}
          </span>
        )}
      </span>
    </button>
  );
}
