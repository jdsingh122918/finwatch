import { describe, it, expectTypeOf } from "vitest";
import type {
  DataTick,
  SourceHealth,
  SourceConfig,
  Anomaly,
  AnomalyFeedback,
  Severity,
  MemoryEntry,
  SearchResult,
  DomainPattern,
  AgentMessage,
  SessionMeta,
  CycleState,
  AgentStatus,
  AgentActivity,
  LLMProvider,
  ProviderHealth,
  ModelSlot,
  IpcCommands,
  IpcEvents,
} from "../index.js";

describe("shared types", () => {
  it("DataTick has required fields", () => {
    expectTypeOf<DataTick>().toHaveProperty("sourceId");
    expectTypeOf<DataTick>().toHaveProperty("timestamp");
    expectTypeOf<DataTick>().toHaveProperty("metrics");
    expectTypeOf<DataTick>().toHaveProperty("metadata");
  });

  it("DataTick.metrics is Record<string, number>", () => {
    expectTypeOf<DataTick["metrics"]>().toEqualTypeOf<
      Record<string, number>
    >();
  });

  it("SourceHealth has status union", () => {
    expectTypeOf<SourceHealth["status"]>().toEqualTypeOf<
      "healthy" | "degraded" | "offline"
    >();
  });

  it("Anomaly has required fields", () => {
    expectTypeOf<Anomaly>().toHaveProperty("id");
    expectTypeOf<Anomaly>().toHaveProperty("severity");
    expectTypeOf<Anomaly>().toHaveProperty("source");
    expectTypeOf<Anomaly>().toHaveProperty("timestamp");
    expectTypeOf<Anomaly>().toHaveProperty("description");
  });

  it("Severity is a union of levels", () => {
    expectTypeOf<Severity>().toEqualTypeOf<"low" | "medium" | "high" | "critical">();
  });

  it("AnomalyFeedback has verdict", () => {
    expectTypeOf<AnomalyFeedback>().toHaveProperty("anomalyId");
    expectTypeOf<AnomalyFeedback>().toHaveProperty("verdict");
    expectTypeOf<AnomalyFeedback["verdict"]>().toEqualTypeOf<
      "confirmed" | "false_positive" | "needs_review"
    >();
  });

  it("MemoryEntry has content and embedding", () => {
    expectTypeOf<MemoryEntry>().toHaveProperty("id");
    expectTypeOf<MemoryEntry>().toHaveProperty("content");
    expectTypeOf<MemoryEntry>().toHaveProperty("embedding");
  });

  it("SearchResult has score", () => {
    expectTypeOf<SearchResult>().toHaveProperty("entry");
    expectTypeOf<SearchResult>().toHaveProperty("score");
    expectTypeOf<SearchResult["score"]>().toBeNumber();
  });

  it("SessionMeta has required fields", () => {
    expectTypeOf<SessionMeta>().toHaveProperty("id");
    expectTypeOf<SessionMeta>().toHaveProperty("startedAt");
    expectTypeOf<SessionMeta>().toHaveProperty("kind");
    expectTypeOf<SessionMeta["kind"]>().toEqualTypeOf<
      "monitor" | "subagent" | "improvement"
    >();
  });

  it("AgentStatus has state union", () => {
    expectTypeOf<AgentStatus>().toHaveProperty("state");
    expectTypeOf<AgentStatus["state"]>().toEqualTypeOf<
      "idle" | "running" | "paused" | "error"
    >();
  });

  it("LLMProvider has required methods shape", () => {
    expectTypeOf<LLMProvider>().toHaveProperty("id");
    expectTypeOf<LLMProvider>().toHaveProperty("name");
    expectTypeOf<LLMProvider>().toHaveProperty("createMessage");
    expectTypeOf<LLMProvider>().toHaveProperty("healthCheck");
  });

  it("ProviderHealth has status", () => {
    expectTypeOf<ProviderHealth["status"]>().toEqualTypeOf<
      "healthy" | "degraded" | "offline" | "rate_limited"
    >();
  });

  it("IpcCommands defines all command signatures", () => {
    expectTypeOf<IpcCommands>().toHaveProperty("agent:start");
    expectTypeOf<IpcCommands>().toHaveProperty("agent:stop");
    expectTypeOf<IpcCommands>().toHaveProperty("agent:status");
    expectTypeOf<IpcCommands>().toHaveProperty("config:get");
    expectTypeOf<IpcCommands>().toHaveProperty("config:update");
    expectTypeOf<IpcCommands>().toHaveProperty("anomalies:list");
    expectTypeOf<IpcCommands>().toHaveProperty("anomalies:feedback");
    expectTypeOf<IpcCommands>().toHaveProperty("memory:search");
    expectTypeOf<IpcCommands>().toHaveProperty("sources:health");
  });

  it("IpcEvents defines all event signatures", () => {
    expectTypeOf<IpcEvents>().toHaveProperty("agent:activity");
    expectTypeOf<IpcEvents>().toHaveProperty("data:tick");
    expectTypeOf<IpcEvents>().toHaveProperty("anomaly:detected");
    expectTypeOf<IpcEvents>().toHaveProperty("source:health-change");
    expectTypeOf<IpcEvents>().toHaveProperty("memory:updated");
  });
});
