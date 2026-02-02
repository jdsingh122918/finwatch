import {
  parseJsonRpcRequest,
  createJsonRpcResponse,
  createJsonRpcError,
} from "./json-rpc.js";

export type JsonRpcHandler = (
  params: Record<string, unknown>
) => Promise<unknown>;

export class JsonRpcServer {
  private handlers = new Map<string, JsonRpcHandler>();

  register(method: string, handler: JsonRpcHandler): void {
    if (this.handlers.has(method)) {
      throw new Error(`Method already registered: ${method}`);
    }
    this.handlers.set(method, handler);
  }

  listMethods(): string[] {
    return [...this.handlers.keys()];
  }

  async handleRequest(raw: string): Promise<string> {
    let id: number | string = 0;

    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return JSON.stringify(createJsonRpcError(0, -32700, "Parse error"));
      }

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("method" in parsed) ||
        !("id" in parsed)
      ) {
        return JSON.stringify(
          createJsonRpcError(0, -32600, "Invalid Request: missing required fields")
        );
      }

      const req = parseJsonRpcRequest(raw);
      id = req.id;

      const handler = this.handlers.get(req.method);
      if (!handler) {
        return JSON.stringify(
          createJsonRpcError(id, -32601, `Method not found: ${req.method}`)
        );
      }

      const result = await handler(req.params ?? {});
      return JSON.stringify(createJsonRpcResponse(id, result));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return JSON.stringify(createJsonRpcError(id, -32603, message));
    }
  }
}
