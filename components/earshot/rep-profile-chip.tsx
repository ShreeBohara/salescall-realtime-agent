"use client";

import { LogOut } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Rep } from "@/app/lib/store/repStore";

/**
 * Signed-in-rep chip for the top-right of the header.
 *
 * Two things happen here:
 *   1. Permanent identity anchor — a monogram in the brand accent
 *      color that says "yes, this Earshot is YOURS" at a glance.
 *      Sits next to the Help button so the top-right cluster reads
 *      as the standard "account / utilities" corner users already
 *      expect from SaaS tooling.
 *   2. Sign-out escape hatch — clicking opens a small popover with
 *      the full name and a Sign out row. Signing out clears the
 *      rep store and re-triggers onboarding so the demo loop can
 *      be replayed end-to-end.
 *
 * Design notes:
 *   - 36×36 button matches the Help icon button next to it so the
 *     corner reads as a single row of controls, not a pair of
 *     mismatched affordances.
 *   - Monogram uses the voice-accent token (same blue/green the
 *     orb breathes in) so "me" shares visual DNA with "the agent",
 *     reinforcing that they're a pair.
 *   - When `rep` is null we render nothing — the onboarding modal
 *     will be covering the screen anyway, and a chip with no name
 *     would look broken.
 */
export function RepProfileChip({
  rep,
  onSignOut,
  connected,
}: {
  rep: Rep | null;
  onSignOut: () => void;
  /**
   * While a call is live, we disable sign-out. Clearing the rep
   * mid-session would yank the name out of the agent's context
   * and silently corrupt authored-by stamps on anything captured
   * after the flip.
   */
  connected: boolean;
}) {
  if (!rep) return null;

  const firstName = rep.name.split(/\s+/)[0] ?? rep.name;

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Signed in as ${rep.name}`}
        className={cn(
          "group relative inline-flex h-9 w-9 items-center justify-center rounded-full",
          "border border-border/70 bg-[--color-accent-voice]/15",
          "text-[13px] font-semibold text-foreground",
          "transition hover:bg-[--color-accent-voice]/25 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        )}
      >
        <span aria-hidden="true">{rep.initial}</span>
        {/* Tiny green dot confirms "you are signed in" — same visual
            grammar as the top-rail status dot. Pure eye candy but it
            sells the "your personal agent" narrative. */}
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-background bg-emerald-400"
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0 text-xs">
        <div className="flex items-center gap-3 border-b border-border/50 px-3 py-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
              "bg-[--color-accent-voice]/20 text-sm font-semibold text-foreground"
            )}
          >
            {rep.initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">
              {rep.name}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              Your personal Earshot agent
            </div>
          </div>
        </div>

        <div className="px-3 py-2 text-[11px] text-muted-foreground">
          Signed in on this device. The agent greets you by name and stamps
          every note and task as yours.
        </div>

        <div className="border-t border-border/50 p-1">
          <button
            type="button"
            onClick={onSignOut}
            disabled={connected}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px]",
              connected
                ? "cursor-not-allowed text-muted-foreground/50"
                : "text-foreground hover:bg-muted/60"
            )}
            aria-disabled={connected}
            title={
              connected
                ? "Sign out is disabled during a live call"
                : `Sign out ${firstName}`
            }
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign out</span>
            {connected && (
              <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground/80">
                locked
              </span>
            )}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
