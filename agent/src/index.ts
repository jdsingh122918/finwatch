import { JsonRpcServer } from "./ipc/json-rpc-server.js";

export { JsonRpcServer } from "./ipc/json-rpc-server.js";

const server = new JsonRpcServer();

server.register("ping", async () => ({
  status: "ok",
  timestamp: Date.now(),
}));

export function start(): void {
  process.stdin.setEncoding("utf-8");
  let buffer = "";

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        server.handleRequest(line.trim()).then((response) => {
          process.stdout.write(response + "\n");
        });
      }
    }
  });
}

// Start when run directly
const isMain =
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js");
if (isMain) {
  start();
}
