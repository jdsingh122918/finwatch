import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatAnomalyNotification,
  formatSuggestionNotification,
  formatTradeNotification,
  shouldNotifyAnomaly,
  createDebouncedNotifier,
  sendNotification,
  getNotificationPreferences,
  setNotificationPreferences,
} from "../notifications.js";
import type { Anomaly, TradeSuggestion, TradeAuditEntry } from "@finwatch/shared";

const mockSendNotification = vi.fn();
const mockIsPermissionGranted = vi.fn();
const mockRequestPermission = vi.fn();

vi.mock("@tauri-apps/plugin-notification", () => ({
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  isPermissionGranted: () => mockIsPermissionGranted(),
  requestPermission: () => mockRequestPermission(),
}));

const anomaly: Anomaly = {
  id: "a1",
  severity: "critical",
  source: "yahoo",
  symbol: "AAPL",
  timestamp: Date.now(),
  description: "Price spike detected +15%",
  metrics: { priceChange: 0.15 },
  preScreenScore: 0.9,
  sessionId: "s1",
};

const suggestion: TradeSuggestion = {
  id: "s1",
  action: {
    symbol: "AAPL",
    side: "buy",
    qty: 10,
    type: "market",
    rationale: "Anomaly detected",
    confidence: 0.85,
    anomalyId: "a1",
  },
  expiresAt: Date.now() + 300000,
  status: "pending",
};

const trade: TradeAuditEntry = {
  id: "t1",
  action: {
    symbol: "TSLA",
    side: "sell",
    qty: 5,
    type: "market",
    rationale: "Exit position",
    confidence: 0.7,
    anomalyId: "a2",
  },
  anomalyId: "a2",
  outcome: "profit",
  limitsChecked: [],
  timestamp: Date.now(),
};

describe("formatAnomalyNotification", () => {
  it("returns title with severity and symbol", () => {
    const result = formatAnomalyNotification(anomaly);
    expect(result.title).toContain("CRITICAL");
    expect(result.title).toContain("AAPL");
  });

  it("returns description in body", () => {
    const result = formatAnomalyNotification(anomaly);
    expect(result.body).toContain("Price spike detected");
  });
});

describe("formatSuggestionNotification", () => {
  it("returns title with symbol and side", () => {
    const result = formatSuggestionNotification(suggestion);
    expect(result.title).toContain("AAPL");
    expect(result.title).toContain("BUY");
  });

  it("returns confidence in body", () => {
    const result = formatSuggestionNotification(suggestion);
    expect(result.body).toContain("85%");
  });
});

describe("formatTradeNotification", () => {
  it("returns title with symbol and side", () => {
    const result = formatTradeNotification(trade);
    expect(result.title).toContain("TSLA");
    expect(result.title).toContain("SELL");
  });

  it("returns outcome in body", () => {
    const result = formatTradeNotification(trade);
    expect(result.body).toContain("profit");
  });
});

describe("shouldNotifyAnomaly", () => {
  it("returns true for critical severity with default threshold", () => {
    expect(shouldNotifyAnomaly(anomaly)).toBe(true);
  });

  it("returns true for high severity with default threshold", () => {
    expect(shouldNotifyAnomaly({ ...anomaly, severity: "high" })).toBe(true);
  });

  it("returns false for low severity with default threshold", () => {
    expect(shouldNotifyAnomaly({ ...anomaly, severity: "low" })).toBe(false);
  });

  it("returns false for medium severity with default threshold", () => {
    expect(shouldNotifyAnomaly({ ...anomaly, severity: "medium" })).toBe(false);
  });

  it("respects custom threshold", () => {
    expect(shouldNotifyAnomaly({ ...anomaly, severity: "low" }, "low")).toBe(true);
  });

  it("returns false when notifications disabled", () => {
    expect(shouldNotifyAnomaly(anomaly, "none")).toBe(false);
  });
});

describe("createDebouncedNotifier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls handler on first invocation", () => {
    const handler = vi.fn();
    const debounced = createDebouncedNotifier(handler, 10000);
    debounced("test");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("skips rapid successive calls within interval", () => {
    const handler = vi.fn();
    const debounced = createDebouncedNotifier(handler, 10000);
    debounced("first");
    debounced("second");
    debounced("third");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("allows calls after interval has passed", () => {
    const handler = vi.fn();
    const debounced = createDebouncedNotifier(handler, 10000);
    debounced("first");
    vi.advanceTimersByTime(10001);
    debounced("second");
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("sendNotification (Tauri native)", () => {
  beforeEach(() => {
    mockSendNotification.mockClear();
    mockIsPermissionGranted.mockClear();
    mockRequestPermission.mockClear();
  });

  it("sends notification when permission is granted", async () => {
    mockIsPermissionGranted.mockResolvedValue(true);
    await sendNotification({ title: "Test", body: "Body" });
    expect(mockSendNotification).toHaveBeenCalledWith({ title: "Test", body: "Body" });
  });

  it("requests permission when not granted and sends if approved", async () => {
    mockIsPermissionGranted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue("granted");
    await sendNotification({ title: "Test", body: "Body" });
    expect(mockRequestPermission).toHaveBeenCalled();
    expect(mockSendNotification).toHaveBeenCalledWith({ title: "Test", body: "Body" });
  });

  it("does not send when permission is denied", async () => {
    mockIsPermissionGranted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue("denied");
    await sendNotification({ title: "Test", body: "Body" });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});

describe("notification preferences", () => {
  const STORAGE_KEY = "finwatch:notification-prefs";
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

  it("returns defaults when no preferences are stored", () => {
    const prefs = getNotificationPreferences();
    expect(prefs.enabled).toBe(true);
    expect(prefs.severityThreshold).toBe("high");
  });

  it("persists preferences to localStorage", () => {
    setNotificationPreferences({ enabled: false, severityThreshold: "critical" });
    const prefs = getNotificationPreferences();
    expect(prefs.enabled).toBe(false);
    expect(prefs.severityThreshold).toBe("critical");
  });

  it("handles partial updates", () => {
    setNotificationPreferences({ enabled: false, severityThreshold: "high" });
    setNotificationPreferences({ enabled: true, severityThreshold: "low" });
    const prefs = getNotificationPreferences();
    expect(prefs.enabled).toBe(true);
    expect(prefs.severityThreshold).toBe("low");
  });

  it("returns defaults for invalid JSON in storage", () => {
    store[STORAGE_KEY] = "not-json";
    const prefs = getNotificationPreferences();
    expect(prefs.enabled).toBe(true);
    expect(prefs.severityThreshold).toBe("high");
  });
});
