"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  RealtimeSession,
} from "@openai/agents-realtime";
import { AlertTriangle } from "lucide-react";

import { saveNote } from "./lib/tools/saveNote";
import { updateNote } from "./lib/tools/updateNote";
import { deleteNote } from "./lib/tools/deleteNote";
import { createFollowUpTask } from "./lib/tools/createFollowUpTask";
import { updateFollowUpTask } from "./lib/tools/updateFollowUpTask";
import { cancelFollowUpTask } from "./lib/tools/cancelFollowUpTask";
import { getCustomerContext } from "./lib/tools/getCustomerContext";
import {
  clearAllTasks,
  getTasksSnapshot,
  subscribeToTasks,
} from "./lib/store/taskStore";
import {
  clearAllNotes,
  getNotesSnapshot,
  subscribeToNotes,
} from "./lib/store/noteStore";
import {
  getSelectedCustomerId,
  setSelectedCustomerId,
  subscribeToSelectedCustomer,
} from "./lib/store/customerStore";
import { getCustomerById } from "./lib/data/customers";
import {
  buildAgentInstructions,
  buildBriefMePrompt,
  showToolCompletionToast,
} from "./lib/agent";
import {
  formatSecondsCountdown,
  hasCustomerDivergence,
  historyToTranscript,
  safeParseJson,
} from "./lib/helpers";
import type {
  CallSummary,
  ErrorKind,
  SummarizeRequestPayload,
  SummaryState,
  ToolCall,
  TranscriptMessage,
  VoiceStatus,
} from "./lib/types";

import { useConsent } from "./hooks/use-consent";
import { useMicAmplitude } from "./hooks/use-mic-amplitude";
import { useSessionCap } from "./hooks/use-session-cap";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VoiceOrb, type VoiceOrbPhase } from "@/components/voice-orb";
import { ConsentDialog } from "@/components/earshot/consent-dialog";
import { CustomerPickerCard } from "@/components/earshot/customer-picker-card";
import { NoteRow } from "@/components/earshot/note-row";
import { PostCallSummaryCard } from "@/components/earshot/post-call-summary-card";
import { StatusBadge } from "@/components/earshot/status-badge";
import { TaskRow } from "@/components/earshot/task-row";
import { ToolCallCard } from "@/components/earshot/tool-call-card";
import { TranscriptLine } from "@/components/earshot/transcript-line";

/**
 * Voice page orchestration root.
 *
 * This component is intentionally kept thin: it holds session-lifetime
 * state (`status`, `transcript`, `toolCalls`, `summary`, `edits`),
 * wires the `RealtimeSession` + event handlers, and composes feature
 * components. All rendering logic, trust/correction UI, and side
 * effects live in child components and hooks — see `components/earshot/`
 * and `app/hooks/`.
 */
export default function Home() {
  // Session + error
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind>("none");
  const [connectedAt, setConnectedAt] = useState<number | null>(null);

  // Conversation data
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryState>({ phase: "idle" });

  // Store-backed state (module-level shared)
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
  const selectedCustomerId = useSyncExternalStore(
    subscribeToSelectedCustomer,
    getSelectedCustomerId,
    getSelectedCustomerId
  );
  const selectedCustomer = getCustomerById(selectedCustomerId);

  // Hooks — side effects + subsystem state
  const { open: consentOpen, accept: acceptConsent } = useConsent();
  const micAmplitude = useMicAmplitude(status === "connected");
  const sessionRemainingMs = useSessionCap({
    active: status === "connected",
    connectedAt,
    onAutoEnd: () => disconnect(),
  });

  // Refs
  const sessionRef = useRef<RealtimeSession | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const latestUserItemRef = useRef<{ id: string; text: string } | null>(null);

  // Auto-scroll transcript on new turns
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

  /**
   * Derived view state:
   *   - isAgentResponding drives the orb's "speaking" phase and the
   *     Brief me disabled state.
   *   - orbPhase picks the single visual state the orb should show,
   *     with explicit precedence: connecting > thinking > speaking >
   *     listening > idle.
   */
  const isAgentResponding = transcript.some(
    (m) => m.role === "assistant" && m.status === "in_progress"
  );

  const orbPhase: VoiceOrbPhase =
    status === "idle"
      ? "idle"
      : status === "connecting"
      ? "connecting"
      : toolCalls.some((c) => c.status === "running")
      ? "thinking"
      : isAgentResponding
      ? "speaking"
      : "listening";

  const orbLabel: string =
    orbPhase === "idle"
      ? "ready"
      : orbPhase === "connecting"
      ? "connecting…"
      : orbPhase === "thinking"
      ? "working…"
      : orbPhase === "speaking"
      ? "speaking"
      : "listening";

  // ---- Session lifecycle ------------------------------------------

  async function connect() {
    try {
      setStatus("connecting");
      setError(null);
      setErrorKind("none");
      setSummary({ phase: "idle" });

      const tokenRes = await fetch("/api/session", { method: "POST" });
      if (!tokenRes.ok) throw new Error("Failed to get token");
      const tokenData = await tokenRes.json();
      const ephemeralKey = tokenData.value;

      const customerAtConnectTime = getCustomerById(getSelectedCustomerId());
      const agent = new RealtimeAgent({
        name: "Earshot",
        instructions: buildAgentInstructions(customerAtConnectTime),
        tools: [
          getCustomerContext,
          saveNote,
          updateNote,
          deleteNote,
          createFollowUpTask,
          updateFollowUpTask,
          cancelFollowUpTask,
        ],
      });

      // Own our own transport so we can call `requestResponse()` after
      // connect. `gpt-realtime` doesn't speak proactively on connect —
      // it waits for user input or an explicit `response.create`. We
      // trigger one so the agent delivers the greeting the system
      // prompt asks for (and acknowledges which customer the rep is
      // calling) the moment the WebRTC handshake completes.
      const transport = new OpenAIRealtimeWebRTC();
      const session = new RealtimeSession(agent, {
        model: "gpt-realtime",
        transport,
      });

      session.on("agent_tool_start", (_ctx, _agent, tool, details) => {
        const tc = details.toolCall;
        const rawArgs =
          tc.type === "function_call" && typeof tc.arguments === "string"
            ? tc.arguments
            : "";
        const { parsed } = safeParseJson(rawArgs);
        const callId =
          tc.type === "function_call"
            ? tc.callId
            : tc.id ?? `${tool.name}_${Date.now()}`;

        const triggeringUserItem = latestUserItemRef.current;

        console.log("[agent_tool_start]", {
          tool: tool.name,
          toolCall: tc,
          triggeredBy: triggeringUserItem,
        });

        setToolCalls((prev) => [
          ...prev,
          {
            id: callId,
            name: tool.name,
            args: parsed,
            rawArgs,
            status: "running",
            startedAt: Date.now(),
            sourceItemId: triggeringUserItem?.id,
            sourceItemText: triggeringUserItem?.text,
          },
        ]);
      });

      session.on("agent_tool_end", (_ctx, _agent, tool, result, details) => {
        const tc = details.toolCall;
        const callId =
          tc.type === "function_call"
            ? tc.callId
            : tc.id ?? `${tool.name}_end`;
        const { parsed } = safeParseJson(result);

        console.log("[agent_tool_end]", {
          tool: tool.name,
          result,
          toolCall: tc,
        });

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

        showToolCompletionToast(tool.name, parsed);
      });

      session.on("history_updated", (history) => {
        const next = historyToTranscript(history);
        setTranscript(next);

        // Track the most recent user turn so new tool-starts can link
        // back to it for the divergence chip.
        for (let i = next.length - 1; i >= 0; i--) {
          const m = next[i];
          if (m.role === "user" && m.text.trim().length > 0) {
            latestUserItemRef.current = { id: m.id, text: m.text };
            break;
          }
        }
      });

      await session.connect({ apiKey: ephemeralKey });
      sessionRef.current = session;
      setConnectedAt(Date.now());
      setStatus("connected");

      // Trigger the greeting turn. Without this, gpt-realtime stays
      // silent until the rep speaks first.
      transport.requestResponse?.();
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Unknown error";
      const name = err instanceof Error ? err.name : "";
      if (
        name === "NotAllowedError" ||
        name === "NotFoundError" ||
        /permission|denied|getUserMedia/i.test(message)
      ) {
        setErrorKind("mic_denied");
        setError("Microphone access was blocked.");
      } else if (/fetch|token|network|failed to/i.test(message)) {
        setErrorKind("network");
        setError("Couldn't reach the voice server.");
      } else {
        setErrorKind("unknown");
        setError(message);
      }
      setStatus("idle");
    }
  }

  async function disconnect() {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    setStatus("idle");
    setConnectedAt(null);

    const customerAtEnd = getCustomerById(getSelectedCustomerId());
    const transcriptAtEnd = transcript
      .filter((m) => m.text.trim().length > 0)
      .map((m) => ({
        role: m.role,
        text: edits[m.id] ?? m.text,
      }));
    const toolCallsAtEnd = toolCalls.map((c) => ({
      name: c.name,
      args: c.args,
      result: c.result,
    }));

    const hasUserTurn = transcriptAtEnd.some((m) => m.role === "user");
    const hasAssistantTurn = transcriptAtEnd.some(
      (m) => m.role === "assistant"
    );

    if (!hasUserTurn || !hasAssistantTurn) {
      setSummary({
        phase: "empty",
        forCustomer: customerAtEnd?.name ?? null,
      });
      return;
    }

    const payload: SummarizeRequestPayload = {
      customer: customerAtEnd
        ? {
            name: customerAtEnd.name,
            industry: customerAtEnd.industry,
            dealStage: customerAtEnd.dealStage,
            dealSize: customerAtEnd.dealSize,
            champion: customerAtEnd.meddic.champion,
            pastObjections: customerAtEnd.pastObjections,
          }
        : null,
      transcript: transcriptAtEnd,
      toolCalls: toolCallsAtEnd,
    };

    requestSummary(payload);
  }

  async function requestSummary(payload: SummarizeRequestPayload) {
    setSummary({
      phase: "loading",
      startedAt: Date.now(),
      forCustomer: payload.customer?.name ?? null,
    });

    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as
        | { ok: true; summary: CallSummary }
        | { ok: false; error: string };

      if (!data.ok) {
        if (data.error === "empty_transcript") {
          setSummary({
            phase: "empty",
            forCustomer: payload.customer?.name ?? null,
          });
          return;
        }
        setSummary({
          phase: "error",
          error: data.error,
          retryPayload: payload,
          forCustomer: payload.customer?.name ?? null,
        });
        return;
      }

      setSummary({
        phase: "ready",
        summary: data.summary,
        forCustomer: payload.customer?.name ?? null,
        endedAt: Date.now(),
      });
    } catch (err) {
      console.error("[requestSummary] failed", err);
      setSummary({
        phase: "error",
        error: err instanceof Error ? err.message : "network_error",
        retryPayload: payload,
        forCustomer: payload.customer?.name ?? null,
      });
    }
  }

  // ---- Handlers -------------------------------------------------

  function handleBriefMe() {
    const session = sessionRef.current;
    if (!session) return;
    if (status !== "connected") return;
    if (!selectedCustomer) return;
    if (isAgentResponding) return;

    session.sendMessage(buildBriefMePrompt(selectedCustomer.name));
  }

  function dismissSummary() {
    setSummary({ phase: "idle" });
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

  // ---- Render ----------------------------------------------------

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 p-4 sm:gap-6 sm:p-8">
      <header className="flex flex-col items-center gap-1.5 pt-2 text-center sm:gap-2 sm:pt-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
          Earshot
        </h1>
        <p className="text-xs text-muted-foreground sm:text-sm">
          Voice-first sales copilot
        </p>
      </header>

      <CustomerPickerCard
        selectedId={selectedCustomerId}
        customer={selectedCustomer}
        connected={status !== "idle"}
        fullyConnected={status === "connected"}
        agentBusy={isAgentResponding}
        onChange={(id) => setSelectedCustomerId(id)}
        onBriefMe={handleBriefMe}
      />

      <section className="flex flex-col items-center gap-4">
        <div className="flex flex-col items-center gap-2">
          <VoiceOrb
            phase={orbPhase}
            amplitude={orbPhase === "listening" ? micAmplitude : 0}
            size={80}
          />
          <div
            className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
            aria-live="polite"
          >
            {orbLabel}
          </div>
        </div>
        <StatusBadge status={status} />

        {status === "idle" && (
          <Button
            size="lg"
            onClick={connect}
            disabled={consentOpen}
            className="h-14 min-w-[12rem] rounded-full px-8 text-base"
          >
            Start talking
          </Button>
        )}

        {status === "connecting" && (
          <Button
            size="lg"
            variant="outline"
            disabled
            className="h-14 min-w-[12rem] rounded-full px-8 text-base"
          >
            Connecting…
          </Button>
        )}

        {status === "connected" && (
          <Button
            size="lg"
            variant="destructive"
            onClick={disconnect}
            className="h-14 min-w-[12rem] rounded-full px-8 text-base"
          >
            End call
          </Button>
        )}

        {error && (
          <div
            role="alert"
            className="flex max-w-md items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="flex-1 flex flex-col gap-1">
              <div className="font-medium">{error}</div>
              {errorKind === "mic_denied" && (
                <div className="text-destructive/80">
                  Click the lock icon in your browser address bar → set
                  Microphone to &quot;Allow&quot; → click Start talking again.
                </div>
              )}
              {errorKind === "network" && (
                <div className="text-destructive/80">
                  Check your internet connection, then retry.
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setErrorKind("none");
                }}
                className="mt-0.5 self-start text-[10px] uppercase tracking-wide text-destructive/70 hover:text-destructive"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {status === "connected" &&
          sessionRemainingMs != null &&
          sessionRemainingMs < 2 * 60 * 1000 && (
            <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400/80">
              auto-end in {formatSecondsCountdown(sessionRemainingMs)}
            </div>
          )}

        <p className="max-w-md text-center text-xs text-muted-foreground">
          Click &quot;Start talking&quot; and allow microphone access. Try:{" "}
          <em>&quot;What was their last objection?&quot;</em>,{" "}
          <em>&quot;Who&apos;s the champion here?&quot;</em>, or{" "}
          <em>&quot;Save a note that they want annual prepay at 12%.&quot;</em>
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
                {transcript.map((m) => {
                  const effective = edits[m.id] ?? m.text;
                  const divergences: string[] = [];
                  if (m.role === "user") {
                    for (const call of toolCalls) {
                      if (call.sourceItemId !== m.id) continue;
                      const divergent = hasCustomerDivergence(
                        call.args,
                        effective
                      );
                      if (divergent && !divergences.includes(divergent)) {
                        divergences.push(divergent);
                      }
                    }
                  }
                  return (
                    <TranscriptLine
                      key={m.id}
                      message={m}
                      editedText={edits[m.id]}
                      isEditing={editingId === m.id}
                      divergences={divergences}
                      onStartEdit={() => startEdit(m.id)}
                      onSaveEdit={(newText) => saveEdit(m.id, m.text, newText)}
                      onCancelEdit={cancelEdit}
                      onUndoEdit={() => undoEdit(m.id)}
                    />
                  );
                })}
              </ol>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {summary.phase !== "idle" && (
        <PostCallSummaryCard
          state={summary}
          onDismiss={dismissSummary}
          onRetry={() =>
            summary.phase === "error" && requestSummary(summary.retryPayload)
          }
        />
      )}

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

      <ConsentDialog open={consentOpen} onAccept={acceptConsent} />
    </main>
  );
}
