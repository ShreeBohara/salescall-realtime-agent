import { tool } from "@openai/agents-realtime";
import { z } from "zod";
import { addNote } from "../store/noteStore";

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
});

export const saveNote = tool({
  name: "save_note",
  description:
    "Save a structured post-call note for the sales rep. Use this whenever the rep explicitly asks to capture a note, takeaway, or observation from the call.",
  parameters: SaveNoteParams,
  execute: async (input) => {
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

    console.log("[tool:save_note] called", { noteId, input });

    return JSON.stringify({
      ok: true,
      noteId,
      status: saved.status,
      savedAt: saved.createdAt,
    });
  },
});
