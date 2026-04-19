/**
 * Shared React/UI state types used across the voice page, hooks, and
 * feature components. Kept pure data (no React, no runtime values) so
 * any module can import from here without risk of cycles.
 */

export type ToolCallStatus = "running" | "done" | "error";

export type ToolCall = {
  id: string;
  name: string;
  args: unknown;
  rawArgs: string;
  status: ToolCallStatus;
  result?: string;
  parsedResult?: unknown;
  startedAt: number;
  endedAt?: number;
  /** id of the user transcript line that triggered this tool (for divergence chip). */
  sourceItemId?: string;
  /** snapshot of the user transcript line text at tool-start time. */
  sourceItemText?: string;
};

export type TranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "in_progress" | "completed" | "incomplete";
};

export type MeddicSummary = {
  metrics: string | null;
  economicBuyer: string | null;
  decisionCriteria: string | null;
  decisionProcess: string | null;
  identifiedPain: string | null;
  champion: string | null;
};

export type CallSummary = {
  headline: string;
  keyPoints: string[];
  newObjections: string[];
  decisions: string[];
  nextSteps: {
    action: string;
    owner: "rep" | "customer" | "other";
    due: string;
  }[];
  meddic: MeddicSummary;
  riskSignals: string[];
  confidence: "high" | "medium" | "low";
};

export type SummarizeRequestPayload = {
  customer: {
    name: string;
    industry?: string;
    dealStage?: string;
    dealSize?: string;
    champion?: string;
    pastObjections?: string[];
  } | null;
  transcript: { role: "user" | "assistant"; text: string }[];
  toolCalls: { name: string; args: unknown; result?: string }[];
};

export type SummaryState =
  | { phase: "idle" }
  | { phase: "loading"; startedAt: number; forCustomer: string | null }
  | {
      phase: "ready";
      summary: CallSummary;
      forCustomer: string | null;
      endedAt: number;
    }
  | { phase: "empty"; forCustomer: string | null }
  | {
      phase: "error";
      error: string;
      retryPayload: SummarizeRequestPayload;
      forCustomer: string | null;
    };

export type ErrorKind = "none" | "mic_denied" | "network" | "unknown";

export type VoiceStatus = "idle" | "connecting" | "connected";
