export type LogLevel = "debug" | "info" | "warn" | "error";

type LogEntry = {
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
};

type LogHandler = (entry: LogEntry) => void;

let handler: LogHandler = (entry) => {
  const prefix = `[${entry.level.toUpperCase()}] [${entry.module}]`;
  const msg = `${prefix} ${entry.message}`;
  // All agent logs go to stderr to avoid corrupting the stdout JSON-RPC channel
  if (entry.data && Object.keys(entry.data).length > 0) {
    console.error(msg, JSON.stringify(entry.data));
  } else {
    console.error(msg);
  }
};

export function setLogHandler(h: LogHandler): void {
  handler = h;
}

export function createLogger(module: string) {
  const log = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
    handler({ level, module, message, data, timestamp: Date.now() });
  };

  return {
    debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
    info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
    error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
  };
}
