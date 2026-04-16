"use client";

import { useState, useRef, useEffect } from "react";
import {
  RealtimeAgent,
  RealtimeSession,
  type RealtimeItem,
} from "@openai/agents-realtime";
import { saveNote } from "./lib/tools/saveNote";
import { createFollowUpTask } from "./lib/tools/createFollowUpTask";

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
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
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
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 p-6 sm:p-8">
      <header className="flex flex-col items-center gap-2 pt-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Earshot</h1>
        <p className="text-sm text-gray-500">Voice-first sales copilot</p>
      </header>

      <section className="flex flex-col items-center gap-4">
        <div className="text-sm">
          Status:{" "}
          <span className="font-mono font-semibold">{status}</span>
        </div>

        {status === "idle" && (
          <button
            onClick={connect}
            className="rounded-full bg-black px-8 py-4 text-white hover:bg-gray-800"
          >
            Start talking
          </button>
        )}

        {status === "connecting" && (
          <button
            disabled
            className="rounded-full bg-gray-400 px-8 py-4 text-white"
          >
            Connecting...
          </button>
        )}

        {status === "connected" && (
          <button
            onClick={disconnect}
            className="rounded-full bg-red-500 px-8 py-4 text-white hover:bg-red-600"
          >
            End call
          </button>
        )}

        {error && <div className="text-sm text-red-500">Error: {error}</div>}

        <p className="max-w-md text-center text-xs text-gray-400">
          Click &quot;Start talking&quot; and allow microphone access. Try:{" "}
          <em>&quot;Save a note that Acme is interested in annual prepay&quot;</em> or{" "}
          <em>&quot;Remind me to email Acme&apos;s CFO on Friday about pricing.&quot;</em>
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
            Transcript
          </h2>
          {transcript.length > 0 && (
            <button
              onClick={clearTranscript}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear
            </button>
          )}
        </div>

        <div
          ref={transcriptRef}
          className="max-h-80 min-h-32 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4"
        >
          {transcript.length === 0 ? (
            <div className="flex h-full min-h-24 items-center justify-center text-center text-sm text-gray-400">
              {status === "connected"
                ? "Listening\u2026 say something."
                : "Start a call to see the live transcript."}
            </div>
          ) : (
            <ol className="flex flex-col gap-2">
              {transcript.map((m) => (
                <TranscriptLine key={m.id} message={m} />
              ))}
            </ol>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
            Agent actions
          </h2>
          {toolCalls.length > 0 && (
            <button
              onClick={clearToolCalls}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear
            </button>
          )}
        </div>

        {toolCalls.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
            No tool calls yet. Ask the agent to save a note.
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {toolCalls.map((call) => (
              <ToolCallCard key={call.id} call={call} />
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function ToolCallCard({ call }: { call: ToolCall }) {
  const elapsedMs =
    call.endedAt != null ? call.endedAt - call.startedAt : undefined;

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm">
      <div className="flex items-center gap-2">
        <StatusDot status={call.status} />
        <span className="font-mono text-sm font-semibold">{call.name}</span>
        <span className="ml-auto font-mono text-xs text-gray-400">
          {call.status === "running"
            ? "running…"
            : elapsedMs != null
            ? `${elapsedMs} ms`
            : call.status}
        </span>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Arguments
          </div>
          <pre className="overflow-x-auto rounded bg-gray-50 p-2 font-mono text-xs text-gray-800">
            {formatJson(call.args)}
          </pre>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Result
          </div>
          {call.status === "done" ? (
            <pre className="overflow-x-auto rounded bg-gray-50 p-2 font-mono text-xs text-gray-800">
              {formatJson(call.parsedResult ?? call.result)}
            </pre>
          ) : (
            <div className="rounded bg-gray-50 p-2 text-xs italic text-gray-400">
              waiting…
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function TranscriptLine({ message }: { message: TranscriptMessage }) {
  const isUser = message.role === "user";
  const isStreaming = message.status === "in_progress";
  const label = isUser ? "You" : "Earshot";
  const labelClass = isUser ? "text-gray-900" : "text-indigo-600";
  const textClass = isStreaming ? "text-gray-400" : "text-gray-800";
  const displayText =
    message.text.trim().length > 0
      ? message.text
      : isStreaming
      ? "\u2026"
      : "";

  return (
    <li className="text-sm leading-relaxed">
      <span className={`mr-2 font-semibold ${labelClass}`}>{label}:</span>
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
      ? "bg-emerald-500"
      : "bg-red-500";
  return (
    <span
      aria-label={status}
      className={`inline-block h-2.5 w-2.5 rounded-full ${colorClass}`}
    />
  );
}
