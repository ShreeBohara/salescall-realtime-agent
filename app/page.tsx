"use client";

import { useState, useRef } from "react";
import { RealtimeAgent, RealtimeSession } from "@openai/agents-realtime";

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
        instructions:
          "You are Earshot, a friendly sales copilot. Keep your responses short and conversational. Greet the user warmly when they connect.",
      });

      const session = new RealtimeSession(agent, {
        model: "gpt-realtime",
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
