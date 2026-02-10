import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  ProviderHealth,
  CreateMessageParams,
  StreamEvent,
} from "@finwatch/shared";

export type AnthropicProviderOptions = {
  apiKey: string;
  id?: string;
  name?: string;
};

const SUPPORTED_MODELS = [
  "claude-opus-4-5-20250929",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
];

export class AnthropicProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  private client: Anthropic;

  constructor(options: AnthropicProviderOptions) {
    this.id = options.id ?? "anthropic";
    this.name = options.name ?? "Anthropic";
    this.client = new Anthropic({ apiKey: options.apiKey });
  }

  async *createMessage(params: CreateMessageParams): AsyncIterable<StreamEvent> {
    const requestBody: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens,
      stream: true,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    const jsonInstruction = params.responseFormat?.type === "json_object"
      ? params.responseFormat.schema
        ? `You must respond with valid JSON matching this schema: ${JSON.stringify(params.responseFormat.schema)}`
        : "You must respond with valid JSON. No other text, explanations, or formatting."
      : undefined;

    if (params.systemBlocks && params.systemBlocks.length > 0) {
      const blocks = [...params.systemBlocks];
      if (jsonInstruction) {
        blocks.push({ type: "text", text: jsonInstruction });
      }
      requestBody.system = blocks;
    } else if (params.system) {
      requestBody.system = jsonInstruction
        ? `${params.system}\n\n${jsonInstruction}`
        : params.system;
    } else if (jsonInstruction) {
      requestBody.system = jsonInstruction;
    }

    if (params.temperature !== undefined) {
      requestBody.temperature = params.temperature;
    }

    if (params.tools && params.tools.length > 0) {
      requestBody.tools = params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    const stream = await this.client.messages.create(
      requestBody as Parameters<typeof this.client.messages.create>[0]
    );

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens: number | undefined;
    let cacheReadTokens: number | undefined;

    // Tool use accumulation
    let currentToolId: string | undefined;
    let currentToolName: string | undefined;
    let currentToolJson = "";

    for await (const event of stream as AsyncIterable<Record<string, unknown>>) {
      const eventType = event.type as string;

      if (eventType === "message_start") {
        const message = event.message as Record<string, unknown> | undefined;
        const usage = message?.usage as Record<string, number> | undefined;
        if (usage?.input_tokens) {
          inputTokens = usage.input_tokens;
        }
        if (usage?.cache_creation_input_tokens) {
          cacheCreationTokens = usage.cache_creation_input_tokens;
        }
        if (usage?.cache_read_input_tokens) {
          cacheReadTokens = usage.cache_read_input_tokens;
        }
      } else if (eventType === "content_block_start") {
        const block = event.content_block as Record<string, unknown> | undefined;
        if (block?.type === "tool_use") {
          currentToolId = block.id as string;
          currentToolName = block.name as string;
          currentToolJson = "";
        }
      } else if (eventType === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          yield { type: "text_delta", text: delta.text };
        } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
          currentToolJson += delta.partial_json;
        }
      } else if (eventType === "content_block_stop") {
        if (currentToolId && currentToolName) {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(currentToolJson) as Record<string, unknown>;
          } catch {
            // If JSON parse fails, pass empty object
          }
          yield {
            type: "tool_use" as const,
            id: currentToolId,
            name: currentToolName,
            input: parsedInput,
          };
          currentToolId = undefined;
          currentToolName = undefined;
          currentToolJson = "";
        }
      } else if (eventType === "message_delta") {
        const usage = event.usage as Record<string, number> | undefined;
        if (usage?.output_tokens) {
          outputTokens = usage.output_tokens;
        }
      } else if (eventType === "message_stop") {
        if (inputTokens > 0 || outputTokens > 0) {
          yield {
            type: "usage" as const,
            input: inputTokens,
            output: outputTokens,
            ...(cacheCreationTokens !== undefined && { cacheCreation: cacheCreationTokens }),
            ...(cacheReadTokens !== undefined && { cacheRead: cacheReadTokens }),
          };
        }
        yield { type: "stop", reason: "end_turn" };
      }
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      // Simple health check: create a minimal message
      const stream = await this.client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        stream: true,
        messages: [{ role: "user", content: "." }],
      });
      // Consume the stream to completion
      for await (const _event of stream as AsyncIterable<unknown>) {
        // drain
      }
      return {
        providerId: this.id,
        status: "healthy",
        latencyMs: Date.now() - start,
        lastSuccess: Date.now(),
      };
    } catch (err) {
      return {
        providerId: this.id,
        status: "offline",
        latencyMs: Date.now() - start,
        lastError: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  listModels(): string[] {
    return [...SUPPORTED_MODELS];
  }
}
