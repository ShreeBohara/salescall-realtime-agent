import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addNote, clearAllNotes, getNote } from "@/app/lib/store/noteStore";
import { addTask, clearAllTasks, getTask } from "@/app/lib/store/taskStore";
import { cancelFollowUpTask } from "@/app/lib/tools/cancelFollowUpTask";
import { createFollowUpTask } from "@/app/lib/tools/createFollowUpTask";
import { deleteNote } from "@/app/lib/tools/deleteNote";
import { getCustomerContext } from "@/app/lib/tools/getCustomerContext";
import { saveNote } from "@/app/lib/tools/saveNote";
import { updateFollowUpTask } from "@/app/lib/tools/updateFollowUpTask";
import { updateNote } from "@/app/lib/tools/updateNote";

const earshotTools = [
  getCustomerContext,
  saveNote,
  updateNote,
  deleteNote,
  createFollowUpTask,
  updateFollowUpTask,
  cancelFollowUpTask,
] as const;

type EarshotTool = (typeof earshotTools)[number];

async function invokeTool(
  tool: EarshotTool,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const raw = await tool.invoke(undefined as never, JSON.stringify(input));
  expect(typeof raw).toBe("string");
  return JSON.parse(raw as string) as Record<string, unknown>;
}

function seedNote() {
  return addNote({
    id: "note_seed",
    customer: "Acme Corp",
    body: "Michael approved pricing",
    tags: ["pricing"],
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

function seedTask() {
  return addTask({
    id: "task_seed",
    customer: "Acme Corp",
    due_at: "Friday",
    channel: "phone",
    body: "Call Michael",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

beforeEach(() => {
  clearAllNotes();
  clearAllTasks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("tool contracts", () => {
  it("keeps all seven tool names stable", () => {
    expect(earshotTools.map((tool) => tool.name)).toEqual([
      "get_customer_context",
      "save_note",
      "update_note",
      "delete_note",
      "create_follow_up_task",
      "update_follow_up_task",
      "cancel_follow_up_task",
    ]);
  });

  it.each([
    [getCustomerContext, ["customer_name", "fields"]],
    [saveNote, ["customer", "body", "tags", "force"]],
    [updateNote, ["note_id", "customer", "new_customer", "body", "tags"]],
    [deleteNote, ["note_id", "customer"]],
    [createFollowUpTask, ["customer", "due_at", "channel", "body", "force"]],
    [
      updateFollowUpTask,
      ["task_id", "customer", "new_customer", "due_at", "channel", "body"],
    ],
    [cancelFollowUpTask, ["task_id", "customer"]],
  ])("preserves the %s required fields", (tool, required) => {
    expect(tool.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required,
    });
  });

  it("rejects invalid schema input before tool execution", async () => {
    const raw = await saveNote.invoke(
      undefined as never,
      JSON.stringify({ customer: "Acme Corp", body: "Missing fields" })
    );

    expect(raw).toContain("Invalid JSON input for tool");
  });

  it("keeps the follow-up channel enum closed", async () => {
    const raw = await createFollowUpTask.invoke(
      undefined as never,
      JSON.stringify({
        customer: "Acme Corp",
        due_at: "Friday",
        channel: "slack",
        body: "Send a message",
        force: false,
      })
    );

    expect(raw).toContain("Invalid JSON input for tool");
  });
});

describe("customer context result shapes", () => {
  it("returns only requested groups for a matched alias", async () => {
    const result = await invokeTool(getCustomerContext, {
      customer_name: "acme",
      fields: ["summary", "contact"],
    });

    expect(result).toMatchObject({
      ok: true,
      id: "acme-corp",
      name: "Acme Corp",
      summary: expect.objectContaining({ dealStage: "negotiation" }),
      contact: expect.objectContaining({ name: "Sarah Chen" }),
    });
    expect(result).not.toHaveProperty("meddic");
  });

  it("returns the stable not-found error and available customers", async () => {
    const result = await invokeTool(getCustomerContext, {
      customer_name: "Unknown Company",
      fields: [],
    });

    expect(result).toMatchObject({
      ok: false,
      error: "customer_not_found",
      available: expect.arrayContaining([
        expect.objectContaining({ id: "acme-corp", name: "Acme Corp" }),
      ]),
    });
  });
});

describe("note tool result shapes and safeguards", () => {
  it("saves a note, reports a likely duplicate, and honors force", async () => {
    const input = {
      customer: "Acme Corp",
      body: "Pricing is the main objection",
      tags: ["pricing"],
      force: false,
    };
    const saved = await invokeTool(saveNote, input);
    const duplicate = await invokeTool(saveNote, input);
    const forced = await invokeTool(saveNote, { ...input, force: true });

    expect(saved).toMatchObject({
      ok: true,
      noteId: expect.stringMatching(/^note_/),
      status: "active",
      forced: false,
      savedAt: expect.any(String),
    });
    expect(duplicate).toMatchObject({
      ok: false,
      error: "duplicate_likely",
      existingNoteId: saved.noteId,
      existing: expect.objectContaining({ customer: "Acme Corp" }),
    });
    expect(forced).toMatchObject({ ok: true, forced: true });
  });

  it("keeps person-name corrections in the body", async () => {
    seedNote();

    const result = await invokeTool(updateNote, {
      note_id: "note_seed",
      customer: "Acme Corp",
      new_customer: null,
      body: "Sri approved pricing",
      tags: null,
    });

    expect(result).toMatchObject({
      ok: true,
      noteId: "note_seed",
      matchedBy: "note_id",
      previous: expect.objectContaining({ customer: "Acme Corp" }),
      changes: { body: "Sri approved pricing" },
      updated: expect.objectContaining({
        customer: "Acme Corp",
        body: "Sri approved pricing",
      }),
    });
  });

  it("rejects a person name used as a replacement account", async () => {
    seedNote();

    const result = await invokeTool(updateNote, {
      note_id: "note_seed",
      customer: "Acme Corp",
      new_customer: "Sri",
      body: null,
      tags: null,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "unknown_customer",
      attempted: { new_customer: "Sri" },
    });
    expect(getNote("note_seed")?.customer).toBe("Acme Corp");
  });

  it("updates an account by alias and soft-deletes by customer fallback", async () => {
    seedNote();
    const updated = await invokeTool(updateNote, {
      note_id: "note_seed",
      customer: "Acme Corp",
      new_customer: "atmos",
      body: null,
      tags: null,
    });
    const deleted = await invokeTool(deleteNote, {
      note_id: "missing",
      customer: "Atmos",
    });

    expect(updated).toMatchObject({
      ok: true,
      changes: { customer: "Atmos Industrial" },
    });
    expect(deleted).toMatchObject({
      ok: true,
      noteId: "note_seed",
      matchedBy: "customer_fallback",
      status: "deleted",
      deleted: expect.objectContaining({ customer: "Atmos Industrial" }),
    });
  });

  it("preserves no-change and no-match errors", async () => {
    seedNote();
    const noChanges = await invokeTool(updateNote, {
      note_id: "note_seed",
      customer: "Acme Corp",
      new_customer: null,
      body: null,
      tags: null,
    });
    clearAllNotes();
    const noMatch = await invokeTool(deleteNote, {
      note_id: "missing",
      customer: "Acme Corp",
    });

    expect(noChanges).toMatchObject({ ok: false, error: "no_changes" });
    expect(noMatch).toMatchObject({ ok: false, error: "no_matching_note" });
  });
});

describe("task tool result shapes and safeguards", () => {
  it("creates a task, reports a likely duplicate, and honors force", async () => {
    const input = {
      customer: "Acme Corp",
      due_at: "Friday",
      channel: "email",
      body: "Email Sarah about pricing",
      force: false,
    };
    const created = await invokeTool(createFollowUpTask, input);
    const duplicate = await invokeTool(createFollowUpTask, {
      ...input,
      due_at: "this Friday",
    });
    const forced = await invokeTool(createFollowUpTask, { ...input, force: true });

    expect(created).toMatchObject({
      ok: true,
      taskId: expect.stringMatching(/^task_/),
      status: "active",
      forced: false,
      createdAt: expect.any(String),
    });
    expect(duplicate).toMatchObject({
      ok: false,
      error: "duplicate_likely",
      existingTaskId: created.taskId,
      existing: expect.objectContaining({ channel: "email" }),
    });
    expect(forced).toMatchObject({ ok: true, forced: true });
  });

  it("keeps person-name corrections in the task body", async () => {
    seedTask();

    const result = await invokeTool(updateFollowUpTask, {
      task_id: "task_seed",
      customer: "Acme Corp",
      new_customer: null,
      due_at: null,
      channel: "unchanged",
      body: "Call Sri",
    });

    expect(result).toMatchObject({
      ok: true,
      taskId: "task_seed",
      matchedBy: "task_id",
      changes: { body: "Call Sri" },
      updated: expect.objectContaining({
        customer: "Acme Corp",
        body: "Call Sri",
      }),
    });
  });

  it("rejects a person name used as a replacement account", async () => {
    seedTask();

    const result = await invokeTool(updateFollowUpTask, {
      task_id: "task_seed",
      customer: "Acme Corp",
      new_customer: "Sri",
      due_at: null,
      channel: "unchanged",
      body: null,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "unknown_customer",
      attempted: { new_customer: "Sri" },
    });
    expect(getTask("task_seed")?.customer).toBe("Acme Corp");
  });

  it("updates an account by alias and cancels by customer fallback", async () => {
    seedTask();
    const updated = await invokeTool(updateFollowUpTask, {
      task_id: "task_seed",
      customer: "Acme Corp",
      new_customer: "globex",
      due_at: null,
      channel: "unchanged",
      body: null,
    });
    const cancelled = await invokeTool(cancelFollowUpTask, {
      task_id: "missing",
      customer: "Globex",
    });

    expect(updated).toMatchObject({
      ok: true,
      changes: { customer: "Globex Systems" },
    });
    expect(cancelled).toMatchObject({
      ok: true,
      taskId: "task_seed",
      matchedBy: "customer_fallback",
      status: "cancelled",
      cancelled: expect.objectContaining({ customer: "Globex Systems" }),
    });
  });

  it("preserves no-change and no-match errors", async () => {
    seedTask();
    const noChanges = await invokeTool(updateFollowUpTask, {
      task_id: "task_seed",
      customer: "Acme Corp",
      new_customer: null,
      due_at: null,
      channel: "unchanged",
      body: null,
    });
    clearAllTasks();
    const noMatch = await invokeTool(cancelFollowUpTask, {
      task_id: "missing",
      customer: "Acme Corp",
    });

    expect(noChanges).toMatchObject({ ok: false, error: "no_changes" });
    expect(noMatch).toMatchObject({ ok: false, error: "no_matching_task" });
  });
});
