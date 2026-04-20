"use client";

/**
 * VoiceOrb — clean circular waveform visualization.
 *
 * A small solid core with thin frequency bars radiating outward.
 * Bars react to voice amplitude via simplex noise. Color shifts
 * per phase. Compact, contained, no overflow. Pure canvas.
 */

import { useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

export type VoiceOrbPhase =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking";

/* ---- Simplex noise (2D) ---- */
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD: [number, number][] = [
  [1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1],
];
const P = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
const PERM: number[] = [];
for (let i = 0; i < 512; i++) PERM[i] = P[i & 255];

function simplex2(xin: number, yin: number): number {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s), j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t), y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  const gi0 = PERM[ii + PERM[jj]] % 8;
  const gi1 = PERM[ii + i1 + PERM[jj + j1]] % 8;
  const gi2 = PERM[ii + 1 + PERM[jj + 1]] % 8;
  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0*x0 - y0*y0;
  if (t0 >= 0) { t0 *= t0; n0 = t0*t0*(GRAD[gi0][0]*x0+GRAD[gi0][1]*y0); }
  let t1 = 0.5 - x1*x1 - y1*y1;
  if (t1 >= 0) { t1 *= t1; n1 = t1*t1*(GRAD[gi1][0]*x1+GRAD[gi1][1]*y1); }
  let t2 = 0.5 - x2*x2 - y2*y2;
  if (t2 >= 0) { t2 *= t2; n2 = t2*t2*(GRAD[gi2][0]*x2+GRAD[gi2][1]*y2); }
  return 70 * (n0 + n1 + n2);
}

/* ---- Phase palettes ---- */
interface Palette {
  /** [h, s, l] for bar start (near core) */
  inner: [number, number, number];
  /** [h, s, l] for bar end (tip) */
  outer: [number, number, number];
  /** Core circle fill */
  core: [number, number, number];
  /** Glow color */
  glow: [number, number, number];
  /** Base bar height multiplier */
  barBase: number;
  /** Noise animation speed */
  speed: number;
}

const PALETTES: Record<VoiceOrbPhase, Palette> = {
  idle: {
    inner: [260, 70, 65],
    outer: [220, 50, 45],
    core:  [255, 60, 55],
    glow:  [260, 55, 50],
    barBase: 0.3,
    speed: 0.008,
  },
  connecting: {
    inner: [260, 55, 55],
    outer: [230, 45, 40],
    core:  [250, 50, 48],
    glow:  [255, 45, 42],
    barBase: 0.25,
    speed: 0.025,
  },
  listening: {
    inner: [20, 90, 65],
    outer: [340, 75, 55],
    core:  [15, 85, 58],
    glow:  [18, 80, 52],
    barBase: 0.35,
    speed: 0.012,
  },
  speaking: {
    inner: [185, 90, 65],
    outer: [210, 75, 50],
    core:  [190, 85, 55],
    glow:  [192, 80, 48],
    barBase: 0.35,
    speed: 0.012,
  },
  thinking: {
    inner: [310, 85, 68],
    outer: [280, 65, 50],
    core:  [300, 78, 55],
    glow:  [305, 72, 48],
    barBase: 0.4,
    speed: 0.02,
  },
};

/* ---- Utility ---- */
function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function lerpHSL(a: [number,number,number], b: [number,number,number], t: number): [number,number,number] {
  let dh = b[0] - a[0];
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return [((a[0] + dh * t) % 360 + 360) % 360, lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function hsl(c: [number,number,number], a = 1) {
  return `hsla(${c[0]},${c[1]}%,${c[2]}%,${a})`;
}

/* ---- Constants ---- */
const BAR_COUNT = 48;
const TWO_PI = Math.PI * 2;

/* ---- Component ---- */
export function VoiceOrb({
  phase,
  amplitude,
  agentAmplitude,
  size = 72,
  halo = false,
  className,
}: {
  phase: VoiceOrbPhase;
  amplitude?: number;
  agentAmplitude?: number;
  size?: number;
  halo?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const st = useRef({
    phase: phase as VoiceOrbPhase,
    ampUser: 0,
    ampAgent: 0,
    halo,
    // Lerped colors
    cInner: [...PALETTES[phase].inner] as [number,number,number],
    cOuter: [...PALETTES[phase].outer] as [number,number,number],
    cCore:  [...PALETTES[phase].core]  as [number,number,number],
    cGlow:  [...PALETTES[phase].glow]  as [number,number,number],
    barBase: PALETTES[phase].barBase,
    speed:   PALETTES[phase].speed,
    time: 0,
    reducedMotion: false,
  });

  useEffect(() => { st.current.phase = phase; }, [phase]);
  useEffect(() => { st.current.ampUser = clamp01(amplitude ?? 0); }, [amplitude]);
  useEffect(() => { st.current.ampAgent = clamp01(agentAmplitude ?? 0); }, [agentAmplitude]);
  useEffect(() => { st.current.halo = halo; }, [halo]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    st.current.reducedMotion = mq.matches;
    const h = (e: MediaQueryListEvent) => { st.current.reducedMotion = e.matches; };
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const s = st.current;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const cx = w / 2;
    const cy = h / 2;

    // Lerp palette
    const target = PALETTES[s.phase];
    const lr = s.reducedMotion ? 1 : 0.07;
    s.cInner = lerpHSL(s.cInner, target.inner, lr);
    s.cOuter = lerpHSL(s.cOuter, target.outer, lr);
    s.cCore  = lerpHSL(s.cCore,  target.core, lr);
    s.cGlow  = lerpHSL(s.cGlow,  target.glow, lr);
    s.barBase = lerp(s.barBase, target.barBase, lr);
    s.speed  = lerp(s.speed,   target.speed, lr);

    const activeAmp = s.phase === "listening" ? s.ampUser
                    : s.phase === "speaking"  ? s.ampAgent
                    : 0;

    if (!s.reducedMotion) s.time += s.speed;

    const coreRadius = Math.min(cx, cy) * 0.34;
    const maxBarLen  = Math.min(cx, cy) * 0.38;

    ctx.clearRect(0, 0, w, h);

    // ── Soft glow behind core ──
    if (s.halo) {
      const glowR = coreRadius * (2.4 + activeAmp * 0.8);
      const gg = ctx.createRadialGradient(cx, cy, coreRadius * 0.5, cx, cy, glowR);
      gg.addColorStop(0, hsl(s.cGlow, 0.18 + activeAmp * 0.15));
      gg.addColorStop(0.5, hsl(s.cGlow, 0.06 + activeAmp * 0.04));
      gg.addColorStop(1, hsl(s.cGlow, 0));
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, TWO_PI);
      ctx.fill();
    }

    // ── Bars ──
    const barWidth = Math.max(1.8, (TWO_PI * coreRadius * 1.15) / BAR_COUNT * 0.55);

    for (let i = 0; i < BAR_COUNT; i++) {
      const angle = (i / BAR_COUNT) * TWO_PI - Math.PI / 2;
      const t = s.time;

      // Noise-driven bar height
      const n = simplex2(
        Math.cos(angle) * 2 + t,
        Math.sin(angle) * 2 + t
      );
      const noise01 = (n + 1) / 2; // 0..1

      const barHeight = maxBarLen * (s.barBase + noise01 * (0.5 + activeAmp * 0.5));
      const startR = coreRadius + 2;
      const endR = startR + barHeight;

      // Bar line
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x1 = cx + cos * startR;
      const y1 = cy + sin * startR;
      const x2 = cx + cos * endR;
      const y2 = cy + sin * endR;

      // Gradient along the bar
      const barGrad = ctx.createLinearGradient(x1, y1, x2, y2);
      const barAlpha = 0.6 + noise01 * 0.35 + activeAmp * 0.05;
      barGrad.addColorStop(0, hsl(s.cInner, barAlpha));
      barGrad.addColorStop(1, hsl(s.cOuter, barAlpha * 0.35));

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = barGrad;
      ctx.lineWidth = barWidth;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    // ── Core circle ──
    // Subtle shadow glow
    ctx.save();
    ctx.shadowColor = hsl(s.cGlow, 0.6 + activeAmp * 0.25);
    ctx.shadowBlur = coreRadius * (0.6 + activeAmp * 0.4);

    const coreGrad = ctx.createRadialGradient(
      cx - coreRadius * 0.2, cy - coreRadius * 0.2, 0,
      cx, cy, coreRadius
    );
    coreGrad.addColorStop(0, hsl([
      s.cCore[0],
      Math.min(95, s.cCore[1] + activeAmp * 10),
      Math.min(82, s.cCore[2] + activeAmp * 12),
    ]));
    coreGrad.addColorStop(1, hsl(s.cCore, 0.9));

    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, TWO_PI);
    ctx.fillStyle = coreGrad;
    ctx.fill();
    ctx.restore();

    // ── Core specular highlight ──
    const specGrad = ctx.createRadialGradient(
      cx - coreRadius * 0.25, cy - coreRadius * 0.3, 0,
      cx, cy, coreRadius * 0.7
    );
    specGrad.addColorStop(0, "rgba(255,255,255,0.25)");
    specGrad.addColorStop(0.5, "rgba(255,255,255,0.04)");
    specGrad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, TWO_PI);
    ctx.fillStyle = specGrad;
    ctx.fill();
  }, []);

  // RAF loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    // 1.4x canvas gives room for the soft glow to extend
    // beyond the orb without being aggressively large.
    const canvasLogical = size * 1.4;
    canvas.width = canvasLogical * dpr;
    canvas.height = canvasLogical * dpr;
    canvas.style.width = `${canvasLogical}px`;
    canvas.style.height = `${canvasLogical}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let rafId: number;
    const loop = () => { draw(); rafId = requestAnimationFrame(loop); };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [size, draw]);

  const canvasLogical = size * 1.4;
  const offset = (canvasLogical - size) / 2;

  return (
    <div
      className={cn(
        "voice-orb-root relative flex shrink-0 items-center justify-center",
        className
      )}
      style={{ width: size, height: size }}
      data-phase={phase}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute"
        style={{
          top: -offset,
          left: -offset,
          width: canvasLogical,
          height: canvasLogical,
        }}
      />
    </div>
  );
}
