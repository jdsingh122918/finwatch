import type { Anomaly, Severity, TradeSuggestion, TradeAuditEntry } from "@finwatch/shared";
import {
  sendNotification as tauriSend,
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";

type NotificationContent = {
  title: string;
  body: string;
};

export type SeverityThreshold = Severity | "none";

export type NotificationPreferences = {
  enabled: boolean;
  severityThreshold: SeverityThreshold;
};

const STORAGE_KEY = "finwatch:notification-prefs";

const DEFAULT_PREFS: NotificationPreferences = {
  enabled: true,
  severityThreshold: "high",
};

const severityRank: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 5,
};

export function formatAnomalyNotification(anomaly: Anomaly): NotificationContent {
  return {
    title: `${anomaly.severity.toUpperCase()} - ${anomaly.symbol || anomaly.source}`,
    body: anomaly.description,
  };
}

export function formatSuggestionNotification(suggestion: TradeSuggestion): NotificationContent {
  const { action } = suggestion;
  return {
    title: `Trade: ${action.side.toUpperCase()} ${action.symbol}`,
    body: `${action.qty} shares (${Math.round(action.confidence * 100)}% confidence) - ${action.rationale}`,
  };
}

export function formatTradeNotification(entry: TradeAuditEntry): NotificationContent {
  const { action } = entry;
  return {
    title: `Executed: ${action.side.toUpperCase()} ${action.symbol}`,
    body: `${action.qty} shares - outcome: ${entry.outcome}`,
  };
}

export function shouldNotifyAnomaly(
  anomaly: Anomaly,
  threshold: SeverityThreshold = "high",
): boolean {
  if (threshold === "none") return false;
  const anomalyRank = severityRank[anomaly.severity] ?? 0;
  const thresholdRank = severityRank[threshold] ?? 0;
  return anomalyRank >= thresholdRank;
}

export function createDebouncedNotifier<T>(
  handler: (item: T) => void,
  intervalMs: number,
): (item: T) => void {
  let lastCall = 0;
  return (item: T) => {
    const now = Date.now();
    if (now - lastCall >= intervalMs) {
      lastCall = now;
      handler(item);
    }
  };
}

export async function sendNotification(content: NotificationContent): Promise<void> {
  let granted = await isPermissionGranted();
  if (!granted) {
    const result = await requestPermission();
    granted = result === "granted";
  }
  if (granted) {
    tauriSend({ title: content.title, body: content.body });
  }
}

export function getNotificationPreferences(): NotificationPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULT_PREFS };
}

export function setNotificationPreferences(prefs: NotificationPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
