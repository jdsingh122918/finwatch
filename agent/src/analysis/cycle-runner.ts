import * as crypto from "node:crypto";
import type {
  DataTick,
  LLMProvider,
  Anomaly,
  CycleState,
  DomainPattern,
  DomainThreshold,
  StreamEvent,
  ResponseFormat,
  ToolDefinition,
} from "@finwatch/shared";
import { preScreenBatch, type PreScreenConfig } from "./pre-screener.js";
import { buildAnalysisPrompt } from "./prompt-builder.js";
import { parseAnomalies } from "./response-parser.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import { ToolExecutor, type ToolResult } from "../tools/tool-executor.js";

export type CycleRunnerDeps = {
  provider: LLMProvider;
  model: string;
  maxTokens: number;
  temperature: number;
  preScreenConfig: PreScreenConfig;
  sessionId: string;
  patterns: DomainPattern[];
  thresholds: DomainThreshold[];
  toolRegistry?: ToolRegistry;
  memoryContext?: (tickSummary: string) => string;
};

export type CycleResult = {
  anomalies: Anomaly[];
  tickCount: number;
  state: CycleState;
  toolResults?: ToolResult[];
};

export class CycleRunner {
  private _state: CycleState;
  private readonly deps: CycleRunnerDeps;

  onAnomaly?: (anomaly: Anomaly) => void;

  constructor(deps: CycleRunnerDeps) {
    this.deps = deps;
    this._state = {
      cycleId: crypto.randomUUID(),
      sessionId: deps.sessionId,
      batchNumber: 0,
      tickCount: 0,
      anomaliesDetected: 0,
      startedAt: Date.now(),
    };
  }

  get state(): CycleState {
    return { ...this._state };
  }

  async run(ticks: DataTick[]): Promise<CycleResult> {
    this._state.batchNumber++;
    this._state.tickCount += ticks.length;

    if (ticks.length === 0) {
      return {
        anomalies: [],
        tickCount: 0,
        state: this.state,
      };
    }

    // Pre-screen
    const scored = preScreenBatch(ticks, this.deps.preScreenConfig);

    // Build prompt
    const { system, messages, responseFormat } = buildAnalysisPrompt(scored, {
      sessionId: this.deps.sessionId,
      cycleId: this._state.cycleId,
      patterns: this.deps.patterns,
      thresholds: this.deps.thresholds,
    });

    // Inject memory context if available
    let enrichedSystem = system;
    if (this.deps.memoryContext) {
      const tickSummary = ticks.map(t => `${t.symbol ?? t.sourceId}`).join(", ");
      const context = this.deps.memoryContext(tickSummary);
      enrichedSystem = `${system}\n\n${context}`;
    }

    // Call LLM
    const tools = this.deps.toolRegistry?.getToolDefinitions();
    const { text: responseText, events } = await this.callProvider(enrichedSystem, messages, responseFormat, tools);

    // Execute tools if registry is available
    let toolResults: ToolResult[] | undefined;
    if (this.deps.toolRegistry) {
      const executor = new ToolExecutor(this.deps.toolRegistry);
      toolResults = await executor.processEvents(events);
    }

    // Parse anomalies
    const anomalies = parseAnomalies(responseText, this.deps.sessionId);

    this._state.anomaliesDetected += anomalies.length;

    // Notify
    if (this.onAnomaly) {
      for (const anomaly of anomalies) {
        this.onAnomaly(anomaly);
      }
    }

    return {
      anomalies,
      tickCount: ticks.length,
      state: this.state,
      toolResults,
    };
  }

  private async callProvider(
    system: string,
    messages: { role: "user" | "assistant"; content: string }[],
    responseFormat?: ResponseFormat,
    tools?: ToolDefinition[],
  ): Promise<{ text: string; events: StreamEvent[] }> {
    const events: StreamEvent[] = [];

    for await (const event of this.deps.provider.createMessage({
      model: this.deps.model,
      system,
      messages,
      maxTokens: this.deps.maxTokens,
      temperature: this.deps.temperature,
      responseFormat,
      tools,
    })) {
      events.push(event);
    }

    let text = "";
    for (const event of events) {
      if (event.type === "text_delta") {
        text += event.text;
      }
    }

    return { text, events };
  }
}
