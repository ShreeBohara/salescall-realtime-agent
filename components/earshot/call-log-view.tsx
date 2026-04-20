"use client";

import { ArrowLeft, ArrowUpRight, ClipboardList, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PostCallSummaryCard } from "@/components/earshot/post-call-summary-card";
import type { CallRecord } from "@/app/lib/store/callHistoryStore";
import type { SummaryState } from "@/app/lib/types";

/**
 * Call Log — dedicated stage that lists every Earshot-recorded call
 * as a table. Entered from the top rail's "Call log" nav button; the
 * orb/transcript/captured surfaces don't render here because the log
 * is a navigation surface, not a call surface.
 *
 * Two inner modes driven by the ambient summary state:
 *   table   → summary.phase is anything but "ready": render the
 *             tabular log with click-to-open rows
 *   detail  → summary.phase === "ready": render the selected call's
 *             PostCallSummaryCard with a "back to log" control
 *
 * Reusing `SummaryState` means the log shares the same selection
 * machinery as the automatic post-call view; swapping in a record
 * via `onOpenDetail` lights up the right row on return.
 */

type Props = {
  history: readonly CallRecord[];
  summaryState: SummaryState;
  onOpenDetail: (record: CallRecord) => void;
  onCloseDetail: () => void;
  onBackHome: () => void;
  onClear: () => void;
  onRetry: () => void;
};

// Tailwind utility maps for the tiny confidence pill.
const CONFIDENCE_CLASS: Record<
  "high" | "medium" | "low",
  { dot: string; label: string; text: string }
> = {
  high: {
    dot: "bg-emerald-400",
    label: "High",
    text: "text-emerald-300",
  },
  medium: {
    dot: "bg-amber-400",
    label: "Medium",
    text: "text-amber-300",
  },
  low: {
    dot: "bg-muted-foreground/60",
    label: "Low",
    text: "text-muted-foreground",
  },
};

function formatRelative(ts: number): string {
  const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (deltaSec < 45) return "just now";
  if (deltaSec < 60 * 60) return `${Math.round(deltaSec / 60)}m ago`;
  if (deltaSec < 60 * 60 * 24) return `${Math.round(deltaSec / 3600)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(ms: number | null): string | null {
  if (ms == null || ms < 1000) return null;
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export function CallLogView({
  history,
  summaryState,
  onOpenDetail,
  onCloseDetail,
  onBackHome,
  onClear,
  onRetry,
}: Props) {
  const inDetail = summaryState.phase === "ready";

  return (
    <div className="earshot-stagger-hero flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={inDetail ? onCloseDetail : onBackHome}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full border border-border/70 bg-card/40 px-3",
            "font-mono text-[11px] uppercase tracking-wider text-muted-foreground",
            "transition-colors hover:bg-card/70 hover:text-foreground",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-[--color-accent-voice]"
          )}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{inDetail ? "Back to log" : "Back to home"}</span>
        </button>

        <div className="ml-1 flex flex-col leading-tight">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {inDetail ? "call log · detail" : "call log"}
          </span>
          <span
            className="text-2xl italic text-foreground"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {inDetail
              ? summaryState.forCustomer ?? "Call detail"
              : history.length === 1
              ? "1 recording"
              : `${history.length} recordings`}
          </span>
        </div>

        {!inDetail && history.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className={cn(
              "ml-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-card/30 px-3",
              "font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80",
              "transition-colors hover:border-destructive/60 hover:text-destructive",
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-destructive/40"
            )}
            aria-label="Clear all recordings"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear all</span>
          </button>
        )}
      </div>

      {inDetail ? (
        <PostCallSummaryCard
          state={summaryState}
          onDismiss={onCloseDetail}
          onRetry={onRetry}
        />
      ) : history.length === 0 ? (
        <CallLogEmpty />
      ) : (
        <CallLogTable history={history} onSelect={onOpenDetail} />
      )}
    </div>
  );
}

function CallLogEmpty() {
  return (
    <div
      className={cn(
        "flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-lg",
        "border border-dashed border-border/50 bg-card/10 px-6 py-10 text-center"
      )}
    >
      <ClipboardList className="h-5 w-5 text-muted-foreground/60" />
      <p
        className="text-lg italic text-foreground/75"
        style={{ fontFamily: "var(--font-display)" }}
      >
        No recordings yet.
      </p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Finish your first Earshot call and it will show up here with the
        headline, key points, duration, and full summary.
      </p>
    </div>
  );
}

function CallLogTable({
  history,
  onSelect,
}: {
  history: readonly CallRecord[];
  onSelect: (record: CallRecord) => void;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border/60 bg-card/20",
        "backdrop-blur-[2px]"
      )}
    >
      <div className="grid grid-cols-[minmax(160px,1.3fr)_minmax(120px,0.8fr)_minmax(70px,0.4fr)_minmax(200px,2.4fr)_minmax(100px,0.55fr)_40px] items-center gap-4 border-b border-border/60 bg-background/40 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>Customer</span>
        <span>Ended</span>
        <span>Duration</span>
        <span>Headline</span>
        <span>Confidence</span>
        <span className="sr-only">Open</span>
      </div>

      <ol>
        {history.map((r) => {
          const duration = formatDuration(
            r.startedAt != null ? r.endedAt - r.startedAt : null
          );
          const conf = CONFIDENCE_CLASS[r.summary.confidence];

          return (
            <li
              key={r.id}
              className="border-b border-border/30 last:border-b-0"
            >
              <button
                type="button"
                onClick={() => onSelect(r)}
                aria-label={`Open full summary for ${r.forCustomer ?? "unknown customer"} call from ${formatRelative(r.endedAt)}`}
                className={cn(
                  "group relative grid w-full grid-cols-[minmax(160px,1.3fr)_minmax(120px,0.8fr)_minmax(70px,0.4fr)_minmax(200px,2.4fr)_minmax(100px,0.55fr)_40px]",
                  "items-center gap-4 px-5 py-4 text-left transition-colors",
                  "hover:bg-card/60 focus:bg-card/60 focus:outline-none"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-y-3 left-0 w-0.5 rounded-full bg-[--color-accent-voice] opacity-0 transition-opacity",
                    "group-hover:opacity-80 group-focus:opacity-80"
                  )}
                />

                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground/95">
                    {r.forCustomer ?? "Unknown customer"}
                  </span>
                </div>

                <div className="flex flex-col gap-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                  <span className="text-foreground/80">
                    {formatRelative(r.endedAt)}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">
                    {formatAbsolute(r.endedAt)}
                  </span>
                </div>

                <span className="font-mono text-[12px] tabular-nums text-foreground/80">
                  {duration ?? "—"}
                </span>

                <p
                  className="line-clamp-2 pr-4 text-[13px] italic leading-snug text-foreground/85"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {r.summary.headline}
                </p>

                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider",
                    conf.text
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("h-1.5 w-1.5 rounded-full", conf.dot)}
                  />
                  {conf.label}
                </span>

                <ArrowUpRight
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground/60 transition-all",
                    "group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[--color-accent-voice]"
                  )}
                  aria-hidden
                />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
