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
  switch (entry.level) {
    case "error":
      console.error(msg, entry.data ?? "");
      break;
    case "warn":
      console.warn(msg, entry.data ?? "");
      break;
    default:
      console.log(msg, entry.data ?? "");
      break;
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
