"use client";

import { useState, useRef } from "react";
import { RealtimeAgent, RealtimeSession } from "@openai/agents-realtime";
import { saveNote } from "./lib/tools/saveNote";

export default function Home() {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected">("idle");
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<RealtimeSession | null>(null);

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
          "You have one tool available: `save_note`. Use it whenever the rep explicitly asks to capture a note, save a takeaway, record an observation, or log something from the call.",
          "When you call `save_note`, give a spoken confirmation out loud (e.g. \"Saved.\") so the rep knows it worked.",
          "Do not call `save_note` unless the rep asked for a note — don't save summaries on your own initiative yet.",
        ].join("\n"),
        tools: [saveNote],
      });

      const session = new RealtimeSession(agent, {
        model: "gpt-realtime",
      });

      session.on("agent_tool_start", (_ctx, _agent, tool, details) => {
        console.log("[agent_tool_start]", {
          tool: tool.name,
          toolCall: details.toolCall,
        });
      });

      session.on("agent_tool_end", (_ctx, _agent, tool, result, details) => {
        console.log("[agent_tool_end]", {
          tool: tool.name,
          result,
          toolCall: details.toolCall,
        });
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

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Earshot</h1>
      <p className="text-gray-500">Voice-first sales copilot</p>

      <div className="flex flex-col items-center gap-4">
        <div className="text-sm">
          Status: <span className="font-mono font-semibold">{status}</span>
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
          <button disabled className="rounded-full bg-gray-400 px-8 py-4 text-white">
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

        {error && <div className="text-red-500 text-sm">Error: {error}</div>}
      </div>

      <p className="text-xs text-gray-400 max-w-md text-center">
        Click &quot;Start talking&quot; and allow microphone access. Say hello &mdash; the AI should
        respond.
      </p>
    </main>
  );
}
