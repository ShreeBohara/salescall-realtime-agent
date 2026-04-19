import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { StickyNote, Trash2 } from "lucide-react";
import type { Note } from "@/app/lib/store/noteStore";

/**
 * Single row in the "Saved notes" active panel. Soft-deleted notes
 * render with strikethrough + reduced opacity — preserving the audit
 * trail rather than hiding the deletion.
 */
export function NoteRow({ note }: { note: Note }) {
  const isDeleted = note.status === "deleted";
  const isUpdated = note.updatedAt !== note.createdAt;

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-md border border-border/60 bg-card/50 px-3 py-2 text-sm",
        isDeleted && "opacity-50"
      )}
    >
      <div className="mt-0.5 flex h-5 w-5 items-center justify-center text-muted-foreground">
        {isDeleted ? (
          <Trash2 className="h-4 w-4 text-destructive/70" />
        ) : (
          <StickyNote className="h-4 w-4 text-amber-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 font-medium",
            isDeleted && "line-through"
          )}
        >
          <span className="truncate">{note.customer}</span>
        </div>
        <p
          className={cn(
            "mt-0.5 text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap",
            isDeleted && "line-through"
          )}
        >
          {note.body}
        </p>
        {note.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {note.tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className={cn(
                  "px-1.5 py-0 text-[10px] font-normal",
                  isDeleted && "line-through"
                )}
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {isDeleted ? (
          <Badge variant="outline" className="text-[10px] font-normal">
            deleted
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
