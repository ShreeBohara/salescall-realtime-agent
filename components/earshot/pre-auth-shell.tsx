"use client";

import { cn } from "@/lib/utils";

/**
 * Pre-auth shell.
 *
 * Rendered INSTEAD OF the full dashboard while nobody is signed in
 * (i.e. the onboarding modal is covering the screen). The goal is a
 * narrative one: before the rep tells Earshot who they are, there is
 * no rep-specific context to display — no customer brief, no open
 * objections, no captured tasks. Showing the real dashboard behind a
 * half-transparent modal breaks the fiction of "your personal agent"
 * and leaks data that, in a real deployment, would belong to someone
 * else's account.
 *
 * Design contract:
 *   - Deliberately empty background. The previous iteration had a
 *     large italic "Earshot" hero centered on the splash, but with
 *     the onboarding modal immediately below it the page read as
 *     two stacked brand moments fighting for attention. We've moved
 *     the wordmark INSIDE the modal's header (see RepOnboarding) so
 *     identity + call-to-action live in one card. The background
 *     only needs to set a calm stage.
 *   - Full-height, non-scrolling. With no dashboard content, the
 *     page fits in one viewport, which keeps the viewport-centered
 *     modal exactly on the visible center.
 *   - Ambient radial wash uses the voice accent at very low alpha
 *     so the stage isn't a flat black rectangle, without reading as
 *     competing UI.
 *   - Accepts children so the caller can drop the RepOnboarding
 *     modal on top; the shell itself knows nothing about onboarding
 *     state.
 */
export function PreAuthShell({ children }: { children?: React.ReactNode }) {
  return (
    <div
      className={cn(
        // h-screen + overflow-hidden guarantees the shell never
        // scrolls, which is what keeps the viewport-centered modal
        // in the visible area regardless of window size.
        "relative flex h-screen flex-col overflow-hidden bg-background"
      )}
    >
      {/* Ambient backdrop. Low-opacity radial wash in the voice
          accent gives the stage a pulse of brand color without
          reading as competing UI behind the modal. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,hsl(var(--accent-voice)/0.1),transparent_65%)]"
      />

      {/* Main stage is intentionally empty — all identity and copy
          now lives inside the modal. flex-1 just reserves the space
          between header and footer so the viewport-centered modal
          has room above and below it. */}
      <main className="relative z-10 flex-1" aria-hidden="true" />

      {/* Footer signature — mirrors the dashboard's bottom-rail
          attribution so the case-study credit stays visible even on
          the pre-auth screen. Kept at a lower opacity so it doesn't
          pull attention from the modal. */}
      <footer className="relative z-10 flex h-10 items-center justify-end px-4 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 sm:px-6 lg:px-8">
        instalily case study · apr 2026
      </footer>

      {children}
    </div>
  );
}
