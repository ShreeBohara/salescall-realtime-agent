"use client";

import { useEffect, useState } from "react";

/**
 * Mic-amplitude loop for the voice orb. Runs ONLY while the session is
 * connected. Gets its own MediaStream (the SDK has already asked for
 * permission by this point, so this second call is silent — the browser
 * reuses the granted permission). FFT data is averaged and smoothed to
 * drive the orb's "listening" scale.
 *
 * Cleanup is critical: stop RAF, close AudioContext, stop tracks. A
 * stale loop after disconnect = memory leak + zombie mic indicator in
 * the browser tab.
 *
 * Hook is SSR-safe: the `window` / `navigator` access only runs after
 * the effect fires, and the effect only runs when `active` is true.
 */
export function useMicAmplitude(active: boolean): number {
  const [amplitude, setAmplitude] = useState(0);

  useEffect(() => {
    if (!active) {
      setAmplitude(0);
      return;
    }

    let cancelled = false;
    let rafId: number | null = null;
    let audioCtx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let analyser: AnalyserNode | null = null;
    let smoothed = 0;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        audioCtx = new AC();
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (cancelled || !analyser) return;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length / 255;
          smoothed = smoothed * 0.7 + avg * 0.3;
          const display = Math.min(1, Math.max(0, smoothed * 2.5));
          setAmplitude(display);
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch (err) {
        console.warn("[useMicAmplitude] unavailable:", err);
      }
    })();

    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioCtx && audioCtx.state !== "closed") {
        audioCtx.close().catch(() => {
          /* ignore */
        });
      }
      setAmplitude(0);
    };
  }, [active]);

  return amplitude;
}
