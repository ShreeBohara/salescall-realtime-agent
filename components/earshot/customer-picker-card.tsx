import { Building2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CUSTOMERS, type Customer } from "@/app/lib/data/customers";

/**
 * Customer selector + "Brief me" button at the top of the voice page.
 *
 * Locked while a call is active (`connected`) because the system
 * prompt is baked at connect time — switching customer mid-call would
 * silently lie to the agent. "Brief me" fires a synthetic user message
 * at the live agent asking for a ~20-second spoken brief.
 */
export function CustomerPickerCard({
  selectedId,
  customer,
  connected,
  fullyConnected,
  agentBusy,
  onChange,
  onBriefMe,
}: {
  selectedId: string;
  customer: Customer | null;
  connected: boolean;
  fullyConnected: boolean;
  agentBusy: boolean;
  onChange: (id: string) => void;
  onBriefMe: () => void;
}) {
  const stageTone =
    customer?.dealStage === "negotiation"
      ? "text-amber-300"
      : customer?.dealStage === "proposal"
      ? "text-sky-300"
      : customer?.dealStage === "qualification"
      ? "text-indigo-300"
      : customer?.dealStage === "closed-won"
      ? "text-emerald-300"
      : customer?.dealStage === "closed-lost"
      ? "text-destructive"
      : "text-muted-foreground";

  const briefDisabled = !fullyConnected || !customer || agentBusy;
  const briefTooltip = !fullyConnected
    ? "Start the call first"
    : !customer
    ? "Pick a customer first"
    : agentBusy
    ? "Agent is speaking…"
    : `Hear a quick brief on ${customer.name}`;

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-3 pt-5 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Calling
              </span>
              <Select
                value={selectedId}
                onValueChange={onChange}
                disabled={connected}
              >
                <SelectTrigger
                  size="sm"
                  className="h-8 min-w-[14rem] border-border/70 bg-card/50 font-medium"
                  aria-label="Select customer"
                >
                  <SelectValue placeholder="Pick a customer" />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOMERS.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {customer ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="truncate">
                  {customer.contact.name} · {customer.contact.title}
                </span>
                <span className="text-border">·</span>
                <span className={cn("font-medium", stageTone)}>
                  {customer.dealStage}
                </span>
                <span className="text-border">·</span>
                <span>{customer.dealSize}</span>
                {customer.openTickets > 0 && (
                  <>
                    <span className="text-border">·</span>
                    <span className="text-amber-300/80">
                      {customer.openTickets} open ticket
                      {customer.openTickets === 1 ? "" : "s"}
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                No customer selected
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-stretch sm:self-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={onBriefMe}
            disabled={briefDisabled}
            title={briefTooltip}
            className={cn(
              "h-9 flex-1 gap-1.5 border-border/70 sm:flex-initial",
              !briefDisabled && "text-primary hover:text-primary"
            )}
            aria-label={briefTooltip}
          >
            <Sparkles
              className={cn(
                "h-3.5 w-3.5",
                !briefDisabled && "text-primary"
              )}
            />
            Brief me
          </Button>
          {connected && !fullyConnected && (
            <span className="hidden text-[10px] text-muted-foreground sm:inline">
              connecting…
            </span>
          )}
          {fullyConnected && (
            <span className="hidden text-[10px] text-muted-foreground sm:inline">
              hang up to switch
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
