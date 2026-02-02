import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmbeddingService } from "../embeddings.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("EmbeddingService", () => {
  let service: EmbeddingService;
  beforeEach(() => { vi.clearAllMocks(); service = new EmbeddingService("test-key", "text-embedding-3-small"); });

  it("calls OpenAI API with correct params", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ embedding: new Array(1536).fill(0.1) }] }) });
    await service.embed("test text");
    expect(mockFetch).toHaveBeenCalledWith("https://api.openai.com/v1/embeddings", expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
    }));
  });

  it("returns number array of correct dimension", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ embedding: new Array(1536).fill(0.5) }] }) });
    const result = await service.embed("test");
    expect(result).toHaveLength(1536);
  });

  it("batches multiple texts in one call", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ embedding: [0.1] }, { embedding: [0.2] }] }) });
    const results = await service.embedBatch(["a", "b"]);
    expect(results).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" });
    await expect(service.embed("test")).rejects.toThrow("429");
  });
});
