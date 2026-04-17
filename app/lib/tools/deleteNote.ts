import { tool } from "@openai/agents-realtime";
import { z } from "zod";
import {
  findLatestActiveNoteForCustomer,
  getNote,
  updateNote as updateNoteInStore,
  type Note,
} from "../store/noteStore";

const DeleteNoteParams = z.object({
  note_id: z
    .string()
    .describe(
      "The noteId of the note to delete. You received this in the tool result when the note was originally saved. Required, but if the id doesn't match an existing note, we will fall back to the most recent active note for the given customer."
    ),
  customer: z
    .string()
    .describe(
      "The customer, company, or contact the note is about. Used as a disambiguator and as a fallback if note_id doesn't match an existing note."
    ),
});

export const deleteNote = tool({
  name: "delete_note",
  description:
    "Delete a previously-saved note (e.g. 'scratch that note', 'delete the Acme note', 'never mind, remove that'). This is a soft delete — the note is marked as deleted but preserved in the audit log. Use this whenever the rep asks to remove or discard a prior note — don't save a new one. Provide note_id (from the original save result) and customer as a fallback.",
  parameters: DeleteNoteParams,
  execute: async (input) => {
    let target: Note | null = getNote(input.note_id);
    let matchedBy: "note_id" | "customer_fallback" | "none" = target
      ? "note_id"
      : "none";

    if (!target) {
      target = findLatestActiveNoteForCustomer(input.customer);
      if (target) matchedBy = "customer_fallback";
    }

    if (!target) {
      console.log("[tool:delete_note] no match", { input });
      return JSON.stringify({
        ok: false,
        error: "no_matching_note",
        message: `Could not find a note with id '${input.note_id}' or any active note for customer '${input.customer}'.`,
      });
    }

    if (target.status === "deleted") {
      console.log("[tool:delete_note] already deleted", {
        noteId: target.id,
      });
      return JSON.stringify({
        ok: true,
        noteId: target.id,
        matchedBy,
        alreadyDeleted: true,
        status: "deleted",
      });
    }

    const deleted = updateNoteInStore(target.id, { status: "deleted" });

    console.log("[tool:delete_note] called", {
      noteId: target.id,
      matchedBy,
    });

    return JSON.stringify({
      ok: true,
      noteId: target.id,
      matchedBy,
      deleted: {
        customer: deleted?.customer,
        body: deleted?.body,
        tags: deleted?.tags,
      },
      status: "deleted",
      deletedAt: deleted?.updatedAt ?? new Date().toISOString(),
    });
  },
});
