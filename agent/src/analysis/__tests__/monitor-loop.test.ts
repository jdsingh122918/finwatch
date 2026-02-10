import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  DataTick,
  LLMProvider,
  StreamEvent,
  CreateMessageParams,
  ProviderHealth,
  Anomaly,
  AgentActivity,
} from "@finwatch/shared";
import { MonitorLoop, type MonitorLoopDeps } from "../monitor-loop.js";
import { DataBuffer } from "../../ingestion/data-buffer.js";

function makeTick(overrides: Partial<DataTick> = {}): DataTick {
  return {
    sourceId: "yahoo",
    timestamp: Date.now(),
    symbol: "AAPL",
    metrics: { close: 184.4, volume: 49120300 },
    metadata: {},
    ...overrides,
  };
}

function createMockProvider(response: string): LLMProvider {
  return {
    id: "mock",
    name: "Mock Provider",
    async *createMessage(_params: CreateMessageParams): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 100, output: 50 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
      providerId: "mock",
      status: "healthy",
      latencyMs: 50,
    }),
    listModels: () => ["mock-model"],
  };
}

const NO_ANOMALIES_RESPONSE = "```json\n[]\n```";
const ONE_ANOMALY_RESPONSE = `\`\`\`json
[{ "severity": "high", "source": "yahoo", "symbol": "AAPL", "description": "Volume spike", "metrics": { "volume": 150000000 } }]
\`\`\``;

function makeDeps(overrides: Partial<MonitorLoopDeps> = {}): MonitorLoopDeps {
  return {
    provider: createMockProvider(NO_ANOMALIES_RESPONSE),
    model: "mock-model",
    maxTokens: 4096,
    temperature: 0.3,
    preScreenConfig: {
      zScoreThreshold: 3.0,
      urgentThreshold: 0.6,
      skipThreshold: 0.2,
    },
    patterns: [],
    thresholds: [],
    ...overrides,
  };
}

describe("MonitorLoop", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in idle state", () => {
    const buffer = new DataBuffer({ flushIntervalMs: 100, urgentThreshold: 0.8 });
    const loop = new MonitorLoop(buffer, makeDeps());

    expect(loop.status.state).toBe("idle");
    expect(loop.status.totalCycles).toBe(0);
    expect(loop.status.totalAnomalies).toBe(0);
    buffer.destroy();
  });

  it("transitions to running state on start", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 50, urgentThreshold: 0.8 });
    const loop = new MonitorLoop(buffer, makeDeps());

    loop.start();
    expect(loop.status.state).toBe("running");

    loop.stop();
    buffer.destroy();
    // Allow any pending promises to settle
    await new Promise((r) => setTimeout(r, 10));
  });

  it("transitions to idle state on stop", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 50, urgentThreshold: 0.8 });
    const loop = new MonitorLoop(buffer, makeDeps());

    loop.start();
    loop.stop();
    expect(loop.status.state).toBe("idle");

    buffer.destroy();
    await new Promise((r) => setTimeout(r, 10));
  });

  it("runs a cycle when buffer flushes ticks", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 30, urgentThreshold: 0.8 });
    const loop = new MonitorLoop(buffer, makeDeps());

    loop.start();
    buffer.push(makeTick());
    buffer.push(makeTick({ symbol: "GOOG" }));

    // Wait for flush interval + processing
    await new Promise((r) => setTimeout(r, 80));

    loop.stop();
    buffer.destroy();

    expect(loop.status.totalCycles).toBeGreaterThanOrEqual(1);
  });

  it("detects anomalies and updates totalAnomalies", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 30, urgentThreshold: 0.8 });
    const loop = new MonitorLoop(
      buffer,
      makeDeps({ provider: createMockProvider(ONE_ANOMALY_RESPONSE) })
    );

    loop.start();
    buffer.push(makeTick());

    await new Promise((r) => setTimeout(r, 80));

    loop.stop();
    buffer.destroy();

    expect(loop.status.totalAnomalies).toBe(1);
  });

  it("emits activity events for cycle_start and cycle_end", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 30, urgentThreshold: 0.8 });
    const loop = new MonitorLoop(buffer, makeDeps());

    const activities: AgentActivity[] = [];
    loop.onActivity = (a) => activities.push(a);

    loop.start();
    buffer.push(makeTick());

    await new Promise((r) => setTimeout(r, 80));

    loop.stop();
    buffer.destroy();

    const types = activities.map((a) => a.type);
    expect(types).toContain("cycle_start");
    expect(types).toContain("cycle_end");
  });

  it("emits anomaly_detected activity for each anomaly", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 30, urgentThreshold: 0.8 });
    const loop = new MonitorLoop(
      buffer,
      makeDeps({ provider: createMockProvider(ONE_ANOMALY_RESPONSE) })
    );

    const activities: AgentActivity[] = [];
    loop.onActivity = (a) => activities.push(a);

    loop.start();
    buffer.push(makeTick());

    await new Promise((r) => setTimeout(r, 80));

    loop.stop();
    buffer.destroy();

    const anomalyActivities = activities.filter((a) => a.type === "anomaly_detected");
    expect(anomalyActivities.length).toBeGreaterThanOrEqual(1);
  });

  it("calls onAnomaly callback for detected anomalies", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 30, urgentThreshold: 0.8 });
    const loop = new MonitorLoop(
      buffer,
      makeDeps({ provider: createMockProvider(ONE_ANOMALY_RESPONSE) })
    );

    const anomalies: Anomaly[] = [];
    loop.onAnomaly = (a) => anomalies.push(a);

    loop.start();
    buffer.push(makeTick());

    await new Promise((r) => setTimeout(r, 80));

    loop.stop();
    buffer.destroy();

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.severity).toBe("high");
  });

  it("handles empty batches without crashing", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 30, urgentThreshold: 0.8 });
    const loop = new MonitorLoop(buffer, makeDeps());

    loop.start();
    // Don't push any ticks — buffer will flush an empty batch

    await new Promise((r) => setTimeout(r, 80));

    loop.stop();
    buffer.destroy();

    // Should still have run at least one cycle
    expect(loop.status.totalCycles).toBeGreaterThanOrEqual(1);
  });

  it("transitions to error state when provider fails", async () => {
    const failProvider: LLMProvider = {
      id: "fail",
      name: "Fail",
      async *createMessage(): AsyncIterable<StreamEvent> {
        throw new Error("LLM down");
      },
      healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
        providerId: "fail",
        status: "offline",
        latencyMs: -1,
      }),
      listModels: () => [],
    };

    const buffer = new DataBuffer({ flushIntervalMs: 30, urgentThreshold: 0.8 });
    const loop = new MonitorLoop(buffer, makeDeps({ provider: failProvider }));

    const activities: AgentActivity[] = [];
    loop.onActivity = (a) => activities.push(a);

    loop.start();
    buffer.push(makeTick());

    await new Promise((r) => setTimeout(r, 80));

    loop.stop();
    buffer.destroy();

    expect(loop.status.lastError).toContain("LLM down");
    const errorActivities = activities.filter((a) => a.type === "error");
    expect(errorActivities.length).toBeGreaterThanOrEqual(1);
  });

  it("prevents double start", () => {
    const buffer = new DataBuffer({ flushIntervalMs: 100, urgentThreshold: 0.8 });
    const loop = new MonitorLoop(buffer, makeDeps());

    loop.start();
    expect(() => loop.start()).toThrow("already running");

    loop.stop();
    buffer.destroy();
  });

  it("passes memoryContext to CycleRunner when provided", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 30, urgentThreshold: 0.8 });
    const memoryContext = vi.fn().mockReturnValue("<relevant-context>\nTest memory\n</relevant-context>");
    const loop = new MonitorLoop(buffer, makeDeps({ memoryContext }));

    loop.start();
    buffer.push(makeTick());

    await new Promise((r) => setTimeout(r, 80));

    loop.stop();
    buffer.destroy();

    expect(memoryContext).toHaveBeenCalled();
  });

  it("tracks uptime while running", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 100, urgentThreshold: 0.8 });
    const loop = new MonitorLoop(buffer, makeDeps());

    loop.start();
    await new Promise((r) => setTimeout(r, 30));

    expect(loop.status.uptime).toBeGreaterThanOrEqual(20);

    loop.stop();
    buffer.destroy();
  });
});
