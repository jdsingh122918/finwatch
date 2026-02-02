export class EmbeddingService {
  private apiKey: string;
  private model: string;
  constructor(apiKey: string, model: string = "text-embedding-3-small") { this.apiKey = apiKey; this.model = model; }

  async embed(text: string): Promise<number[]> { return (await this.embedBatch([text]))[0]; }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ input: texts, model: this.model }),
    });
    if (!response.ok) throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as { data: { embedding: number[] }[] };
    return data.data.map(d => d.embedding);
  }
}
