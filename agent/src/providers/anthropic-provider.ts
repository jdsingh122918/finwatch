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
  "claude-opus-4-5-20251101",
  "claude-sonnet-4-5-20241022",
  "claude-haiku-35-20241022",
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

    if (params.system) {
      requestBody.system = params.system;
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

    for await (const event of stream as AsyncIterable<Record<string, unknown>>) {
      const eventType = event.type as string;

      if (eventType === "message_start") {
        const message = event.message as Record<string, unknown> | undefined;
        const usage = message?.usage as Record<string, number> | undefined;
        if (usage?.input_tokens) {
          inputTokens = usage.input_tokens;
        }
      } else if (eventType === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          yield { type: "text_delta", text: delta.text };
        }
      } else if (eventType === "message_delta") {
        const usage = event.usage as Record<string, number> | undefined;
        if (usage?.output_tokens) {
          outputTokens = usage.output_tokens;
        }
      } else if (eventType === "message_stop") {
        if (inputTokens > 0 || outputTokens > 0) {
          yield { type: "usage", input: inputTokens, output: outputTokens };
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
        model: "claude-haiku-35-20241022",
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
