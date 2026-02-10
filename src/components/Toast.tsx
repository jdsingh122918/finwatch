import { createContext, useCallback, useContext, useState, useRef, useEffect } from "react";

type ToastType = "success" | "error" | "info";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

type ToastFn = (message: string, type?: ToastType) => void;

const ToastContext = createContext<ToastFn | null>(null);

const TOAST_DURATION = 3000;

const borderClass: Record<ToastType, string> = {
  success: "border-accent",
  error: "border-severity-critical",
  info: "border-text-muted",
};

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const addToast: ToastFn = useCallback((message, type = "success") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION);
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <ToastContainer toasts={toasts} />
    </ToastContext.Provider>
  );
}

export function ToastContainer({ toasts }: { toasts?: Toast[] }) {
  const ctx = useContext(ToastContext);
  const [internalToasts, setInternalToasts] = useState<Toast[]>([]);

  // Standalone mode (used without provider, with internal state)
  useEffect(() => {
    if (!ctx && toasts) {
      setInternalToasts(toasts);
    }
  }, [ctx, toasts]);

  const items = toasts ?? internalToasts;

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-10 right-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`bg-bg-surface border-l-2 ${borderClass[t.type]} px-4 py-2 text-xs font-mono text-text-primary rounded-sm shadow-lg`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
