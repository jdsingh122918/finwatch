import { z } from "zod";
import type { ToolRegistry } from "./tool-registry.js";

export type ToolDataSources = {
  memorySearch?: (query: string, limit: number) => Promise<unknown[]>;
  historicalData?: (symbol: string, days: number) => Promise<unknown[]>;
};

export function registerDefaultTools(registry: ToolRegistry, sources?: ToolDataSources): void {
  registry.register({
    name: "search_memory",
    description: "Search the agent's memory for previously observed patterns, anomalies, and domain knowledge.",
    inputSchema: z.object({
      query: z.string().describe("Search query to find relevant memory entries"),
      limit: z.number().int().positive().optional().describe("Maximum number of results to return"),
    }),
    handler: async (args) => {
      const limit = args.limit ?? 10;
      const results = sources?.memorySearch
        ? await sources.memorySearch(args.query, limit)
        : [];
      return { query: args.query, results };
    },
  });

  registry.register({
    name: "get_historical_data",
    description: "Retrieve historical price and volume data for a given symbol over a specified time period.",
    inputSchema: z.object({
      symbol: z.string().describe("Ticker symbol (e.g., AAPL, GOOG)"),
      days: z.number().int().positive().optional().describe("Number of days of history to retrieve"),
    }),
    handler: async (args) => {
      const days = args.days ?? 30;
      const data = sources?.historicalData
        ? await sources.historicalData(args.symbol, days)
        : [];
      return { symbol: args.symbol, days, data };
    },
  });
}
