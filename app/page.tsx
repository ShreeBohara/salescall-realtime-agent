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
import {
  addCallToHistory,
  clearCallHistory,
  getCallHistorySnapshot,
  getServerCallHistorySnapshot,
  initClientCallHistory,
  subscribeToCallHistory,
  type CallRecord,
} from "./lib/store/callHistoryStore";
import {
  clearCurrentRep,
  getCurrentRepSnapshot,
  getServerCurrentRepSnapshot,
  initClientRep,
  setCurrentRep,
  subscribeToCurrentRep,
} from "./lib/store/repStore";
import { getCustomerById } from "./lib/data/customers";
import {
  buildAgentInstructions,
  buildBriefMePrompt,
  showToolCompletionToast,
} from "./lib/agent";
import {
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { VoiceOrb, type VoiceOrbPhase } from "@/components/voice-orb";
import { ConsentDialog } from "@/components/earshot/consent-dialog";
import { PostCallSummaryCard } from "@/components/earshot/post-call-summary-card";
import { TranscriptLine } from "@/components/earshot/transcript-line";
import { TopRail } from "@/components/earshot/top-rail";
import { LedgerPanel } from "@/components/earshot/ledger-panel";
import { InlineToolCallRow } from "@/components/earshot/inline-tool-call-row";
import { PreCallBriefing } from "@/components/earshot/pre-call-briefing";
import { CallLogView } from "@/components/earshot/call-log-view";
import { RepOnboarding } from "@/components/earshot/rep-onboarding";
import { PreAuthShell } from "@/components/earshot/pre-auth-shell";
import { OrbCallMeta } from "@/components/earshot/orb-call-meta";
import { Pause, PhoneOff, Play, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

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
  /**
   * USER-INTENT mute — true iff the rep hit the Pause button. Drives
   * the Pause/Resume UI toggle and the orb label. Separate from the
   * AUTO-mute that triggers while the agent is speaking (see
   * `agentSpeaking` below); the actual SDK mute call is the OR of
   * both signals. Reset to false on disconnect so a fresh call never
   * starts pre-muted.
   */
  const [muted, setMuted] = useState(false);
  /**
   * AUTO-mute — true while the agent is actively generating audio.
   *
   * Why this exists: the SDK's WebRTC transport has a hardcoded
   * behavior where `input_audio_buffer.speech_started` unconditionally
   * fires `output_audio_buffer.clear`, which wipes the agent's
   * in-flight audio on the client as soon as the rep starts their
   * next utterance. Turn-detection tuning can't fix this — every
   * quick back-to-back ask clips the agent's confirmation mid-word.
   *
   * The workaround is to temporarily mute the MIC while the agent is
   * speaking, so the rep's overlapping utterance never triggers
   * `speech_started` and the buffer never gets wiped. We toggle this
   * from the session's `audio_start` / `audio_stopped` /
   * `audio_interrupted` events; the mute flips back to whatever the
   * rep's intent (`muted`) was the moment the agent finishes.
   *
   * Trade-off: during a confirmation ("Saved.", "Reminder set.") the
   * rep literally cannot be heard by the model. For 3-5 word
   * confirmations this is imperceptible; the manual Pause button is
   * still the right tool for longer holds.
   */
  const [agentSpeaking, setAgentSpeaking] = useState(false);

  // Conversation data
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryState>({ phase: "idle" });

  /**
   * Which top-level stage is showing:
   *   home → orb/transcript/pre-call-briefing/post-call-summary
   *   log  → full-width call-log table (+ inline summary detail when
   *          a row is selected). Reached via the top-rail "Call log"
   *          nav button; left via its in-stage "Back to home".
   * Calls can only be started from home, so we don't worry about this
   * being "log" while a session is connecting/connected.
   */
  const [stageView, setStageView] = useState<"home" | "log">("home");

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
  const callHistory = useSyncExternalStore(
    subscribeToCallHistory,
    getCallHistorySnapshot,
    getServerCallHistorySnapshot
  );
  const currentRep = useSyncExternalStore(
    subscribeToCurrentRep,
    getCurrentRepSnapshot,
    getServerCurrentRepSnapshot
  );

  // We need to distinguish "rep is actually null" (user is mid-
  // onboarding or just signed out) from "we haven't hydrated yet".
  // Without this flag, the onboarding modal would flash on every
  // reload for the split second between mount and localStorage read.
  const [clientReady, setClientReady] = useState(false);

  // Swap the empty SSR snapshots for the real localStorage-backed
  // values once, after the initial hydration pass. Running this in
  // an effect (rather than at module load) keeps server and first
  // client renders identical and avoids React hydration mismatches.
  useEffect(() => {
    initClientCallHistory();
    initClientRep();
    setClientReady(true);
  }, []);

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

  // Sync the SDK's mute state to the OR of user-intent + auto-mute.
  //
  // The effect fires on every change to either `muted` (Pause
  // toggle) or `agentSpeaking` (audio_start/stopped listeners). We
  // only call `session.mute()` when the effective value actually
  // differs from what the SDK already has, so we don't spam the
  // transport with no-op updates.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    const desired = muted || agentSpeaking;
    if (session.muted !== desired) {
      session.mute(desired);
    }
  }, [muted, agentSpeaking]);

  // Sync status to body[data-status] so the ambient halo intensity animates.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.dataset.status = status;
  }, [status]);

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

  // When the call is paused (mic muted), override whatever phase
  // label we'd otherwise show. The orb's underlying animation stays
  // in its derived state, but the TEXT needs to read "paused" so the
  // rep isn't confused by a "listening" label while the agent can't
  // actually hear them. We only apply the override while connected —
  // `muted` is reset on disconnect, so this is just a safety for an
  // intermediate connecting frame.
  const orbLabel: string =
    status === "connected" && muted
      ? "paused"
      : orbPhase === "idle"
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
      // Snapshot the rep at connect time (same pattern as customer)
      // so re-renders during the call don't retroactively rewrite
      // the agent's system prompt. If the rep signs out mid-call,
      // the agent stays addressed to the original identity — which
      // matches the "sign-out is locked during a live call" rule
      // enforced by the profile chip.
      const repAtConnectTime = getCurrentRepSnapshot();
      const agent = new RealtimeAgent({
        name: "Earshot",
        instructions: buildAgentInstructions(
          customerAtConnectTime,
          repAtConnectTime
        ),
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

      // Auto-mute the mic while the agent is generating audio.
      //
      // See the `agentSpeaking` useState above for the full rationale.
      // Short version: the SDK wipes the agent's audio buffer the
      // moment `speech_started` fires on the input side, so any quick
      // follow-up ask cuts off the previous confirmation. Muting the
      // mic during agent speech prevents `speech_started` from ever
      // firing and the buffer survives.
      //
      // `audio_interrupted` fires when the SDK's own interrupt path
      // runs (ideally rare once auto-mute is in place, but we still
      // unflag on it defensively — if the agent was interrupted,
      // it's no longer speaking).
      session.on("audio_start", () => setAgentSpeaking(true));
      session.on("audio_stopped", () => setAgentSpeaking(false));
      session.on("audio_interrupted", () => setAgentSpeaking(false));

      // Debug telemetry for turn-detection bugs.
      //
      // When a user ask goes silent (no tool call, no confirmation,
      // but the action eventually lands on the NEXT utterance), the
      // most useful signal is the sequence of server turn events:
      // speech_started, speech_stopped, audio_buffer.committed,
      // response.created, response.done, response.cancelled. We
      // relay just those to the console so silence bugs are
      // diagnosable without instrumenting the SDK. Everything else
      // stays off to keep the console scannable.
      session.on("transport_event", (event) => {
        const type = (event as { type?: string }).type;
        if (!type) return;
        if (
          type.includes("speech_started") ||
          type.includes("speech_stopped") ||
          type === "input_audio_buffer.committed" ||
          type === "response.created" ||
          type === "response.done" ||
          type === "response.cancelled"
        ) {
          console.log(`[vad] ${type}`, event);
        }
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

      // Turn detection: `semantic_vad`, not `server_vad`.
      //
      // We originally overrode the SDK default with `server_vad` and
      // tuned `silenceDurationMs` down to 350 ms for snappier
      // end-of-turn. Live testing surfaced a nasty failure mode with
      // that choice: `server_vad` is pure amplitude-based silence
      // detection, so any mid-sentence breath, filler word, or
      // ambient noise trips the threshold, closes the turn, and the
      // model starts generating. If the rep's next breath then
      // registers as a new turn before the response lands, the
      // in-flight response gets interrupted and the tool call +
      // confirmation disappear into the void — the rep hears nothing
      // and sees nothing, even though the model was about to act.
      //
      // `semantic_vad` is the SDK default precisely for this reason:
      // the model itself decides whether an utterance is complete by
      // listening to the SEMANTICS, not just the waveform. A pause
      // after "the call is with Mike, not —" is understood as
      // mid-thought; a pause after "cancel my reminder about the
      // CFO" is understood as complete. Pauses, um's, and ambient
      // hiss no longer close the turn prematurely.
      //
      // `eagerness: 'high'` is deliberate for this product.
      //
      // Previous rounds tried 'auto' and 'low'. Both produced the
      // same failure mode in live testing: a rep finishes a short
      // declarative ask ("save a note that pricing concerns came
      // up", "change that to Thursday") and the model stays silent
      // until the rep says ANYTHING else — at which point the
      // original ask's tool call lands. Root cause: semantic VAD
      // wasn't committing the turn. With low eagerness the VAD sits
      // and waits for possible continuation; with auto it's
      // inconsistent. Either way, the turn only commits when a new
      // `speech_started` event forces it.
      //
      // Sales-rep speech in this product is command-shaped — short,
      // imperative, one clean beat ("Remind me to call the CFO
      // Friday."). There IS no continuation coming. We want the VAD
      // to commit the moment the ask is complete. `'high'` does
      // exactly that: the server closes the turn as soon as it has
      // enough signal, the model responds immediately, tool calls
      // land before the rep moves on.
      //
      // Trade-off: reps who pause mid-sentence to think (rare in
      // this product, common in free-form dictation) may have their
      // turn closed early. Acceptable for Earshot's UX.
      try {
        transport.updateSessionConfig({
          audio: {
            input: {
              turnDetection: {
                type: "semantic_vad",
                eagerness: "high",
                createResponse: true,
              },
            },
          },
        });
      } catch (err) {
        console.warn(
          "[session] turn-detection tuning failed; falling back to server default",
          err
        );
      }

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
    const startedAtSnapshot = connectedAt;
    setStatus("idle");
    setConnectedAt(null);
    // Clear both mute flags so the next call starts unmuted. Without
    // this, a rep who ends a call while paused (or while the agent
    // was mid-response) would find their mic silently muted on the
    // next `Start talking`.
    setMuted(false);
    setAgentSpeaking(false);

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

    requestSummary(payload, startedAtSnapshot);
  }

  async function requestSummary(
    payload: SummarizeRequestPayload,
    startedAt: number | null = null
  ) {
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

      const endedAt = Date.now();
      setSummary({
        phase: "ready",
        summary: data.summary,
        forCustomer: payload.customer?.name ?? null,
        endedAt,
      });
      addCallToHistory({
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `call_${endedAt}`,
        endedAt,
        startedAt,
        forCustomer: payload.customer?.name ?? null,
        summary: data.summary,
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

  /**
   * Toggle the user-intent pause state on a live call.
   *
   * Pause semantics here = mic-side silence: the auto-mute effect
   * above translates user intent + agent-speaking into the actual
   * `session.mute()` call, so this handler just flips the intent
   * flag. If the rep hits Pause mid-agent-response, we also call
   * `session.interrupt()` so the agent stops talking immediately —
   * same UX contract as before (a manual pause means "silence now").
   *
   * No-op when the session isn't connected — the button is disabled
   * in those states, but a double-click race could still land here.
   */
  function togglePause() {
    const session = sessionRef.current;
    if (!session) return;
    if (status !== "connected") return;

    const nextMuted = !muted;
    if (nextMuted) {
      session.interrupt();
    }
    setMuted(nextMuted);
  }

  function dismissSummary() {
    setSummary({ phase: "idle" });
  }

  function restoreSummaryFromHistory(record: CallRecord) {
    setSummary({
      phase: "ready",
      summary: record.summary,
      forCustomer: record.forCustomer,
      endedAt: record.endedAt,
    });
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

  // ---- Feed composition -------------------------------------------
  //
  // Interleave tool-call chips into the transcript by their
  // `sourceItemId` link (established when the tool started — it points
  // at the user message that triggered it). This avoids timestamp math
  // across streaming messages. Orphan calls (no source) fall to the
  // bottom. The same `toolCalls[]` array still feeds the Actions tab in
  // the ledger — two views, one source of truth.
  type FeedEntry =
    | { kind: "message"; message: TranscriptMessage }
    | { kind: "tool"; call: ToolCall };

  const callsBySourceId = new Map<string, ToolCall[]>();
  const orphanCalls: ToolCall[] = [];
  for (const call of toolCalls) {
    if (call.sourceItemId) {
      const arr = callsBySourceId.get(call.sourceItemId) ?? [];
      arr.push(call);
      callsBySourceId.set(call.sourceItemId, arr);
    } else {
      orphanCalls.push(call);
    }
  }
  const mergedFeed: FeedEntry[] = [];
  for (const m of transcript) {
    mergedFeed.push({ kind: "message", message: m });
    const linked = callsBySourceId.get(m.id);
    if (linked) {
      for (const call of linked) {
        mergedFeed.push({ kind: "tool", call });
      }
    }
  }
  for (const call of orphanCalls) {
    mergedFeed.push({ kind: "tool", call });
  }

  const showSummaryStage = summary.phase !== "idle";

  /**
   * Latest call *with the currently selected customer*. The pre-call
   * briefing shows a recap keyed off this — not the globally-most-
   * recent call, because otherwise picking "Initech" still shows the
   * Atmos headline on the right, which is misleading.
   */
  const latestCallForSelected =
    selectedCustomer == null
      ? null
      : callHistory.find((r) => r.forCustomer === selectedCustomer.name) ??
        null;

  // Switching to/from the log view. When leaving the log, we also
  // dismiss any lingering summary so "Back to home" reliably lands on
  // the idle hero (and not the post-call summary the user might have
  // had open inside the log as a detail).
  function openCallLog() {
    setStageView("log");
  }
  function closeCallLog() {
    setSummary({ phase: "idle" });
    setStageView("home");
  }
  function toggleCallLog() {
    if (stageView === "log") {
      closeCallLog();
    } else {
      openCallLog();
    }
  }

  // ---- Render ----------------------------------------------------

  // Pre-auth gate. Before a rep signs in we render a clean splash
  // instead of the full dashboard — no customer brief, no call log,
  // no captured panel. Two reasons:
  //   1. Product narrative: Earshot is "your personal agent", so it
  //      shouldn't show someone else's CRM data before we know who
  //      you are. The dashboard content should arrive AFTER sign-in,
  //      the same way a real SaaS loads your own workspace on login.
  //   2. Layout: a full dashboard behind the modal made the page tall
  //      enough that the viewport-centered Radix dialog ended up below
  //      the fold on short windows. A non-scrolling splash keeps the
  //      modal exactly on the visible center.
  // The `clientReady` gate keeps the onboarding modal hidden during
  // the pre-hydration frame so localStorage-backed reps don't see a
  // flash of the "Welcome" copy before their name is restored. The
  // splash itself still renders in that frame so the transition from
  // SSR → hydrated → signed-in stays visually stable.
  if (!currentRep) {
    return (
      <PreAuthShell>
        {clientReady && (
          <RepOnboarding open onComplete={setCurrentRep} />
        )}
      </PreAuthShell>
    );
  }

  return (
    // Outer bound: `min-h-screen` on mobile (the long portrait layout
    // scrolls as a normal document) and `h-screen` on desktop (the
    // dashboard is designed to fit entirely in one viewport so the
    // transcript panel doesn't get pushed below the fold). The
    // desktop override plus `overflow-hidden` hands scroll control to
    // the inner scrollers (transcript ScrollArea, call-log wrapper,
    // summary wrapper) instead of the page itself.
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <TopRail
        selectedId={selectedCustomerId}
        customer={selectedCustomer}
        status={status}
        connected={status !== "idle"}
        onSelectCustomer={(id) => setSelectedCustomerId(id)}
        callHistoryCount={callHistory.length}
        logActive={stageView === "log"}
        onToggleLog={toggleCallLog}
        rep={currentRep}
        onSignOut={clearCurrentRep}
      />

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col lg:min-h-0 lg:flex-row">
        <section
          className={cn(
            "flex min-w-0 flex-1 flex-col px-4 pt-5 pb-8 sm:px-6 lg:min-h-0 lg:overflow-hidden lg:px-10 lg:pt-7 lg:pb-10"
          )}
          aria-label="Live call stage"
        >
          {stageView === "log" ? (
            <CallLogView
              history={callHistory}
              summaryState={summary}
              onOpenDetail={restoreSummaryFromHistory}
              onCloseDetail={dismissSummary}
              onBackHome={closeCallLog}
              onClear={clearCallHistory}
              onRetry={() =>
                summary.phase === "error" &&
                requestSummary(summary.retryPayload)
              }
            />
          ) : showSummaryStage ? (
            // The summary card can be tall (many key points / next
            // steps). Section is `lg:overflow-hidden` now, so give
            // this branch its own internal scroll on desktop.
            <div className="earshot-stagger-hero flex flex-col gap-6 lg:h-full lg:overflow-y-auto lg:pr-1">
              <div className="flex items-center gap-4">
                <VoiceOrb phase="idle" size={72} halo />
                <div className="flex flex-col leading-tight">
                  <span
                    className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    call ended
                  </span>
                  <span
                    className="text-2xl italic text-foreground"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    post-call summary
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={connect}
                    disabled={consentOpen}
                    className={cn(
                      "h-9 gap-1.5 rounded-full px-4 text-xs uppercase tracking-wider",
                      "shadow-[0_0_24px_-6px_rgba(168,132,247,0.55)]"
                    )}
                  >
                    Start new call
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openCallLog}
                    className="h-9 gap-1.5 rounded-full border-border/70 px-4 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    View all calls
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={dismissSummary}
                    aria-label="Dismiss summary"
                    className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <PostCallSummaryCard
                state={summary}
                onDismiss={dismissSummary}
                onRetry={() =>
                  summary.phase === "error" &&
                  requestSummary(summary.retryPayload)
                }
              />
            </div>
          ) : (
            <>
              {/* Two-column hero (orb+actions | customer brief) stays
                  mounted across idle/connecting/connected so the rep
                  always has CRM context while talking. The transcript
                  below still gets the full row width.
                  `md:items-stretch` (default) lets the orb column
                  match the brief column's height so we can vertically
                  center the orb cluster — the previous `items-start`
                  left a hard block of whitespace below the buttons
                  whenever the brief ran long. */}
              <div className="flex flex-col gap-8 md:flex-row md:gap-12 lg:gap-16">
                <div className="flex flex-col items-center justify-center gap-4 md:w-[320px] md:shrink-0">
                  <div className="earshot-stagger-orb flex flex-col items-center gap-2">
                    <VoiceOrb
                      phase={orbPhase}
                      amplitude={
                        orbPhase === "listening" && !muted ? micAmplitude : 0
                      }
                      size={104}
                      halo
                    />
                    <div
                      className="text-base italic text-foreground/80"
                      style={{ fontFamily: "var(--font-display)" }}
                      aria-live="polite"
                    >
                      {orbLabel}
                    </div>
                    {/* Live call metrics sit directly under the orb
                        label now, replacing the old bottom rail. One
                        glance surfaces state + elapsed + any auto-end
                        warning + the muted pill when paused. */}
                    <OrbCallMeta
                      connectedAt={connectedAt}
                      remainingMs={sessionRemainingMs}
                      muted={muted}
                    />
                  </div>

                  <div className="earshot-stagger-hero flex flex-wrap items-center justify-center gap-2.5">
                    {status === "idle" && (
                      <Button
                        onClick={connect}
                        disabled={consentOpen}
                        className={cn(
                          "h-9 rounded-full px-5 text-[12px] font-medium uppercase tracking-[0.14em]",
                          "shadow-[0_0_28px_-6px_rgba(168,132,247,0.55),inset_0_1px_0_rgba(255,255,255,0.12)]",
                          "ring-1 ring-[--color-accent-voice]/40 transition-shadow",
                          "hover:shadow-[0_0_40px_-4px_rgba(168,132,247,0.75),inset_0_1px_0_rgba(255,255,255,0.18)]"
                        )}
                      >
                        Start talking
                      </Button>
                    )}

                    {status === "connecting" && (
                      <Button
                        variant="outline"
                        disabled
                        className="h-9 rounded-full border-border/70 px-5 text-[12px] uppercase tracking-[0.14em]"
                      >
                        Connecting…
                      </Button>
                    )}

                    {/* In-call controls are icon-only, matching
                        standard phone-app conventions: PhoneOff to
                        hang up, Pause/Play to mute/resume the mic.
                        Dropping the text labels tightens the control
                        cluster under the orb and mirrors how real
                        voice UIs (Meet, FaceTime, Zoom) present the
                        same actions. `aria-label` + `title` carry the
                        full verb for screen readers and hover. */}
                    {status === "connected" && (
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={disconnect}
                        aria-label="End call"
                        title="End call"
                        className="h-10 w-10 rounded-full p-0"
                      >
                        <PhoneOff className="h-4 w-4" />
                      </Button>
                    )}

                    {/* Pause / Resume toggle. Only renders while a call
                        is actually connected — there is nothing to
                        pause when idle or mid-handshake. When muted,
                        the button flips to the destructive palette so
                        it reads as "you are currently paused, click
                        to resume" at a glance (same visual grammar as
                        the End-call button sitting next to it). */}
                    {status === "connected" && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={togglePause}
                        aria-pressed={muted}
                        aria-label={muted ? "Resume call" : "Pause call"}
                        title={
                          muted
                            ? "Mic is muted — click to resume the conversation"
                            : "Mute the mic and pause the conversation"
                        }
                        className={cn(
                          "h-10 w-10 rounded-full border-border/70 bg-card/40 p-0",
                          "hover:bg-card/70 hover:text-foreground",
                          muted &&
                            "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
                        )}
                      >
                        {muted ? (
                          <Play className="h-4 w-4" />
                        ) : (
                          <Pause className="h-4 w-4" />
                        )}
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      onClick={handleBriefMe}
                      disabled={
                        status !== "connected" ||
                        !selectedCustomer ||
                        isAgentResponding ||
                        muted
                      }
                      className={cn(
                        "h-9 gap-1.5 rounded-full border-border/70 bg-card/40 px-4 text-[12px]",
                        "hover:bg-card/70 hover:text-foreground"
                      )}
                      title={
                        !selectedCustomer
                          ? "Pick a customer first"
                          : status !== "connected"
                          ? "Connect before requesting a brief"
                          : muted
                          ? "Resume the call before requesting a brief"
                          : isAgentResponding
                          ? "Agent is already speaking"
                          : undefined
                      }
                    >
                      <Sparkles className="h-3.5 w-3.5 text-[--color-accent-voice]" />
                      Brief me
                    </Button>
                  </div>
                </div>

                <div className="w-full min-w-0 md:flex-1">
                  <PreCallBriefing
                    customer={selectedCustomer}
                    latestCall={latestCallForSelected}
                    // Only wire the click-through during idle. Mid-
                    // call, the row stays visible but inert so the rep
                    // can't accidentally jump to the post-call view.
                    onOpenSummary={
                      status === "idle" && latestCallForSelected
                        ? () =>
                            restoreSummaryFromHistory(latestCallForSelected)
                        : undefined
                    }
                  />
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="mx-auto mt-5 flex max-w-md items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="flex flex-1 flex-col gap-1">
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

              {/* Merged transcript + tool-call feed */}
              <div className="earshot-stagger-hero mt-7 flex min-h-0 flex-1 flex-col">
                <div className="mb-3 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  <span className="text-foreground/80">Live transcript</span>
                  <div className="h-px flex-1 bg-border/50" />
                  {transcript.length > 0 && (
                    <button
                      type="button"
                      onClick={clearTranscript}
                      className="tracking-wider text-muted-foreground/70 transition-colors hover:text-foreground"
                    >
                      clear
                    </button>
                  )}
                </div>
                <ScrollArea
                  ref={transcriptScrollRef}
                  // Mobile: a fixed-vh ScrollArea is fine because the
                  // page already scrolls as a document. Desktop: the
                  // outer `lg:h-screen` bounds the viewport, so we let
                  // the ScrollArea flex into whatever height is left
                  // after the hero row (`lg:h-full` + `lg:min-h-0`).
                  // This is what actually keeps the transcript from
                  // getting clipped off the bottom of the page.
                  className="h-[44vh] min-h-[260px] rounded-lg border border-border/50 bg-card/20 px-3 py-3 lg:h-full lg:min-h-0"
                >
                  {mergedFeed.length === 0 ? (
                    <div className="flex h-full min-h-40 items-center justify-center px-6 text-center">
                      <span
                        className="text-base italic text-muted-foreground/80"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        {status === "connected"
                          ? "Listening… say something."
                          : "Start a call to see the live transcript."}
                      </span>
                    </div>
                  ) : (
                    <ol className="flex flex-col gap-2 pr-2">
                      {mergedFeed.map((entry) => {
                        if (entry.kind === "message") {
                          const m = entry.message;
                          const effective = edits[m.id] ?? m.text;
                          const divergences: string[] = [];
                          if (m.role === "user") {
                            for (const call of toolCalls) {
                              if (call.sourceItemId !== m.id) continue;
                              const divergent = hasCustomerDivergence(
                                call.args,
                                effective
                              );
                              if (
                                divergent &&
                                !divergences.includes(divergent)
                              ) {
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
                              onSaveEdit={(newText) =>
                                saveEdit(m.id, m.text, newText)
                              }
                              onCancelEdit={cancelEdit}
                              onUndoEdit={() => undoEdit(m.id)}
                            />
                          );
                        }
                        return (
                          <InlineToolCallRow
                            key={entry.call.id}
                            call={entry.call}
                          />
                        );
                      })}
                    </ol>
                  )}
                </ScrollArea>
              </div>
            </>
          )}
        </section>

        {/* Ledger column */}
        <div
          className={cn(
            "w-full border-t border-border/70",
            "lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem-2rem)] lg:w-[380px] lg:shrink-0 lg:self-start lg:border-l lg:border-t-0"
          )}
        >
          <LedgerPanel
            tasks={tasks}
            notes={notes}
            toolCalls={toolCalls}
            onClearTasks={clearAllTasks}
            onClearNotes={clearAllNotes}
            onClearActions={clearToolCalls}
          />
        </div>
      </main>

      <ConsentDialog open={consentOpen} onAccept={acceptConsent} />
    </div>
  );
}
