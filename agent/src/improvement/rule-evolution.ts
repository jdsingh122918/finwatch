import type { LLMProvider } from "@finwatch/shared";

export type RuleEvolutionDeps = {
  provider: LLMProvider;
  model: string;
  rulesDir: string;
  writeFile: (path: string, content: string) => void;
  appendFile: (path: string, content: string) => void;
  readFile: (path: string) => string;
  listFiles: (dir: string) => string[];
};

export type PerformanceMetrics = {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  totalPredictions: number;
};

export type EvolutionResult = {
  newVersion: number;
  rulesCount: number;
  durationMs: number;
};

export class RuleEvolution {
  private deps: RuleEvolutionDeps;

  constructor(deps: RuleEvolutionDeps) { this.deps = deps; }

  async run(currentRules: unknown[], metrics: PerformanceMetrics): Promise<EvolutionResult> {
    const startTime = Date.now();

    const files = this.deps.listFiles(this.deps.rulesDir);
    const versions = files.map((f) => f.match(/rules_v(\d+)/)).filter((m): m is RegExpMatchArray => m !== null).map((m) => parseInt(m[1]!, 10));
    const nextVersion = versions.length > 0 ? Math.max(...versions) + 1 : 1;

    let response = "";
    const stream = this.deps.provider.createMessage({
      model: this.deps.model,
      system: "You are a rule evolution assistant. Given current detection rules and performance metrics, output an improved JSON rules array. Only output the JSON array.",
      messages: [{ role: "user", content: `Current rules:\n${JSON.stringify(currentRules, null, 2)}\n\nPerformance metrics (last 24h):\n${JSON.stringify(metrics, null, 2)}\n\nPropose updated rules array.` }],
      maxTokens: 4096,
      temperature: 0.3,
    });

    for await (const event of stream) {
      if (event.type === "text_delta") response += event.text;
    }

    let newRules: unknown[];
    try {
      newRules = JSON.parse(response);
      if (!Array.isArray(newRules)) newRules = [];
    } catch {
      newRules = currentRules;
    }

    const versionStr = String(nextVersion).padStart(3, "0");
    this.deps.writeFile(`${this.deps.rulesDir}/rules_v${versionStr}.json`, JSON.stringify(newRules, null, 2));
    this.deps.writeFile(`${this.deps.rulesDir}/rules_active.json`, JSON.stringify(newRules, null, 2));

    this.deps.appendFile(`${this.deps.rulesDir}/evolution_log.jsonl`, JSON.stringify({ timestamp: Date.now(), version: nextVersion, metrics, rulesCount: newRules.length }) + "\n");

    return { newVersion: nextVersion, rulesCount: newRules.length, durationMs: Date.now() - startTime };
  }
}
