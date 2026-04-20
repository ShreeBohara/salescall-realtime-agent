"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatSecondsCountdown } from "@/app/lib/helpers";
import type { VoiceStatus } from "@/app/lib/types";

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

export function BottomRail({
  status,
  connectedAt,
  remainingMs,
}: {
  status: VoiceStatus;
  connectedAt: number | null;
  remainingMs: number | null;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [rtt, setRtt] = useState(112);
  const phaseRef = useRef(0);

  // Live elapsed clock
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

  // Cosmetic RTT oscillation between ~90 and ~140 ms when connected
  useEffect(() => {
    if (status !== "connected") {
      setRtt(0);
      return;
    }
    const id = window.setInterval(() => {
      phaseRef.current += 0.3;
      const base = 115 + Math.sin(phaseRef.current) * 18;
      const jitter = (Math.random() - 0.5) * 6;
      setRtt(Math.round(base + jitter));
    }, 1200);
    return () => window.clearInterval(id);
  }, [status]);

  const dot =
    status === "connected"
      ? "bg-emerald-400"
      : status === "connecting"
      ? "bg-amber-400"
      : "bg-muted-foreground/60";

  const dotAnim = status === "idle" ? "" : "animate-pulse";

  return (
    <footer
      className={cn(
        "earshot-stagger-bottom-rail",
        "sticky bottom-0 z-30 border-t border-border/70 bg-background/85 backdrop-blur-md"
      )}
    >
      <div
        className={cn(
          "mx-auto flex h-8 w-full max-w-[1400px] items-center gap-3 px-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground sm:px-6 lg:px-8"
        )}
      >
        <span className="flex items-center gap-1.5">
          <span className={cn("inline-block h-1.5 w-1.5 rounded-full", dot, dotAnim)} />
          <span className="text-foreground/80">gpt-realtime</span>
        </span>
        <span className="text-border">·</span>
        <span>webrtc</span>
        <span className="text-border">·</span>
        <span>
          elapsed <span className="tabular-nums text-foreground/80">{formatElapsed(elapsedMs)}</span>
        </span>
        {remainingMs != null && (
          <>
            <span className="text-border">·</span>
            <span>
              auto-end{" "}
              <span
                className={cn(
                  "tabular-nums",
                  remainingMs < 60_000 ? "text-amber-300" : "text-foreground/80"
                )}
              >
                {formatSecondsCountdown(remainingMs)}
              </span>
            </span>
          </>
        )}
        {status === "connected" && rtt > 0 && (
          <>
            <span className="text-border">·</span>
            <span>
              <span className="tabular-nums text-foreground/80">{rtt}</span>ms rtt
            </span>
          </>
        )}
        <span className="ml-auto hidden text-[10px] tracking-[0.18em] text-muted-foreground/70 sm:inline">
          instalily case study &middot; apr 2026
        </span>
      </div>
    </footer>
  );
}
