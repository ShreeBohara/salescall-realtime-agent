import { beforeEach, describe, expect, it } from "vitest";

import { findCustomer } from "@/app/lib/data/customers";
import {
  addNote,
  clearAllNotes,
  findLatestActiveNoteForCustomer,
  findNearDuplicateNote,
} from "@/app/lib/store/noteStore";
import {
  addTask,
  clearAllTasks,
  findLatestActiveForCustomer,
  findNearDuplicateTask,
} from "@/app/lib/store/taskStore";

describe("customer matching", () => {
  it("matches ids, names, aliases, and safe substrings", () => {
    expect(findCustomer("acme-corp")?.name).toBe("Acme Corp");
    expect(findCustomer("ACME CORP")?.id).toBe("acme-corp");
    expect(findCustomer("Atmos Industries")?.id).toBe("atmos-industrial");
    expect(findCustomer("the Globex account")?.id).toBe("globex-systems");
  });

  it("does not turn an unknown person name into an account", () => {
    expect(findCustomer("Sri")).toBeNull();
    expect(findCustomer("Michael")).toBeNull();
    expect(findCustomer("")).toBeNull();
  });
});

describe("note-store regression behavior", () => {
  beforeEach(() => clearAllNotes());

  it("detects near-duplicate active notes", () => {
    addNote({
      id: "note_1",
      customer: "Acme Corp",
      body: "Pricing is the main objection.",
      tags: ["pricing"],
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(
      findNearDuplicateNote({
        customer: "Acme",
        body: "The pricing is the main objection",
      })?.id
    ).toBe("note_1");
    expect(
      findNearDuplicateNote({
        customer: "Acme",
        body: "Sarah requested a security review",
      })
    ).toBeNull();
  });

  it("falls back to the newest active note for a customer", () => {
    addNote({
      id: "older",
      customer: "Acme Corp",
      body: "Older",
      tags: [],
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    addNote({
      id: "newer",
      customer: "Acme Corp",
      body: "Newer",
      tags: [],
      status: "active",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(findLatestActiveNoteForCustomer("Acme")?.id).toBe("newer");
  });
});

describe("task-store regression behavior", () => {
  beforeEach(() => clearAllTasks());

  it("detects near-duplicate active tasks without conflating different weekdays", () => {
    addTask({
      id: "task_1",
      customer: "Acme Corp",
      due_at: "Friday",
      channel: "email",
      body: "Email Sarah about pricing",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(
      findNearDuplicateTask({
        customer: "Acme",
        due_at: "this Friday",
        channel: "email",
        body: "Please email Sarah about pricing this Friday",
      })?.id
    ).toBe("task_1");
    expect(
      findNearDuplicateTask({
        customer: "Acme",
        due_at: "Monday",
        channel: "email",
        body: "Email Sarah about pricing",
      })
    ).toBeNull();
  });

  it("falls back to the newest active task for a customer", () => {
    addTask({
      id: "older",
      customer: "Atmos Industrial",
      due_at: "Friday",
      channel: "phone",
      body: "Call Raj",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    addTask({
      id: "newer",
      customer: "Atmos Industrial",
      due_at: "Monday",
      channel: "phone",
      body: "Call Raj again",
      status: "active",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(findLatestActiveForCustomer("Atmos")?.id).toBe("newer");
  });
});
