import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  LLMProvider,
  ProviderHealth,
  CreateMessageParams,
  StreamEvent,
  SessionTranscriptEntry,
  AgentMessage,
} from "@finwatch/shared";
import {
  estimateTokens,
  shouldCompact,
  compactSession,
  type CompactionOptions,
} from "../session-compaction.js";

function makeMessageEntry(
  role: "user" | "assistant" | "system",
  content: string,
): SessionTranscriptEntry {
  return {
    type: "message",
    message: {
      role,
      content,
      timestamp: Date.now(),
    },
  };
}

function makeSessionHeader(): SessionTranscriptEntry {
  return {
    type: "session",
    version: 1,
    id: "test-session",
    timestamp: new Date().toISOString(),
    kind: "monitor",
  };
}

function createSummaryProvider(summaryText: string): LLMProvider {
  return {
    id: "mock-summary",
    name: "Mock Summary",
    async *createMessage(_params: CreateMessageParams): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: summaryText };
      yield { type: "usage", input: 50, output: 20 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
      providerId: "mock-summary",
      status: "healthy",
      latencyMs: 10,
    }),
    listModels: vi.fn<[], string[]>().mockReturnValue(["mock-model"]),
  };
}

describe("estimateTokens", () => {
  it("returns a positive number for non-empty text", () => {
    const count = estimateTokens("Hello, how are you?");
    expect(count).toBeGreaterThan(0);
  });

  it("returns 0 for empty text", () => {
    const count = estimateTokens("");
    expect(count).toBe(0);
  });

  it("longer text has more tokens", () => {
    const shortCount = estimateTokens("Hi");
    const longCount = estimateTokens(
      "This is a much longer piece of text that contains many more words and should result in a significantly higher token count."
    );
    expect(longCount).toBeGreaterThan(shortCount);
  });
});

describe("shouldCompact", () => {
  it("returns false when token count is below threshold", () => {
    const entries: SessionTranscriptEntry[] = [
      makeSessionHeader(),
      makeMessageEntry("user", "Short message"),
      makeMessageEntry("assistant", "Short reply"),
    ];

    const result = shouldCompact(entries, {
      contextWindow: 100000,
      maxCycleTokenRatio: 0.8,
    });
    expect(result).toBe(false);
  });

  it("returns true when token count exceeds threshold", () => {
    // Create a lot of large messages to exceed threshold
    const entries: SessionTranscriptEntry[] = [makeSessionHeader()];
    const longText = "word ".repeat(500); // ~500 tokens

    for (let i = 0; i < 200; i++) {
      entries.push(makeMessageEntry("user", longText));
      entries.push(makeMessageEntry("assistant", longText));
    }

    // contextWindow=1000, ratio=0.8 => threshold=800 tokens
    // 400 messages x ~500 tokens each = ~200000 tokens >> 800
    const result = shouldCompact(entries, {
      contextWindow: 1000,
      maxCycleTokenRatio: 0.8,
    });
    expect(result).toBe(true);
  });

  it("ignores non-message entries for token counting", () => {
    const entries: SessionTranscriptEntry[] = [
      makeSessionHeader(),
      {
        type: "data_tick",
        source: "yahoo",
        payload: {
          sourceId: "yahoo",
          timestamp: Date.now(),
          metrics: { price: 150 },
          metadata: {},
        },
      },
    ];

    const result = shouldCompact(entries, {
      contextWindow: 100,
      maxCycleTokenRatio: 0.8,
    });
    expect(result).toBe(false);
  });
});

describe("compactSession", () => {
  it("summarizes oldest 40% of messages and keeps newest 60%", async () => {
    const entries: SessionTranscriptEntry[] = [makeSessionHeader()];

    // Add 10 messages
    for (let i = 1; i <= 10; i++) {
      entries.push(
        makeMessageEntry(
          i % 2 === 1 ? "user" : "assistant",
          `Message number ${i}`
        )
      );
    }

    const provider = createSummaryProvider("Summary of old messages: 1-4");

    const options: CompactionOptions = {
      provider,
      model: "mock-model",
      contextWindow: 100,
      maxCycleTokenRatio: 0.8,
    };

    const compacted = await compactSession(entries, options);

    // Original: 1 header + 10 messages = 11 entries
    // Oldest 40% of messages (4 messages) compacted to 1 summary
    // Kept: 1 header + 1 summary + 6 newest messages = 8 entries
    expect(compacted.length).toBe(8);

    // First should be the original header
    expect(compacted[0]!.type).toBe("session");

    // Second should be the summary (a system message)
    expect(compacted[1]!.type).toBe("message");
    if (compacted[1]!.type === "message") {
      expect(compacted[1]!.message.role).toBe("system");
      expect(compacted[1]!.message.content).toContain("Summary of old messages");
    }

    // Last message should be the 10th original message
    const lastEntry = compacted[compacted.length - 1]!;
    expect(lastEntry.type).toBe("message");
    if (lastEntry.type === "message") {
      expect(lastEntry.message.content).toBe("Message number 10");
    }
  });

  it("sends correct prompt to the LLM for summarization", async () => {
    const entries: SessionTranscriptEntry[] = [
      makeSessionHeader(),
      makeMessageEntry("user", "What is AAPL doing?"),
      makeMessageEntry("assistant", "AAPL is up 5%."),
      makeMessageEntry("user", "Any anomalies?"),
      makeMessageEntry("assistant", "No anomalies detected."),
      makeMessageEntry("user", "Check GOOGL."),
    ];

    const createMessageSpy = vi.fn<
      [CreateMessageParams],
      AsyncIterable<StreamEvent>
    >();
    // Return a proper async iterable from the spy
    createMessageSpy.mockImplementation(async function* () {
      yield { type: "text_delta", text: "Compacted summary." };
      yield { type: "stop", reason: "end_turn" };
    });

    const provider: LLMProvider = {
      id: "spy-provider",
      name: "Spy",
      createMessage: createMessageSpy,
      healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
        providerId: "spy-provider",
        status: "healthy",
        latencyMs: 10,
      }),
      listModels: vi.fn<[], string[]>().mockReturnValue(["spy-model"]),
    };

    await compactSession(entries, {
      provider,
      model: "spy-model",
      contextWindow: 100,
      maxCycleTokenRatio: 0.8,
    });

    expect(createMessageSpy).toHaveBeenCalledOnce();
    const callParams = createMessageSpy.mock.calls[0]![0];
    expect(callParams.model).toBe("spy-model");
    expect(callParams.system).toContain("summarize");
    // The user message should contain the old messages being compacted
    expect(callParams.messages[0]!.role).toBe("user");
    expect(callParams.messages[0]!.content).toContain("What is AAPL doing?");
  });

  it("preserves non-message entries in their original positions", async () => {
    const entries: SessionTranscriptEntry[] = [
      makeSessionHeader(),
      makeMessageEntry("user", "Msg 1"),
      makeMessageEntry("assistant", "Msg 2"),
      {
        type: "anomaly",
        anomaly: {
          id: "a1",
          severity: "high",
          source: "test",
          timestamp: Date.now(),
          description: "Spike",
          metrics: { x: 1 },
          preScreenScore: 0.9,
          sessionId: "test-session",
        },
      },
      makeMessageEntry("user", "Msg 3"),
      makeMessageEntry("assistant", "Msg 4"),
      makeMessageEntry("user", "Msg 5"),
      makeMessageEntry("assistant", "Msg 6"),
      makeMessageEntry("user", "Msg 7"),
      makeMessageEntry("assistant", "Msg 8"),
    ];

    const provider = createSummaryProvider("Summary of old messages");

    const compacted = await compactSession(entries, {
      provider,
      model: "mock-model",
      contextWindow: 100,
      maxCycleTokenRatio: 0.8,
    });

    // Non-message entries like anomalies should be preserved
    const anomalyEntries = compacted.filter((e) => e.type === "anomaly");
    expect(anomalyEntries).toHaveLength(1);
  });

  it("returns original entries unchanged when there are too few messages to compact", async () => {
    const entries: SessionTranscriptEntry[] = [
      makeSessionHeader(),
      makeMessageEntry("user", "Only one"),
    ];

    const provider = createSummaryProvider("Should not be called");

    const compacted = await compactSession(entries, {
      provider,
      model: "mock-model",
      contextWindow: 100,
      maxCycleTokenRatio: 0.8,
    });

    // With only 1 message, 40% = 0 messages to compact => return unchanged
    expect(compacted).toEqual(entries);
  });
});
