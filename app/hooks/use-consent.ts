"use client";

import { useCallback, useEffect, useState } from "react";

const CONSENT_KEY = "earshot:consent";

/**
 * First-visit consent gate state. Persisted to localStorage so it
 * shows once per browser. On SSR `window` is undefined, so the
 * initial read runs in an effect rather than inline — we start with
 * `open=false` (no flash of modal on SSR) and open it in the effect
 * if no prior consent is stored.
 */
export function useConsent() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const accepted = window.localStorage.getItem(CONSENT_KEY);
      if (accepted !== "yes") setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  const accept = useCallback(() => {
    try {
      window.localStorage.setItem(CONSENT_KEY, "yes");
    } catch {
      // private-browsing / storage disabled — still let the user through this session
    }
    setOpen(false);
  }, []);

  return { open, accept };
}
