"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

// Drag distance is damped (×0.4); triggering needs ~110px of finger travel.
const TRIGGER_PX = 44;
const MAX_PULL_PX = 90;

/**
 * Touch-only pull-to-refresh wrapper for list pages. Starts tracking only when
 * the page is scrolled to the top; desktop mouse users never see it. The
 * body's overscroll-behavior already suppresses the native browser gesture.
 */
export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<unknown>;
  children: React.ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    if (window.scrollY <= 0 && !refreshing) {
      startY.current = e.touches[0].clientY;
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startY.current === null || refreshing) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy <= 0 || window.scrollY > 0) {
      setPull(0);
      return;
    }
    setPull(Math.min(MAX_PULL_PX, dy * 0.4));
  }

  async function onTouchEnd() {
    if (startY.current === null) return;
    startY.current = null;
    const shouldRefresh = pull >= TRIGGER_PX && !refreshing;
    setPull(0);
    if (shouldRefresh) {
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    }
  }

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        aria-hidden={!refreshing}
        role={refreshing ? "status" : undefined}
        className="flex items-center justify-center overflow-hidden transition-[height] duration-150"
        style={{ height: refreshing ? 44 : pull }}
      >
        <Loader2
          className={cn(
            "h-5 w-5 text-accent",
            (refreshing || pull >= TRIGGER_PX) && "animate-spin"
          )}
          style={{
            opacity: refreshing ? 1 : Math.min(1, pull / TRIGGER_PX),
          }}
        />
      </div>
      {children}
    </div>
  );
}
