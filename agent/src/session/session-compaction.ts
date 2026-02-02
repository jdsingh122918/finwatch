import { encode } from "gpt-tokenizer";
import type {
  LLMProvider,
  CreateMessageParams,
  StreamEvent,
  SessionTranscriptEntry,
} from "@finwatch/shared";

export type CompactionOptions = {
  provider: LLMProvider;
  model: string;
  contextWindow: number;
  maxCycleTokenRatio: number;
};

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

export function shouldCompact(
  entries: SessionTranscriptEntry[],
  options: { contextWindow: number; maxCycleTokenRatio: number },
): boolean {
  const threshold = options.contextWindow * options.maxCycleTokenRatio;
  let totalTokens = 0;

  for (const entry of entries) {
    if (entry.type === "message") {
      totalTokens += estimateTokens(entry.message.content);
      if (totalTokens > threshold) return true;
    }
  }

  return false;
}

export async function compactSession(
  entries: SessionTranscriptEntry[],
  options: CompactionOptions,
): Promise<SessionTranscriptEntry[]> {
  // Separate header, messages, and non-message entries with their indices
  const header = entries.find((e) => e.type === "session");
  const messageEntries: Array<{ index: number; entry: SessionTranscriptEntry }> = [];
  const nonMessageEntries: Array<{ index: number; entry: SessionTranscriptEntry }> = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.type === "message") {
      messageEntries.push({ index: i, entry });
    } else if (entry.type !== "session") {
      nonMessageEntries.push({ index: i, entry });
    }
  }

  // Calculate how many messages to compact (oldest 40%)
  const compactCount = Math.floor(messageEntries.length * 0.4);

  if (compactCount < 1) {
    return entries;
  }

  const oldMessages = messageEntries.slice(0, compactCount);
  const keptMessages = messageEntries.slice(compactCount);

  // Build the text to summarize
  const oldText = oldMessages
    .map((m) => {
      if (m.entry.type === "message") {
        return `[${m.entry.message.role}]: ${m.entry.message.content}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");

  // Call LLM to summarize
  const summaryText = await callLLMForSummary(oldText, options);

  // Build compacted entries
  const result: SessionTranscriptEntry[] = [];

  // Header first
  if (header) {
    result.push(header);
  }

  // Summary as system message
  const summaryEntry: SessionTranscriptEntry = {
    type: "message",
    message: {
      role: "system",
      content: summaryText,
      timestamp: Date.now(),
    },
  };
  result.push(summaryEntry);

  // Merge kept messages and non-message entries, preserving order
  const allRemaining = [
    ...keptMessages,
    ...nonMessageEntries,
  ].sort((a, b) => a.index - b.index);

  for (const item of allRemaining) {
    result.push(item.entry);
  }

  return result;
}

async function callLLMForSummary(
  oldText: string,
  options: CompactionOptions,
): Promise<string> {
  const params: CreateMessageParams = {
    model: options.model,
    system:
      "You are a session compaction assistant. Your job is to summarize the following conversation messages into a concise summary that preserves all key facts, decisions, anomalies detected, and context needed for continued analysis. Be factual and thorough.",
    messages: [
      {
        role: "user",
        content: `Please summarize the following conversation messages:\n\n${oldText}`,
      },
    ],
    maxTokens: 2048,
    temperature: 0.2,
  };

  let summary = "";
  for await (const event of options.provider.createMessage(params)) {
    if (event.type === "text_delta") {
      summary += event.text;
    }
  }

  return summary;
}
