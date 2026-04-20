/**
 * Tiny module-level store for follow-up tasks.
 *
 * Tool `execute` handlers run in the browser but outside the React tree, so
 * they can't call `useState`. This store gives us a single shared source of
 * truth that both the tools and the React UI can read/write. The React UI
 * subscribes via `useSyncExternalStore` and re-renders on change.
 *
 * This is a client-side stub intended to demonstrate the update/cancel flow
 * without needing a real backend. In production, each tool's execute would
 * hit a `/api/tools/*` route with a real database.
 */

export type TaskChannel = "email" | "phone" | "calendar" | "other";
export type TaskStatus = "active" | "cancelled";

export type FollowUpTask = {
  id: string;
  customer: string;
  due_at: string;
  channel: TaskChannel;
  body: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  /**
   * Display name of the rep who created this task, captured from
   * the repStore at tool-execute time. Optional for the same reason
   * as `Note.createdBy` — fixtures and pre-sign-in calls have no
   * meaningful author. Kept silent in the UI today; present in the
   * data so a future per-rep filter has it ready.
   */
  createdBy?: string;
};

type Listener = () => void;

const tasks = new Map<string, FollowUpTask>();
const listeners = new Set<Listener>();

// Cached snapshot so useSyncExternalStore sees a stable reference when nothing changed.
// Rebuilt only when a mutation calls notify().
let cachedSnapshot: readonly FollowUpTask[] = [];

function rebuildSnapshot() {
  cachedSnapshot = Array.from(tasks.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1
  );
}

function notify() {
  rebuildSnapshot();
  listeners.forEach((l) => l());
}

export function addTask(task: FollowUpTask): FollowUpTask {
  tasks.set(task.id, task);
  notify();
  return task;
}

export function getTask(id: string): FollowUpTask | null {
  return tasks.get(id) ?? null;
}

export function updateTask(
  id: string,
  patch: Partial<Omit<FollowUpTask, "id" | "createdAt">>
): FollowUpTask | null {
  const existing = tasks.get(id);
  if (!existing) return null;
  const updated: FollowUpTask = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  tasks.set(id, updated);
  notify();
  return updated;
}

/** Find the most recent active task whose customer loosely matches. */
export function findLatestActiveForCustomer(
  customer: string
): FollowUpTask | null {
  const needle = customer.trim().toLowerCase();
  if (!needle) return null;
  let best: FollowUpTask | null = null;
  for (const task of tasks.values()) {
    if (task.status !== "active") continue;
    const haystack = task.customer.toLowerCase();
    if (haystack === needle || haystack.includes(needle) || needle.includes(haystack)) {
      if (!best || task.createdAt > best.createdAt) {
        best = task;
      }
    }
  }
  return best;
}

/**
 * Normalize a string for duplicate detection.
 * Lowercase + trim + collapse whitespace + strip trailing punctuation.
 * Conservative on purpose — false positives (blocking a legit new task)
 * are worse than false negatives here.
 */
function normalizeForDup(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?,]+$/, "");
}

function customerLooseMatch(a: string, b: string): boolean {
  const na = normalizeForDup(a);
  const nb = normalizeForDup(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Loose match for due-at strings. "Friday" and "this Friday" refer to
 * the same day in common rep speech, so we treat deictic prefixes as
 * noise. Also handles "on Friday" / "next Friday" conservatively —
 * "next Friday" is NOT considered the same as "Friday" (different
 * intent), so we only strip `this/the/on/at` but keep `next`.
 */
function dueLooseMatch(a: string, b: string): boolean {
  const strip = (s: string) =>
    normalizeForDup(s).replace(/^(this|the|on|at|by|in)\s+/, "");
  const na = strip(a);
  const nb = strip(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Token-set similarity for task bodies. A stop-word list strips common
 * filler (including due-at deictics like "this", "on") so two bodies
 * that differ only by such words still match. Returns a Jaccard score
 * in [0, 1] over the remaining tokens.
 */
const BODY_STOPWORDS = new Set([
  "a", "an", "the", "to", "for", "of", "in", "on", "at", "by",
  "this", "that", "these", "those", "next", "and", "or", "about",
  "with", "from", "make", "just", "please",
]);

function bodyTokenSet(s: string): Set<string> {
  return new Set(
    normalizeForDup(s)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0 && !BODY_STOPWORDS.has(t))
  );
}

function bodySimilar(a: string, b: string): boolean {
  const na = normalizeForDup(a);
  const nb = normalizeForDup(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const ta = bodyTokenSet(a);
  const tb = bodyTokenSet(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let intersect = 0;
  for (const t of ta) if (tb.has(t)) intersect++;
  const union = ta.size + tb.size - intersect;
  if (union === 0) return false;
  const jaccard = intersect / union;
  return jaccard >= 0.65;
}

/**
 * Find an existing active task that looks like a duplicate of the candidate.
 * Match rule: customer (loose) + due_at (loose) + channel (exact) +
 * body (similar — substring OR token-set Jaccard ≥ 0.65).
 *
 * Fuzzier than strict-equality so small rephrasings don't slip through:
 *   ("email Sarah about pricing", "Friday")
 *   vs
 *   ("email Sarah about pricing this Friday", "this Friday")
 * are correctly treated as the same task.
 */
export function findNearDuplicateTask(candidate: {
  customer: string;
  due_at: string;
  channel: TaskChannel;
  body: string;
}): FollowUpTask | null {
  for (const task of tasks.values()) {
    if (task.status !== "active") continue;
    if (!customerLooseMatch(task.customer, candidate.customer)) continue;
    if (!dueLooseMatch(task.due_at, candidate.due_at)) continue;
    if (task.channel !== candidate.channel) continue;
    if (!bodySimilar(task.body, candidate.body)) continue;
    return task;
  }
  return null;
}

export function getAllTasks(): readonly FollowUpTask[] {
  return cachedSnapshot;
}

export function clearAllTasks() {
  tasks.clear();
  notify();
}

export function subscribeToTasks(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTasksSnapshot(): readonly FollowUpTask[] {
  return cachedSnapshot;
}
