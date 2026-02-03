import type { PortfolioPosition } from "@finwatch/shared";
import type { PositionLookup } from "./trade-generator.js";
import { createLogger } from "../utils/logger.js";

export type PositionTrackerConfig = {
  keyId: string;
  secretKey: string;
  baseUrl: string;
};

type AlpacaPositionResponse = {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  unrealized_pl: string;
};

export class PositionTracker implements PositionLookup {
  private config: PositionTrackerConfig;
  private log = createLogger("position-tracker");
  private positions: Map<string, PortfolioPosition> = new Map();

  onChange?: (positions: PortfolioPosition[]) => void;

  constructor(config: PositionTrackerConfig) {
    this.config = config;
  }

  async sync(): Promise<void> {
    this.log.info("Syncing positions from Alpaca");
    const url = `${this.config.baseUrl}/v2/positions`;
    const response = await globalThis.fetch(url, {
      headers: {
        "APCA-API-KEY-ID": this.config.keyId,
        "APCA-API-SECRET-KEY": this.config.secretKey,
      },
    });

    if (!response.ok) {
      this.log.error("Failed to sync positions", { status: response.status });
      const text = await response.text();
      throw new Error(`Alpaca positions API returned HTTP ${response.status}: ${text}`);
    }

    const data = (await response.json()) as AlpacaPositionResponse[];

    const parsed: PortfolioPosition[] = [];
    for (const raw of data) {
      const qty = parseFloat(raw.qty);
      const avgEntry = parseFloat(raw.avg_entry_price);
      const currentPrice = parseFloat(raw.current_price);
      const unrealizedPnl = parseFloat(raw.unrealized_pl);

      if (
        !Number.isFinite(qty) ||
        !Number.isFinite(avgEntry) ||
        !Number.isFinite(currentPrice) ||
        !Number.isFinite(unrealizedPnl)
      ) {
        this.log.warn("Skipping position with invalid numeric data", { symbol: raw.symbol });
        continue; // skip corrupt position data
      }

      parsed.push({
        symbol: raw.symbol,
        qty,
        avgEntry,
        currentPrice,
        unrealizedPnl,
      });
    }

    this.log.info("Positions synced", { count: parsed.length });

    // Replace atomically only after all positions are validated
    this.positions.clear();
    for (const pos of parsed) {
      this.positions.set(pos.symbol, pos);
    }

    this.onChange?.(this.getPositions());
  }

  getPositions(): PortfolioPosition[] {
    return Array.from(this.positions.values());
  }

  getPosition(symbol: string): PortfolioPosition | undefined {
    return this.positions.get(symbol);
  }

  hasPosition(symbol: string): boolean {
    return this.positions.has(symbol);
  }

  getQty(symbol: string): number {
    return this.positions.get(symbol)?.qty ?? 0;
  }

  totalExposure(): number {
    let total = 0;
    for (const pos of this.positions.values()) {
      total += Math.abs(pos.qty * pos.currentPrice);
    }
    return total;
  }
}
