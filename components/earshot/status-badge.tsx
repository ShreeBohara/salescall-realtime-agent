import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VoiceStatus } from "@/app/lib/types";

export function StatusBadge({ status }: { status: VoiceStatus }) {
  const variant =
    status === "connected"
      ? "default"
      : status === "connecting"
      ? "outline"
      : "secondary";
  const dotClass =
    status === "connected"
      ? "bg-emerald-400 animate-pulse"
      : status === "connecting"
      ? "bg-amber-400 animate-pulse"
      : "bg-muted-foreground/60";

  return (
    <Badge variant={variant} className="gap-2 px-3 py-1 font-mono text-xs">
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", dotClass)} />
      {status}
    </Badge>
  );
}
