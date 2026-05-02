import type { Candle, Fill } from "../../types";
import type { BehavioralFlag, BehavioralFlagType } from "../../types/reporting";

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
  earlyProfitTake: {
    minRealizedReturn: number;
    forwardGainThreshold: number;
    lookaheadCandles: number;
  };
  overtrading: {
    minTradesPerCandle: number;
    minFeeDragPct: number;
    maxBenchmarkOutperformance: number;
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
  earlyProfitTake: {
    minRealizedReturn: 0.02,
    forwardGainThreshold: 0.05,
    lookaheadCandles: 20,
  },
  overtrading: {
    minTradesPerCandle: 0.25,
    minFeeDragPct: 0.01,
    maxBenchmarkOutperformance: 0.0,
  },
};

function severityFromMagnitude(magnitude: number): 1 | 2 | 3 | 4 | 5 {
  const m = Math.abs(magnitude);
  if (m >= 0.25) return 5;
  if (m >= 0.15) return 4;
  if (m >= 0.08) return 3;
  if (m >= 0.03) return 2;
  return 1;
}

function findCandleIndexAtOrBefore(
  candles: Candle[],
  time: string,
): number {
  let lo = 0;
  let hi = candles.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].closeTime <= time) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
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
  const idx = findCandleIndexAtOrBefore(candles, input.fill.time);
  if (idx < 0) return undefined;

  const start = Math.max(0, idx - params.lookbackCandles);
  let priorPeak = -Infinity;
  for (let i = start; i <= idx; i++) {
    if (candles[i].high > priorPeak) priorPeak = candles[i].high;
  }
  const fillPrice = input.fill.price;
  const priorDrawdown =
    priorPeak > 0 ? (priorPeak - fillPrice) / priorPeak : 0;
  if (priorDrawdown < params.priorDrawdownThreshold) return undefined;

  const end = Math.min(candles.length - 1, idx + params.lookaheadCandles);
  let forwardPeak = -Infinity;
  for (let i = idx + 1; i <= end; i++) {
    if (candles[i].high > forwardPeak) forwardPeak = candles[i].high;
  }
  if (!isFinite(forwardPeak)) return undefined;
  const recovery = (forwardPeak - fillPrice) / fillPrice;
  if (recovery < params.recoveryThreshold) return undefined;

  const estimatedImpact = -recovery * input.fill.quantity * fillPrice;
  return {
    id: `panic_sell:${input.fill.id}`,
    type: "panic_sell",
    severity: severityFromMagnitude(recovery),
    tradeIds: [input.fill.id],
    evidence: `Sold after ${(priorDrawdown * 100).toFixed(1)}% drawdown; price recovered ${(recovery * 100).toFixed(1)}% within ${params.lookaheadCandles} candles.`,
    estimatedImpact,
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
  const idx = findCandleIndexAtOrBefore(candles, input.fill.time);
  if (idx < 0) return undefined;

  const start = Math.max(0, idx - params.lookbackCandles);
  const priorClose = candles[start].close;
  const fillPrice = input.fill.price;
  const priorRally = priorClose > 0 ? (fillPrice - priorClose) / priorClose : 0;
  if (priorRally < params.priorRallyThreshold) return undefined;

  const end = Math.min(candles.length - 1, idx + params.lookaheadCandles);
  if (end <= idx) return undefined;
  const forwardClose = candles[end].close;
  const forwardReturn = (forwardClose - fillPrice) / fillPrice;
  if (forwardReturn > params.forwardReturnThreshold) return undefined;

  const estimatedImpact = forwardReturn * input.fill.quantity * fillPrice;
  return {
    id: `fomo_buy:${input.fill.id}`,
    type: "fomo_buy",
    severity: severityFromMagnitude(Math.max(priorRally, -forwardReturn)),
    tradeIds: [input.fill.id],
    evidence: `Bought after ${(priorRally * 100).toFixed(1)}% rally; forward ${params.lookaheadCandles}-candle return was ${(forwardReturn * 100).toFixed(1)}%.`,
    estimatedImpact,
  };
}

export type EarlyProfitTakeInput = {
  closingFill: Fill;
  realizedReturn: number;
  candlesForSymbol: Candle[];
  params?: DetectorParams["earlyProfitTake"];
};

export function detectEarlyProfitTake(
  input: EarlyProfitTakeInput,
): BehavioralFlag | undefined {
  if (input.closingFill.side !== "sell") return undefined;
  const params = input.params ?? defaultDetectorParams.earlyProfitTake;
  if (input.realizedReturn < params.minRealizedReturn) return undefined;

  const candles = input.candlesForSymbol;
  const idx = findCandleIndexAtOrBefore(candles, input.closingFill.time);
  if (idx < 0) return undefined;
  const end = Math.min(candles.length - 1, idx + params.lookaheadCandles);
  let forwardPeak = -Infinity;
  for (let i = idx + 1; i <= end; i++) {
    if (candles[i].high > forwardPeak) forwardPeak = candles[i].high;
  }
  if (!isFinite(forwardPeak)) return undefined;
  const sellPrice = input.closingFill.price;
  const missedGain = (forwardPeak - sellPrice) / sellPrice;
  if (missedGain < params.forwardGainThreshold) return undefined;

  const estimatedImpact = missedGain * input.closingFill.quantity * sellPrice;
  return {
    id: `early_profit_take:${input.closingFill.id}`,
    type: "early_profit_take",
    severity: severityFromMagnitude(missedGain),
    tradeIds: [input.closingFill.id],
    evidence: `Closed at +${(input.realizedReturn * 100).toFixed(1)}%; price continued ${(missedGain * 100).toFixed(1)}% higher within ${params.lookaheadCandles} candles.`,
    estimatedImpact: -estimatedImpact,
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
  if (feeDrag < params.minFeeDragPct) return undefined;

  if (input.excessReturn > params.maxBenchmarkOutperformance) return undefined;

  return {
    id: "overtrading:session",
    type: "overtrading",
    severity: severityFromMagnitude(feeDrag * 5),
    tradeIds: input.fills.map((f) => f.id),
    evidence: `Executed ${input.fills.length} fills over ${input.candleCount} candles (${tradesPerCandle.toFixed(2)}/candle), ${(feeDrag * 100).toFixed(2)}% equity lost to fees+slippage, ${(input.excessReturn * 100).toFixed(1)}% vs benchmark.`,
    estimatedImpact: -(input.feesPaid + input.slippagePaid),
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
  params?: Partial<DetectorParams>;
};

export function detectAllBehavioralFlags(
  input: DetectAllInput,
): BehavioralFlag[] {
  const flags: BehavioralFlag[] = [];
  const params = {
    panicSell: { ...defaultDetectorParams.panicSell, ...input.params?.panicSell },
    fomoBuy: { ...defaultDetectorParams.fomoBuy, ...input.params?.fomoBuy },
    earlyProfitTake: {
      ...defaultDetectorParams.earlyProfitTake,
      ...input.params?.earlyProfitTake,
    },
    overtrading: {
      ...defaultDetectorParams.overtrading,
      ...input.params?.overtrading,
    },
  };

  for (const fill of input.fills) {
    const candles = input.candlesBySymbol.get(fill.symbol) ?? [];
    if (candles.length === 0) continue;

    const panic = detectPanicSell({
      fill,
      candlesForSymbol: candles,
      params: params.panicSell,
    });
    if (panic) flags.push(panic);

    const fomo = detectFomoBuy({
      fill,
      candlesForSymbol: candles,
      params: params.fomoBuy,
    });
    if (fomo) flags.push(fomo);

    if (fill.side === "sell") {
      const realizedReturn = input.realizedTradeReturns.get(fill.id) ?? 0;
      const early = detectEarlyProfitTake({
        closingFill: fill,
        realizedReturn,
        candlesForSymbol: candles,
        params: params.earlyProfitTake,
      });
      if (early) flags.push(early);
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

  return flags;
}
