export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "usage"; input: number; output: number }
  | { type: "stop"; reason: string };

export type LLMMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CreateMessageParams = {
  model: string;
  system?: string;
  messages: LLMMessage[];
  maxTokens: number;
  temperature?: number;
  tools?: ToolDefinition[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type LLMProvider = {
  id: string;
  name: string;
  createMessage(params: CreateMessageParams): AsyncIterable<StreamEvent>;
  healthCheck(): Promise<ProviderHealth>;
  listModels(): string[];
};

export type ProviderHealthStatus = "healthy" | "degraded" | "offline" | "rate_limited";

export type ProviderHealth = {
  providerId: string;
  status: ProviderHealthStatus;
  latencyMs: number;
  lastSuccess?: number;
  lastError?: string;
  cooldownUntil?: number;
};

export type ModelSlot = "analysis" | "subagent" | "improvement";

export type ModelAssignment = {
  slot: ModelSlot;
  provider: string;
  model: string;
};
