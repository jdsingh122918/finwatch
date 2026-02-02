import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTauriEvent } from "../use-tauri-event.js";
import { listen } from "@tauri-apps/api/event";

const mockListen = vi.mocked(listen);

describe("useTauriEvent", () => {
  it("calls listen with event name on mount", () => {
    const callback = vi.fn();
    mockListen.mockResolvedValue(() => {});
    renderHook(() => useTauriEvent("data:tick", callback));
    expect(mockListen).toHaveBeenCalledWith("data:tick", expect.any(Function));
  });

  it("calls callback when event fires", async () => {
    const callback = vi.fn();
    let handler: ((event: any) => void) | undefined;
    mockListen.mockImplementation(async (_name, cb) => {
      handler = cb as any;
      return () => {};
    });

    renderHook(() => useTauriEvent("data:tick", callback));
    await vi.waitFor(() => expect(handler).toBeDefined());

    act(() => {
      handler!({ payload: { sourceId: "yahoo", timestamp: 1 } });
    });
    expect(callback).toHaveBeenCalledWith({ sourceId: "yahoo", timestamp: 1 });
  });

  it("cleans up on unmount", async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValue(unlisten);
    const { unmount } = renderHook(() => useTauriEvent("data:tick", vi.fn()));
    await vi.waitFor(() => expect(mockListen).toHaveBeenCalled());
    unmount();
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalled());
  });
});
