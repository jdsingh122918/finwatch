import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTauriCommand } from "../use-tauri-command.js";
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

describe("useTauriCommand", () => {
  it("starts with idle state", () => {
    const { result } = renderHook(() => useTauriCommand<string>("config:get"));
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it("sets loading during execution", async () => {
    let resolve: (v: string) => void;
    mockInvoke.mockReturnValue(
      new Promise((r) => {
        resolve = r as any;
      }),
    );
    const { result } = renderHook(() => useTauriCommand<string>("config:get"));

    act(() => {
      result.current.execute();
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolve!("{}");
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe("{}");
  });

  it("sets error on failure", async () => {
    mockInvoke.mockRejectedValue(new Error("DB error"));
    const { result } = renderHook(() => useTauriCommand<string>("config:get"));
    await act(async () => {
      await result.current.execute().catch(() => {});
    });
    expect(result.current.error).toBe("DB error");
  });

  it("passes args to invoke", async () => {
    mockInvoke.mockResolvedValue("ok");
    const { result } = renderHook(() =>
      useTauriCommand<string>("config:update"),
    );
    await act(async () => {
      await result.current.execute({ patch: "{}" });
    });
    expect(mockInvoke).toHaveBeenCalledWith("config:update", { patch: "{}" });
  });
});
