/**
 * Tiny module-level store for post-call notes.
 *
 * Mirrors the pattern in `./taskStore.ts`: a Map keyed by id, a Set of
 * listeners, and a cached snapshot that's rebuilt only on mutation so
 * `useSyncExternalStore` sees a stable reference when nothing changed.
 *
 * Delete is soft (status flips to "deleted") so the UI can render a
 * strikethrough / "deleted" badge, matching how tasks cancel. The
 * agent-actions feed preserves the audit trail regardless.
 */

export type NoteStatus = "active" | "deleted";

export type Note = {
  id: string;
  customer: string;
  body: string;
  tags: string[];
  status: NoteStatus;
  createdAt: string;
  updatedAt: string;
  /**
   * Display name of the rep who authored this note, captured from
   * the repStore at tool-execute time. Optional because notes saved
   * before the rep signed in (or during automated test fixtures)
   * have no meaningful author — the UI treats null/undefined as
   * "unattributed" and skips the byline. Not surfaced in the UI
   * today; we stamp it silently so a future "Shree's notes" filter
   * or audit view has the data ready.
   */
  createdBy?: string;
};

type Listener = () => void;

const notes = new Map<string, Note>();
const listeners = new Set<Listener>();

let cachedSnapshot: readonly Note[] = [];

function rebuildSnapshot() {
  cachedSnapshot = Array.from(notes.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1
  );
}

function notify() {
  rebuildSnapshot();
  listeners.forEach((l) => l());
}

export function addNote(note: Note): Note {
  notes.set(note.id, note);
  notify();
  return note;
}

export function getNote(id: string): Note | null {
  return notes.get(id) ?? null;
}

export function updateNote(
  id: string,
  patch: Partial<Omit<Note, "id" | "createdAt">>
): Note | null {
  const existing = notes.get(id);
  if (!existing) return null;
  const updated: Note = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  notes.set(id, updated);
  notify();
  return updated;
}

/** Find the most recent active note whose customer loosely matches. */
export function findLatestActiveNoteForCustomer(
  customer: string
): Note | null {
  const needle = customer.trim().toLowerCase();
  if (!needle) return null;
  let best: Note | null = null;
  for (const note of notes.values()) {
    if (note.status !== "active") continue;
    const haystack = note.customer.toLowerCase();
    if (
      haystack === needle ||
      haystack.includes(needle) ||
      needle.includes(haystack)
    ) {
      if (!best || note.createdAt > best.createdAt) {
        best = note;
      }
    }
  }
  return best;
}

/**
 * Normalize + fuzzy-similarity helpers for note duplicate detection.
 * Shares shape with the task-store versions so behavior is predictable
 * across both surfaces, but kept local to avoid a circular dep.
 */
function normalizeForDup(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ").replace(/[.!?,]+$/, "");
}

const NOTE_BODY_STOPWORDS = new Set([
  "a", "an", "the", "to", "for", "of", "in", "on", "at", "by",
  "this", "that", "these", "those", "and", "or", "about", "with",
  "from", "make", "just", "please",
]);

function bodyTokenSet(s: string): Set<string> {
  return new Set(
    normalizeForDup(s)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0 && !NOTE_BODY_STOPWORDS.has(t))
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
  return intersect / union >= 0.65;
}

function customerLooseMatch(a: string, b: string): boolean {
  const na = normalizeForDup(a);
  const nb = normalizeForDup(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Find an existing active note that looks like a duplicate of the
 * candidate. Match rule: customer (loose) + body (similar — substring
 * OR token-set Jaccard ≥ 0.65). Tags are ignored for dup detection —
 * reps often re-tag, and the body is the semantic content.
 */
export function findNearDuplicateNote(candidate: {
  customer: string;
  body: string;
}): Note | null {
  for (const note of notes.values()) {
    if (note.status !== "active") continue;
    if (!customerLooseMatch(note.customer, candidate.customer)) continue;
    if (!bodySimilar(note.body, candidate.body)) continue;
    return note;
  }
  return null;
}

export function clearAllNotes() {
  notes.clear();
  notify();
}

export function subscribeToNotes(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNotesSnapshot(): readonly Note[] {
  return cachedSnapshot;
}
