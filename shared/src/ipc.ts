import type { AgentStatus, AgentActivity } from "./agent.js";
import type { Anomaly, AnomalyFeedback, AnomalyFilter } from "./anomaly.js";
import type { DataTick, SourceHealth } from "./data.js";
import type { SearchResult, MemoryEvent } from "./memory.js";
import type { Config } from "./config.js";
import type {
  TradeSuggestion,
  TradeAuditEntry,
  PortfolioPosition,
  TradingMode,
  TradeHistoryFilter,
} from "./trading.js";
import type { BacktestConfig, BacktestResult, BacktestProgress, BacktestStatus } from "./backtest.js";

// Commands: React -> Rust -> Node.js (request/response)
export type IpcCommands = {
  "agent:start": () => void;
  "agent:stop": () => void;
  "agent:status": () => AgentStatus;
  "config:get": () => Config;
  "config:update": (patch: Partial<Config>) => Config;
  "anomalies:list": (filter: AnomalyFilter) => Anomaly[];
  "anomalies:feedback": (id: string, feedback: AnomalyFeedback) => void;
  "memory:search": (query: string) => SearchResult[];
  "sources:health": () => Record<string, SourceHealth>;
  "trading:suggest": () => TradeSuggestion[];
  "trading:approve": (suggestionId: string) => void;
  "trading:dismiss": (suggestionId: string) => void;
  "trading:history": (filter?: TradeHistoryFilter) => TradeAuditEntry[];
  "trading:positions": () => PortfolioPosition[];
  "trading:mode": (mode?: TradingMode) => TradingMode;
  "backtest:start": (config: BacktestConfig) => { backtestId: string };
  "backtest:cancel": (backtestId: string) => void;
  "backtest:list": () => BacktestResult[];
  "backtest:get": (backtestId: string) => BacktestResult;
  "backtest:delete": (backtestId: string) => void;
};

// Events: Node.js -> Rust -> React (push, fire-and-forget)
export type IpcEvents = {
  "agent:activity": AgentActivity;
  "data:tick": DataTick;
  "anomaly:detected": Anomaly;
  "source:health-change": SourceHealth;
  "memory:updated": MemoryEvent;
  "trade:suggestion": TradeSuggestion;
  "trade:executed": TradeAuditEntry;
  "trade:expired": TradeSuggestion;
  "portfolio:update": PortfolioPosition[];
  "backtest:progress": BacktestProgress;
  "backtest:complete": { backtestId: string; status: BacktestStatus };
};
