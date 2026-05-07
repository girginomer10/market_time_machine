import type {
  Fill,
  PortfolioSnapshot,
  Position,
  TradablePrice,
} from "../../types";

export type PortfolioState = {
  cash: number;
  positions: Record<string, Position>;
  realizedPnl: number;
  feesPaid: number;
  slippagePaid: number;
  financingPaid: number;
};

export function emptyPortfolio(initialCash: number): PortfolioState {
  return {
    cash: initialCash,
    positions: {},
    realizedPnl: 0,
    feesPaid: 0,
    slippagePaid: 0,
    financingPaid: 0,
  };
}

export function applyFill(
  state: PortfolioState,
  fill: Fill,
): PortfolioState {
  const next: PortfolioState = {
    ...state,
    positions: { ...state.positions },
  };
  const existing = next.positions[fill.symbol];
  const heldQty = existing?.quantity ?? 0;
  const heldAvg = existing?.averagePrice ?? 0;
  let tradeRealized = 0;
  let nextQuantity = heldQty;
  let nextAverage = heldAvg;

  if (fill.side === "buy") {
    next.cash -= fill.price * fill.quantity + fill.commission;
    if (heldQty < -1e-9) {
      const coverQty = Math.min(fill.quantity, Math.abs(heldQty));
      tradeRealized = (heldAvg - fill.price) * coverQty;
      const remainingBuy = fill.quantity - coverQty;
      nextQuantity = heldQty + coverQty;
      nextAverage = Math.abs(nextQuantity) > 1e-9 ? heldAvg : 0;
      if (remainingBuy > 1e-9) {
        nextQuantity = remainingBuy;
        nextAverage = fill.price;
      }
    } else {
      nextQuantity = heldQty + fill.quantity;
      nextAverage =
        nextQuantity > 0
          ? (heldQty * heldAvg + fill.quantity * fill.price) / nextQuantity
          : 0;
    }
    next.realizedPnl += tradeRealized;
    next.positions[fill.symbol] = {
      symbol: fill.symbol,
      quantity: nextQuantity,
      averagePrice: nextAverage,
      marketPrice: fill.price,
      marketValue: nextQuantity * fill.price,
      unrealizedPnl: (fill.price - nextAverage) * nextQuantity,
      realizedPnl: (existing?.realizedPnl ?? 0) + tradeRealized,
    };
  } else {
    next.cash += fill.price * fill.quantity - fill.commission;
    if (heldQty > 1e-9) {
      const closeQty = Math.min(fill.quantity, heldQty);
      tradeRealized = (fill.price - heldAvg) * closeQty;
      const remainingSell = fill.quantity - closeQty;
      nextQuantity = heldQty - closeQty;
      nextAverage = nextQuantity > 1e-9 ? heldAvg : 0;
      if (remainingSell > 1e-9) {
        nextQuantity = -remainingSell;
        nextAverage = fill.price;
      }
    } else {
      const existingShortQty = Math.abs(Math.min(heldQty, 0));
      nextQuantity = heldQty - fill.quantity;
      nextAverage =
        Math.abs(nextQuantity) > 1e-9
          ? (existingShortQty * heldAvg + fill.quantity * fill.price) /
            Math.abs(nextQuantity)
          : 0;
    }
    next.realizedPnl += tradeRealized;
    if (Math.abs(nextQuantity) <= 1e-9) {
      next.positions[fill.symbol] = {
        symbol: fill.symbol,
        quantity: 0,
        averagePrice: 0,
        marketPrice: fill.price,
        marketValue: 0,
        unrealizedPnl: 0,
        realizedPnl: (existing?.realizedPnl ?? 0) + tradeRealized,
      };
    } else {
      next.positions[fill.symbol] = {
        symbol: fill.symbol,
        quantity: nextQuantity,
        averagePrice: nextAverage,
        marketPrice: fill.price,
        marketValue: nextQuantity * fill.price,
        unrealizedPnl: (fill.price - nextAverage) * nextQuantity,
        realizedPnl: (existing?.realizedPnl ?? 0) + tradeRealized,
      };
    }
  }

  next.feesPaid += fill.commission + fill.spreadCost;
  next.slippagePaid += fill.slippage * fill.quantity;
  return next;
}

export function applyFinancingCost(
  state: PortfolioState,
  amount: number,
): PortfolioState {
  if (!Number.isFinite(amount) || amount <= 0) return state;
  return {
    ...state,
    cash: state.cash - amount,
    realizedPnl: state.realizedPnl - amount,
    financingPaid: state.financingPaid + amount,
  };
}

export function markToMarket(
  state: PortfolioState,
  prices: TradablePrice[],
): PortfolioState {
  const next: PortfolioState = {
    ...state,
    positions: { ...state.positions },
  };
  const priceMap = new Map(prices.map((p) => [p.symbol, p.price]));
  for (const [symbol, position] of Object.entries(state.positions)) {
    const marketPrice = priceMap.get(symbol) ?? position.marketPrice;
    next.positions[symbol] = {
      ...position,
      marketPrice,
      marketValue: position.quantity * marketPrice,
      unrealizedPnl:
        (marketPrice - position.averagePrice) * position.quantity,
    };
  }
  return next;
}

export function snapshotPortfolio(
  state: PortfolioState,
  time: string,
): PortfolioSnapshot {
  const positionsValue = Object.values(state.positions).reduce(
    (sum, p) => sum + p.marketValue,
    0,
  );
  const unrealizedPnl = Object.values(state.positions).reduce(
    (sum, p) => sum + p.unrealizedPnl,
    0,
  );
  return {
    time,
    cash: state.cash,
    positionsValue,
    totalValue: state.cash + positionsValue,
    realizedPnl: state.realizedPnl,
    unrealizedPnl,
    feesPaid: state.feesPaid,
    slippagePaid: state.slippagePaid,
    financingPaid: state.financingPaid,
  };
}
