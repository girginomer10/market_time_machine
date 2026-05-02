import type { Candle, Fill, TradeOutcome } from "../../types";

type Lot = {
  remainingQuantity: number;
  price: number;
  commissionPerUnit: number;
};

export type RealizedTrade = {
  closingFill: Fill;
  realizedPnl: number;
  matchedQuantity: number;
};

export function realizeTrades(fills: Fill[]): RealizedTrade[] {
  const sorted = [...fills].sort((a, b) => a.time.localeCompare(b.time));
  const lotsBySymbol: Record<string, Lot[]> = {};
  const out: RealizedTrade[] = [];

  for (const fill of sorted) {
    const lots = (lotsBySymbol[fill.symbol] ??= []);
    if (fill.side === "buy") {
      const commissionPerUnit =
        fill.quantity > 0 ? fill.commission / fill.quantity : 0;
      lots.push({
        remainingQuantity: fill.quantity,
        price: fill.price,
        commissionPerUnit,
      });
      continue;
    }

    let remaining = fill.quantity;
    let realized = -fill.commission;
    let matched = 0;
    while (remaining > 1e-12 && lots.length > 0) {
      const lot = lots[0];
      const used = Math.min(lot.remainingQuantity, remaining);
      realized += (fill.price - lot.price) * used - lot.commissionPerUnit * used;
      lot.remainingQuantity -= used;
      remaining -= used;
      matched += used;
      if (lot.remainingQuantity <= 1e-9) lots.shift();
    }

    out.push({
      closingFill: fill,
      realizedPnl: realized,
      matchedQuantity: matched,
    });
  }

  return out;
}

export function tradeOutcomes(
  fills: Fill[],
  finalEquity: number,
  initialEquity: number,
): TradeOutcome[] {
  const realized = realizeTrades(fills);
  const totalGain = finalEquity - initialEquity;
  return realized.map((r) => ({
    fill: r.closingFill,
    realizedPnl: r.realizedPnl,
    contributionPct: totalGain !== 0 ? r.realizedPnl / totalGain : 0,
  }));
}

export function bestTrade(outcomes: TradeOutcome[]): TradeOutcome | undefined {
  if (outcomes.length === 0) return undefined;
  let best = outcomes[0];
  for (const o of outcomes) {
    if (o.realizedPnl > best.realizedPnl) best = o;
  }
  return best.realizedPnl > 0 ? best : undefined;
}

export function worstTrade(outcomes: TradeOutcome[]): TradeOutcome | undefined {
  if (outcomes.length === 0) return undefined;
  let worst = outcomes[0];
  for (const o of outcomes) {
    if (o.realizedPnl < worst.realizedPnl) worst = o;
  }
  return worst.realizedPnl < 0 ? worst : undefined;
}

export function winRate(outcomes: TradeOutcome[]): number {
  if (outcomes.length === 0) return 0;
  const wins = outcomes.filter((o) => o.realizedPnl > 0).length;
  return wins / outcomes.length;
}

export function profitFactor(
  outcomes: TradeOutcome[],
): number | undefined {
  let win = 0;
  let loss = 0;
  for (const o of outcomes) {
    if (o.realizedPnl > 0) win += o.realizedPnl;
    else if (o.realizedPnl < 0) loss += -o.realizedPnl;
  }
  if (loss > 0) return win / loss;
  return win > 0 ? Infinity : undefined;
}

export function averageWin(outcomes: TradeOutcome[]): number | undefined {
  const wins = outcomes.filter((o) => o.realizedPnl > 0);
  if (wins.length === 0) return undefined;
  return wins.reduce((s, o) => s + o.realizedPnl, 0) / wins.length;
}

export function averageLoss(outcomes: TradeOutcome[]): number | undefined {
  const losses = outcomes.filter((o) => o.realizedPnl < 0);
  if (losses.length === 0) return undefined;
  return losses.reduce((s, o) => s + o.realizedPnl, 0) / losses.length;
}

export function feesTotal(fills: Fill[]): number {
  return fills.reduce((s, f) => s + f.commission + f.spreadCost, 0);
}

export function slippageTotal(fills: Fill[]): number {
  return fills.reduce((s, f) => s + f.slippage * f.quantity, 0);
}

export function turnover(fills: Fill[]): number {
  return fills.reduce((s, f) => s + f.price * f.quantity, 0);
}

export function exposureTime(
  candles: Candle[],
  fills: Fill[],
  symbol: string,
): number {
  const symCandles = candles.filter((c) => c.symbol === symbol);
  if (symCandles.length === 0) return 0;
  const sorted = [...fills]
    .filter((f) => f.symbol === symbol)
    .sort((a, b) => a.time.localeCompare(b.time));
  let qty = 0;
  let exposed = 0;
  let idx = 0;
  for (const candle of symCandles) {
    const qtyEntering = qty;
    while (idx < sorted.length && sorted[idx].time <= candle.closeTime) {
      const f = sorted[idx];
      qty += f.side === "buy" ? f.quantity : -f.quantity;
      idx++;
    }
    if (qtyEntering > 1e-9 || qty > 1e-9) exposed++;
  }
  return exposed / symCandles.length;
}
