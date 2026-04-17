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
