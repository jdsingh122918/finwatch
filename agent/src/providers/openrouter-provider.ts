import type {
  LLMProvider,
  ProviderHealth,
  CreateMessageParams,
  StreamEvent,
} from "@finwatch/shared";

export type OpenRouterProviderOptions = {
  apiKey: string;
  id?: string;
  name?: string;
  referer?: string;
  title?: string;
  baseUrl?: string;
};

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

const SUPPORTED_MODELS = [
  "anthropic/claude-opus-4-5-20251101",
  "anthropic/claude-sonnet-4-5-20241022",
  "anthropic/claude-3-5-haiku-20241022",
  "google/gemini-2.5-pro",
  "openai/gpt-4o",
];

export class OpenRouterProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  private apiKey: string;
  private referer: string;
  private title: string;
  private baseUrl: string;

  constructor(options: OpenRouterProviderOptions) {
    this.id = options.id ?? "openrouter";
    this.name = options.name ?? "OpenRouter";
    this.apiKey = options.apiKey;
    this.referer = options.referer ?? "https://finwatch.app";
    this.title = options.title ?? "FinWatch Agent";
    this.baseUrl = options.baseUrl ?? OPENROUTER_BASE_URL;
  }

  async *createMessage(params: CreateMessageParams): AsyncIterable<StreamEvent> {
    const messages: Array<{ role: string; content: string }> = [];

    if (params.system) {
      messages.push({ role: "system", content: params.system });
    }

    for (const m of params.messages) {
      messages.push({ role: m.role, content: m.content });
    }

    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens,
      stream: true,
      messages,
    };

    if (params.temperature !== undefined) {
      body.temperature = params.temperature;
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": this.referer,
        "X-Title": this.title,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenRouter API error ${response.status}: ${errorText}`
      );
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };

          const choice = parsed.choices?.[0];
          if (!choice) continue;

          if (choice.delta?.content) {
            yield { type: "text_delta", text: choice.delta.content };
          }

          if (choice.finish_reason) {
            if (parsed.usage) {
              yield {
                type: "usage",
                input: parsed.usage.prompt_tokens ?? 0,
                output: parsed.usage.completion_tokens ?? 0,
              };
            }
            yield { type: "stop", reason: choice.finish_reason };
          }
        } catch {
          // Skip malformed SSE data lines
        }
      }
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": this.referer,
          "X-Title": this.title,
        },
        body: JSON.stringify({
          model: "anthropic/claude-3-5-haiku-20241022",
          max_tokens: 1,
          stream: true,
          messages: [{ role: "user", content: "." }],
        }),
      });

      if (!response.ok) {
        return {
          providerId: this.id,
          status: "degraded",
          latencyMs: Date.now() - start,
          lastError: `HTTP ${response.status}`,
        };
      }

      // Consume body to complete the request
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
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
