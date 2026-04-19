/**
 * Pure stateless helpers used by the voice page, hooks, and feature
 * components. No React, no side effects. Grouped into one file
 * because they're all small and tightly related to transcript / tool
 * rendering.
 */

import type { RealtimeItem } from "@openai/agents-realtime";
import type { ToolPart } from "@/components/ai-elements/tool";
import type {
  MeddicSummary,
  ToolCallStatus,
  TranscriptMessage,
} from "./types";

/**
 * Flatten a RealtimeSession's history into the TranscriptMessage shape
 * our UI renders. Only keeps user/assistant messages and concatenates
 * their text + audio-transcript chunks into a single string per turn.
 */
export function historyToTranscript(
  history: RealtimeItem[]
): TranscriptMessage[] {
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

export function safeParseJson(raw: string): { parsed: unknown; ok: boolean } {
  try {
    return { parsed: JSON.parse(raw), ok: true };
  } catch {
    return { parsed: raw, ok: false };
  }
}

/**
 * Detect "transcript-vs-tool-arg" divergence for a single tool call against
 * its triggering user transcript line. This is the Atmas/Acme chip's reason
 * to exist: voice transcription often mis-hears the customer name, but the
 * tool captures the agent's inferred intent. When they disagree, surface it.
 *
 * Rule: if the tool call has a `customer` arg, check whether the (normalized)
 * customer substring-matches the (normalized) transcript line in either
 * direction. If neither direction matches, and the first word of the tool's
 * customer (if >=3 chars) also isn't in the transcript, call it divergent.
 */
export function hasCustomerDivergence(
  toolArgs: unknown,
  sourceText: string | undefined
): string | null {
  if (!sourceText) return null;
  if (typeof toolArgs !== "object" || toolArgs === null) return null;
  const args = toolArgs as { customer?: unknown };
  if (typeof args.customer !== "string" || !args.customer.trim()) return null;

  const toolCustomer = args.customer.toLowerCase().trim();
  const src = sourceText.toLowerCase();

  if (src.includes(toolCustomer)) return null;
  if (toolCustomer.includes(src.trim())) return null;

  const firstWord = toolCustomer.split(/\s+/)[0];
  if (firstWord.length >= 3 && src.includes(firstWord)) return null;

  return args.customer;
}

export function toolStateFromStatus(status: ToolCallStatus): ToolPart["state"] {
  if (status === "done") return "output-available";
  if (status === "error") return "output-error";
  return "input-available";
}

export function formatSecondsCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export function formatMeddicKey(key: keyof MeddicSummary): string {
  switch (key) {
    case "metrics":
      return "Metrics";
    case "economicBuyer":
      return "Economic buyer";
    case "decisionCriteria":
      return "Decision criteria";
    case "decisionProcess":
      return "Decision process";
    case "identifiedPain":
      return "Identified pain";
    case "champion":
      return "Champion";
  }
}
