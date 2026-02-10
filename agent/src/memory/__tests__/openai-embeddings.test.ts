import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIEmbeddingProvider } from "../openai-embeddings.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("OpenAIEmbeddingProvider", () => {
  let provider: OpenAIEmbeddingProvider;
  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIEmbeddingProvider("test-api-key");
  });

  it("implements EmbeddingProvider interface with embed()", async () => {
    const fakeEmbedding = new Array(1536).fill(0.1);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: fakeEmbedding }] }),
    });

    const result = await provider.embed("test text");
    expect(result).toHaveLength(1536);
    expect(result[0]).toBe(0.1);
  });

  it("sends correct request to OpenAI API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1] }] }),
    });

    await provider.embed("hello world");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
        }),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input).toEqual(["hello world"]);
    expect(body.model).toBe("text-embedding-3-small");
  });

  it("throws on API error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    });

    await expect(provider.embed("test")).rejects.toThrow("429");
  });

  it("uses custom model when specified", async () => {
    const custom = new OpenAIEmbeddingProvider("key", "text-embedding-3-large");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.5] }] }),
    });

    await custom.embed("test");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("text-embedding-3-large");
  });
});
