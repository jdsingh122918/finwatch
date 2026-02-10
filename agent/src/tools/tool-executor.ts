import type { StreamEvent } from "@finwatch/shared";
import type { ToolRegistry } from "./tool-registry.js";

export type ToolResult = {
  toolUseId: string;
  toolName: string;
  output?: unknown;
  error?: string;
};

export class ToolExecutor {
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async processEvents(events: StreamEvent[]): Promise<ToolResult[]> {
    const toolUseEvents = events.filter(
      (e): e is Extract<StreamEvent, { type: "tool_use" }> => e.type === "tool_use"
    );

    if (toolUseEvents.length === 0) {
      return [];
    }

    const results: ToolResult[] = [];

    for (const event of toolUseEvents) {
      try {
        const output = await this.registry.execute(event.name, event.input);
        results.push({
          toolUseId: event.id,
          toolName: event.name,
          output,
        });
      } catch (err) {
        results.push({
          toolUseId: event.id,
          toolName: event.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }
}
