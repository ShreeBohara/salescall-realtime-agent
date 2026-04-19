import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { toolStateFromStatus } from "@/app/lib/helpers";
import type { ToolCall } from "@/app/lib/types";

/**
 * Single row in the Agent Actions feed. Uses Vercel AI Elements
 * primitives (`<Tool>` / `<ToolHeader>` / etc.) so the status icon
 * + JSON pane styling matches the wider ecosystem. Shows elapsed ms
 * when the tool has finished.
 */
export function ToolCallCard({ call }: { call: ToolCall }) {
  const elapsedMs =
    call.endedAt != null ? call.endedAt - call.startedAt : undefined;
  const state = toolStateFromStatus(call.status);
  const output =
    call.status === "done" ? call.parsedResult ?? call.result : undefined;
  const errorText =
    call.status === "error" ? call.result ?? "Tool error" : undefined;

  return (
    <li>
      <Tool defaultOpen className="mb-0 bg-card">
        <ToolHeader type="dynamic-tool" toolName={call.name} state={state} />
        <ToolContent>
          <ToolInput input={call.args} />
          <ToolOutput output={output as never} errorText={errorText} />
          {elapsedMs != null && (
            <div className="text-right font-mono text-[10px] text-muted-foreground">
              {elapsedMs} ms
            </div>
          )}
        </ToolContent>
      </Tool>
    </li>
  );
}
