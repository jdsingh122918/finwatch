// agent/src/__tests__/integration/v5-compaction.test.ts
import { describe, it, expect, vi } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import type {
  LLMProvider,
  StreamEvent,
  SessionTranscriptEntry,
} from "@finwatch/shared";
import { SessionManager } from "../../session/session-manager.js";
import { shouldCompact, compactSession } from "../../session/session-compaction.js";

function mockCompactionProvider(summary: string): LLMProvider {
  return {
    id: "mock-compact",
    name: "Mock Compact",
    async *createMessage(): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: summary };
      yield { type: "usage", input: 100, output: 50 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi
      .fn()
      .mockResolvedValue({
        providerId: "mock-compact",
        status: "healthy",
        latencyMs: 10,
      }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

describe("V5: Session Compaction Integration", () => {
  let sessionDir: string;

  it("fills session to threshold, compacts, and preserves key findings", async () => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "finwatch-v5-"));
    const manager = new SessionManager(sessionDir);
    const sessionId = await manager.create("monitor");

    // Fill session with many messages to exceed threshold
    const longText =
      "This is a detailed analysis of market conditions. ".repeat(50);
    for (let i = 0; i < 20; i++) {
      await manager.append(sessionId, {
        type: "message",
        message: {
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Turn ${i}: ${longText}`,
          timestamp: Date.now() + i,
        },
      });
    }

    const entries = await manager.read(sessionId);

    // Should trigger compaction at a low threshold
    const needsCompaction = shouldCompact(entries, {
      contextWindow: 1000,
      maxCycleTokenRatio: 0.8,
    });
    expect(needsCompaction).toBe(true);

    // Run compaction
    const provider = mockCompactionProvider(
      "Summary: 20 analysis turns were conducted. Key finding: price anomaly detected in turn 5, volume spike in turn 12.",
    );

    const compacted = await compactSession(entries, {
      provider,
      model: "mock-model",
      contextWindow: 1000,
      maxCycleTokenRatio: 0.8,
    });

    // Compacted should have fewer entries
    expect(compacted.length).toBeLessThan(entries.length);

    // Should contain summary
    const summaryEntry = compacted.find(
      (e): e is Extract<SessionTranscriptEntry, { type: "message" }> =>
        e.type === "message" &&
        e.message.role === "system" &&
        e.message.content.includes("Summary"),
    );
    expect(summaryEntry).toBeDefined();

    // Key findings preserved in summary
    if (summaryEntry) {
      expect(summaryEntry.message.content).toContain("anomaly");
    }

    fs.rmSync(sessionDir, { recursive: true, force: true });
  });
});
