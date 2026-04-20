"use client";

import { useState } from "react";
import { ChevronRight, Circle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToolCallCard } from "@/components/earshot/tool-call-card";
import { cn } from "@/lib/utils";
import type { ToolCall } from "@/app/lib/types";

/**
 * Compact inline chip that renders inside the merged transcript feed.
 * Default collapsed: `⏺ toolName · 112ms · status ▸`. Click to expand
 * into the full <ToolCallCard> (same component used in the Actions tab).
 */
export function InlineToolCallRow({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const elapsedMs = call.endedAt != null ? call.endedAt - call.startedAt : undefined;

  const StatusIcon =
    call.status === "done" ? CheckCircle2 : call.status === "error" ? XCircle : Loader2;
  const statusColor =
    call.status === "done"
      ? "text-emerald-400"
      : call.status === "error"
      ? "text-destructive"
      : "text-[--color-accent-voice]";
  const statusAnim = call.status === "running" ? "animate-spin" : "";
  const statusLabel =
    call.status === "done" ? "done" : call.status === "error" ? "error" : "running";

  return (
    <li className="earshot-chip-in">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className={cn(
            "group flex w-full items-center gap-2 rounded-md border border-border/40 bg-card/30 px-3 py-1.5",
            "text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground",
            "transition-colors hover:border-border/80 hover:bg-card/60 hover:text-foreground",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-[--color-accent-voice]"
          )}
          aria-expanded={open}
          aria-label={`Tool call ${call.name}, ${statusLabel}`}
        >
          <Circle className="h-2 w-2 fill-[--color-accent-voice] text-[--color-accent-voice]" />
          <span className="font-medium normal-case tracking-normal text-foreground/90">
            {call.name}
          </span>
          {elapsedMs != null && (
            <>
              <span className="text-border">·</span>
              <span className="tabular-nums">{elapsedMs}ms</span>
            </>
          )}
          <span className="text-border">·</span>
          <StatusIcon className={cn("h-3 w-3", statusColor, statusAnim)} />
          <span className={statusColor}>{statusLabel}</span>
          <ChevronRight
            className={cn(
              "ml-auto h-3.5 w-3.5 transition-transform",
              open && "rotate-90"
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <ol>
            <ToolCallCard call={call} />
          </ol>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
