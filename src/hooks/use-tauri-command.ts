import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

type CommandState<T> = {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  execute: (args?: Record<string, unknown>) => Promise<T | undefined>;
};

export function useTauriCommand<T>(command: string): CommandState<T> {
  const [data, setData] = useState<T | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const execute = useCallback(
    async (args?: Record<string, unknown>) => {
      setLoading(true);
      setError(undefined);
      try {
        const result = await invoke<T>(command, args);
        setData(result);
        setLoading(false);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setLoading(false);
        throw err;
      }
    },
    [command],
  );

  return { data, loading, error, execute };
}
