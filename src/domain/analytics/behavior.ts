import type { Candle, Fill, MarketEvent } from "../../types";
import type { BehavioralFlag, BehavioralFlagType } from "../../types/reporting";
import {
  positionEffectsForFills,
  type FillPositionEffect,
} from "./trades";

export type { BehavioralFlag, BehavioralFlagType };

export type DetectorParams = {
  panicSell: {
    priorDrawdownThreshold: number;
    recoveryThreshold: number;
    lookbackCandles: number;
    lookaheadCandles: number;
  };
  fomoBuy: {
    priorRallyThreshold: number;
    forwardReturnThreshold: number;
    lookbackCandles: number;
    lookaheadCandles: number;
  };
  dipCatching: {
    priorDrawdownThreshold: number;
    furtherLossThreshold: number;
    lookbackCandles: number;
    lookaheadCandles: number;
  };
  earlyProfitTake: {
    minRealizedReturn: number;
    forwardGainThreshold: number;
    lookaheadCandles: number;
  };
  holdingLoser: {
    minLossThreshold: number;
    minHoldCandles: number;
  };
  overtrading: {
    minTradesPerCandle: number;
    minFeeDragPct: number;
    maxBenchmarkOutperformance: number;
  };
  newsOverreaction: {
    minImportance: 1 | 2 | 3 | 4 | 5;
    reactionWindowCandles: number;
    reversalThreshold: number;
    lookaheadCandles: number;
  };
  excessiveLeverage: {
    leverageThreshold: number;
    minOccurrences: number;
  };
};

export const defaultDetectorParams: DetectorParams = {
  panicSell: {
    priorDrawdownThreshold: 0.05,
    recoveryThreshold: 0.05,
    lookbackCandles: 10,
    lookaheadCandles: 10,
  },
  fomoBuy: {
    priorRallyThreshold: 0.07,
    forwardReturnThreshold: -0.02,
    lookbackCandles: 10,
    lookaheadCandles: 10,
  },
  dipCatching: {
    priorDrawdownThreshold: 0.08,
    furtherLossThreshold: 0.04,
    lookbackCandles: 20,
    lookaheadCandles: 10,
  },
  earlyProfitTake: {
    minRealizedReturn: 0.02,
    forwardGainThreshold: 0.05,
    lookaheadCandles: 20,
  },
  holdingLoser: {
    minLossThreshold: 0.05,
    minHoldCandles: 10,
  },
  overtrading: {
    minTradesPerCandle: 0.25,
    minFeeDragPct: 0.01,
    maxBenchmarkOutperformance: 0,
  },
  newsOverreaction: {
    minImportance: 4,
    reactionWindowCandles: 1,
    reversalThreshold: 0.04,
    lookaheadCandles: 5,
  },
  excessiveLeverage: {
    leverageThreshold: 2,
    minOccurrences: 1,
  },
};

function timestamp(time: string): number {
  const value = Date.parse(time);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid behavioral-analysis timestamp: ${time}`);
  }
  return value;
}

function severityFromMagnitude(magnitude: number): 1 | 2 | 3 | 4 | 5 {
  const value = Math.abs(magnitude);
  if (value >= 0.25) return 5;
  if (value >= 0.15) return 4;
  if (value >= 0.08) return 3;
  if (value >= 0.03) return 2;
  return 1;
}

function findCandleIndexAtOrBefore(candles: Candle[], time: string): number {
  const target = timestamp(time);
  let low = 0;
  let high = candles.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (timestamp(candles[middle].closeTime) <= target) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

export type PanicSellInput = {
  fill: Fill;
  candlesForSymbol: Candle[];
  params?: DetectorParams["panicSell"];
};

export function detectPanicSell(
  input: PanicSellInput,
): BehavioralFlag | undefined {
  if (input.fill.side !== "sell") return undefined;
  const params = input.params ?? defaultDetectorParams.panicSell;
  const candles = input.candlesForSymbol;
  const index = findCandleIndexAtOrBefore(candles, input.fill.time);
  if (index < 0) return undefined;

  const start = Math.max(0, index - params.lookbackCandles);
  let priorPeak = -Infinity;
  for (let i = start; i <= index; i++) priorPeak = Math.max(priorPeak, candles[i].high);
  const fillPrice = input.fill.price;
  const priorDrawdown = priorPeak > 0 ? (priorPeak - fillPrice) / priorPeak : 0;
  if (priorDrawdown < params.priorDrawdownThreshold) return undefined;

  const end = Math.min(candles.length - 1, index + params.lookaheadCandles);
  let forwardPeak = -Infinity;
  for (let i = index + 1; i <= end; i++) {
    forwardPeak = Math.max(forwardPeak, candles[i].high);
  }
  if (!Number.isFinite(forwardPeak) || fillPrice <= 0) return undefined;
  const recovery = (forwardPeak - fillPrice) / fillPrice;
  if (recovery < params.recoveryThreshold) return undefined;

  return {
    id: `panic_sell:${input.fill.id}`,
    type: "panic_sell",
    severity: severityFromMagnitude(recovery),
    tradeIds: [input.fill.id],
    evidence: `Sold after ${(priorDrawdown * 100).toFixed(1)}% drawdown; price recovered ${(recovery * 100).toFixed(1)}% within ${params.lookaheadCandles} candles.`,
    estimatedImpact: -recovery * input.fill.quantity * fillPrice,
  };
}

export type FomoBuyInput = {
  fill: Fill;
  candlesForSymbol: Candle[];
  params?: DetectorParams["fomoBuy"];
};

export function detectFomoBuy(
  input: FomoBuyInput,
): BehavioralFlag | undefined {
  if (input.fill.side !== "buy") return undefined;
  const params = input.params ?? defaultDetectorParams.fomoBuy;
  const candles = input.candlesForSymbol;
  const index = findCandleIndexAtOrBefore(candles, input.fill.time);
  if (index < 0) return undefined;

  const start = Math.max(0, index - params.lookbackCandles);
  const priorClose = candles[start].close;
  const fillPrice = input.fill.price;
  const priorRally = priorClose > 0 ? (fillPrice - priorClose) / priorClose : 0;
  if (priorRally < params.priorRallyThreshold) return undefined;

  const end = Math.min(candles.length - 1, index + params.lookaheadCandles);
  if (end <= index || fillPrice <= 0) return undefined;
  const forwardReturn = (candles[end].close - fillPrice) / fillPrice;
  if (forwardReturn > params.forwardReturnThreshold) return undefined;

  return {
    id: `fomo_buy:${input.fill.id}`,
    type: "fomo_buy",
    severity: severityFromMagnitude(Math.max(priorRally, -forwardReturn)),
    tradeIds: [input.fill.id],
    evidence: `Bought after ${(priorRally * 100).toFixed(1)}% rally; forward ${params.lookaheadCandles}-candle return was ${(forwardReturn * 100).toFixed(1)}%.`,
    estimatedImpact: forwardReturn * input.fill.quantity * fillPrice,
  };
}

export type DipCatchingInput = {
  fill: Fill;
  candlesForSymbol: Candle[];
  params?: DetectorParams["dipCatching"];
};

export function detectDipCatching(
  input: DipCatchingInput,
): BehavioralFlag | undefined {
  if (input.fill.side !== "buy") return undefined;
  const params = input.params ?? defaultDetectorParams.dipCatching;
  const candles = input.candlesForSymbol;
  const index = findCandleIndexAtOrBefore(candles, input.fill.time);
  if (index < 0 || input.fill.price <= 0) return undefined;
  const start = Math.max(0, index - params.lookbackCandles);
  let priorPeak = -Infinity;
  for (let i = start; i <= index; i++) priorPeak = Math.max(priorPeak, candles[i].high);
  const drawdown = priorPeak > 0 ? (priorPeak - input.fill.price) / priorPeak : 0;
  if (drawdown < params.priorDrawdownThreshold) return undefined;

  const end = Math.min(candles.length - 1, index + params.lookaheadCandles);
  let forwardLow = Infinity;
  for (let i = index + 1; i <= end; i++) forwardLow = Math.min(forwardLow, candles[i].low);
  if (!Number.isFinite(forwardLow)) return undefined;
  const furtherLoss = (input.fill.price - forwardLow) / input.fill.price;
  if (furtherLoss < params.furtherLossThreshold) return undefined;

  return {
    id: `dip_catching:${input.fill.id}`,
    type: "dip_catching",
    severity: severityFromMagnitude(Math.max(drawdown, furtherLoss)),
    tradeIds: [input.fill.id],
    evidence: `Bought after a ${(drawdown * 100).toFixed(1)}% drawdown; price fell another ${(furtherLoss * 100).toFixed(1)}% within ${params.lookaheadCandles} candles.`,
    estimatedImpact: -furtherLoss * input.fill.quantity * input.fill.price,
  };
}

export type EarlyProfitTakeInput = {
  closingFill: Fill;
  realizedReturn: number;
  candlesForSymbol: Candle[];
  positionSide?: "long" | "short";
  params?: DetectorParams["earlyProfitTake"];
};

export function detectEarlyProfitTake(
  input: EarlyProfitTakeInput,
): BehavioralFlag | undefined {
  const positionSide =
    input.positionSide ?? (input.closingFill.side === "sell" ? "long" : undefined);
  if (!positionSide) return undefined;
  if (
    (positionSide === "long" && input.closingFill.side !== "sell") ||
    (positionSide === "short" && input.closingFill.side !== "buy")
  ) {
    return undefined;
  }
  const params = input.params ?? defaultDetectorParams.earlyProfitTake;
  if (input.realizedReturn < params.minRealizedReturn) return undefined;

  const candles = input.candlesForSymbol;
  const index = findCandleIndexAtOrBefore(candles, input.closingFill.time);
  if (index < 0 || input.closingFill.price <= 0) return undefined;
  const end = Math.min(candles.length - 1, index + params.lookaheadCandles);
  let continuation = -Infinity;
  for (let i = index + 1; i <= end; i++) {
    const gain =
      positionSide === "long"
        ? (candles[i].high - input.closingFill.price) / input.closingFill.price
        : (input.closingFill.price - candles[i].low) / input.closingFill.price;
    continuation = Math.max(continuation, gain);
  }
  if (!Number.isFinite(continuation) || continuation < params.forwardGainThreshold) {
    return undefined;
  }

  return {
    id: `early_profit_take:${input.closingFill.id}`,
    type: "early_profit_take",
    severity: severityFromMagnitude(continuation),
    tradeIds: [input.closingFill.id],
    evidence: `Closed a ${positionSide} at +${(input.realizedReturn * 100).toFixed(1)}%; the move continued another ${(continuation * 100).toFixed(1)}% within ${params.lookaheadCandles} candles.`,
    estimatedImpact:
      -continuation * input.closingFill.quantity * input.closingFill.price,
  };
}

export type HoldingLoserInput = {
  closingFill: Fill;
  realizedReturn: number;
  entryTime: string;
  candlesForSymbol: Candle[];
  params?: DetectorParams["holdingLoser"];
};

export function detectHoldingLoser(
  input: HoldingLoserInput,
): BehavioralFlag | undefined {
  const params = input.params ?? defaultDetectorParams.holdingLoser;
  if (input.realizedReturn > -params.minLossThreshold) return undefined;
  const entryIndex = findCandleIndexAtOrBefore(
    input.candlesForSymbol,
    input.entryTime,
  );
  const exitIndex = findCandleIndexAtOrBefore(
    input.candlesForSymbol,
    input.closingFill.time,
  );
  if (entryIndex < 0 || exitIndex < entryIndex) return undefined;
  const heldCandles = exitIndex - entryIndex;
  if (heldCandles < params.minHoldCandles) return undefined;

  return {
    id: `holding_loser:${input.closingFill.id}`,
    type: "holding_loser",
    severity: severityFromMagnitude(input.realizedReturn),
    tradeIds: [input.closingFill.id],
    evidence: `Held a losing position for ${heldCandles} candles before closing at ${(input.realizedReturn * 100).toFixed(1)}%.`,
    estimatedImpact: input.closingFill.quantity * input.closingFill.price * input.realizedReturn,
  };
}

export type OvertradingInput = {
  fills: Fill[];
  candleCount: number;
  feesPaid: number;
  slippagePaid: number;
  initialEquity: number;
  excessReturn: number;
  params?: DetectorParams["overtrading"];
};

export function detectOvertrading(
  input: OvertradingInput,
): BehavioralFlag | undefined {
  if (input.candleCount <= 0 || input.fills.length === 0) return undefined;
  const params = input.params ?? defaultDetectorParams.overtrading;
  const tradesPerCandle = input.fills.length / input.candleCount;
  if (tradesPerCandle < params.minTradesPerCandle) return undefined;
  const feeDrag =
    input.initialEquity > 0
      ? (input.feesPaid + input.slippagePaid) / input.initialEquity
      : 0;
  if (
    feeDrag < params.minFeeDragPct ||
    input.excessReturn > params.maxBenchmarkOutperformance
  ) {
    return undefined;
  }

  return {
    id: "overtrading:session",
    type: "overtrading",
    severity: severityFromMagnitude(feeDrag * 5),
    tradeIds: input.fills.map((fill) => fill.id),
    evidence: `Executed ${input.fills.length} fills over ${input.candleCount} candles (${tradesPerCandle.toFixed(2)}/candle), ${(feeDrag * 100).toFixed(2)}% equity lost to fees+slippage, ${(input.excessReturn * 100).toFixed(1)}% vs benchmark.`,
    estimatedImpact: -(input.feesPaid + input.slippagePaid),
  };
}

export type NewsOverreactionInput = {
  fill: Fill;
  candlesForSymbol: Candle[];
  events: MarketEvent[];
  params?: DetectorParams["newsOverreaction"];
};

export function detectNewsOverreaction(
  input: NewsOverreactionInput,
): BehavioralFlag | undefined {
  const params = input.params ?? defaultDetectorParams.newsOverreaction;
  const candles = input.candlesForSymbol;
  const fillIndex = findCandleIndexAtOrBefore(candles, input.fill.time);
  if (fillIndex < 0 || input.fill.price <= 0) return undefined;
  const candidates = input.events
    .filter(
      (event) =>
        event.importance >= params.minImportance &&
        timestamp(event.publishedAt) <= timestamp(input.fill.time) &&
        event.affectedSymbols.includes(input.fill.symbol),
    )
    .map((event) => ({
      event,
      eventIndex: findCandleIndexAtOrBefore(candles, event.publishedAt),
    }))
    .filter(
      ({ eventIndex }) =>
        eventIndex >= 0 &&
        fillIndex - eventIndex >= 0 &&
        fillIndex - eventIndex <= params.reactionWindowCandles,
    )
    .sort(
      (a, b) =>
        timestamp(b.event.publishedAt) - timestamp(a.event.publishedAt),
    );
  const candidate = candidates[0];
  if (!candidate) return undefined;

  const end = Math.min(candles.length - 1, fillIndex + params.lookaheadCandles);
  if (end <= fillIndex) return undefined;
  const forwardReturn = (candles[end].close - input.fill.price) / input.fill.price;
  const reversal = input.fill.side === "buy" ? -forwardReturn : forwardReturn;
  if (reversal < params.reversalThreshold) return undefined;

  return {
    id: `news_overreaction:${input.fill.id}:${candidate.event.id}`,
    type: "news_overreaction",
    severity: severityFromMagnitude(reversal),
    tradeIds: [input.fill.id],
    evidence: `${input.fill.side === "buy" ? "Bought" : "Sold"} within ${params.reactionWindowCandles} candle(s) of “${candidate.event.title}”; price reversed ${(reversal * 100).toFixed(1)}% over the next ${params.lookaheadCandles} candles.`,
    estimatedImpact: -reversal * input.fill.quantity * input.fill.price,
  };
}

export type ExcessiveLeverageInput = {
  fills: Fill[];
  leverageByFill: Map<string, number>;
  params?: DetectorParams["excessiveLeverage"];
};

export function detectExcessiveLeverage(
  input: ExcessiveLeverageInput,
): BehavioralFlag | undefined {
  const params = input.params ?? defaultDetectorParams.excessiveLeverage;
  const exceeded = input.fills
    .map((fill) => ({ fill, leverage: input.leverageByFill.get(fill.id) ?? 0 }))
    .filter(({ leverage }) => leverage > params.leverageThreshold);
  if (exceeded.length < params.minOccurrences) return undefined;
  const maximum = Math.max(...exceeded.map(({ leverage }) => leverage));
  return {
    id: "excessive_leverage:session",
    type: "excessive_leverage",
    severity: severityFromMagnitude((maximum - 1) / Math.max(1, params.leverageThreshold)),
    tradeIds: exceeded.map(({ fill }) => fill.id),
    evidence: `Leverage exceeded ${params.leverageThreshold.toFixed(1)}× after ${exceeded.length} fill(s), reaching ${maximum.toFixed(2)}×.`,
  };
}

export type DetectAllInput = {
  fills: Fill[];
  candlesBySymbol: Map<string, Candle[]>;
  totalCandleCount: number;
  feesPaid: number;
  slippagePaid: number;
  initialEquity: number;
  excessReturn: number;
  realizedTradeReturns: Map<string, number>;
  realizedTradeEntryTimes?: Map<string, string>;
  realizedTradeSides?: Map<string, "long" | "short">;
  fillEffects?: Map<string, FillPositionEffect>;
  events?: MarketEvent[];
  leverageByFill?: Map<string, number>;
  params?: Partial<DetectorParams>;
};

export function detectAllBehavioralFlags(
  input: DetectAllInput,
): BehavioralFlag[] {
  const flags: BehavioralFlag[] = [];
  const effects = input.fillEffects ?? positionEffectsForFills(input.fills);
  const params: DetectorParams = {
    panicSell: { ...defaultDetectorParams.panicSell, ...input.params?.panicSell },
    fomoBuy: { ...defaultDetectorParams.fomoBuy, ...input.params?.fomoBuy },
    dipCatching: {
      ...defaultDetectorParams.dipCatching,
      ...input.params?.dipCatching,
    },
    earlyProfitTake: {
      ...defaultDetectorParams.earlyProfitTake,
      ...input.params?.earlyProfitTake,
    },
    holdingLoser: {
      ...defaultDetectorParams.holdingLoser,
      ...input.params?.holdingLoser,
    },
    overtrading: {
      ...defaultDetectorParams.overtrading,
      ...input.params?.overtrading,
    },
    newsOverreaction: {
      ...defaultDetectorParams.newsOverreaction,
      ...input.params?.newsOverreaction,
    },
    excessiveLeverage: {
      ...defaultDetectorParams.excessiveLeverage,
      ...input.params?.excessiveLeverage,
    },
  };

  for (const fill of input.fills) {
    const candles = input.candlesBySymbol.get(fill.symbol) ?? [];
    if (candles.length === 0) continue;
    const effect = effects.get(fill.id);

    if ((effect?.closesLong ?? (fill.side === "sell" ? fill.quantity : 0)) > 0) {
      const panic = detectPanicSell({
        fill,
        candlesForSymbol: candles,
        params: params.panicSell,
      });
      if (panic) flags.push(panic);
    }

    if ((effect?.opensLong ?? (fill.side === "buy" ? fill.quantity : 0)) > 0) {
      const fomo = detectFomoBuy({
        fill,
        candlesForSymbol: candles,
        params: params.fomoBuy,
      });
      if (fomo) flags.push(fomo);
      const dip = detectDipCatching({
        fill,
        candlesForSymbol: candles,
        params: params.dipCatching,
      });
      if (dip) flags.push(dip);
    }

    const realizedReturn = input.realizedTradeReturns.get(fill.id);
    const positionSide = input.realizedTradeSides?.get(fill.id);
    if (realizedReturn !== undefined && positionSide) {
      const early = detectEarlyProfitTake({
        closingFill: fill,
        realizedReturn,
        positionSide,
        candlesForSymbol: candles,
        params: params.earlyProfitTake,
      });
      if (early) flags.push(early);
      const entryTime = input.realizedTradeEntryTimes?.get(fill.id);
      if (entryTime) {
        const holding = detectHoldingLoser({
          closingFill: fill,
          realizedReturn,
          entryTime,
          candlesForSymbol: candles,
          params: params.holdingLoser,
        });
        if (holding) flags.push(holding);
      }
    }

    if ((input.events?.length ?? 0) > 0) {
      const news = detectNewsOverreaction({
        fill,
        candlesForSymbol: candles,
        events: input.events ?? [],
        params: params.newsOverreaction,
      });
      if (news) flags.push(news);
    }
  }

  const overtrading = detectOvertrading({
    fills: input.fills,
    candleCount: input.totalCandleCount,
    feesPaid: input.feesPaid,
    slippagePaid: input.slippagePaid,
    initialEquity: input.initialEquity,
    excessReturn: input.excessReturn,
    params: params.overtrading,
  });
  if (overtrading) flags.push(overtrading);

  if (input.leverageByFill) {
    const leverage = detectExcessiveLeverage({
      fills: input.fills,
      leverageByFill: input.leverageByFill,
      params: params.excessiveLeverage,
    });
    if (leverage) flags.push(leverage);
  }

  return flags;
}
