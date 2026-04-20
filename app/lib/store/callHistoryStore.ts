/**
 * Module-level call history store.
 *
 * Only ended calls whose summary actually resolved (`ready`) are kept.
 * Empty / error calls are skipped — they wouldn't help the rep anyway,
 * and cluttering the popover with "call too short" rows hurts the
 * signal. Most recent call is at index 0.
 *
 * Persisted to localStorage so reloads don't erase the session. Capped
 * at MAX_ENTRIES to keep the payload small; this isn't a real backend.
 */

import type { CallSummary } from "@/app/lib/types";

export type CallRecord = {
  id: string;
  endedAt: number;
  startedAt: number | null;
  forCustomer: string | null;
  summary: CallSummary;
};

type Listener = () => void;

const STORAGE_KEY = "earshot:call-history";
const MAX_ENTRIES = 20;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function hydrate(): readonly CallRecord[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Basic shape check — drop anything that doesn't look like a record.
    return parsed.filter(
      (r): r is CallRecord =>
        !!r &&
        typeof r === "object" &&
        typeof (r as CallRecord).id === "string" &&
        typeof (r as CallRecord).endedAt === "number" &&
        (r as CallRecord).summary != null
    );
  } catch {
    return [];
  }
}

function persist(next: readonly CallRecord[]) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or serialization failures are non-fatal; in-memory state
    // still works for the current session.
  }
}

const EMPTY_HISTORY: readonly CallRecord[] = Object.freeze([]);
/**
 * History starts EMPTY on both server and client. We don't read
 * localStorage at module load because that would make the first
 * client snapshot differ from the SSR snapshot and trip React's
 * hydration check. `initClientCallHistory()` (called from a
 * `useEffect` in the consumer) runs after mount and swaps in the
 * persisted data via a normal notify/re-render cycle.
 */
let history: readonly CallRecord[] = EMPTY_HISTORY;
let clientHydrated = false;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

/**
 * Hydrate from localStorage exactly once, after React has finished
 * its initial hydration pass. Safe to call from multiple places —
 * subsequent calls are no-ops. No-op on the server.
 */
export function initClientCallHistory() {
  if (clientHydrated) return;
  if (!canUseStorage()) return;
  clientHydrated = true;
  const persisted = hydrate();
  if (persisted.length === 0) return;
  history = persisted;
  notify();
}

export function addCallToHistory(record: CallRecord) {
  history = [record, ...history].slice(0, MAX_ENTRIES);
  persist(history);
  notify();
}

export function clearCallHistory() {
  if (history.length === 0) return;
  history = [];
  persist(history);
  notify();
}

export function subscribeToCallHistory(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCallHistorySnapshot(): readonly CallRecord[] {
  return history;
}

/**
 * SSR-safe snapshot. Returns a stable empty array so the server and
 * first client render agree; the real history swaps in after
 * hydration completes. Without this, a localStorage-backed history
 * causes React hydration mismatches — server renders no popover,
 * client renders it, DOM position diverges.
 */
export function getServerCallHistorySnapshot(): readonly CallRecord[] {
  return EMPTY_HISTORY;
}
