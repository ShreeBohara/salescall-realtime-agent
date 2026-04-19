"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Session cost cap: 10-minute hard wall-clock timer.
 *
 * At 9:00 we warn via toast; at 10:00 we fire `onAutoEnd`. The hook
 * also returns `remainingMs` so the UI can render a live countdown
 * ribbon once the call is past 8 min — rep sees it coming.
 *
 * Chose these thresholds to match the Compass-doc edge-case plan, and
 * to bound runaway realtime-audio token spend during demo rehearsal.
 *
 * Pass `connectedAt=null` when not connected; the hook is a no-op.
 */
export function useSessionCap({
  active,
  connectedAt,
  onAutoEnd,
  maxMs = 10 * 60 * 1000,
  warnMs = 9 * 60 * 1000,
}: {
  active: boolean;
  connectedAt: number | null;
  onAutoEnd: () => void;
  maxMs?: number;
  warnMs?: number;
}): number | null {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  // Stash the handler in a ref so the interval effect doesn't tear
  // down and rebuild every render when the caller passes a freshly-
  // bound callback (common pattern in React components that don't
  // useCallback every handler).
  const onAutoEndRef = useRef(onAutoEnd);
  useEffect(() => {
    onAutoEndRef.current = onAutoEnd;
  }, [onAutoEnd]);

  useEffect(() => {
    if (!active || connectedAt == null) {
      setRemainingMs(null);
      return;
    }

    let warned = false;
    const tick = () => {
      const elapsed = Date.now() - connectedAt;
      const remaining = Math.max(0, maxMs - elapsed);
      setRemainingMs(remaining);
      if (!warned && elapsed >= warnMs) {
        warned = true;
        toast.warning("Call ends in 1 minute", {
          description: "Auto-disconnect protects cost during demos.",
          duration: 8000,
        });
      }
      if (elapsed >= maxMs) {
        toast("Session auto-ended (10-minute cap)", { duration: 4000 });
        onAutoEndRef.current();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active, connectedAt, maxMs, warnMs]);

  return remainingMs;
}
