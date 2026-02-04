import type { TradeAction, BacktestTrade } from "@finwatch/shared";

type Lot = { qty: number; price: number; timestamp: number };

type Position = {
  qty: number;
  avgEntry: number;
  lots: Lot[];
};

export class BacktestExecutor {
  private backtestId: string;
  private _cash: number;
  private positions = new Map<string, Position>();
  private tradeLog: BacktestTrade[] = [];
  private equityCurve: { date: string; value: number }[] = [];
  private tradeSeq = 0;

  constructor(backtestId: string, initialCapital: number) {
    this.backtestId = backtestId;
    this._cash = initialCapital;
  }

  get cash(): number {
    return this._cash;
  }

  execute(
    action: TradeAction,
    fillPrice: number,
    timestamp: number,
  ): BacktestTrade | null {
    if (action.side === "buy") {
      return this.executeBuy(action, fillPrice, timestamp);
    }
    return this.executeSell(action, fillPrice, timestamp);
  }

  private executeBuy(
    action: TradeAction,
    fillPrice: number,
    timestamp: number,
  ): BacktestTrade | null {
    const cost = action.qty * fillPrice;
    if (cost > this._cash) return null;

    this._cash -= cost;

    const existing = this.positions.get(action.symbol);
    if (existing) {
      const totalQty = existing.qty + action.qty;
      const totalCost = existing.avgEntry * existing.qty + fillPrice * action.qty;
      existing.qty = totalQty;
      existing.avgEntry = totalCost / totalQty;
      existing.lots.push({ qty: action.qty, price: fillPrice, timestamp });
    } else {
      this.positions.set(action.symbol, {
        qty: action.qty,
        avgEntry: fillPrice,
        lots: [{ qty: action.qty, price: fillPrice, timestamp }],
      });
    }

    const trade: BacktestTrade = {
      id: `btt-${++this.tradeSeq}`,
      backtestId: this.backtestId,
      symbol: action.symbol,
      side: "buy",
      qty: action.qty,
      fillPrice,
      timestamp,
      anomalyId: action.anomalyId,
      rationale: action.rationale,
      realizedPnl: null,
    };
    this.tradeLog.push(trade);
    return trade;
  }

  private executeSell(
    action: TradeAction,
    fillPrice: number,
    timestamp: number,
  ): BacktestTrade | null {
    const pos = this.positions.get(action.symbol);
    if (!pos || pos.qty <= 0) return null;

    const sellQty = Math.min(action.qty, pos.qty);
    let realizedPnl = 0;
    let remaining = sellQty;

    // FIFO (First-In-First-Out) lot matching: sells consume the oldest purchased lots first
    while (remaining > 0 && pos.lots.length > 0) {
      const lot = pos.lots[0];
      const fromLot = Math.min(remaining, lot.qty);
      realizedPnl += fromLot * (fillPrice - lot.price);
      lot.qty -= fromLot;
      remaining -= fromLot;
      if (lot.qty <= 0) pos.lots.shift();
    }

    this._cash += sellQty * fillPrice;
    pos.qty -= sellQty;

    if (pos.qty <= 0) {
      this.positions.delete(action.symbol);
    } else {
      // Recalculate avgEntry from remaining lots
      const totalCost = pos.lots.reduce((s, l) => s + l.qty * l.price, 0);
      pos.avgEntry = totalCost / pos.qty;
    }

    const trade: BacktestTrade = {
      id: `btt-${++this.tradeSeq}`,
      backtestId: this.backtestId,
      symbol: action.symbol,
      side: "sell",
      qty: sellQty,
      fillPrice,
      timestamp,
      anomalyId: action.anomalyId,
      rationale: action.rationale,
      realizedPnl,
    };
    this.tradeLog.push(trade);
    return trade;
  }

  portfolioValue(currentPrices: Record<string, number>): number {
    let posValue = 0;
    for (const [symbol, pos] of this.positions) {
      // Falls back to avgEntry when current market price is unavailable for this symbol
      const price = currentPrices[symbol] ?? pos.avgEntry;
      posValue += pos.qty * price;
    }
    return this._cash + posValue;
  }

  snapshot(date: string, currentPrices: Record<string, number>): void {
    this.equityCurve.push({ date, value: this.portfolioValue(currentPrices) });
  }

  getPositions(): Record<string, { qty: number; avgEntry: number }> {
    const result: Record<string, { qty: number; avgEntry: number }> = {};
    for (const [symbol, pos] of this.positions) {
      result[symbol] = { qty: pos.qty, avgEntry: pos.avgEntry };
    }
    return result;
  }

  getTradeLog(): BacktestTrade[] {
    return this.tradeLog;
  }

  getEquityCurve(): { date: string; value: number }[] {
    return this.equityCurve;
  }

  hasPosition(symbol: string): boolean {
    return this.positions.has(symbol);
  }

  getQty(symbol: string): number {
    return this.positions.get(symbol)?.qty ?? 0;
  }
}
