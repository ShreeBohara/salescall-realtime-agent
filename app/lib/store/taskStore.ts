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
    .replace(/[.!?]+$/, "");
}

function customerLooseMatch(a: string, b: string): boolean {
  const na = normalizeForDup(a);
  const nb = normalizeForDup(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Find an existing active task that looks like a duplicate of the candidate.
 * Match rule: customer (loose) + due_at (exact after normalize) +
 * channel (exact) + body (exact after normalize). All four must match.
 */
export function findNearDuplicateTask(candidate: {
  customer: string;
  due_at: string;
  channel: TaskChannel;
  body: string;
}): FollowUpTask | null {
  const cDue = normalizeForDup(candidate.due_at);
  const cBody = normalizeForDup(candidate.body);
  for (const task of tasks.values()) {
    if (task.status !== "active") continue;
    if (!customerLooseMatch(task.customer, candidate.customer)) continue;
    if (normalizeForDup(task.due_at) !== cDue) continue;
    if (task.channel !== candidate.channel) continue;
    if (normalizeForDup(task.body) !== cBody) continue;
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
