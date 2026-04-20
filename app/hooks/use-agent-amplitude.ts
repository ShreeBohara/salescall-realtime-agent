"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Agent-amplitude loop for the voice orb. Mirrors `use-mic-amplitude`
 * but reads from the agent's playback audio element instead of the
 * user's microphone.
 *
 * The OpenAIRealtimeWebRTC transport is given a ref'd `<audio>`
 * element by the page; once connected, the SDK pipes the inbound
 * agent track into `audioRef.current.srcObject`. This hook attaches
 * a Web Audio analyser to that element so the orb can pulse with
 * the agent's actual voice amplitude — not just a fixed CSS rhythm.
 *
 * `MediaElementAudioSourceNode` taps the audio without disrupting
 * playback (we still connect through to `destination` so speakers
 * keep working). The browser routes the same audio twice: through
 * the analyser (for FFT data) and through the speakers.
 *
 * Runs only when `active` is true. Cleans up RAF, audio context,
 * and source node on disconnect to avoid zombie analysers.
 */
export function useAgentAmplitude(
  audioRef: RefObject<HTMLAudioElement | null>,
  active: boolean
): number {
  const [amplitude, setAmplitude] = useState(0);

  useEffect(() => {
    if (!active) {
      setAmplitude(0);
      return;
    }
    const audioEl = audioRef.current;
    if (!audioEl) return;

    let cancelled = false;
    let rafId: number | null = null;
    let audioCtx: AudioContext | null = null;
    let source: MediaElementAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let smoothed = 0;

    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioCtx = new AC();

      // createMediaElementSource throws if the same element has been
      // wrapped before. Across reconnects React keeps the ref stable
      // so we'd hit that on the second call. Cache the source on the
      // element so the second hook run reuses it instead of throwing.
      const cached = (
        audioEl as unknown as { __earshotSource?: MediaElementAudioSourceNode }
      ).__earshotSource;
      if (cached) {
        source = cached;
      } else {
        source = audioCtx.createMediaElementSource(audioEl);
        (
          audioEl as unknown as { __earshotSource?: MediaElementAudioSourceNode }
        ).__earshotSource = source;
      }

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);

      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (cancelled || !analyser) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length / 255;
        // Slightly less aggressive smoothing than the mic loop — the
        // agent's TTS is already pre-filtered so we don't need the
        // same noise tolerance, and a snappier response makes the
        // orb feel more alive.
        smoothed = smoothed * 0.6 + avg * 0.4;
        const display = Math.min(1, Math.max(0, smoothed * 3));
        setAmplitude(display);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    } catch (err) {
      console.warn("[useAgentAmplitude] unavailable:", err);
    }

    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      // Don't disconnect the cached source — the next mount will
      // re-attach a fresh analyser to it. Disconnecting + reusing
      // throws.
      if (analyser) {
        try {
          analyser.disconnect();
        } catch {
          /* ignore */
        }
      }
      if (audioCtx && audioCtx.state !== "closed") {
        audioCtx.close().catch(() => {
          /* ignore */
        });
      }
      setAmplitude(0);
    };
  }, [active, audioRef]);

  return amplitude;
}
