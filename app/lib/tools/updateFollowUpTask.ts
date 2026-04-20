import { tool } from "@openai/agents-realtime";
import { z } from "zod";
import { findCustomer } from "../data/customers";
import {
  findLatestActiveForCustomer,
  getTask,
  updateTask,
  type FollowUpTask,
} from "../store/taskStore";

const UpdateFollowUpTaskParams = z.object({
  task_id: z
    .string()
    .describe(
      "The taskId of the follow-up task to update. You received this in the tool result when the task was originally created. Required, but if the id doesn't match an existing task, we will fall back to the most recent active task for the given customer."
    ),
  customer: z
    .string()
    .describe(
      "The CURRENT customer account of the task — used as a disambiguator and as a fallback lookup if task_id doesn't match. Do NOT change this field to edit the task — see `new_customer` and `body` below."
    ),
  new_customer: z
    .string()
    .nullable()
    .describe(
      [
        "Use this field ONLY to re-assign the task to a different CRM ACCOUNT/COMPANY (e.g. 'that task was supposed to be for Atmos, not Acme', 'move that reminder from Initech to Globex'). Must be an existing CRM customer name/alias — the tool will reject unknown names.",
        "DO NOT use this field when the rep is correcting a person's name inside the task description. Example: task body 'call Michael'; rep says 'the call was with Sri, not Michael' — the ACCOUNT stays the same, you should update `body` to 'call Sri' and leave new_customer null.",
        "Pass null if the account should not change.",
      ].join(" ")
    ),
  due_at: z
    .string()
    .nullable()
    .describe(
      "New due date/time for the task. Pass null or the literal string 'unchanged' if this field should not change."
    ),
  channel: z
    .enum(["email", "phone", "calendar", "other", "unchanged"])
    .describe(
      "New channel for the task. Use 'unchanged' if the channel should not change."
    ),
  body: z
    .string()
    .nullable()
    .describe(
      [
        "New description for the task. Use this when the rep corrects WHAT the task is about or WHO (by person name) to contact, while the account stays the same. Example: task 'call Michael' → rep says 'call was with Sri not Michael' → pass body 'call Sri'.",
        "Pass null or the literal string 'unchanged' if this field should not change.",
      ].join(" ")
    ),
});

function isUnchanged(v: string | null | undefined): boolean {
  return v == null || v === "unchanged";
}

export const updateFollowUpTask = tool({
  name: "update_follow_up_task",
  description:
    "Modify a previously-created follow-up task (e.g. 'change that reminder to Thursday', 'make it a phone call instead', 'update the Acme task to say...'). Use this INSTEAD OF create_follow_up_task whenever the rep is modifying a prior task — don't create a duplicate. Provide task_id (from the original create result) plus only the fields that should change; leave others as 'unchanged' or null.",
  parameters: UpdateFollowUpTaskParams,
  execute: async (input) => {
    let target: FollowUpTask | null = getTask(input.task_id);
    let matchedBy: "task_id" | "customer_fallback" | "none" = target
      ? "task_id"
      : "none";

    if (!target) {
      target = findLatestActiveForCustomer(input.customer);
      if (target) matchedBy = "customer_fallback";
    }

    if (!target) {
      console.log("[tool:update_follow_up_task] no match", { input });
      return JSON.stringify({
        ok: false,
        error: "no_matching_task",
        message: `Could not find a task with id '${input.task_id}' or any active task for customer '${input.customer}'. The rep may need to create a new task instead.`,
      });
    }

    const patch: Partial<FollowUpTask> = {};
    if (!isUnchanged(input.due_at)) patch.due_at = input.due_at as string;
    if (input.channel !== "unchanged") patch.channel = input.channel;
    if (!isUnchanged(input.body)) patch.body = input.body as string;

    // new_customer is only valid if it names an actual CRM account.
    // Person names mentioned inside the task body (e.g. "call Michael")
    // are the #1 false-positive here — if the rep says "actually it's
    // Sri, not Michael", the model is very tempted to slam that into
    // new_customer. Reject anything that doesn't resolve to a known
    // customer and steer the agent toward `body` instead.
    if (!isUnchanged(input.new_customer)) {
      const candidate = (input.new_customer as string).trim();
      const resolved = findCustomer(candidate);
      if (!resolved) {
        console.log("[tool:update_follow_up_task] rejected new_customer", {
          candidate,
          input,
        });
        return JSON.stringify({
          ok: false,
          error: "unknown_customer",
          attempted: { new_customer: candidate },
          message: [
            `'${candidate}' is not a customer account in the CRM.`,
            "If the rep was correcting a PERSON's name inside the task (e.g. 'call Michael' → 'call Sri'), update `body` instead — the account stays the same.",
            "If they really meant to move this task to another account, re-call update_follow_up_task with `new_customer` set to the exact CRM account name.",
          ].join(" "),
        });
      }
      patch.customer = resolved.name;
    }

    if (Object.keys(patch).length === 0) {
      console.log("[tool:update_follow_up_task] no changes", { input });
      return JSON.stringify({
        ok: false,
        error: "no_changes",
        message:
          "Update called but no fields were marked as changed. Ask the rep what specifically they want to change.",
      });
    }

    const previous = {
      customer: target.customer,
      due_at: target.due_at,
      channel: target.channel,
      body: target.body,
    };
    const updated = updateTask(target.id, patch);

    console.log("[tool:update_follow_up_task] called", {
      taskId: target.id,
      matchedBy,
      patch,
    });

    return JSON.stringify({
      ok: true,
      taskId: target.id,
      matchedBy,
      previous,
      changes: patch,
      updated: updated
        ? {
            customer: updated.customer,
            due_at: updated.due_at,
            channel: updated.channel,
            body: updated.body,
          }
        : null,
      updatedAt: updated?.updatedAt ?? new Date().toISOString(),
    });
  },
});
