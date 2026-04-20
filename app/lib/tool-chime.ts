/**
 * Tool-completion chime.
 *
 * Audible fallback for the case where the agent's verbal
 * confirmation doesn't land. Observed in live testing: gpt-realtime
 * occasionally emits a `response.done` with no audio output at all
 * (no TTS generated) — especially after tool-call `duplicate_likely`
 * paths and multi-tool turns. The mic doesn't get stuck (the safety-
 * net unmute in page.tsx handles that) but the rep misses the
 * "Saved."/"Updated."/"Deleted." verbal cue and is left guessing
 * whether the action landed.
 *
 * The chime is a short, soft sine tone (~120 ms at ~880 Hz with a
 * gentle fade) played through the Web Audio API. No external assets
 * — the tone is synthesized on the fly so there's nothing to load,
 * cache, or host. The volume is deliberately low so it layers
 * cleanly over the agent's voice if both do happen.
 *
 * Usage pattern in page.tsx:
 *   1. On `agent_tool_end`, schedule a chime 600 ms in the future
 *      via `scheduleToolChime()`.
 *   2. On `audio_start`, cancel any pending chime via
 *      `cancelPendingToolChime()` — if the agent IS speaking, we
 *      don't need the fallback.
 *   3. On disconnect, `cancelPendingToolChime()` for safety.
 *
 * Why 600 ms: audio from the server typically begins streaming
 * within 100–400 ms of a tool's `response.done`. 600 ms is long
 * enough to avoid firing when the agent is just slow, short enough
 * that a silent confirmation still feels responsive.
 */

let sharedAudioContext: AudioContext | null = null;
let pendingChimeTimer: number | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedAudioContext) return sharedAudioContext;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    sharedAudioContext = new AC();
    return sharedAudioContext;
  } catch {
    return null;
  }
}

function playChime() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    // Resume on user-gesture'd browsers where the context might have
    // landed in the 'suspended' state. This is idempotent on already-
    // running contexts.
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    // 880 Hz (A5) — high enough to read as a "confirmation beep", low
    // enough not to feel piercing over voice audio.
    osc.frequency.setValueAtTime(880, now);

    // 10 ms attack, exponential decay to near-zero by 120 ms. The
    // attack avoids clicks; the decay gives a soft, brief shape.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  } catch {
    // Audio blocked (autoplay policy, etc.) — best-effort, no-op on
    // failure. Visual feedback via the Captured panel still lands.
  }
}

/**
 * Schedule a confirmation chime to play 600 ms from now. If another
 * chime is already pending, it gets cancelled first (only the most
 * recent tool call matters). Call `cancelPendingToolChime()` if the
 * agent starts speaking, to suppress the fallback.
 */
export function scheduleToolChime(): void {
  cancelPendingToolChime();
  pendingChimeTimer = window.setTimeout(() => {
    playChime();
    pendingChimeTimer = null;
  }, 600);
}

/**
 * Cancel any pending chime. Safe to call repeatedly.
 */
export function cancelPendingToolChime(): void {
  if (pendingChimeTimer !== null) {
    window.clearTimeout(pendingChimeTimer);
    pendingChimeTimer = null;
  }
}
