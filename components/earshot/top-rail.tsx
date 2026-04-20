"use client";

import { ClipboardList, HelpCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CUSTOMERS, type Customer } from "@/app/lib/data/customers";
import type { VoiceStatus } from "@/app/lib/types";
import type { Rep } from "@/app/lib/store/repStore";
import { RepProfileChip } from "./rep-profile-chip";

const STAGE_TONE: Record<string, string> = {
  negotiation: "text-amber-300",
  proposal: "text-sky-300",
  qualification: "text-indigo-300",
  discovery: "text-muted-foreground",
  "closed-won": "text-emerald-300",
  "closed-lost": "text-destructive",
};

export function TopRail({
  selectedId,
  customer,
  status,
  connected,
  onSelectCustomer,
  callHistoryCount,
  logActive,
  onToggleLog,
  rep,
  onSignOut,
}: {
  selectedId: string;
  customer: Customer | null;
  status: VoiceStatus;
  connected: boolean;
  onSelectCustomer: (id: string) => void;
  callHistoryCount: number;
  logActive: boolean;
  onToggleLog: () => void;
  /**
   * Currently signed-in rep (from the module-level repStore). Passed
   * in so the header can render the monogram chip and offer a sign-
   * out path; null while we're pre-hydration or between sign-out and
   * re-onboarding.
   */
  rep: Rep | null;
  onSignOut: () => void;
}) {
  const statusDotClass =
    status === "connected"
      ? "bg-emerald-400 animate-pulse"
      : status === "connecting"
      ? "bg-amber-400 animate-pulse"
      : "bg-muted-foreground/60";

  const statusLabel =
    status === "connected" ? "live" : status === "connecting" ? "connecting" : "idle";

  const stageTone = customer ? STAGE_TONE[customer.dealStage] ?? "text-muted-foreground" : "text-muted-foreground";

  return (
    <header
      className={cn(
        "earshot-stagger-top-rail",
        "sticky top-0 z-30 border-b border-border/70 backdrop-blur-md",
        "bg-background/75"
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span
            className="text-2xl italic leading-none tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Earshot
          </span>
          <span className="hidden text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:inline">
            voice-first sales copilot
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Status pill */}
          <div
            className={cn(
              "hidden items-center gap-2 rounded-full border border-border/70 bg-card/40 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground sm:inline-flex"
            )}
          >
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", statusDotClass)} />
            {statusLabel}
          </div>

          {/* Customer pill (the Select itself styled as a pill) */}
          <Select value={selectedId} onValueChange={onSelectCustomer} disabled={connected}>
            <SelectTrigger
              size="sm"
              aria-label="Select customer"
              className={cn(
                "h-9 gap-2 rounded-full border-border/70 bg-card/60 pl-3 pr-3 font-medium",
                "hover:bg-card/80 focus:ring-1 focus:ring-[--color-accent-voice]"
              )}
            >
              <span className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[--color-accent-voice]" />
                <SelectValue placeholder="Pick a customer" />
                {customer && (
                  <span className={cn("hidden text-[11px] uppercase tracking-wide md:inline", stageTone)}>
                    {customer.dealStage}
                  </span>
                )}
              </span>
            </SelectTrigger>
            <SelectContent>
              {CUSTOMERS.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Call log nav button — toggles the full-stage log view.
              Shows a count chip once recordings exist; highlights when
              the log view is active so the rep always knows where they
              are in the app. */}
          <button
            type="button"
            onClick={onToggleLog}
            aria-pressed={logActive}
            aria-label={logActive ? "Close call log" : "Open call log"}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 font-mono text-[11px] uppercase tracking-wider transition-colors",
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-[--color-accent-voice]",
              logActive
                ? "border-[--color-accent-voice]/70 bg-[--color-accent-voice]/25 text-foreground shadow-[0_0_18px_-6px_rgba(168,132,247,0.55)]"
                : "border-border/70 bg-card/40 text-muted-foreground hover:bg-card/70 hover:text-foreground"
            )}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Call log</span>
            {callHistoryCount > 0 && (
              <span
                className={cn(
                  "inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] tabular-nums",
                  logActive
                    ? "bg-[--color-accent-voice]/30 text-foreground"
                    : "bg-border/40 text-foreground/80"
                )}
              >
                {callHistoryCount}
              </span>
            )}
          </button>

          {/* Help popover — replaces the inline hint paragraph */}
          <Popover>
            <PopoverTrigger
              aria-label="Usage tips"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card/40 text-muted-foreground hover:text-foreground"
            >
              <HelpCircle className="h-4 w-4" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 text-xs">
              <p className="font-medium text-foreground">Try saying…</p>
              <ul className="mt-2 space-y-1.5 text-muted-foreground">
                <li>&ldquo;What was their last objection?&rdquo;</li>
                <li>&ldquo;Who&rsquo;s the champion here?&rdquo;</li>
                <li>&ldquo;Save a note that they want annual prepay at 12%.&rdquo;</li>
                <li>&ldquo;Remind me to follow up with Acme on Friday.&rdquo;</li>
              </ul>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Mic permission required. Sessions cap at 10 minutes.
              </p>
            </PopoverContent>
          </Popover>

          {/* Signed-in rep chip — the "this Earshot is yours" anchor.
              Rendered last in the row so it sits flush with the right
              edge (standard SaaS account-corner placement). Hidden
              when no rep is signed in; the onboarding modal is
              covering the screen in that state anyway. */}
          <RepProfileChip
            rep={rep}
            onSignOut={onSignOut}
            connected={connected}
          />
        </div>
      </div>

      {/* Secondary indicator row — contact name, title, and deal size
          previously lived here, but they duplicated what the Customer
          Brief panel already shows next to the orb. This row now only
          surfaces signals that are NOT in the brief: an open-ticket
          risk count and the "locked during call" hint while a session
          is live. Hidden entirely when neither signal applies so the
          top chrome stays quiet. */}
      {customer && (customer.openTickets > 0 || connected) && (
        <div className="mx-auto hidden h-7 w-full max-w-[1400px] items-center justify-end gap-2 border-t border-border/40 px-4 text-[11px] text-muted-foreground sm:flex sm:px-6 lg:px-8">
          {customer.openTickets > 0 && (
            <span className="text-amber-300/80">
              {customer.openTickets} open ticket
              {customer.openTickets === 1 ? "" : "s"}
            </span>
          )}
          {customer.openTickets > 0 && connected && (
            <span className="text-border">·</span>
          )}
          {connected && (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
              locked during call
            </span>
          )}
        </div>
      )}
    </header>
  );
}
