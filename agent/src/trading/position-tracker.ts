import type { PortfolioPosition } from "@finwatch/shared";
import type { PositionLookup } from "./trade-generator.js";

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
  private positions: Map<string, PortfolioPosition> = new Map();

  onChange?: (positions: PortfolioPosition[]) => void;

  constructor(config: PositionTrackerConfig) {
    this.config = config;
  }

  async sync(): Promise<void> {
    const url = `${this.config.baseUrl}/v2/positions`;
    const response = await globalThis.fetch(url, {
      headers: {
        "APCA-API-KEY-ID": this.config.keyId,
        "APCA-API-SECRET-KEY": this.config.secretKey,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Alpaca positions API returned HTTP ${response.status}: ${text}`);
    }

    const data = (await response.json()) as AlpacaPositionResponse[];

    this.positions.clear();
    for (const raw of data) {
      const position: PortfolioPosition = {
        symbol: raw.symbol,
        qty: parseFloat(raw.qty),
        avgEntry: parseFloat(raw.avg_entry_price),
        currentPrice: parseFloat(raw.current_price),
        unrealizedPnl: parseFloat(raw.unrealized_pl),
      };
      this.positions.set(position.symbol, position);
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
