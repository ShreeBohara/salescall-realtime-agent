import { tool } from "@openai/agents-realtime";
import { z } from "zod";
import { addNote, findNearDuplicateNote } from "../store/noteStore";

const SaveNoteParams = z.object({
  customer: z
    .string()
    .describe(
      "The customer, company, or deal this note is about. Use what the rep said; leave a short free-text value if no clear entity."
    ),
  body: z
    .string()
    .describe("The note body in the rep's own words. One or two sentences is ideal."),
  tags: z
    .array(z.string())
    .describe(
      "Short lowercase tags that help categorize the note, e.g. ['pricing', 'objection', 'champion']. Use an empty array if unsure."
    ),
  force: z
    .boolean()
    .describe(
      "Usually false. Set true ONLY when the rep has been shown a 'duplicate_likely' warning and explicitly confirmed they want to save a second, near-identical note anyway. Never set true by default."
    ),
});

export const saveNote = tool({
  name: "save_note",
  description:
    "Save a structured post-call note for the sales rep. Use this whenever the rep explicitly asks to capture a note, takeaway, or observation from the call. If the tool returns error='duplicate_likely', DO NOT silently call again — tell the rep about the existing note and ask whether to update, add a differentiated note, or leave it.",
  parameters: SaveNoteParams,
  execute: async (input) => {
    if (!input.force) {
      const existing = findNearDuplicateNote({
        customer: input.customer,
        body: input.body,
      });
      if (existing) {
        console.log("[tool:save_note] duplicate_likely", {
          existingNoteId: existing.id,
          input,
        });
        return JSON.stringify({
          ok: false,
          error: "duplicate_likely",
          message: `A very similar active note already exists for this customer. Tell the rep about it and ask whether to update it (add detail), add a differentiated note, or leave it. Only re-call this tool with force:true if the rep explicitly says they want an extra duplicate note.`,
          existingNoteId: existing.id,
          existing: {
            customer: existing.customer,
            body: existing.body,
            tags: existing.tags,
          },
        });
      }
    }

    const noteId = `note_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const now = new Date().toISOString();

    const saved = addNote({
      id: noteId,
      customer: input.customer,
      body: input.body,
      tags: input.tags,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    console.log("[tool:save_note] called", {
      noteId,
      forced: input.force,
      input,
    });

    return JSON.stringify({
      ok: true,
      noteId,
      status: saved.status,
      forced: input.force,
      savedAt: saved.createdAt,
    });
  },
});
