import { describe, it, expect, vi } from "vitest";
import { JsonRpcServer } from "../json-rpc-server.js";

describe("JsonRpcServer", () => {
  it("can register and call a method", async () => {
    const server = new JsonRpcServer();
    server.register("ping", async () => ({ status: "ok" }));

    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} })
    );
    const parsed = JSON.parse(response);
    expect(parsed.jsonrpc).toBe("2.0");
    expect(parsed.id).toBe(1);
    expect(parsed.result).toEqual({ status: "ok" });
    expect(parsed.error).toBeUndefined();
  });

  it("passes params to handler", async () => {
    const server = new JsonRpcServer();
    server.register("echo", async (params) => ({ echo: params.message }));

    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "echo", params: { message: "hello" } })
    );
    const parsed = JSON.parse(response);
    expect(parsed.result).toEqual({ echo: "hello" });
  });

  it("returns method-not-found error for unregistered method", async () => {
    const server = new JsonRpcServer();

    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "nonexistent", params: {} })
    );
    const parsed = JSON.parse(response);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe(-32601);
    expect(parsed.error.message).toContain("Method not found");
  });

  it("returns parse error for invalid JSON", async () => {
    const server = new JsonRpcServer();

    const response = await server.handleRequest("not valid json{{{");
    const parsed = JSON.parse(response);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe(-32700);
  });

  it("returns internal error when handler throws", async () => {
    const server = new JsonRpcServer();
    server.register("fail", async () => {
      throw new Error("something broke");
    });

    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "fail", params: {} })
    );
    const parsed = JSON.parse(response);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe(-32603);
    expect(parsed.error.message).toContain("something broke");
  });

  it("returns invalid-request error for missing required fields", async () => {
    const server = new JsonRpcServer();

    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0" })
    );
    const parsed = JSON.parse(response);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe(-32600);
  });

  it("lists registered methods", () => {
    const server = new JsonRpcServer();
    server.register("a", async () => ({}));
    server.register("b", async () => ({}));
    expect(server.listMethods()).toEqual(["a", "b"]);
  });

  it("prevents duplicate method registration", () => {
    const server = new JsonRpcServer();
    server.register("dup", async () => ({}));
    expect(() => server.register("dup", async () => ({}))).toThrow(
      "Method already registered: dup"
    );
  });
});
