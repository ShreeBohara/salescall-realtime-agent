import { tool } from "@openai/agents-realtime";
import { z } from "zod";
import { findCustomer } from "../data/customers";
import {
  findLatestActiveNoteForCustomer,
  getNote,
  updateNote as updateNoteInStore,
  type Note,
} from "../store/noteStore";

const UpdateNoteParams = z.object({
  note_id: z
    .string()
    .describe(
      "The noteId of the note to update. You received this in the tool result when the note was originally saved. Required, but if the id doesn't match an existing note, we will fall back to the most recent active note for the given customer."
    ),
  customer: z
    .string()
    .describe(
      "The CURRENT customer account of the note — used as a disambiguator and as a fallback lookup if note_id doesn't match. Do NOT change this field to edit the note — see `new_customer` and `body` below."
    ),
  new_customer: z
    .string()
    .nullable()
    .describe(
      [
        "Use this field ONLY to re-assign the note to a different CRM ACCOUNT/COMPANY (e.g. 'that note was supposed to be about Atmos, not Acme'). Must be an existing CRM customer name/alias — the tool will reject unknown names.",
        "DO NOT use this field when the rep is correcting a person's name inside the note body. Example: note says 'Michael approved pricing'; rep says 'that was Sri, not Michael' — the ACCOUNT stays the same, update `body` to '...Sri approved pricing' and leave new_customer null.",
        "Pass null if the account should not change.",
      ].join(" ")
    ),
  body: z
    .string()
    .nullable()
    .describe(
      "The full new body text for the note. If the rep is ADDING information, concatenate the existing body with the new thought yourself and pass the combined result here. Use this (not new_customer) when the rep corrects a person's name inside the note. Pass null or the literal string 'unchanged' if the body should not change."
    ),
  tags: z
    .array(z.string())
    .nullable()
    .describe(
      "New list of tags for the note. Pass null if the tags should not change. Pass [] to clear all tags."
    ),
});

function isUnchangedString(v: string | null | undefined): boolean {
  return v == null || v === "unchanged";
}

export const updateNote = tool({
  name: "update_note",
  description:
    "Modify a previously-saved note. Use this whenever the rep corrects, clarifies, or ADDS to a prior note (e.g. 'actually the note should say X', 'also add that they mentioned competitor pricing', 'change the Acme note to...'). Use this INSTEAD OF save_note when the rep is revising a prior note — don't create a duplicate. When the rep is adding information, pass the FULL combined body (old body + new addition), not just the addition. Provide note_id (from the original save result) plus only the fields that should change; leave others as 'unchanged' or null.",
  parameters: UpdateNoteParams,
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
      console.log("[tool:update_note] no match", { input });
      return JSON.stringify({
        ok: false,
        error: "no_matching_note",
        message: `Could not find a note with id '${input.note_id}' or any active note for customer '${input.customer}'. The rep may need to save a new note instead.`,
      });
    }

    const patch: Partial<Note> = {};
    if (!isUnchangedString(input.body)) patch.body = input.body as string;
    if (input.tags !== null) patch.tags = input.tags;

    // Same guardrail as update_follow_up_task: if new_customer doesn't
    // resolve to a known CRM account, reject the whole update and
    // steer the agent toward `body` (person-name corrections belong
    // there, not in new_customer).
    if (!isUnchangedString(input.new_customer)) {
      const candidate = (input.new_customer as string).trim();
      const resolved = findCustomer(candidate);
      if (!resolved) {
        console.log("[tool:update_note] rejected new_customer", {
          candidate,
          input,
        });
        return JSON.stringify({
          ok: false,
          error: "unknown_customer",
          attempted: { new_customer: candidate },
          message: [
            `'${candidate}' is not a customer account in the CRM.`,
            "If the rep was correcting a PERSON's name inside the note (e.g. 'Michael approved' → 'Sri approved'), update `body` instead — the account stays the same.",
            "If they really meant to move this note to another account, re-call update_note with `new_customer` set to the exact CRM account name.",
          ].join(" "),
        });
      }
      patch.customer = resolved.name;
    }

    if (Object.keys(patch).length === 0) {
      console.log("[tool:update_note] no changes", { input });
      return JSON.stringify({
        ok: false,
        error: "no_changes",
        message:
          "Update called but no fields were marked as changed. Ask the rep what specifically they want to change.",
      });
    }

    const previous = {
      customer: target.customer,
      body: target.body,
      tags: target.tags,
    };
    const updated = updateNoteInStore(target.id, patch);

    console.log("[tool:update_note] called", {
      noteId: target.id,
      matchedBy,
      patch,
    });

    return JSON.stringify({
      ok: true,
      noteId: target.id,
      matchedBy,
      previous,
      changes: patch,
      updated: updated
        ? {
            customer: updated.customer,
            body: updated.body,
            tags: updated.tags,
          }
        : null,
      updatedAt: updated?.updatedAt ?? new Date().toISOString(),
    });
  },
});
