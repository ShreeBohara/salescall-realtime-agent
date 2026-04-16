import { tool } from "@openai/agents-realtime";
import { z } from "zod";
import { addTask } from "../store/taskStore";

const CreateFollowUpTaskParams = z.object({
  customer: z
    .string()
    .describe(
      "The customer, company, contact, or deal this follow-up is about. Use what the rep said; leave a short free-text value if no clear entity."
    ),
  due_at: z
    .string()
    .describe(
      "When the follow-up should happen. Use whatever the rep said (e.g. 'Friday', 'end of week', 'tomorrow at 2pm', 'next Tuesday'). A normalized date string is preferred when obvious, but natural-language is acceptable."
    ),
  channel: z
    .enum(["email", "phone", "calendar", "other"])
    .describe(
      "The channel for the follow-up. Pick the best match from the enum. Use 'other' if unclear."
    ),
  body: z
    .string()
    .describe(
      "A short description of what the follow-up is about, in the rep's own words. One sentence is ideal."
    ),
});

export const createFollowUpTask = tool({
  name: "create_follow_up_task",
  description:
    "Create a follow-up task or reminder for the sales rep. Use this whenever the rep asks to set a reminder, schedule a follow-up, or create a task to do later (e.g. 'remind me to call Acme on Friday', 'schedule a follow-up with the CFO next week').",
  parameters: CreateFollowUpTaskParams,
  execute: async (input) => {
    const taskId = `task_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const now = new Date().toISOString();

    const saved = addTask({
      id: taskId,
      customer: input.customer,
      due_at: input.due_at,
      channel: input.channel,
      body: input.body,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    console.log("[tool:create_follow_up_task] called", { taskId, input });

    return JSON.stringify({
      ok: true,
      taskId,
      status: saved.status,
      createdAt: saved.createdAt,
    });
  },
});
