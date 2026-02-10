import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type {
  DataTick,
  Anomaly,
  AgentActivity,
  SourceHealth,
  TradeSuggestion,
  TradeAuditEntry,
  PortfolioPosition,
} from "@finwatch/shared";
import {
  shouldNotifyAnomaly,
  formatAnomalyNotification,
  formatSuggestionNotification,
  formatTradeNotification,
  sendNotification,
  createDebouncedNotifier,
  getNotificationPreferences,
} from "../utils/notifications.js";

type Stores = {
  addTick: (tick: DataTick) => void;
  addAnomaly: (anomaly: Anomaly) => void;
  addActivity: (activity: AgentActivity) => void;
  setSources: (update: Record<string, SourceHealth>) => void;
  addSuggestion?: (s: TradeSuggestion) => void;
  addHistoryEntry?: (e: TradeAuditEntry) => void;
  setPositions?: (p: PortfolioPosition[]) => void;
};

export function useAgentEvents(stores: Stores): void {
  const debouncedNotify = useRef(
    createDebouncedNotifier((content: { title: string; body: string }) => {
      const prefs = getNotificationPreferences();
      if (prefs.enabled) {
        sendNotification(content);
      }
    }, 10000),
  );

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    console.log("[useAgentEvents] Setting up Tauri event listeners");

    listen<DataTick>("data:tick", (e) => {
      console.log("[useAgentEvents] data:tick received", e.payload.symbol, e.payload.sourceId);
      stores.addTick(e.payload);
    }).then((fn) => unlisteners.push(fn));

    listen<Anomaly>("anomaly:detected", (e) => {
      console.log("[useAgentEvents] anomaly:detected received");
      stores.addAnomaly(e.payload);
      const prefs = getNotificationPreferences();
      if (shouldNotifyAnomaly(e.payload, prefs.severityThreshold)) {
        debouncedNotify.current(formatAnomalyNotification(e.payload));
      }
    }).then((fn) => unlisteners.push(fn));

    listen<AgentActivity>("agent:activity", (e) => {
      console.log("[useAgentEvents] agent:activity received", e.payload.type, e.payload.message);
      stores.addActivity(e.payload);
    }).then((fn) => unlisteners.push(fn));

    listen<SourceHealth>("source:health-change", (e) => {
      console.log("[useAgentEvents] source:health-change received", e.payload.sourceId, e.payload.status);
      stores.setSources({ [e.payload.sourceId]: e.payload });
    }).then((fn) => unlisteners.push(fn));

    if (stores.addSuggestion) {
      const handler = stores.addSuggestion;
      listen<TradeSuggestion>("trade:suggestion", (e) => {
        handler(e.payload);
        const prefs = getNotificationPreferences();
        if (prefs.enabled) {
          sendNotification(formatSuggestionNotification(e.payload));
        }
      }).then((fn) => unlisteners.push(fn));
    }

    if (stores.addHistoryEntry) {
      const handler = stores.addHistoryEntry;
      listen<TradeAuditEntry>("trade:executed", (e) => {
        handler(e.payload);
        const prefs = getNotificationPreferences();
        if (prefs.enabled) {
          sendNotification(formatTradeNotification(e.payload));
        }
      }).then((fn) => unlisteners.push(fn));
    }

    if (stores.setPositions) {
      const handler = stores.setPositions;
      listen<PortfolioPosition[]>("portfolio:update", (e) => {
        handler(e.payload);
      }).then((fn) => unlisteners.push(fn));
    }

    return () => {
      console.log("[useAgentEvents] Cleaning up event listeners");
      unlisteners.forEach((fn) => fn());
    };
  }, [stores]);
}
