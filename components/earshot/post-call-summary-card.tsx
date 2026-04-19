"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleCheck,
  Copy,
  FileText,
  ListChecks,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Target,
  User,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMeddicKey } from "@/app/lib/helpers";
import type { CallSummary, MeddicSummary, SummaryState } from "@/app/lib/types";

/**
 * Post-call summary card. Rendered right below the transcript whenever
 * the `summary` state is not idle. Four visual modes:
 *   loading  → skeleton + spinner
 *   ready    → full structured summary (headline, bullets, MEDDIC grid,
 *              objections, risks, next steps)
 *   empty    → "call too short" compact row
 *   error    → error chip + retry button
 *
 * Primary UX goal: this is the CLOSING BEAT of the demo. Must feel
 * like the voice call produced a polished, copy-pastable, CRM-ready
 * artifact. Keep the layout generous — dense data hidden in a card
 * won't land in a 5-minute pitch.
 */
export function PostCallSummaryCard({
  state,
  onDismiss,
  onRetry,
}: {
  state: SummaryState;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [crmSent, setCrmSent] = useState(false);

  function handleCopy() {
    if (state.phase !== "ready") return;
    try {
      navigator.clipboard.writeText(JSON.stringify(state.summary, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — ignore silently; user can still read the JSON.
    }
  }

  function handleSendToCrm() {
    setCrmSent(true);
    setTimeout(() => setCrmSent(false), 2200);
  }

  const forCustomer = state.phase !== "idle" ? state.forCustomer : null;

  return (
    <Card className="overflow-hidden border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          <FileText className="h-4 w-4 text-primary" />
          Post-call summary
          {forCustomer && (
            <span className="text-muted-foreground/70 normal-case tracking-normal">
              · for {forCustomer}
            </span>
          )}
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            aria-label="Dismiss summary"
            className="text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {state.phase === "loading" && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>Extracting structured notes from the call…</span>
          </div>
        )}

        {state.phase === "empty" && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span>
              Call was too short to summarize. Start another call and speak
              with the copilot to generate a summary.
            </span>
          </div>
        )}

        {state.phase === "error" && (
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1 flex flex-col gap-2">
              <div className="text-sm">
                Couldn&apos;t generate the summary.
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {state.error}
                </span>
              </div>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRetry}
                  className="h-7 gap-1.5"
                >
                  <RotateCcw className="h-3 w-3" /> Retry
                </Button>
              </div>
            </div>
          </div>
        )}

        {state.phase === "ready" && (
          <SummaryBody
            summary={state.summary}
            copied={copied}
            crmSent={crmSent}
            onCopy={handleCopy}
            onSendToCrm={handleSendToCrm}
          />
        )}
      </CardContent>
    </Card>
  );
}

function SummaryBody({
  summary,
  copied,
  crmSent,
  onCopy,
  onSendToCrm,
}: {
  summary: CallSummary;
  copied: boolean;
  crmSent: boolean;
  onCopy: () => void;
  onSendToCrm: () => void;
}) {
  const confidenceTone =
    summary.confidence === "high"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : summary.confidence === "medium"
      ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
      : "bg-muted/30 text-muted-foreground border-border";

  const meddicEntries = (
    Object.entries(summary.meddic) as [keyof MeddicSummary, string | null][]
  ).filter(([, v]) => v != null && v.trim().length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-medium leading-snug">{summary.headline}</p>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 px-1.5 py-0 text-[10px] font-normal capitalize",
            confidenceTone
          )}
        >
          {summary.confidence} confidence
        </Badge>
      </div>

      {summary.keyPoints.length > 0 && (
        <SummarySection title="Key points" icon={<ListChecks className="h-3.5 w-3.5" />}>
          <ul className="flex flex-col gap-1.5 text-sm">
            {summary.keyPoints.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                <span className="text-foreground/90">{p}</span>
              </li>
            ))}
          </ul>
        </SummarySection>
      )}

      {summary.nextSteps.length > 0 && (
        <SummarySection title="Next steps" icon={<Target className="h-3.5 w-3.5" />}>
          <ul className="flex flex-col gap-1.5 text-sm">
            {summary.nextSteps.map((step, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
              >
                <Badge
                  variant="outline"
                  className={cn(
                    "px-1.5 py-0 text-[10px] font-normal capitalize",
                    step.owner === "rep"
                      ? "border-primary/40 text-primary"
                      : step.owner === "customer"
                      ? "border-amber-500/40 text-amber-300"
                      : "border-border"
                  )}
                >
                  <User className="mr-1 h-2.5 w-2.5" />
                  {step.owner}
                </Badge>
                <span className="text-foreground/90">{step.action}</span>
                <span className="text-xs text-muted-foreground">
                  · {step.due}
                </span>
              </li>
            ))}
          </ul>
        </SummarySection>
      )}

      {meddicEntries.length > 0 && (
        <SummarySection title="MEDDIC updates" icon={<Target className="h-3.5 w-3.5" />}>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {meddicEntries.map(([key, value]) => (
              <div
                key={key}
                className="rounded-md border border-border/60 bg-card/50 px-2.5 py-1.5"
              >
                <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {formatMeddicKey(key)}
                </dt>
                <dd className="mt-0.5 text-xs text-foreground/90">{value}</dd>
              </div>
            ))}
          </dl>
        </SummarySection>
      )}

      {(summary.newObjections.length > 0 ||
        summary.riskSignals.length > 0 ||
        summary.decisions.length > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {summary.decisions.length > 0 && (
            <SummarySection
              title="Decisions"
              icon={<CircleCheck className="h-3.5 w-3.5" />}
            >
              <ul className="flex flex-col gap-1 text-xs text-foreground/90">
                {summary.decisions.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-400/70" />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </SummarySection>
          )}

          {summary.newObjections.length > 0 && (
            <SummarySection
              title="New objections"
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
            >
              <ul className="flex flex-col gap-1 text-xs text-foreground/90">
                {summary.newObjections.map((o, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400/70" />
                    <span>{o}</span>
                  </li>
                ))}
              </ul>
            </SummarySection>
          )}

          {summary.riskSignals.length > 0 && (
            <SummarySection
              title="Risk signals"
              icon={<ShieldAlert className="h-3.5 w-3.5" />}
            >
              <ul className="flex flex-col gap-1 text-xs text-foreground/90">
                {summary.riskSignals.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-destructive/70" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </SummarySection>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onCopy}
          className="h-8 gap-1.5"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy JSON
            </>
          )}
        </Button>
        <Button
          size="sm"
          onClick={onSendToCrm}
          disabled={crmSent}
          className="h-8 gap-1.5"
        >
          {crmSent ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Pushed to CRM
            </>
          ) : (
            <>
              <FileText className="h-3.5 w-3.5" />
              Send to CRM
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function SummarySection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}
