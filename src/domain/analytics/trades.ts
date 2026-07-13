import type { Candle, Fill, TradeOutcome } from "../../types";

type Lot = {
  direction: "long" | "short";
  remainingQuantity: number;
  price: number;
  commissionPerUnit: number;
  openedAt: string;
};

export type RealizedTrade = {
  closingFill: Fill;
  realizedPnl: number;
  matchedQuantity: number;
  matchedCostBasis: number;
  entryTime: string;
  positionSide: "long" | "short";
};

export type FillPositionEffect = {
  quantityBefore: number;
  quantityAfter: number;
  opensLong: number;
  closesLong: number;
  opensShort: number;
  closesShort: number;
};

function timestamp(time: string): number {
  const value = Date.parse(time);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid analytics timestamp: ${time}`);
  }
  return value;
}

function sortedFills(fills: Fill[]): Fill[] {
  return fills
    .map((fill, index) => ({ fill, index }))
    .sort(
      (a, b) =>
        timestamp(a.fill.time) - timestamp(b.fill.time) || a.index - b.index,
    )
    .map(({ fill }) => fill);
}

export function positionEffectsForFills(
  fills: Fill[],
): Map<string, FillPositionEffect> {
  const quantities = new Map<string, number>();
  const effects = new Map<string, FillPositionEffect>();

  for (const fill of sortedFills(fills)) {
    const before = quantities.get(fill.symbol) ?? 0;
    let closesLong = 0;
    let closesShort = 0;
    let opensLong = 0;
    let opensShort = 0;

    if (fill.side === "buy") {
      closesShort = Math.min(fill.quantity, Math.max(0, -before));
      opensLong = Math.max(0, fill.quantity - closesShort);
    } else {
      closesLong = Math.min(fill.quantity, Math.max(0, before));
      opensShort = Math.max(0, fill.quantity - closesLong);
    }

    const after =
      before + (fill.side === "buy" ? fill.quantity : -fill.quantity);
    quantities.set(fill.symbol, Math.abs(after) <= 1e-9 ? 0 : after);
    effects.set(fill.id, {
      quantityBefore: before,
      quantityAfter: after,
      opensLong,
      closesLong,
      opensShort,
      closesShort,
    });
  }

  return effects;
}

export function realizeTrades(fills: Fill[]): RealizedTrade[] {
  const lotsBySymbol = new Map<string, Lot[]>();
  const out: RealizedTrade[] = [];

  for (const fill of sortedFills(fills)) {
    if (!Number.isFinite(fill.quantity) || fill.quantity <= 0) continue;
    const lots = lotsBySymbol.get(fill.symbol) ?? [];
    lotsBySymbol.set(fill.symbol, lots);
    const closingDirection = fill.side === "buy" ? "short" : "long";
    const openingDirection = fill.side === "buy" ? "long" : "short";
    const commissionPerUnit = fill.commission / fill.quantity;
    let remaining = fill.quantity;
    let realized = 0;
    let matched = 0;
    let matchedCostBasis = 0;
    let entryTime: string | undefined;

    while (
      remaining > 1e-12 &&
      lots.length > 0 &&
      lots[0].direction === closingDirection
    ) {
      const lot = lots[0];
      const used = Math.min(lot.remainingQuantity, remaining);
      const pricePnl =
        closingDirection === "long"
          ? (fill.price - lot.price) * used
          : (lot.price - fill.price) * used;
      realized +=
        pricePnl -
        lot.commissionPerUnit * used -
        commissionPerUnit * used;
      matchedCostBasis += lot.price * used;
      entryTime = entryTime
        ? timestamp(entryTime) < timestamp(lot.openedAt)
          ? entryTime
          : lot.openedAt
        : lot.openedAt;
      lot.remainingQuantity -= used;
      remaining -= used;
      matched += used;
      if (lot.remainingQuantity <= 1e-9) lots.shift();
    }

    if (matched > 1e-12 && entryTime) {
      out.push({
        closingFill: fill,
        realizedPnl: realized,
        matchedQuantity: matched,
        matchedCostBasis,
        entryTime,
        positionSide: closingDirection,
      });
    }

    if (remaining > 1e-12) {
      lots.push({
        direction: openingDirection,
        remainingQuantity: remaining,
        price: fill.price,
        commissionPerUnit,
        openedAt: fill.time,
      });
    }
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
  return realized.map((trade) => ({
    fill: trade.closingFill,
    realizedPnl: trade.realizedPnl,
    contributionPct: totalGain !== 0 ? trade.realizedPnl / totalGain : 0,
    matchedQuantity: trade.matchedQuantity,
    entryTime: trade.entryTime,
    positionSide: trade.positionSide,
  }));
}

export function bestTrade(outcomes: TradeOutcome[]): TradeOutcome | undefined {
  if (outcomes.length === 0) return undefined;
  let best = outcomes[0];
  for (const outcome of outcomes) {
    if (outcome.realizedPnl > best.realizedPnl) best = outcome;
  }
  return best.realizedPnl > 0 ? best : undefined;
}

export function worstTrade(outcomes: TradeOutcome[]): TradeOutcome | undefined {
  if (outcomes.length === 0) return undefined;
  let worst = outcomes[0];
  for (const outcome of outcomes) {
    if (outcome.realizedPnl < worst.realizedPnl) worst = outcome;
  }
  return worst.realizedPnl < 0 ? worst : undefined;
}

export function winRate(outcomes: TradeOutcome[]): number {
  if (outcomes.length === 0) return 0;
  const wins = outcomes.filter((outcome) => outcome.realizedPnl > 0).length;
  return wins / outcomes.length;
}

export function profitFactor(
  outcomes: TradeOutcome[],
): number | undefined {
  let win = 0;
  let loss = 0;
  for (const outcome of outcomes) {
    if (outcome.realizedPnl > 0) win += outcome.realizedPnl;
    else if (outcome.realizedPnl < 0) loss += -outcome.realizedPnl;
  }
  if (loss > 0) return win / loss;
  return win > 0 ? Infinity : undefined;
}

export function averageWin(outcomes: TradeOutcome[]): number | undefined {
  const wins = outcomes.filter((outcome) => outcome.realizedPnl > 0);
  if (wins.length === 0) return undefined;
  return wins.reduce((sum, outcome) => sum + outcome.realizedPnl, 0) / wins.length;
}

export function averageLoss(outcomes: TradeOutcome[]): number | undefined {
  const losses = outcomes.filter((outcome) => outcome.realizedPnl < 0);
  if (losses.length === 0) return undefined;
  return (
    losses.reduce((sum, outcome) => sum + outcome.realizedPnl, 0) /
    losses.length
  );
}

export function feesTotal(fills: Fill[]): number {
  return fills.reduce(
    (sum, fill) => sum + fill.commission + fill.spreadCost,
    0,
  );
}

export function slippageTotal(fills: Fill[]): number {
  return fills.reduce(
    (sum, fill) => sum + fill.slippage * fill.quantity,
    0,
  );
}

export function turnover(fills: Fill[]): number {
  return fills.reduce(
    (sum, fill) => sum + fill.price * fill.quantity,
    0,
  );
}

export function exposureTime(
  candles: Candle[],
  fills: Fill[],
  symbol: string,
): number {
  const symbolCandles = candles
    .filter((candle) => candle.symbol === symbol)
    .sort((a, b) => timestamp(a.closeTime) - timestamp(b.closeTime));
  if (symbolCandles.length === 0) return 0;
  const fillsForSymbol = sortedFills(fills).filter(
    (fill) => fill.symbol === symbol,
  );
  let quantity = 0;
  let exposed = 0;
  let fillIndex = 0;
  for (const candle of symbolCandles) {
    const quantityEntering = quantity;
    while (
      fillIndex < fillsForSymbol.length &&
      timestamp(fillsForSymbol[fillIndex].time) <= timestamp(candle.closeTime)
    ) {
      const fill = fillsForSymbol[fillIndex];
      quantity += fill.side === "buy" ? fill.quantity : -fill.quantity;
      fillIndex++;
    }
    if (Math.abs(quantityEntering) > 1e-9 || Math.abs(quantity) > 1e-9) {
      exposed++;
    }
  }
  return exposed / symbolCandles.length;
}

export function portfolioExposureTime(
  candles: Candle[],
  fills: Fill[],
  symbols?: string[],
): number {
  const includedSymbols = new Set(
    symbols ?? candles.map((candle) => candle.symbol),
  );
  const timeline = [
    ...new Set(
      candles
        .filter((candle) => includedSymbols.has(candle.symbol))
        .map((candle) => timestamp(candle.closeTime)),
    ),
  ].sort((a, b) => a - b);
  if (timeline.length === 0) return 0;

  const relevantFills = sortedFills(fills).filter((fill) =>
    includedSymbols.has(fill.symbol),
  );
  const quantities = new Map<string, number>();
  let fillIndex = 0;
  let exposed = 0;

  for (const time of timeline) {
    const enteringExposed = [...quantities.values()].some(
      (quantity) => Math.abs(quantity) > 1e-9,
    );
    while (
      fillIndex < relevantFills.length &&
      timestamp(relevantFills[fillIndex].time) <= time
    ) {
      const fill = relevantFills[fillIndex];
      const current = quantities.get(fill.symbol) ?? 0;
      quantities.set(
        fill.symbol,
        current + (fill.side === "buy" ? fill.quantity : -fill.quantity),
      );
      fillIndex++;
    }
    const exitingExposed = [...quantities.values()].some(
      (quantity) => Math.abs(quantity) > 1e-9,
    );
    if (enteringExposed || exitingExposed) exposed++;
  }

  return exposed / timeline.length;
}
