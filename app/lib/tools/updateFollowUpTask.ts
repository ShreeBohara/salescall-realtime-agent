import { tool } from "@openai/agents-realtime";
import { z } from "zod";
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
      "The customer, company, or contact the task is for. Used as a disambiguator and as a fallback if task_id doesn't match an existing task."
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
      "New description for the task. Pass null or the literal string 'unchanged' if this field should not change."
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
            due_at: updated.due_at,
            channel: updated.channel,
            body: updated.body,
          }
        : null,
      updatedAt: updated?.updatedAt ?? new Date().toISOString(),
    });
  },
});
