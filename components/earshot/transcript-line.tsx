import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ArrowRight, Pencil, RotateCcw } from "lucide-react";
import type { TranscriptMessage } from "@/app/lib/types";

/**
 * One line in the live transcript.
 *
 * Does three jobs for the trust/correction bundle (A3):
 *   1. Dim-to-solid streaming: interim turns render in muted text;
 *      finalized turns in solid.
 *   2. Editable user lines: hover → pencil, click → contenteditable,
 *      Enter saves / Esc cancels / blur saves. "edited" chip + undo
 *      control if the rep has overridden the ASR text.
 *   3. Divergence chips: when the agent's tool-arg `customer` doesn't
 *      match the line's effective text, render an amber chip that
 *      pops a clickable explainer showing both repair paths.
 *
 * Edit state is owned by the parent (Home) so edits survive across
 * re-renders of the transcript list.
 */
export function TranscriptLine({
  message,
  editedText,
  isEditing,
  divergences,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onUndoEdit,
}: {
  message: TranscriptMessage;
  editedText?: string;
  isEditing: boolean;
  divergences: string[];
  onStartEdit: () => void;
  onSaveEdit: (newText: string) => void;
  onCancelEdit: () => void;
  onUndoEdit: () => void;
}) {
  const isUser = message.role === "user";
  const isStreaming = message.status === "in_progress";
  const label = isUser ? "You" : "Earshot";
  const labelClass = isUser ? "text-foreground" : "text-primary";
  const textClass = isStreaming ? "text-muted-foreground" : "text-foreground";
  const effectiveText = editedText ?? message.text;
  const isEdited = editedText != null;
  const canEdit = isUser && !isStreaming && effectiveText.trim().length > 0;

  if (isEditing && isUser) {
    return (
      <li className="text-sm leading-relaxed">
        <span className={cn("mr-2 font-semibold", labelClass)}>{label}:</span>
        <input
          autoFocus
          defaultValue={effectiveText}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSaveEdit((e.target as HTMLInputElement).value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancelEdit();
            }
          }}
          onBlur={(e) => onSaveEdit(e.target.value)}
          aria-label="Edit transcript line"
          className="inline-block w-[min(32rem,85%)] rounded border border-border bg-background px-2 py-0.5 text-sm outline-none focus:border-primary"
        />
      </li>
    );
  }

  const placeholderText =
    effectiveText.trim().length > 0
      ? effectiveText
      : isStreaming
      ? "\u2026"
      : "";

  return (
    <li className="group flex items-start gap-2 text-sm leading-relaxed">
      <div className="flex-1">
        <span className={cn("mr-2 font-semibold", labelClass)}>{label}:</span>
        <span className={textClass}>{placeholderText}</span>
        {isStreaming && (
          <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400 align-middle" />
        )}
        {isEdited && (
          <>
            <Badge
              variant="outline"
              className="ml-2 px-1.5 py-0 text-[10px] font-normal"
            >
              edited
            </Badge>
            <button
              type="button"
              onClick={onUndoEdit}
              aria-label="Undo edit"
              className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          </>
        )}
        {divergences.map((toolCustomer) => (
          <Popover key={toolCustomer}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Transcript disagrees with tool arg "${toolCustomer}" — click for details`}
                className="ml-2 inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-400/60 bg-amber-400/10 px-1.5 py-0 text-[10px] font-normal text-amber-200 hover:bg-amber-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
              >
                <ArrowRight className="h-2.5 w-2.5" />
                {toolCustomer}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 text-xs">
              <PopoverHeader>
                <PopoverTitle className="text-sm">
                  Transcript &amp; tool don&apos;t match
                </PopoverTitle>
                <PopoverDescription>
                  The tool captured customer as{" "}
                  <span className="font-mono font-semibold text-amber-200">
                    {toolCustomer}
                  </span>
                  , but this transcript line says something different.
                </PopoverDescription>
              </PopoverHeader>
              <div className="flex flex-col gap-1.5 text-muted-foreground">
                <div>
                  <span className="font-semibold text-foreground">
                    If the transcript was mis-heard
                  </span>{" "}
                  (tool got it right): click the pencil icon on this line and
                  edit the text to match.
                </div>
                <div>
                  <span className="font-semibold text-foreground">
                    If the tool got it wrong
                  </span>{" "}
                  (transcript is right): say out loud{" "}
                  <em>
                    &ldquo;actually that was &lt;name&gt;, not {toolCustomer}
                    &rdquo;
                  </em>{" "}
                  — the agent will fix the record.
                </div>
                <div className="pt-1 text-[10px] text-muted-foreground/70">
                  Either way, the chip disappears when both sides agree.
                </div>
              </div>
            </PopoverContent>
          </Popover>
        ))}
      </div>
      {canEdit && !isEdited && (
        <button
          type="button"
          onClick={onStartEdit}
          aria-label="Edit transcript line"
          className="invisible mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground group-hover:visible"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </li>
  );
}
