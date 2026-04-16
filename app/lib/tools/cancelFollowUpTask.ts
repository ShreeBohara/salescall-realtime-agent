import { tool } from "@openai/agents-realtime";
import { z } from "zod";
import {
  findLatestActiveForCustomer,
  getTask,
  updateTask,
  type FollowUpTask,
} from "../store/taskStore";

const CancelFollowUpTaskParams = z.object({
  task_id: z
    .string()
    .describe(
      "The taskId of the follow-up task to cancel. You received this in the tool result when the task was originally created. Required, but if the id doesn't match an existing task, we will fall back to the most recent active task for the given customer."
    ),
  customer: z
    .string()
    .describe(
      "The customer, company, or contact the task is for. Used as a disambiguator and as a fallback if task_id doesn't match an existing task."
    ),
});

export const cancelFollowUpTask = tool({
  name: "cancel_follow_up_task",
  description:
    "Cancel a previously-created follow-up task (e.g. 'scratch that reminder', 'cancel the Acme follow-up', 'never mind, drop that task'). Use this whenever the rep asks to remove or undo a prior task — don't create a new task. Provide task_id (from the original create result) and customer as a fallback.",
  parameters: CancelFollowUpTaskParams,
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
      console.log("[tool:cancel_follow_up_task] no match", { input });
      return JSON.stringify({
        ok: false,
        error: "no_matching_task",
        message: `Could not find a task with id '${input.task_id}' or any active task for customer '${input.customer}'.`,
      });
    }

    if (target.status === "cancelled") {
      console.log("[tool:cancel_follow_up_task] already cancelled", {
        taskId: target.id,
      });
      return JSON.stringify({
        ok: true,
        taskId: target.id,
        matchedBy,
        alreadyCancelled: true,
        status: "cancelled",
      });
    }

    const cancelled = updateTask(target.id, { status: "cancelled" });

    console.log("[tool:cancel_follow_up_task] called", {
      taskId: target.id,
      matchedBy,
    });

    return JSON.stringify({
      ok: true,
      taskId: target.id,
      matchedBy,
      cancelled: {
        customer: cancelled?.customer,
        due_at: cancelled?.due_at,
        channel: cancelled?.channel,
        body: cancelled?.body,
      },
      status: "cancelled",
      cancelledAt: cancelled?.updatedAt ?? new Date().toISOString(),
    });
  },
});
