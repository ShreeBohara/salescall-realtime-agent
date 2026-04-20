"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { formatSecondsCountdown } from "@/app/lib/helpers";

/**
 * Tiny live-clock strip that sits directly under the voice-orb state
 * label ("listening", "speaking", etc).
 *
 * Replaces the old bottom-rail ticker. The rep's attention during a
 * call is already anchored to the orb, so burying the elapsed/auto-end
 * timers at the very bottom of the page was asking them to track two
 * places at once. Co-locating with the orb means "how long have I been
 * on this call" reads in the same glance as "what's the agent doing".
 *
 * Shape:
 *   00:26               ← always shown while connected
 *   00:26 · 0:34 left   ← auto-end warning turns amber under 1 minute
 *
 * We intentionally HIDE the auto-end countdown while it's non-urgent
 * (> 60s remaining). The 10-minute session cap is a safety rail, not
 * a primary piece of information, so surfacing it early just creates
 * low-grade anxiety. When it becomes genuinely imminent we flip it on
 * in amber so the rep can wrap up.
 *
 * When connectedAt is null we render a placeholder sized-but-empty
 * span so the orb column doesn't collapse vertically between idle and
 * connected states.
 */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

// Threshold in ms below which the auto-end countdown is surfaced.
// Kept as a named constant because a magic "60000" in JSX obscures
// the actual product decision being made: "warn under a minute".
const AUTO_END_WARNING_MS = 60_000;

export function OrbCallMeta({
  connectedAt,
  remainingMs,
  muted,
}: {
  /** Timestamp (ms) the WebRTC session connected; null while idle. */
  connectedAt: number | null;
  /** Ms remaining before the 10-min cap auto-ends the call. */
  remainingMs: number | null;
  /**
   * Whether the mic is currently muted (pause). We show a tiny
   * "muted" tag when true so the rep knows the agent can't hear them
   * — the orb label alone ("paused") doesn't make the AUDIO state
   * unambiguous.
   */
  muted: boolean;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!connectedAt) {
      setElapsedMs(0);
      return;
    }
    const tick = () => setElapsedMs(Date.now() - connectedAt);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [connectedAt]);

  if (!connectedAt) {
    // Reserve vertical space so the orb column has stable height
    // across idle → connected transitions.
    return <div aria-hidden="true" className="h-4" />;
  }

  const showAutoEnd =
    remainingMs != null && remainingMs < AUTO_END_WARNING_MS;

  return (
    <div
      className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground"
      aria-live="polite"
    >
      <span className="tabular-nums text-foreground/75">
        {formatElapsed(elapsedMs)}
      </span>
      {showAutoEnd && remainingMs != null && (
        <>
          <span className="text-border">·</span>
          <span className="tabular-nums text-amber-300">
            {formatSecondsCountdown(remainingMs)} left
          </span>
        </>
      )}
      {muted && (
        <>
          <span className="text-border">·</span>
          <span
            className={cn(
              "rounded-sm border border-destructive/40 bg-destructive/10 px-1.5 py-[1px]",
              "text-[9px] tracking-[0.22em] text-destructive"
            )}
          >
            muted
          </span>
        </>
      )}
    </div>
  );
}
