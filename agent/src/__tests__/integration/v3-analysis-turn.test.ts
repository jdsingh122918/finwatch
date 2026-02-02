// agent/src/__tests__/integration/v3-analysis-turn.test.ts
import { describe, it, expect, vi } from "vitest";
import type {
  LLMProvider,
  CreateMessageParams,
  StreamEvent,
  DataTick,
  DomainPattern,
  DomainThreshold,
} from "@finwatch/shared";
import { CycleRunner } from "../../analysis/index.js";
import type { CycleRunnerDeps } from "../../analysis/index.js";
import { SessionManager } from "../../session/session-manager.js";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

function makeTick(close: number): DataTick {
  return {
    sourceId: "test",
    timestamp: Date.now(),
    metrics: { close, volume: 1000 },
    metadata: {},
  };
}

function mockAnalysisProvider(): LLMProvider {
  return {
    id: "mock-analysis",
    name: "Mock Analysis",
    async *createMessage(
      _params: CreateMessageParams,
    ): AsyncIterable<StreamEvent> {
      // Response must contain a JSON array that parseAnomalies can extract
      yield {
        type: "text_delta",
        text: `I detected an anomaly in the data.

\`\`\`json
[
  {
    "severity": "critical",
    "source": "test",
    "symbol": "AAPL",
    "description": "Price spike to 500 (normal range 98-102)",
    "metrics": { "close": 500, "volume": 1000 },
    "preScreenScore": 0.95
  }
]
\`\`\``,
      };
      yield { type: "usage", input: 500, output: 200 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi
      .fn()
      .mockResolvedValue({
        providerId: "mock-analysis",
        status: "healthy",
        latencyMs: 50,
      }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

describe("V3: Analysis Turn Integration", () => {
  let sessionDir: string;

  it("runs analysis on batch with anomaly, produces anomaly and persists to session", async () => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "finwatch-v3-"));
    const sessionManager = new SessionManager(sessionDir);
    const sessionId = await sessionManager.create("monitor");

    const provider = mockAnalysisProvider();

    const deps: CycleRunnerDeps = {
      provider,
      model: "mock-model",
      maxTokens: 1024,
      temperature: 0,
      preScreenConfig: {
        zScoreThreshold: 3.0,
        urgentThreshold: 0.6,
        skipThreshold: 0.2,
      },
      sessionId,
      patterns: [] as DomainPattern[],
      thresholds: [] as DomainThreshold[],
    };

    const runner = new CycleRunner(deps);

    const batch: DataTick[] = [
      ...Array.from({ length: 5 }, (_, i) => makeTick(100 + (i % 3))),
      makeTick(500), // anomaly
    ];

    const result = await runner.run(batch);

    // Should have parsed the anomaly from the mock response
    expect(result.anomalies.length).toBe(1);
    expect(result.anomalies[0]!.severity).toBe("critical");
    expect(result.anomalies[0]!.description).toContain("500");
    expect(result.tickCount).toBe(6);

    // Persist anomaly to session transcript
    await sessionManager.append(sessionId, {
      type: "anomaly",
      anomaly: result.anomalies[0]!,
    });

    // Also persist the analysis message
    await sessionManager.append(sessionId, {
      type: "message",
      message: {
        role: "assistant",
        content: `Detected ${result.anomalies.length} anomaly in batch of ${result.tickCount} ticks.`,
        timestamp: Date.now(),
      },
    });

    // Verify transcript persisted
    const entries = await sessionManager.read(sessionId);
    const anomalyEntries = entries.filter((e) => e.type === "anomaly");
    const messageEntries = entries.filter((e) => e.type === "message");

    expect(anomalyEntries.length).toBe(1);
    expect(messageEntries.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    fs.rmSync(sessionDir, { recursive: true, force: true });
  });
});
