"use client";

import { useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NoteRow } from "@/components/earshot/note-row";
import { TaskRow } from "@/components/earshot/task-row";
import { ToolCallCard } from "@/components/earshot/tool-call-card";
import type { FollowUpTask } from "@/app/lib/store/taskStore";
import type { Note } from "@/app/lib/store/noteStore";
import type { ToolCall } from "@/app/lib/types";

type LedgerTab = "tasks" | "notes" | "actions";

export function LedgerPanel({
  tasks,
  notes,
  toolCalls,
  onClearTasks,
  onClearNotes,
  onClearActions,
}: {
  tasks: readonly FollowUpTask[];
  notes: readonly Note[];
  toolCalls: readonly ToolCall[];
  onClearTasks: () => void;
  onClearNotes: () => void;
  onClearActions: () => void;
}) {
  const [tab, setTab] = useState<LedgerTab>("tasks");
  const userTouchedRef = useRef(false);

  // Auto-default the tab when user hasn't touched it yet.
  useEffect(() => {
    if (userTouchedRef.current) return;
    if (tasks.length > 0) setTab("tasks");
    else if (notes.length > 0) setTab("notes");
    else if (toolCalls.length > 0) setTab("actions");
  }, [tasks.length, notes.length, toolCalls.length]);

  const handleTabChange = (next: string) => {
    userTouchedRef.current = true;
    setTab(next as LedgerTab);
  };

  return (
    <aside
      className={cn(
        "earshot-stagger-ledger",
        "flex h-full min-h-0 flex-col border-l border-border/70 bg-background/40"
      )}
      aria-label="Captured artifacts"
    >
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Captured
        </h2>
        <span
          className="text-[10px] italic text-muted-foreground/70"
          style={{ fontFamily: "var(--font-display)" }}
        >
          this call
        </span>
      </div>

      <Tabs
        value={tab}
        onValueChange={handleTabChange}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList
          variant="line"
          className="mx-5 mb-0 h-9 justify-start gap-4 border-b border-border/50 px-0"
        >
          <LedgerTrigger value="tasks" label="Tasks" count={tasks.length} />
          <LedgerTrigger value="notes" label="Notes" count={notes.length} />
          <LedgerTrigger value="actions" label="Actions" count={toolCalls.length} />
        </TabsList>

        <TabsContent value="tasks" className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5">
          {tasks.length === 0 ? (
            <EmptyState label="No follow-ups yet" hint='Say "remind me to…"' />
          ) : (
            <>
              <ol className="flex flex-col gap-2">
                {tasks.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </ol>
              <ClearLine onClear={onClearTasks} label="Clear tasks" />
            </>
          )}
        </TabsContent>

        <TabsContent value="notes" className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5">
          {notes.length === 0 ? (
            <EmptyState label="No notes yet" hint='Say "save a note…"' />
          ) : (
            <>
              <ol className="flex flex-col gap-2">
                {notes.map((n) => (
                  <NoteRow key={n.id} note={n} />
                ))}
              </ol>
              <ClearLine onClear={onClearNotes} label="Clear notes" />
            </>
          )}
        </TabsContent>

        <TabsContent value="actions" className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5">
          {toolCalls.length === 0 ? (
            <EmptyState label="No tool calls yet" hint="They appear as the agent works" />
          ) : (
            <>
              <ol className="flex flex-col gap-2">
                {toolCalls.map((call) => (
                  <ToolCallCard key={call.id} call={call} />
                ))}
              </ol>
              <ClearLine onClear={onClearActions} label="Clear actions" />
            </>
          )}
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function LedgerTrigger({
  value,
  label,
  count,
}: {
  value: LedgerTab;
  label: string;
  count: number;
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        "!h-8 !flex-none !justify-start !px-0 font-mono text-[11px] uppercase tracking-[0.14em]"
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "ml-1 tabular-nums",
          count > 0 ? "text-[--color-accent-voice]" : "text-muted-foreground/50"
        )}
      >
        {count}
      </span>
    </TabsTrigger>
  );
}

function EmptyState({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border/50 px-4 py-8 text-center">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-[11px] italic text-muted-foreground/60" style={{ fontFamily: "var(--font-display)" }}>
        {hint}
      </span>
    </div>
  );
}

function ClearLine({ onClear, label }: { onClear: () => void; label: string }) {
  return (
    <div className="mt-3 flex justify-end">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        onClick={onClear}
      >
        {label}
      </Button>
    </div>
  );
}
