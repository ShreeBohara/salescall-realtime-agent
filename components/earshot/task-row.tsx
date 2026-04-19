import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Calendar, CircleCheck, CircleX, Mail, MessageSquare, Phone } from "lucide-react";
import type { FollowUpTask } from "@/app/lib/store/taskStore";

/**
 * Single row in the "Follow-up tasks" active panel. Visually mirrors
 * NoteRow so the two live panels feel like siblings. Strikethrough +
 * opacity on cancelled tasks makes the soft-cancel audit trail visible
 * without hiding it entirely.
 */
export function TaskRow({ task }: { task: FollowUpTask }) {
  const isCancelled = task.status === "cancelled";
  const isUpdated = task.updatedAt !== task.createdAt;

  const ChannelIcon =
    task.channel === "email"
      ? Mail
      : task.channel === "phone"
      ? Phone
      : task.channel === "calendar"
      ? Calendar
      : MessageSquare;

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-md border border-border/60 bg-card/50 px-3 py-2 text-sm",
        isCancelled && "opacity-50"
      )}
    >
      <div className="mt-0.5 flex h-5 w-5 items-center justify-center text-muted-foreground">
        {isCancelled ? (
          <CircleX className="h-4 w-4 text-destructive/70" />
        ) : (
          <CircleCheck className="h-4 w-4 text-emerald-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 font-medium",
            isCancelled && "line-through"
          )}
        >
          <span className="truncate">{task.customer}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{task.due_at}</span>
          <ChannelIcon
            className="h-3 w-3 text-muted-foreground"
            aria-label={task.channel}
          />
        </div>
        <p
          className={cn(
            "mt-0.5 text-xs text-muted-foreground line-clamp-2",
            isCancelled && "line-through"
          )}
        >
          {task.body}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {isCancelled ? (
          <Badge variant="outline" className="text-[10px] font-normal">
            cancelled
          </Badge>
        ) : isUpdated ? (
          <Badge variant="secondary" className="text-[10px] font-normal">
            updated
          </Badge>
        ) : null}
      </div>
    </li>
  );
}
