export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export function parseJsonRpcRequest(raw: string): JsonRpcRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("jsonrpc" in parsed) ||
    !("method" in parsed) ||
    !("id" in parsed)
  ) {
    throw new Error("Invalid JSON-RPC request: missing required fields");
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.method !== "string") {
    throw new Error("Invalid JSON-RPC request: method must be a string");
  }

  return {
    jsonrpc: "2.0",
    id: obj.id as number | string,
    method: obj.method as string,
    params: (obj.params as Record<string, unknown>) ?? {},
  };
}

export function createJsonRpcResponse(
  id: number | string,
  result: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function createJsonRpcError(
  id: number | string,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}
