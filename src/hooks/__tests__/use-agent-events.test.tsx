import { describe, it, expect, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";

describe("useAgentEvents", () => {
  it("exports a hook function", async () => {
    const mod = await import("../use-agent-events.js");
    expect(typeof mod.useAgentEvents).toBe("function");
  });

  it("registers listeners for all event types", async () => {
    const { renderHook, cleanup } = await import("@testing-library/react");
    const { useAgentEvents } = await import("../use-agent-events.js");

    const stores = {
      addTick: vi.fn(),
      addAnomaly: vi.fn(),
      addActivity: vi.fn(),
      setSources: vi.fn(),
    };

    renderHook(() => useAgentEvents(stores));

    // listen is mocked in test-setup.ts — verify it was called
    expect(listen).toHaveBeenCalled();

    cleanup();
  });
});
