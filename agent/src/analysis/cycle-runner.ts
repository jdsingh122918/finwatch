import * as crypto from "node:crypto";
import type {
  DataTick,
  LLMProvider,
  Anomaly,
  CycleState,
  DomainPattern,
  DomainThreshold,
  StreamEvent,
} from "@finwatch/shared";
import { preScreenBatch, type PreScreenConfig } from "./pre-screener.js";
import { buildAnalysisPrompt } from "./prompt-builder.js";
import { parseAnomalies } from "./response-parser.js";

export type CycleRunnerDeps = {
  provider: LLMProvider;
  model: string;
  maxTokens: number;
  temperature: number;
  preScreenConfig: PreScreenConfig;
  sessionId: string;
  patterns: DomainPattern[];
  thresholds: DomainThreshold[];
};

export type CycleResult = {
  anomalies: Anomaly[];
  tickCount: number;
  state: CycleState;
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
    const { system, messages } = buildAnalysisPrompt(scored, {
      sessionId: this.deps.sessionId,
      cycleId: this._state.cycleId,
      patterns: this.deps.patterns,
      thresholds: this.deps.thresholds,
    });

    // Call LLM
    const responseText = await this.callProvider(system, messages);

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
    };
  }

  private async callProvider(
    system: string,
    messages: { role: "user" | "assistant"; content: string }[],
  ): Promise<string> {
    const events: StreamEvent[] = [];

    for await (const event of this.deps.provider.createMessage({
      model: this.deps.model,
      system,
      messages,
      maxTokens: this.deps.maxTokens,
      temperature: this.deps.temperature,
    })) {
      events.push(event);
    }

    let text = "";
    for (const event of events) {
      if (event.type === "text_delta") {
        text += event.text;
      }
    }

    return text;
  }
}
