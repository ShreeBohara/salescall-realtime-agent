"use client";

import { useState, useRef, useEffect, useSyncExternalStore } from "react";
import {
  RealtimeAgent,
  RealtimeSession,
  type RealtimeItem,
} from "@openai/agents-realtime";
import { saveNote } from "./lib/tools/saveNote";
import { updateNote } from "./lib/tools/updateNote";
import { deleteNote } from "./lib/tools/deleteNote";
import { createFollowUpTask } from "./lib/tools/createFollowUpTask";
import { updateFollowUpTask } from "./lib/tools/updateFollowUpTask";
import { cancelFollowUpTask } from "./lib/tools/cancelFollowUpTask";
import {
  subscribeToTasks,
  getTasksSnapshot,
  clearAllTasks,
  type FollowUpTask,
} from "./lib/store/taskStore";
import {
  subscribeToNotes,
  getNotesSnapshot,
  clearAllNotes,
  type Note,
} from "./lib/store/noteStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from "@/components/ai-elements/tool";
import { cn } from "@/lib/utils";
import { Pencil, RotateCcw, CircleCheck, CircleX, Mail, Phone, Calendar, MessageSquare, StickyNote, Trash2 } from "lucide-react";

type ToolCallStatus = "running" | "done" | "error";

type ToolCall = {
  id: string;
  name: string;
  args: unknown;
  rawArgs: string;
  status: ToolCallStatus;
  result?: string;
  parsedResult?: unknown;
  startedAt: number;
  endedAt?: number;
};

type TranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "in_progress" | "completed" | "incomplete";
};

function historyToTranscript(history: RealtimeItem[]): TranscriptMessage[] {
  const out: TranscriptMessage[] = [];
  for (const item of history) {
    if (item.type !== "message") continue;
    if (item.role !== "user" && item.role !== "assistant") continue;

    let text = "";
    for (const chunk of item.content) {
      if (chunk.type === "input_text" || chunk.type === "output_text") {
        text += chunk.text;
      } else if (
        chunk.type === "input_audio" ||
        chunk.type === "output_audio"
      ) {
        text += chunk.transcript ?? "";
      }
    }

    out.push({
      id: item.itemId,
      role: item.role,
      text,
      status: item.status,
    });
  }
  return out;
}

function safeParseJson(raw: string): { parsed: unknown; ok: boolean } {
  try {
    return { parsed: JSON.parse(raw), ok: true };
  } catch {
    return { parsed: raw, ok: false };
  }
}

function toolStateFromStatus(status: ToolCallStatus): ToolPart["state"] {
  if (status === "done") return "output-available";
  if (status === "error") return "output-error";
  return "input-available";
}

export default function Home() {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected">("idle");
  const [error, setError] = useState<string | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const tasks = useSyncExternalStore(
    subscribeToTasks,
    getTasksSnapshot,
    getTasksSnapshot
  );
  const notes = useSyncExternalStore(
    subscribeToNotes,
    getNotesSnapshot,
    getNotesSnapshot
  );
  const sessionRef = useRef<RealtimeSession | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = transcriptScrollRef.current;
    if (!el) return;
    const viewport = el.querySelector<HTMLDivElement>(
      "[data-slot=scroll-area-viewport]"
    );
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [transcript]);

  async function connect() {
    try {
      setStatus("connecting");
      setError(null);

      const tokenRes = await fetch("/api/session", { method: "POST" });
      if (!tokenRes.ok) throw new Error("Failed to get token");
      const tokenData = await tokenRes.json();
      const ephemeralKey = tokenData.value;

      const agent = new RealtimeAgent({
        name: "Earshot",
        instructions: [
          "You are Earshot, a friendly sales copilot for a sales rep.",
          "Always respond in English, regardless of what you think you hear. If the user explicitly asks you to switch languages, acknowledge briefly in English and then switch.",
          "Keep your responses short and conversational.",
          "Greet the user warmly when they connect.",
          "",
          "You have six tools available, grouped into two lifecycles:",
          "",
          "NOTES (save / update / delete)",
          "1. `save_note` — use when the rep asks to capture, save, log, or record a note, takeaway, observation, or piece of information from the call.",
          "2. `update_note` — use when the rep REVISES a previously-saved note: corrections (\"actually the note should say X\"), clarifications, or ADDITIONS (\"also add that they mentioned competitor pricing\"). DO NOT call save_note again when the rep is revising — that would create a duplicate. When the rep is ADDING information, concatenate the existing body with the new thought and pass the FULL combined body, not just the addition. Provide the note_id from the original save result.",
          "3. `delete_note` — use when the rep asks to scratch, delete, or discard a previously-saved note. Provide the note_id.",
          "",
          "TASKS (create / update / cancel)",
          "4. `create_follow_up_task` — use when the rep asks to set a NEW reminder, schedule a follow-up, or create a task for later (e.g. \"remind me to call Acme on Friday\"). Capture the customer, the when, and a short description. Infer the channel (email/phone/calendar/other) from context, or use \"other\" if unclear.",
          "5. `update_follow_up_task` — use when the rep asks to MODIFY a previously-created task (e.g. \"change that to Thursday\", \"make it a phone call instead\"). DO NOT call create_follow_up_task again when the rep is modifying — that would create a duplicate. Provide the task_id; for fields that should not change, pass \"unchanged\" (for channel) or null (for due_at and body).",
          "6. `cancel_follow_up_task` — use when the rep asks to CANCEL, DELETE, or REMOVE a previously-created task. Provide the task_id.",
          "",
          "Rules for note and task lifecycle:",
          "- Remember the note_id and task_id returned from each save/create result — you will need them for updates and cancels/deletes.",
          "- If the rep corrects themselves or adds to something within the same turn or shortly after, prefer update/cancel/delete over creating a new one. Ask briefly for clarification only if you genuinely cannot tell which note or task they mean.",
          "- Notes and tasks are two separate concepts. \"Note\" = a piece of information captured for later reference. \"Task\" = a specific thing to do at a specific time. Use your judgment about which fits the rep's intent.",
          "",
          "When you call any tool, give a brief spoken confirmation (e.g. \"Saved.\", \"Updated the note.\", \"Reminder set for Friday.\", \"Cancelled.\", \"Got it, deleted.\") so the rep knows it worked.",
          "Do not call tools unless the rep explicitly asked — don't save summaries or schedule things on your own initiative.",
        ].join("\n"),
        tools: [
          saveNote,
          updateNote,
          deleteNote,
          createFollowUpTask,
          updateFollowUpTask,
          cancelFollowUpTask,
        ],
      });

      const session = new RealtimeSession(agent, {
        model: "gpt-realtime",
      });

      session.on("agent_tool_start", (_ctx, _agent, tool, details) => {
        const tc = details.toolCall;
        const rawArgs =
          tc.type === "function_call" && typeof tc.arguments === "string"
            ? tc.arguments
            : "";
        const { parsed } = safeParseJson(rawArgs);
        const callId =
          tc.type === "function_call" ? tc.callId : tc.id ?? `${tool.name}_${Date.now()}`;

        console.log("[agent_tool_start]", { tool: tool.name, toolCall: tc });

        setToolCalls((prev) => [
          ...prev,
          {
            id: callId,
            name: tool.name,
            args: parsed,
            rawArgs,
            status: "running",
            startedAt: Date.now(),
          },
        ]);
      });

      session.on("agent_tool_end", (_ctx, _agent, tool, result, details) => {
        const tc = details.toolCall;
        const callId =
          tc.type === "function_call" ? tc.callId : tc.id ?? `${tool.name}_end`;
        const { parsed } = safeParseJson(result);

        console.log("[agent_tool_end]", { tool: tool.name, result, toolCall: tc });

        setToolCalls((prev) =>
          prev.map((c) =>
            c.id === callId
              ? {
                  ...c,
                  status: "done",
                  result,
                  parsedResult: parsed,
                  endedAt: Date.now(),
                }
              : c
          )
        );
      });

      session.on("history_updated", (history) => {
        setTranscript(historyToTranscript(history));
      });

      await session.connect({ apiKey: ephemeralKey });
      sessionRef.current = session;
      setStatus("connected");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("idle");
    }
  }

  async function disconnect() {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    setStatus("idle");
  }

  function clearToolCalls() {
    setToolCalls([]);
  }

  function clearTranscript() {
    setTranscript([]);
    setEdits({});
    setEditingId(null);
  }

  function startEdit(id: string) {
    setEditingId(id);
  }

  function saveEdit(id: string, originalText: string, newText: string) {
    const trimmed = newText.trim();
    setEdits((prev) => {
      const next = { ...prev };
      if (trimmed.length === 0 || trimmed === originalText.trim()) {
        delete next[id];
      } else {
        next[id] = trimmed;
      }
      return next;
    });
    setEditingId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function undoEdit(id: string) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col items-center gap-2 pt-6 text-center">
        <h1 className="font-heading text-4xl font-semibold tracking-tight">
          Earshot
        </h1>
        <p className="text-sm text-muted-foreground">
          Voice-first sales copilot
        </p>
      </header>

      <section className="flex flex-col items-center gap-4">
        <StatusBadge status={status} />

        {status === "idle" && (
          <Button size="lg" onClick={connect} className="h-12 rounded-full px-8">
            Start talking
          </Button>
        )}

        {status === "connecting" && (
          <Button
            size="lg"
            variant="outline"
            disabled
            className="h-12 rounded-full px-8"
          >
            Connecting…
          </Button>
        )}

        {status === "connected" && (
          <Button
            size="lg"
            variant="destructive"
            onClick={disconnect}
            className="h-12 rounded-full px-8"
          >
            End call
          </Button>
        )}

        {error && (
          <div className="text-xs text-destructive">Error: {error}</div>
        )}

        <p className="max-w-md text-center text-xs text-muted-foreground">
          Click &quot;Start talking&quot; and allow microphone access. Try:{" "}
          <em>&quot;Save a note that Acme is interested in annual prepay&quot;</em>{" "}
          or{" "}
          <em>
            &quot;Remind me to email Acme&apos;s CFO on Friday about pricing.&quot;
          </em>
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Transcript
          </CardTitle>
          {transcript.length > 0 && (
            <CardAction>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearTranscript}
                className="text-muted-foreground"
              >
                Clear
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <ScrollArea ref={transcriptScrollRef} className="h-72">
            {transcript.length === 0 ? (
              <div className="flex h-full min-h-40 items-center justify-center text-center text-sm text-muted-foreground">
                {status === "connected"
                  ? "Listening… say something."
                  : "Start a call to see the live transcript."}
              </div>
            ) : (
              <ol className="flex flex-col gap-2 pr-3">
                {transcript.map((m) => (
                  <TranscriptLine
                    key={m.id}
                    message={m}
                    editedText={edits[m.id]}
                    isEditing={editingId === m.id}
                    onStartEdit={() => startEdit(m.id)}
                    onSaveEdit={(newText) => saveEdit(m.id, m.text, newText)}
                    onCancelEdit={cancelEdit}
                    onUndoEdit={() => undoEdit(m.id)}
                  />
                ))}
              </ol>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {tasks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Follow-up tasks
            </CardTitle>
            <CardAction>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllTasks}
                className="text-muted-foreground"
              >
                Clear
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2">
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {notes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Saved notes
            </CardTitle>
            <CardAction>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllNotes}
                className="text-muted-foreground"
              >
                Clear
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2">
              {notes.map((note) => (
                <NoteRow key={note.id} note={note} />
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Agent actions
          </CardTitle>
          {toolCalls.length > 0 && (
            <CardAction>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearToolCalls}
                className="text-muted-foreground"
              >
                Clear
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {toolCalls.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No tool calls yet. Ask the agent to save a note or set a reminder.
            </div>
          ) : (
            <ol className="flex flex-col gap-3">
              {toolCalls.map((call) => (
                <ToolCallCard key={call.id} call={call} />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function TaskRow({ task }: { task: FollowUpTask }) {
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
          <ChannelIcon className="h-3 w-3 text-muted-foreground" aria-label={task.channel} />
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

function NoteRow({ note }: { note: Note }) {
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

function StatusBadge({
  status,
}: {
  status: "idle" | "connecting" | "connected";
}) {
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

function ToolCallCard({ call }: { call: ToolCall }) {
  const elapsedMs =
    call.endedAt != null ? call.endedAt - call.startedAt : undefined;

  const state = toolStateFromStatus(call.status);

  const output =
    call.status === "done" ? call.parsedResult ?? call.result : undefined;
  const errorText =
    call.status === "error" ? call.result ?? "Tool error" : undefined;

  return (
    <li>
      <Tool defaultOpen className="mb-0 bg-card">
        <ToolHeader type="dynamic-tool" toolName={call.name} state={state} />
        <ToolContent>
          <ToolInput input={call.args} />
          <ToolOutput output={output as never} errorText={errorText} />
          {elapsedMs != null && (
            <div className="text-right font-mono text-[10px] text-muted-foreground">
              {elapsedMs} ms
            </div>
          )}
        </ToolContent>
      </Tool>
    </li>
  );
}

function TranscriptLine({
  message,
  editedText,
  isEditing,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onUndoEdit,
}: {
  message: TranscriptMessage;
  editedText?: string;
  isEditing: boolean;
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

