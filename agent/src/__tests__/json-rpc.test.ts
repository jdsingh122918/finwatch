import { describe, it, expect } from "vitest";
import { parseJsonRpcRequest, createJsonRpcResponse, createJsonRpcError } from "../ipc/json-rpc.js";

describe("JSON-RPC message parsing", () => {
  it("parses a valid request", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: {},
    });
    const req = parseJsonRpcRequest(raw);
    expect(req.method).toBe("ping");
    expect(req.id).toBe(1);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseJsonRpcRequest("not json")).toThrow();
  });

  it("rejects missing method", () => {
    const raw = JSON.stringify({ jsonrpc: "2.0", id: 1 });
    expect(() => parseJsonRpcRequest(raw)).toThrow();
  });

  it("creates a valid response", () => {
    const resp = createJsonRpcResponse(1, { status: "ok" });
    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.id).toBe(1);
    expect(resp.result).toEqual({ status: "ok" });
    expect(resp.error).toBeUndefined();
  });

  it("creates a valid error response", () => {
    const resp = createJsonRpcError(1, -32600, "Invalid Request");
    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.id).toBe(1);
    expect(resp.error?.code).toBe(-32600);
    expect(resp.error?.message).toBe("Invalid Request");
    expect(resp.result).toBeUndefined();
  });
});
