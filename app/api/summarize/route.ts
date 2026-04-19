/**
 * POST /api/summarize
 *
 * Generate a structured post-call summary from a transcript + tool-call
 * trace + customer context. Non-realtime call to gpt-4o-mini in JSON
 * mode. Called by the client right after `session.close()`, so it
 * doesn't touch the live voice session.
 *
 * The server is the only thing that holds OPENAI_API_KEY, same pattern
 * as /api/session. Direct fetch to Chat Completions (no SDK) for the
 * same reason: one fewer dependency to reason about, and the surface
 * we use is stable.
 *
 * Shape of the expected request body is a best-effort contract — we
 * validate the minimum (transcript exists + has user content) but we
 * are tolerant about surrounding fields so the client can evolve.
 */

import { NextResponse } from "next/server";

type TranscriptInput = {
  role: "user" | "assistant";
  text: string;
};

type ToolCallInput = {
  name: string;
  args: unknown;
  result?: string;
};

type CustomerInput = {
  name: string;
  industry?: string;
  dealStage?: string;
  dealSize?: string;
  champion?: string;
  pastObjections?: string[];
};

type SummarizeRequest = {
  customer?: CustomerInput | null;
  transcript: TranscriptInput[];
  toolCalls?: ToolCallInput[];
};

const SUMMARY_SYSTEM_PROMPT = [
  "You are a sales-operations analyst extracting structured notes from a recorded sales call.",
  "",
  "You MUST output valid JSON matching this exact schema:",
  "{",
  '  "headline": string                         // one sentence summarizing the call outcome',
  '  "keyPoints": string[]                      // 3-5 crisp bullets of what was discussed',
  '  "newObjections": string[]                  // objections raised in this call, not already known',
  '  "decisions": string[]                      // anything agreed or decided in this call',
  '  "nextSteps": [                             // concrete follow-up actions',
  '    { "action": string, "owner": "rep" | "customer" | "other", "due": string }',
  "  ],",
  '  "meddic": {                                // only fill fields that were discussed or UPDATED in THIS call',
  '    "metrics": string | null,',
  '    "economicBuyer": string | null,',
  '    "decisionCriteria": string | null,',
  '    "decisionProcess": string | null,',
  '    "identifiedPain": string | null,',
  '    "champion": string | null',
  "  },",
  '  "riskSignals": string[]                    // e.g. ghosting, unclear champion, pricing pushback, timeline pressure',
  '  "confidence": "high" | "medium" | "low"    // how confident you are in this summary given transcript length + clarity',
  "}",
  "",
  "Rules:",
  "- Be honest. Short or trivial calls get short summaries and low confidence.",
  "- Do not invent details that aren't in the transcript.",
  "- If a field wasn't touched in this call, use null (MEDDIC fields) or an empty array.",
  "- Keep every string concise — one clause or sentence. No markdown.",
  "- Never include headers, bullets, or formatting characters. Just clean JSON strings.",
].join("\n");

function buildUserPrompt(req: SummarizeRequest): string {
  const parts: string[] = [];

  if (req.customer) {
    const c = req.customer;
    parts.push("CUSTOMER CONTEXT (prior state before this call):");
    parts.push(`- Name: ${c.name}`);
    if (c.industry) parts.push(`- Industry: ${c.industry}`);
    if (c.dealStage) parts.push(`- Deal stage: ${c.dealStage}`);
    if (c.dealSize) parts.push(`- Deal size: ${c.dealSize}`);
    if (c.champion) parts.push(`- Champion: ${c.champion}`);
    if (c.pastObjections && c.pastObjections.length > 0) {
      parts.push(`- Already-known objections: ${c.pastObjections.join("; ")}`);
    }
    parts.push("");
  } else {
    parts.push("CUSTOMER CONTEXT: not provided.");
    parts.push("");
  }

  parts.push("CALL TRANSCRIPT:");
  if (req.transcript.length === 0) {
    parts.push("(empty)");
  } else {
    for (const msg of req.transcript) {
      const label = msg.role === "user" ? "Rep" : "Copilot";
      const text = msg.text.trim();
      if (!text) continue;
      parts.push(`${label}: ${text}`);
    }
  }
  parts.push("");

  if (req.toolCalls && req.toolCalls.length > 0) {
    parts.push("TOOL CALLS FIRED DURING CALL:");
    for (const t of req.toolCalls) {
      parts.push(`- ${t.name}(${safeStringify(t.args)})`);
    }
    parts.push("");
  }

  parts.push(
    "Extract structured post-call notes as JSON. Focus on what changed during THIS call. Do not restate customer context that was already known unless it was confirmed, denied, or updated in the conversation."
  );

  return parts.join("\n");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function POST(req: Request) {
  let body: SummarizeRequest;
  try {
    body = (await req.json()) as SummarizeRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json_body" },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.transcript)) {
    return NextResponse.json(
      { ok: false, error: "missing_transcript" },
      { status: 400 }
    );
  }

  const hasUserTurn = body.transcript.some(
    (m) => m.role === "user" && m.text.trim().length > 0
  );
  const hasAssistantTurn = body.transcript.some(
    (m) => m.role === "assistant" && m.text.trim().length > 0
  );

  if (!hasUserTurn || !hasAssistantTurn) {
    return NextResponse.json(
      { ok: false, error: "empty_transcript" },
      { status: 200 }
    );
  }

  try {
    const userPrompt = buildUserPrompt(body);

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SUMMARY_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("[/api/summarize] upstream error:", errText);
      return NextResponse.json(
        { ok: false, error: "upstream_error" },
        { status: 502 }
      );
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? "";

    let summary: unknown;
    try {
      summary = JSON.parse(content);
    } catch {
      console.error("[/api/summarize] model returned non-JSON:", content);
      return NextResponse.json(
        { ok: false, error: "bad_model_output" },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[/api/summarize] exception:", err);
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 }
    );
  }
}
