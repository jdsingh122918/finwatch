import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Settings } from "../Settings.js";
import { ToastProvider } from "../../components/Toast.js";

vi.mock("@tauri-apps/plugin-notification", () => ({
  sendNotification: vi.fn(),
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
}));

function renderSettings(props = {}) {
  const defaultProps = {
    onCredentialsSave: vi.fn(),
    onConfigSave: vi.fn(),
    onAgentStart: vi.fn(),
    onAgentStop: vi.fn(),
    agentRunning: false,
    watchlist: [] as string[],
    pendingChanges: false,
    onRemoveSymbol: vi.fn(),
    onNavigateWatchlist: vi.fn(),
    onApplyChanges: vi.fn(),
    ...props,
  };
  return render(
    <ToastProvider>
      <Settings {...defaultProps} />
    </ToastProvider>,
  );
}

describe("Settings", () => {
  it("renders heading", () => {
    renderSettings();
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("renders Alpaca credential fields", () => {
    renderSettings();
    expect(screen.getByLabelText("API Key")).toBeDefined();
    expect(screen.getByLabelText("API Secret")).toBeDefined();
  });

  it("renders LLM provider fields", () => {
    renderSettings();
    expect(screen.getByLabelText(/anthropic api key/i)).toBeDefined();
    expect(screen.getByLabelText(/openrouter api key/i)).toBeDefined();
  });

  it("renders symbol chips", () => {
    renderSettings({ watchlist: ["AAPL", "TSLA"] });
    expect(screen.getByText("AAPL")).toBeDefined();
    expect(screen.getByText("TSLA")).toBeDefined();
  });

  it("renders Manage Watchlist link", () => {
    renderSettings({ watchlist: [] });
    expect(screen.getByText(/manage watchlist/i)).toBeDefined();
  });

  it("calls onRemoveSymbol when chip x clicked", () => {
    const handler = vi.fn();
    renderSettings({ watchlist: ["AAPL"], onRemoveSymbol: handler });
    fireEvent.click(screen.getByLabelText("Remove AAPL"));
    expect(handler).toHaveBeenCalledWith("AAPL");
  });

  it("shows Apply Changes when pendingChanges is true", () => {
    renderSettings({ pendingChanges: true });
    expect(screen.getByText(/apply changes/i)).toBeDefined();
  });

  it("calls onCredentialsSave when Save Credentials clicked", () => {
    const handler = vi.fn();
    renderSettings({ onCredentialsSave: handler });
    const keyInput = screen.getByLabelText("API Key");
    const secretInput = screen.getByLabelText("API Secret");
    fireEvent.change(keyInput, { target: { value: "PKTEST" } });
    fireEvent.change(secretInput, { target: { value: "SECRET" } });
    fireEvent.click(screen.getByText(/save credentials/i));
    expect(handler).toHaveBeenCalledWith("PKTEST", "SECRET");
  });

  it("shows toast when credentials saved", () => {
    renderSettings();
    fireEvent.click(screen.getByText(/save credentials/i));
    expect(screen.getByText("Credentials saved")).toBeTruthy();
  });

  it("shows toast when config saved", () => {
    renderSettings();
    fireEvent.click(screen.getByText(/save config/i));
    expect(screen.getByText("Config saved")).toBeTruthy();
  });

  it("renders agent start button when not running", () => {
    renderSettings({ agentRunning: false });
    expect(screen.getByText(/start agent/i)).toBeDefined();
  });

  it("renders agent stop button when running", () => {
    renderSettings({ agentRunning: true });
    expect(screen.getByText(/stop agent/i)).toBeDefined();
  });

  describe("notification preferences", () => {
    let store: Record<string, string>;

    beforeEach(() => {
      store = {};
      vi.stubGlobal("localStorage", {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, val: string) => { store[key] = val; },
        removeItem: (key: string) => { delete store[key]; },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("renders notification toggle", () => {
      renderSettings();
      expect(screen.getByLabelText(/enable notifications/i)).toBeDefined();
    });

    it("renders severity threshold selector", () => {
      renderSettings();
      expect(screen.getByLabelText(/severity threshold/i)).toBeDefined();
    });

    it("defaults to enabled with high threshold", () => {
      renderSettings();
      const toggle = screen.getByLabelText(/enable notifications/i) as HTMLInputElement;
      expect(toggle.checked).toBe(true);
      const select = screen.getByLabelText(/severity threshold/i) as HTMLSelectElement;
      expect(select.value).toBe("high");
    });

    it("persists notification toggle to localStorage", () => {
      renderSettings();
      const toggle = screen.getByLabelText(/enable notifications/i);
      fireEvent.click(toggle);
      const stored = JSON.parse(store["finwatch:notification-prefs"] ?? "{}");
      expect(stored.enabled).toBe(false);
    });

    it("persists severity threshold to localStorage", () => {
      renderSettings();
      const select = screen.getByLabelText(/severity threshold/i);
      fireEvent.change(select, { target: { value: "critical" } });
      const stored = JSON.parse(store["finwatch:notification-prefs"] ?? "{}");
      expect(stored.severityThreshold).toBe("critical");
    });
  });
});
