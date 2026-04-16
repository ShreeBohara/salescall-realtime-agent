"use client";

import { useState, useRef, useEffect } from "react";
import {
  RealtimeAgent,
  RealtimeSession,
  type RealtimeItem,
} from "@openai/agents-realtime";
import { saveNote } from "./lib/tools/saveNote";
import { createFollowUpTask } from "./lib/tools/createFollowUpTask";
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
import { cn } from "@/lib/utils";

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

function formatJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function Home() {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected">("idle");
  const [error, setError] = useState<string | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
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
          "Keep your responses short and conversational.",
          "Greet the user warmly when they connect.",
          "",
          "You have two tools available:",
          "",
          "1. `save_note` — use when the rep asks to capture, save, log, or record a note, takeaway, observation, or piece of information from the call.",
          "",
          "2. `create_follow_up_task` — use when the rep asks to set a reminder, schedule a follow-up, or create a task for later (e.g. \"remind me to call Acme on Friday\", \"schedule a follow-up with the CFO next week\"). Always capture the customer, the when, and a short description. Infer the channel (email/phone/calendar/other) from context, or use \"other\" if unclear.",
          "",
          "When you call either tool, give a brief spoken confirmation (e.g. \"Saved.\", \"Reminder set for Friday.\") so the rep knows it worked.",
          "Do not call tools unless the rep explicitly asked — don't save summaries or schedule things on your own initiative yet.",
        ].join("\n"),
        tools: [saveNote, createFollowUpTask],
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
                  <TranscriptLine key={m.id} message={m} />
                ))}
              </ol>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

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

  const statusVariant =
    call.status === "done"
      ? "default"
      : call.status === "error"
      ? "destructive"
      : "outline";
  const statusLabel =
    call.status === "running"
      ? "running…"
      : call.status === "done"
      ? "done"
      : "error";

  return (
    <li>
      <Card size="sm">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot status={call.status} />
            <span className="font-mono text-sm font-semibold">{call.name}</span>
            <Badge variant={statusVariant} className="ml-1">
              {statusLabel}
            </Badge>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {elapsedMs != null ? `${elapsedMs} ms` : "\u00A0"}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <JsonPane label="Arguments" value={call.args} />
            <JsonPane
              label="Result"
              value={
                call.status === "done"
                  ? call.parsedResult ?? call.result
                  : undefined
              }
              placeholder={call.status === "done" ? undefined : "waiting…"}
            />
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

function JsonPane({
  label,
  value,
  placeholder,
}: {
  label: string;
  value: unknown;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {value != null ? (
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-xs text-foreground">
          {formatJson(value)}
        </pre>
      ) : (
        <div className="rounded-md bg-muted/30 p-2 text-xs italic text-muted-foreground">
          {placeholder ?? "\u2014"}
        </div>
      )}
    </div>
  );
}

function TranscriptLine({ message }: { message: TranscriptMessage }) {
  const isUser = message.role === "user";
  const isStreaming = message.status === "in_progress";
  const label = isUser ? "You" : "Earshot";
  const labelClass = isUser ? "text-foreground" : "text-primary";
  const textClass = isStreaming ? "text-muted-foreground" : "text-foreground";
  const displayText =
    message.text.trim().length > 0
      ? message.text
      : isStreaming
      ? "\u2026"
      : "";

  return (
    <li className="text-sm leading-relaxed">
      <span className={cn("mr-2 font-semibold", labelClass)}>{label}:</span>
      <span className={textClass}>{displayText}</span>
      {isStreaming && (
        <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400 align-middle" />
      )}
    </li>
  );
}

function StatusDot({ status }: { status: ToolCallStatus }) {
  const colorClass =
    status === "running"
      ? "bg-amber-400 animate-pulse"
      : status === "done"
      ? "bg-emerald-400"
      : "bg-destructive";
  return (
    <span
      aria-label={status}
      className={cn("inline-block h-2 w-2 rounded-full", colorClass)}
    />
  );
}
