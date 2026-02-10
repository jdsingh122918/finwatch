import { describe, it, expect, vi } from "vitest";

describe("agent JSON-RPC commands", () => {
  it("responds to agent:start with config", async () => {
    const { createAgentServer } = await import("../index.js");
    const server = createAgentServer();

    const response = await server.handleRequest(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "agent:start",
      params: {
        alpaca: { keyId: "TEST", secretKey: "SECRET", symbols: ["AAPL"], feed: "iex" },
        llm: {
          anthropicApiKey: "sk-ant-test",
          openrouterApiKey: "sk-or-test",
          model: "claude-haiku-4-5-20251001",
          maxTokens: 4096,
          temperature: 0.3,
        },
      },
    }));

    const parsed = JSON.parse(response);
    expect(parsed.result.status).toBe("started");
  });

  it("responds to agent:status", async () => {
    const { createAgentServer } = await import("../index.js");
    const server = createAgentServer();

    const response = await server.handleRequest(JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "agent:status",
    }));

    const parsed = JSON.parse(response);
    expect(parsed.result.state).toBeDefined();
  });

  it("responds to agent:stop", async () => {
    const { createAgentServer } = await import("../index.js");
    const server = createAgentServer();

    const response = await server.handleRequest(JSON.stringify({
      jsonrpc: "2.0", id: 3, method: "agent:stop",
    }));

    const parsed = JSON.parse(response);
    expect(parsed.result.status).toBe("stopped");
  });
});
