"use client";

/**
 * VoiceOrb — ambient voice-presence visualization.
 *
 * Text is the hero in this UI; the orb is punctuation. A small
 * reactive sphere that conveys which phase the call is in. Five states
 * driven explicitly by the parent (not self-detected), because the
 * parent already knows from transcript state + session status:
 *
 *   idle        — pre-call, slow breathing gradient
 *   connecting  — WebRTC handshake in flight, rotating ring
 *   listening   — rep is speaking, mic amplitude drives scale
 *   thinking    — tool call in flight, shimmer rotation
 *   speaking    — agent is responding, rhythmic outward pulse
 *
 * Amplitude (0..1) is only read during "listening". Other phases run on
 * CSS keyframe animations. Respects `prefers-reduced-motion`.
 */

import { cn } from "@/lib/utils";

export type VoiceOrbPhase =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking";

export function VoiceOrb({
  phase,
  amplitude,
  size = 72,
  halo = false,
  className,
}: {
  phase: VoiceOrbPhase;
  amplitude?: number;
  size?: number;
  /** Render an expanded radial glow around the orb. Scales with `size`. */
  halo?: boolean;
  className?: string;
}) {
  const amp = Math.max(0, Math.min(1, amplitude ?? 0));

  const baseScale = phase === "listening" ? 1 + amp * 0.25 : 1;

  const tone =
    phase === "idle"
      ? "bg-[radial-gradient(circle_at_30%_30%,hsl(var(--muted-foreground)/0.5),hsl(var(--border))_60%,hsl(var(--background)))]"
      : phase === "connecting"
      ? "bg-[radial-gradient(circle_at_30%_30%,hsl(var(--chart-3,200_60%_60%))_0%,hsl(var(--muted-foreground)/0.7)_50%,hsl(var(--background))_100%)]"
      : phase === "thinking"
      ? "bg-[radial-gradient(circle_at_30%_30%,oklch(0.8_0.18_300),oklch(0.55_0.22_280)_45%,oklch(0.3_0.08_270)_90%)]"
      : phase === "speaking"
      ? "bg-[radial-gradient(circle_at_30%_30%,oklch(0.85_0.14_250),oklch(0.62_0.2_260)_45%,oklch(0.3_0.1_260)_90%)]"
      : /* listening */ "bg-[radial-gradient(circle_at_30%_30%,oklch(0.85_0.12_260),oklch(0.62_0.22_270)_45%,oklch(0.3_0.12_270)_90%)]";

  const haloOpacity =
    phase === "listening" || phase === "speaking" || phase === "thinking"
      ? 0.55
      : phase === "connecting"
      ? 0.3
      : 0.2;

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center",
        "motion-reduce:[&_.voice-orb-motion]:animate-none",
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {halo && (
        <span
          className="pointer-events-none absolute rounded-full blur-3xl transition-opacity duration-700"
          style={{
            width: size * 2.2,
            height: size * 2.2,
            background:
              "radial-gradient(circle, oklch(0.68 0.22 295 / 0.55), transparent 65%)",
            opacity: haloOpacity,
          }}
        />
      )}
      {phase === "connecting" && (
        <span
          className="voice-orb-motion absolute inset-0 rounded-full border-2 border-transparent border-t-primary/70 border-r-primary/40 animate-[spin_1.2s_linear_infinite]"
          style={{ padding: 2 }}
        />
      )}

      {phase === "speaking" && (
        <>
          <span
            className="voice-orb-motion absolute inset-0 rounded-full bg-primary/20 animate-[voice-orb-pulse_1.6s_ease-out_infinite]"
          />
          <span
            className="voice-orb-motion absolute inset-0 rounded-full bg-primary/15 animate-[voice-orb-pulse_1.6s_ease-out_infinite]"
            style={{ animationDelay: "0.4s" }}
          />
        </>
      )}

      {phase === "thinking" && (
        <span
          className="voice-orb-motion absolute inset-[-2px] rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,oklch(0.7_0.22_290/0.8)_90deg,transparent_180deg,oklch(0.7_0.22_290/0.5)_270deg,transparent_360deg)] animate-[spin_2.4s_linear_infinite]"
        />
      )}

      <div
        className={cn(
          "voice-orb-motion relative rounded-full shadow-[0_0_24px_-6px_rgba(124,92,247,0.5)] transition-transform duration-75 ease-out",
          tone,
          (phase === "idle" || phase === "listening") &&
            "animate-[voice-orb-breathe_4s_ease-in-out_infinite]"
        )}
        style={{
          width: size * 0.82,
          height: size * 0.82,
          transform: `scale(${baseScale})`,
        }}
      />

      <div
        className="voice-orb-motion pointer-events-none absolute inset-0 rounded-full opacity-70"
        style={{
          background:
            "radial-gradient(circle at 30% 28%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.05) 22%, transparent 40%)",
        }}
      />
    </div>
  );
}
