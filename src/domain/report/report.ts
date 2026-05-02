import type {
  BenchmarkPoint,
  Candle,
  EquityPoint,
  Fill,
  ReportMetrics,
  ReportPayload,
  ScenarioPackage,
} from "../../types";
import {
  applyFill,
  emptyPortfolio,
  markToMarket,
  snapshotPortfolio,
} from "../portfolio/portfolio";
import {
  annualizedVolatility,
  averageLoss,
  averageWin,
  bestTrade,
  benchmarkReturn,
  detectAllBehavioralFlags,
  excessReturn,
  exposureTime,
  feesTotal,
  maxDrawdown,
  periodsPerYearForGranularity,
  profitFactor,
  realizeTrades,
  sharpeRatio,
  simpleReturns,
  slippageTotal,
  sortinoRatio,
  totalReturn,
  tradeOutcomes,
  turnover,
  volatility,
  winRate,
  worstTrade,
} from "../analytics";

export type EquityCurveInput = {
  scenario: ScenarioPackage;
  fills: Fill[];
  initialCash: number;
};

export function buildEquityCurve(input: EquityCurveInput): EquityPoint[] {
  const { scenario, fills, initialCash } = input;
  const sortedFills = [...fills].sort((a, b) => a.time.localeCompare(b.time));
  const candlesBySymbol = new Map<string, Candle[]>();
  for (const symbol of scenario.meta.symbols) {
    candlesBySymbol.set(
      symbol,
      scenario.candles.filter((c) => c.symbol === symbol),
    );
  }

  const benchmark =
    scenario.benchmarks.length > 0
      ? [...scenario.benchmarks].sort((a, b) => a.time.localeCompare(b.time))
      : [];
  const benchmarkBaseline = benchmark[0]?.value ?? 1;

  let portfolio = emptyPortfolio(initialCash);
  const equity: EquityPoint[] = [];
  let fillIdx = 0;

  const primarySymbol = scenario.meta.symbols[0];
  const primaryCandles = candlesBySymbol.get(primarySymbol) ?? [];

  for (let i = 0; i < primaryCandles.length; i++) {
    const candle = primaryCandles[i];
    while (
      fillIdx < sortedFills.length &&
      sortedFills[fillIdx].time <= candle.closeTime
    ) {
      portfolio = applyFill(portfolio, sortedFills[fillIdx]);
      fillIdx++;
    }
    const prices = scenario.meta.symbols
      .map((symbol) => {
        const sc = candlesBySymbol.get(symbol) ?? [];
        const c = sc[Math.min(i, sc.length - 1)];
        if (!c) return null;
        return {
          symbol,
          time: c.closeTime,
          price: c.close,
          bid: c.close,
          ask: c.close,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    portfolio = markToMarket(portfolio, prices);
    const snap = snapshotPortfolio(portfolio, candle.closeTime);

    let benchmarkValue = initialCash;
    if (benchmark.length > 0) {
      const point =
        findLastBenchmarkAtOrBefore(benchmark, candle.closeTime) ?? benchmark[0];
      benchmarkValue = (point.value / benchmarkBaseline) * initialCash;
    }

    equity.push({
      time: candle.closeTime,
      portfolioValue: snap.totalValue,
      benchmarkValue,
    });
  }

  return equity;
}

function findLastBenchmarkAtOrBefore(
  series: BenchmarkPoint[],
  time: string,
): BenchmarkPoint | undefined {
  let result: BenchmarkPoint | undefined;
  for (const p of series) {
    if (p.time <= time) result = p;
    else break;
  }
  return result;
}

export type ReportInput = {
  scenario: ScenarioPackage;
  fills: Fill[];
  initialCash: number;
};

export type FinishedSessionReport = ReportPayload;

export function buildReport(input: ReportInput): FinishedSessionReport {
  const { scenario, fills, initialCash } = input;
  const equityCurve = buildEquityCurve(input);
  const portfolioValues = equityCurve.map((e) => e.portfolioValue);
  const benchmarkValues = equityCurve.map((e) => e.benchmarkValue);

  const finalEquity =
    portfolioValues[portfolioValues.length - 1] ?? initialCash;
  const benchmarkFinal =
    benchmarkValues[benchmarkValues.length - 1] ?? initialCash;
  const benchmarkInitial = benchmarkValues[0] ?? initialCash;

  const ret = totalReturn(initialCash, finalEquity);
  const benchRet = benchmarkReturn(benchmarkInitial, benchmarkFinal);
  const excess = excessReturn(ret, benchRet);

  const portfolioReturns = simpleReturns(portfolioValues);
  const periodsPerYear = periodsPerYearForGranularity(
    scenario.meta.defaultGranularity,
  );
  const vol = volatility(portfolioReturns);
  const annualizedVol = annualizedVolatility(portfolioReturns, periodsPerYear);
  const sharpe = sharpeRatio(portfolioReturns, periodsPerYear);
  const sortino = sortinoRatio(portfolioReturns, periodsPerYear);
  const dd = maxDrawdown(portfolioValues);

  const outcomes = tradeOutcomes(fills, finalEquity, initialCash);
  const realized = realizeTrades(fills);
  const realizedReturnByFill = new Map<string, number>();
  for (const r of realized) {
    const cost = r.closingFill.price * r.matchedQuantity;
    realizedReturnByFill.set(
      r.closingFill.id,
      cost > 0 ? r.realizedPnl / cost : 0,
    );
  }

  const fees = feesTotal(fills);
  const slippage = slippageTotal(fills);
  const turnoverValue = turnover(fills);
  const primarySymbol = scenario.meta.symbols[0];
  const exposure = exposureTime(scenario.candles, fills, primarySymbol);

  const candlesBySymbol = new Map<string, Candle[]>();
  for (const symbol of scenario.meta.symbols) {
    candlesBySymbol.set(
      symbol,
      scenario.candles
        .filter((c) => c.symbol === symbol)
        .sort((a, b) => a.closeTime.localeCompare(b.closeTime)),
    );
  }
  const primaryCandleCount =
    candlesBySymbol.get(primarySymbol)?.length ?? equityCurve.length;

  const behavioralFlags = detectAllBehavioralFlags({
    fills,
    candlesBySymbol,
    totalCandleCount: primaryCandleCount,
    feesPaid: fees,
    slippagePaid: slippage,
    initialEquity: initialCash,
    excessReturn: excess,
    realizedTradeReturns: realizedReturnByFill,
  });

  const metrics: ReportMetrics = {
    totalReturn: ret,
    benchmarkReturn: benchRet,
    excessReturn: excess,
    maxDrawdown: dd,
    volatility: annualizedVol > 0 ? annualizedVol : vol,
    sharpe,
    sortino,
    winRate: winRate(outcomes),
    profitFactor: profitFactor(outcomes),
    averageWin: averageWin(outcomes),
    averageLoss: averageLoss(outcomes),
    exposureTime: exposure,
    turnover: turnoverValue,
    feesPaid: fees,
    slippagePaid: slippage,
    initialEquity: initialCash,
    finalEquity,
    benchmarkInitial,
    benchmarkFinal,
  };

  return {
    scenarioId: scenario.meta.id,
    scenarioTitle: scenario.meta.title,
    metrics,
    equityCurve,
    bestTrade: bestTrade(outcomes),
    worstTrade: worstTrade(outcomes),
    totalTrades: fills.length,
    behavioralFlags,
  };
}
