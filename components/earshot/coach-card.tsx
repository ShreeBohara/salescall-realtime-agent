"use client";

import { cn } from "@/lib/utils";
import type { Customer } from "@/app/lib/data/customers";

/**
 * Pre-call "Coach" — a strategist's whisper that fills the column
 * under the voice orb on the idle home stage. Renders 2-3 concrete
 * plays for THIS specific deal, a deal-pulse indicator (days since
 * last touch, color-coded), and the open MEDDIC gaps. All derived
 * deterministically from the customer record — no LLM round-trip
 * needed because the rep wants this BEFORE they hit Start talking.
 *
 * Hides once the call connects so the live transcript can dominate
 * the column without competition.
 */

type Play = {
  rank: 1 | 2 | 3;
  /** Verb-led headline. Keep under ~32 chars. */
  headline: string;
  /** One-line elaboration in body voice. Under ~110 chars. */
  body: string;
};

const PLAYBOOKS: Record<string, Play[]> = {
  "acme-corp": [
    {
      rank: 1,
      headline: "Triage the trial tickets",
      body: "Three open tickets are stalling the close — own a status update before pricing comes up.",
    },
    {
      rank: 2,
      headline: "Reframe pricing on MTTR ROI",
      body: "Anchor on 12 hrs/week of triage time saved — the CFO already bought the business case.",
    },
    {
      rank: 3,
      headline: "Counter the 3-month timeline",
      body: "Float a 6-week onboarding pilot to neutralize the longest-standing objection.",
    },
  ],
  "atmos-industrial": [
    {
      rank: 1,
      headline: "Surface the economic buyer",
      body: "Raj has carried this alone — earn the intro to whoever signs above $85k.",
    },
    {
      rank: 2,
      headline: "Counter Globex with SAP depth",
      body: "20% cheaper means nothing if the connector breaks. Lead with last week's deep-dive.",
    },
    {
      rank: 3,
      headline: "Pin down the process",
      body: "Decision steps are still fog. Get a name for the next gate before the call ends.",
    },
  ],
  "globex-systems": [
    {
      rank: 1,
      headline: "Break the on-prem freeze",
      body: "Two weeks of silence followed an unanswered hard requirement — open with a yes/no.",
    },
    {
      rank: 2,
      headline: "Lock a second stakeholder",
      body: "Dr. Alvarez is enthusiastic but isolated. Earn an intro to a clinical lead this call.",
    },
    {
      rank: 3,
      headline: "Anchor on the audit clock",
      body: "Quarterly board cadence + 30% of CMIO bandwidth on prep — make the wait cost tangible.",
    },
  ],
  "initech-solutions": [
    {
      rank: 1,
      headline: "Lead with year-one wins",
      body: "Risk-model retraining cadence is delivered — open with proof, not a renewal pitch.",
    },
    {
      rank: 2,
      headline: "Close the 5-seat expansion",
      body: "Peter signed off; this is execution. Get seat names and a Q3 start date today.",
    },
    {
      rank: 3,
      headline: "Plant the year-two wedge",
      body: "Risk team is growing 3x. Seed Q4 expansion before this seat count goes to paper.",
    },
  ],
};

/**
 * MEDDIC fields whose copy includes a hedging keyword surface as
 * "open gap" chips. Cheap heuristic, but the seed data is written to
 * make this readable — `Unknown — Raj is the point of contact but
 * authority unclear` triggers two gaps, which matches reality.
 */
const GAP_RULES: Array<{
  id: string;
  label: string;
  test: (c: Customer) => boolean;
}> = [
  {
    id: "economic-buyer",
    label: "Economic buyer",
    test: (c) => /\b(unknown|unclear|tba)\b/i.test(c.meddic.economicBuyer),
  },
  {
    id: "second-champion",
    label: "Second champion",
    test: (c) =>
      /\b(isolated|no\s+second|no\s+other|alone)\b/i.test(c.meddic.champion),
  },
  {
    id: "process",
    label: "Decision process",
    test: (c) => /\b(unclear|unknown|tba)\b/i.test(c.meddic.decisionProcess),
  },
];

function daysSinceISO(iso: string): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 3600_000)));
}

type PulseLevel = "fresh" | "warm" | "cool" | "cold";

function pulseLevel(days: number | null): PulseLevel {
  if (days == null) return "cool";
  if (days <= 3) return "fresh";
  if (days <= 10) return "warm";
  if (days <= 21) return "cool";
  return "cold";
}

const PULSE_TONE: Record<
  PulseLevel,
  { dot: string; ring: string; text: string; word: string }
> = {
  fresh: {
    dot: "bg-emerald-400",
    ring: "shadow-[0_0_0_3px_rgba(52,211,153,0.20)]",
    text: "text-emerald-300/90",
    word: "fresh",
  },
  warm: {
    dot: "bg-[--color-accent-voice]",
    ring: "shadow-[0_0_0_3px_rgba(168,132,247,0.22)]",
    text: "text-[--color-accent-voice]/90",
    word: "warm",
  },
  cool: {
    dot: "bg-amber-400",
    ring: "shadow-[0_0_0_3px_rgba(251,191,36,0.20)]",
    text: "text-amber-300/90",
    word: "cooling",
  },
  cold: {
    dot: "bg-destructive",
    ring: "shadow-[0_0_0_3px_rgba(239,68,68,0.22)]",
    text: "text-destructive/90",
    word: "cold",
  },
};

export function CoachCard({ customer }: { customer: Customer | null }) {
  if (!customer) {
    return (
      <aside
        aria-label="Pre-call coach"
        className={cn(
          "earshot-stagger-hero w-full self-stretch",
          "rounded-xl border border-dashed border-border/40 bg-card/10",
          "px-5 py-7 text-center"
        )}
      >
        <p
          className="text-[15px] italic leading-snug text-muted-foreground/70"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Pick a customer to see the playbook.
        </p>
      </aside>
    );
  }

  const plays = PLAYBOOKS[customer.id] ?? [];
  const days = daysSinceISO(customer.lastCallDate);
  const level = pulseLevel(days);
  const tone = PULSE_TONE[level];
  const gaps = GAP_RULES.filter((r) => r.test(customer));

  return (
    <aside
      aria-label={`Pre-call coach for ${customer.name}`}
      className={cn(
        "earshot-stagger-hero relative w-full self-stretch overflow-hidden",
        "rounded-xl border border-border/50",
        "bg-gradient-to-b from-card/35 via-card/15 to-background/0",
        "px-4 py-4 backdrop-blur-sm",
        // soft inner highlight to lift the card off the page
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      )}
    >
      {/* Decorative corner glyph — a subtle diagonal mark that
          signals "intel briefing" without adding chrome. Sits behind
          the content so it doesn't catch the eye. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-3 -top-3 select-none text-[80px] leading-none italic text-[--color-accent-voice]/[0.06]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        &
      </span>

      {/* Header: COACH label + deal-pulse indicator */}
      <header className="relative flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Coach
          </span>
          <span
            className="text-[11px] italic text-muted-foreground/60"
            style={{ fontFamily: "var(--font-display)" }}
          >
            for this call
          </span>
        </div>
        <div
          className="flex items-center gap-1.5"
          title={
            days == null
              ? "No prior contact on file"
              : `Last touch ${days} day${days === 1 ? "" : "s"} ago`
          }
        >
          <span
            aria-hidden
            className={cn(
              "earshot-pulse-dot inline-block h-1.5 w-1.5 rounded-full",
              tone.dot,
              tone.ring
            )}
          />
          <span
            className={cn(
              "font-mono text-[9.5px] uppercase tracking-[0.22em]",
              tone.text
            )}
          >
            {days == null ? "no contact" : `${days}d · ${tone.word}`}
          </span>
        </div>
      </header>

      {/* Plays — numbered serif drop-caps in the accent voice color
          paired with sans body text. The serif numerals carry most of
          the visual weight; the body copy stays restrained so 2-3
          plays read as a glanceable column, not a wall. */}
      <ol className="relative mt-3.5 flex flex-col gap-3 border-l border-[--color-accent-voice]/30 pl-3.5">
        {plays.map((play) => (
          <li
            key={play.rank}
            className="flex gap-3"
          >
            <span
              aria-hidden
              className="select-none text-[26px] leading-[0.85] italic text-[--color-accent-voice]/75"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {play.rank}
            </span>
            <div className="flex flex-col gap-0.5 pt-0.5">
              <span className="text-[12.5px] font-medium leading-snug text-foreground/95">
                {play.headline}
              </span>
              <span className="text-[11.5px] leading-snug text-muted-foreground">
                {play.body}
              </span>
            </div>
          </li>
        ))}
      </ol>

      {/* Open gaps — only renders when the deal has them. Chips reuse
          the same amber palette as the customer-brief "Open objections"
          dot list so the rep visually links the two. */}
      {gaps.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground/80">
            Gaps
          </span>
          {gaps.map((gap) => (
            <span
              key={gap.id}
              className={cn(
                "rounded-sm border border-amber-300/15 bg-amber-300/[0.07] px-1.5 py-px",
                "font-mono text-[9.5px] uppercase tracking-[0.16em] text-amber-300/90"
              )}
            >
              {gap.label}
            </span>
          ))}
        </div>
      )}
    </aside>
  );
}
