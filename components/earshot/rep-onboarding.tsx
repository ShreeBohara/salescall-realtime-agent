"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Rep onboarding — the first-visit "who are you?" gate.
 *
 * Philosophy: this stands in for a future auth flow without pretending
 * to be one. We ask for a name, we store it in localStorage, we carry
 * it through every surface (top rail chip, agent prompt, authored-by
 * stamps). No password, no email confirmation, no OAuth dance — the
 * fiction is "this is YOUR personal Earshot, signed in for you".
 *
 * UX contract:
 *   - Modal is non-dismissible by outside-click or Escape. The only
 *     way out is to submit a non-empty name. Dismissing silently
 *     would leave the app in a weird half-personalized state (agent
 *     still generic, chip still empty) that's worse than either the
 *     fully-signed-in or fully-signed-out experiences.
 *   - Name field is pre-filled with "Shree" because this is shipping
 *     as a demo for Shree. Caller can override via `defaultName` if
 *     that ever changes.
 *   - Input is auto-focused and its text is pre-selected so a rep
 *     who wants to use their own name can just start typing and the
 *     default gets replaced.
 *   - Submit clamps to `.trim()` — leading/trailing whitespace would
 *     otherwise show up in the monogram and the agent greeting,
 *     which looks janky.
 */
export function RepOnboarding({
  open,
  onComplete,
  defaultName = "Shree",
}: {
  open: boolean;
  onComplete: (name: string) => void;
  defaultName?: string;
}) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset and re-focus whenever the modal re-opens. This matters for
  // the sign-out → sign-in loop: after signing out, we re-open with
  // the default pre-filled, not whatever the previous session typed.
  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    // Defer to the next tick so the dialog has mounted its input.
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => window.clearTimeout(id);
  }, [open, defaultName]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    onComplete(trimmed);
  };

  return (
    <Dialog
      open={open}
      // Swallow every close intent that isn't an explicit submit.
      // Radix fires onOpenChange for backdrop click, Escape, and the
      // close button (there isn't one here) — we want none of those
      // paths to leave us nameless.
      onOpenChange={() => {}}
    >
      <DialogContent
        // Prevent the Radix-default Escape-to-close and
        // pointer-down-outside-to-close behaviors, AND hide the
        // auto-injected X close button. This dialog is the first-
        // visit gate — the only way out is a real submit.
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        showCloseButton={false}
        // Force viewport-centering with `!important`. Radix's default
        // `fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2`
        // combined with tailwindcss-animate's `zoom-in-95` keyframes
        // sometimes loses the centering translates mid-animation,
        // leaving the dialog with its top-left corner at viewport
        // center (i.e. visually stuck in the bottom-right quadrant).
        // Explicit `!` prefixes win over the animation's composite
        // transform variables and guarantee the modal lands dead-
        // center regardless of splash-shell layout above.
        className="!fixed !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2 sm:max-w-md"
      >
        {/* Copy contract: the splash behind us is deliberately empty
         *  — the Earshot brand mark now lives HERE, inside the card,
         *  so the modal is the single visual anchor on the pre-auth
         *  screen. A tiny wordmark + tagline sit above the question
         *  so the rep immediately sees "yes, this is Earshot" without
         *  a second stacked hero. Title is a short question; the
         *  description adds a touch of texture about what the name
         *  actually does, so the field doesn't feel like it's asking
         *  for data with no stated purpose. */}
        <div
          aria-hidden="true"
          className="flex items-center gap-2 text-muted-foreground"
        >
          <span
            className="text-[15px] italic leading-none tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Earshot
          </span>
          <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
          <span className="text-[9px] uppercase tracking-[0.22em]">
            voice-first sales copilot
          </span>
        </div>

        <DialogHeader>
          <DialogTitle>Who&apos;s using Earshot?</DialogTitle>
          <DialogDescription>
            We&apos;ll tune the voice agent to you — greetings by name,
            notes and tasks stamped as yours.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <label className="flex flex-col gap-2 text-sm">
            <span className="font-medium text-foreground">Your name</span>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Shree"
              autoComplete="off"
              spellCheck={false}
              aria-label="Your name"
              maxLength={40}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <span className="text-[11px] text-muted-foreground">
              Stays on this device.
            </span>
          </label>

          <DialogFooter>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="w-full sm:w-auto"
            >
              Continue as {trimmed || "…"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
