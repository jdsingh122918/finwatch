export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "usage"; input: number; output: number; cacheCreation?: number; cacheRead?: number }
  | { type: "stop"; reason: string };

export type LLMMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

export type ResponseFormat = {
  type: "json_object";
  schema?: Record<string, unknown>;
};

export type CreateMessageParams = {
  model: string;
  system?: string;
  systemBlocks?: SystemBlock[];
  messages: LLMMessage[];
  maxTokens: number;
  temperature?: number;
  tools?: ToolDefinition[];
  responseFormat?: ResponseFormat;
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
