import { parseJsonRpcRequest, createJsonRpcResponse, createJsonRpcError } from "./ipc/json-rpc.js";

const methods: Record<string, (params: Record<string, unknown>) => unknown> = {
  ping: () => ({ status: "ok", timestamp: Date.now() }),
};

function handleRequest(raw: string): string {
  try {
    const req = parseJsonRpcRequest(raw);
    const handler = methods[req.method];
    if (!handler) {
      return JSON.stringify(createJsonRpcError(req.id, -32601, `Method not found: ${req.method}`));
    }
    const result = handler(req.params ?? {});
    return JSON.stringify(createJsonRpcResponse(req.id, result));
  } catch {
    return JSON.stringify(createJsonRpcError(0, -32700, "Parse error"));
  }
}

export function start(): void {
  process.stdin.setEncoding("utf-8");
  let buffer = "";

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        const response = handleRequest(line.trim());
        process.stdout.write(response + "\n");
      }
    }
  });
}

// Start when run directly
const isMain = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isMain) {
  start();
}
