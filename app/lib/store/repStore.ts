/**
 * Signed-in-rep store.
 *
 * Earshot is built for one human at a time — the rep who's about to
 * take a call. This tiny store holds their identity (currently just a
 * display name) and persists it to localStorage so reloads don't force
 * them back through onboarding.
 *
 * Shape mirrors `callHistoryStore`:
 *   - module-level state with listeners
 *   - SSR-safe first snapshot (returns null on the server and the
 *     first client render so React's hydration pass sees identical
 *     DOM on both sides; `initClientRep()` swaps in the persisted
 *     value after mount via a normal notify cycle)
 *   - writes are synchronous and fan out via `notify()`
 *
 * This is a client-side stub. In a real multi-tenant deployment the
 * rep identity would come from an auth provider (NextAuth / Clerk /
 * Workos) and the tools would stamp `createdBy` server-side rather
 * than reading it from the browser. For the demo, "who am I" lives
 * here and is editable from the profile popover.
 */

export type Rep = {
  /** Display name the UI shows and the agent uses in conversation. */
  name: string;
  /** First grapheme uppercased — rendered in the monogram chip. */
  initial: string;
  /** ISO timestamp of when this identity was first captured. */
  signedInAt: string;
};

type Listener = () => void;

const STORAGE_KEY = "earshot:current-rep";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function computeInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "·";
  // Grab the first visible character; works for most Latin names
  // without dragging in a grapheme-segmenter dependency.
  return trimmed.charAt(0).toUpperCase();
}

function hydrate(): Rep | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as Rep).name !== "string" ||
      (parsed as Rep).name.trim().length === 0
    ) {
      return null;
    }
    const p = parsed as Partial<Rep>;
    return {
      name: (p.name as string).trim(),
      // Recompute initial on read in case the stored value is stale
      // (e.g. someone edited localStorage by hand).
      initial: computeInitial(p.name as string),
      signedInAt:
        typeof p.signedInAt === "string" ? p.signedInAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function persist(next: Rep | null) {
  if (!canUseStorage()) return;
  try {
    if (next === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Quota / privacy-mode failures are non-fatal; the in-memory
    // value still drives the current tab.
  }
}

/**
 * Rep starts NULL on both server and client. We don't read localStorage
 * at module load because that would desync SSR vs the first client
 * render. `initClientRep()` hydrates after mount through a normal
 * notify cycle, the same trick callHistoryStore uses.
 */
let current: Rep | null = null;
let clientHydrated = false;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

/**
 * Hydrate from localStorage exactly once, after React's first pass.
 * Called from a `useEffect` in the root page; subsequent calls are
 * no-ops. No-op on the server.
 */
export function initClientRep() {
  if (clientHydrated) return;
  if (!canUseStorage()) return;
  clientHydrated = true;
  const persisted = hydrate();
  if (persisted === null) return;
  current = persisted;
  notify();
}

/**
 * Save (or overwrite) the signed-in rep. The onboarding modal calls
 * this when the user hits Continue; the profile popover could also
 * call it if we ever let people edit their name.
 */
export function setCurrentRep(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const next: Rep = {
    name: trimmed,
    initial: computeInitial(trimmed),
    // Preserve the original sign-in time across in-session edits;
    // treat a fresh name as a fresh session only when there was no
    // previous rep.
    signedInAt: current?.signedInAt ?? new Date().toISOString(),
  };
  current = next;
  persist(next);
  notify();
}

/**
 * Sign out. Clears localStorage and the in-memory value, which causes
 * the onboarding modal to re-appear and the agent to fall back to the
 * generic "the rep" voice on its next call.
 */
export function clearCurrentRep() {
  if (current === null) return;
  current = null;
  persist(null);
  notify();
}

export function subscribeToCurrentRep(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCurrentRepSnapshot(): Rep | null {
  return current;
}

/**
 * SSR-safe snapshot. Always returns null so the server and the first
 * client render agree; the real rep swaps in via `initClientRep()`
 * after mount. Without this, any localStorage-driven identity would
 * trip React's hydration warning.
 */
export function getServerCurrentRepSnapshot(): Rep | null {
  return null;
}

/**
 * First name only, for UI micro-copy ("Ready when you are, Shree.").
 * Returns null when nobody is signed in so callers can skip the
 * personalization gracefully.
 */
export function getFirstName(rep: Rep | null): string | null {
  if (!rep) return null;
  const parts = rep.name.trim().split(/\s+/);
  return parts[0] ?? null;
}
