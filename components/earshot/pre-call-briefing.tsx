"use client";

import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Customer } from "@/app/lib/data/customers";
import type { CallRecord } from "@/app/lib/store/callHistoryStore";

/**
 * Pre-call briefing panel — sits next to the voice orb on the home
 * stage across idle/connecting/connected. Intentionally CUSTOMER-
 * centric (not call-centric): it's the kind of short dossier a BDR
 * manager would paste into Slack five minutes before a call. Works
 * for customers with zero Earshot-recorded history: all core content
 * (narrative briefing, recent activity, champion, stage) comes from
 * the mock CRM data.
 *
 * Renders three sections:
 *   1. Meta header — name · deal stage · deal size
 *   2. Narrative briefing paragraph (from customer.briefing)
 *   3. Recent activity timeline — always shows the 3 latest CRM-style
 *      touches from customer.recentActivity. If an Earshot call with
 *      this customer exists, it's prepended as a row — clickable when
 *      `onOpenSummary` is provided (idle state), inert during a live
 *      call so the rep can't accidentally boot themselves into the
 *      post-call summary mid-conversation.
 *
 * No-customer state renders a single hint pointing at the picker.
 */

type Props = {
  customer: Customer | null;
  latestCall: CallRecord | null;
  /**
   * When provided, the Earshot-call row acts as a button that restores
   * the full summary. When omitted (e.g. during an active call) the
   * row renders as a non-interactive read-only item — the rep still
   * sees the call existed, without a jump target.
   */
  onOpenSummary?: () => void;
};

const STAGE_LABEL: Record<Customer["dealStage"], string> = {
  discovery: "Discovery",
  qualification: "Qualification",
  proposal: "Proposal",
  negotiation: "Negotiation",
  "closed-won": "Closed-won",
  "closed-lost": "Closed-lost",
};

const STAGE_TONE: Record<Customer["dealStage"], string> = {
  discovery: "text-muted-foreground",
  qualification: "text-indigo-300",
  proposal: "text-sky-300",
  negotiation: "text-amber-300",
  "closed-won": "text-emerald-300",
  "closed-lost": "text-destructive",
};

function formatAgo(endedAt: number): string {
  const deltaMin = Math.max(0, Math.floor((Date.now() - endedAt) / 60000));
  if (deltaMin < 1) return "just now";
  if (deltaMin < 60) return `${deltaMin}m ago`;
  if (deltaMin < 60 * 24) return `${Math.floor(deltaMin / 60)}h ago`;
  return new Date(endedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Recent-activity rows come out of the mock data as
 * "YYYY-MM-DD — description". Split on the em-dash so we can style
 * the date differently from the prose without making every mock entry
 * do it by hand.
 */
function splitActivityRow(row: string): { date: string; body: string } {
  const m = row.match(/^(\d{4}-\d{2}-\d{2})\s*—\s*(.*)$/);
  if (!m) return { date: "", body: row };
  const [, iso, body] = m;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { date: iso, body };
  return {
    date: date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    body,
  };
}

export function PreCallBriefing({
  customer,
  latestCall,
  onOpenSummary,
}: Props) {
  if (!customer) {
    return (
      <aside
        aria-label="Pre-call briefing"
        className="earshot-stagger-ledger flex flex-col gap-3"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          No customer selected
        </span>
        <p
          className="text-[20px] italic leading-[1.3] text-foreground/55"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Pick a customer at the top to see their brief, recent
          activity, and champions.
        </p>
      </aside>
    );
  }

  const recent = customer.recentActivity.slice(0, 3);
  const objections = customer.pastObjections.filter(
    (o) => !/^none blocking/i.test(o)
  );

  return (
    <aside
      aria-label={`Pre-call briefing for ${customer.name}`}
      className={cn(
        "earshot-stagger-ledger relative flex flex-col gap-4",
        "border-l-2 border-[--color-accent-voice]/35 pl-6 md:pl-8"
      )}
    >
      {/* Meta row: stage + deal size + champion name.
          This is the CRM-summary-at-a-glance line. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <span className="text-[--color-accent-voice]">Customer brief</span>
        <span className="text-border">/</span>
        <span className={cn("tracking-[0.18em]", STAGE_TONE[customer.dealStage])}>
          {STAGE_LABEL[customer.dealStage]}
        </span>
        <span className="text-border">/</span>
        <span className="tabular-nums text-foreground/80">
          {customer.dealSize}
        </span>
        {customer.openTickets > 0 && (
          <>
            <span className="text-border">/</span>
            <span className="text-amber-300/80">
              {customer.openTickets} open ticket{customer.openTickets === 1 ? "" : "s"}
            </span>
          </>
        )}
      </div>

      {/* Narrative briefing — the headline content.
          Intentionally sized down from the old 18/19px display block:
          with the tightened ~100-char mock copy (see Customer.briefing
          doc) this reads as a punchy two-line lead-in rather than a
          wall of italics. `max-w-[65ch]` is tuned to the natural width
          of the brief column — caps line length on very wide viewports
          without leaving artificial blank space next to the paragraph
          on the default layout. */}
      <p
        className="max-w-[65ch] text-[15px] italic leading-[1.55] text-foreground/90 md:text-[16px]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {customer.briefing}
      </p>

      {/* Compact champion + contact line. Keeps the who-to-call info
          glanceable without pushing the briefing down the fold. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Primary contact
          </span>
          <span className="text-sm text-foreground/90">
            {customer.contact.name}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {customer.contact.title}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Champion
          </span>
          <span className="text-sm text-foreground/90">
            {customer.meddic.champion.split(" — ")[0] ??
              customer.meddic.champion}
          </span>
          {customer.meddic.champion.includes(" — ") && (
            <span className="text-[11px] text-muted-foreground">
              {customer.meddic.champion.split(" — ").slice(1).join(" — ")}
            </span>
          )}
        </div>
      </div>

      {/* Recent activity timeline. The last Earshot call (if any) is
          injected as the newest row and is clickable — it's the only
          live link in this panel, and taps into the existing summary
          detail flow. Everything else is CRM prose. */}
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Recent activity
        </span>
        <ul className="flex flex-col gap-1.5">
          {latestCall &&
            (onOpenSummary ? (
              <li>
                <button
                  type="button"
                  onClick={onOpenSummary}
                  className={cn(
                    "group flex w-full items-baseline gap-3 text-left",
                    "transition-colors"
                  )}
                  aria-label={`Open full summary for last Earshot call with ${customer.name}`}
                >
                  <span className="w-14 shrink-0 font-mono text-[11px] tabular-nums text-[--color-accent-voice]/90">
                    {formatAgo(latestCall.endedAt)}
                  </span>
                  <span className="flex-1 text-sm leading-snug text-foreground/90 group-hover:text-foreground">
                    <span className="mr-2 rounded-sm bg-[--color-accent-voice]/15 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.18em] text-[--color-accent-voice]">
                      Earshot call
                    </span>
                    <span className="italic text-foreground/80 group-hover:text-foreground/95">
                      {latestCall.summary.headline}
                    </span>
                  </span>
                  <ArrowUpRight
                    className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/70 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[--color-accent-voice]"
                    aria-hidden
                  />
                </button>
              </li>
            ) : (
              <li className="flex items-baseline gap-3">
                <span className="w-14 shrink-0 font-mono text-[11px] tabular-nums text-[--color-accent-voice]/90">
                  {formatAgo(latestCall.endedAt)}
                </span>
                <span className="flex-1 text-sm leading-snug text-foreground/85">
                  <span className="mr-2 rounded-sm bg-[--color-accent-voice]/15 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.18em] text-[--color-accent-voice]">
                    Earshot call
                  </span>
                  <span className="italic text-foreground/80">
                    {latestCall.summary.headline}
                  </span>
                </span>
              </li>
            ))}
          {recent.map((row, idx) => {
            const { date, body } = splitActivityRow(row);
            return (
              <li
                key={idx}
                className="flex items-baseline gap-3 text-sm leading-snug text-foreground/80"
              >
                <span className="w-14 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/80">
                  {date}
                </span>
                <span className="flex-1">{body}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Open objections footer — only renders when real friction is
          on the table. Keeps the risks visible without cluttering the
          main briefing flow. */}
      {objections.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border/40 pt-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Open objections
          </span>
          <ul className="flex flex-col gap-1">
            {objections.map((o, idx) => (
              <li
                key={idx}
                className="flex gap-2 text-[12px] leading-snug text-muted-foreground"
              >
                <span
                  aria-hidden
                  className="mt-[0.55em] h-[3px] w-[3px] shrink-0 rounded-full bg-amber-400/70"
                />
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
