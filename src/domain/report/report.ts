import type {
  AuditEvent,
  BenchmarkPoint,
  BehavioralFlag,
  Candle,
  DecisionConsistencySummary,
  DecisionReplayPoint,
  EquityPoint,
  Fill,
  FinancingCostPoint,
  JournalEntry,
  JournalQualitySummary,
  Order,
  PerformanceAttribution,
  PracticeRecommendation,
  ReportMetrics,
  ReportPayload,
  ReportScore,
  ScenarioPackage,
  TradeOutcome,
} from "../../types";
import {
  applyFill,
  applyFinancingCost,
  applyCorporateAction,
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
  calmarRatio,
  detectAllBehavioralFlags,
  excessReturn,
  feesTotal,
  maxDrawdown,
  periodsPerYearForGranularity,
  portfolioExposureTime,
  positionEffectsForFills,
  profitFactor,
  realizeTrades,
  sharpeRatio,
  simpleReturns,
  slippageTotal,
  sortinoRatio,
  totalReturn,
  tradeOutcomes,
  turnover,
  winRate,
  worstTrade,
} from "../analytics";

export type EquityCurveInput = {
  scenario: ScenarioPackage;
  fills: Fill[];
  initialCash: number;
  finalEquityOverride?: number;
  financingPaid?: number;
  financingCosts?: FinancingCostPoint[];
};

function timestamp(time: string): number {
  const value = Date.parse(time);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid report timestamp: ${time}`);
  }
  return value;
}

function compareTimestamps(
  left: { time: string },
  right: { time: string },
): number {
  return timestamp(left.time) - timestamp(right.time);
}

function compareCandleTimes(left: Candle, right: Candle): number {
  return timestamp(left.closeTime) - timestamp(right.closeTime);
}

function sortedCandlesBySymbol(
  scenario: ScenarioPackage,
): Map<string, Candle[]> {
  const result = new Map<string, Candle[]>();
  for (const symbol of scenario.meta.symbols) {
    result.set(
      symbol,
      scenario.candles
        .filter((candle) => candle.symbol === symbol)
        .sort(compareCandleTimes),
    );
  }
  return result;
}

function findLastCandleAtOrBefore(
  candles: Candle[],
  time: string,
): Candle | undefined {
  const target = timestamp(time);
  let low = 0;
  let high = candles.length - 1;
  let result: Candle | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (timestamp(candles[middle].closeTime) <= target) {
      result = candles[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function findLastBenchmarkAtOrBefore(
  series: BenchmarkPoint[],
  time: string,
): BenchmarkPoint | undefined {
  const target = timestamp(time);
  let low = 0;
  let high = series.length - 1;
  let result: BenchmarkPoint | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (timestamp(series[middle].time) <= target) {
      result = series[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function benchmarkSeriesFor(scenario: ScenarioPackage): BenchmarkPoint[] {
  const preferredSymbol =
    scenario.meta.benchmarkSymbol ?? scenario.benchmarks[0]?.symbol;
  const start = timestamp(scenario.meta.startTime);
  const end = timestamp(scenario.meta.endTime);
  return scenario.benchmarks
    .filter(
      (point) =>
        (!preferredSymbol || point.symbol === preferredSymbol) &&
        timestamp(point.time) >= start &&
        timestamp(point.time) <= end,
    )
    .sort(compareTimestamps);
}

export function buildEquityCurve(input: EquityCurveInput): EquityPoint[] {
  const { scenario, initialCash } = input;
  const startTime = scenario.meta.startTime;
  const startTimestamp = timestamp(startTime);
  const endTimestamp = timestamp(scenario.meta.endTime);
  const fills = [...input.fills].sort(compareTimestamps);
  const financingCosts = [...(input.financingCosts ?? [])]
    .filter(
      (point) =>
        Number.isFinite(point.amount) &&
        point.amount > 0 &&
        Number.isFinite(Date.parse(point.time)),
    )
    .sort(compareTimestamps);
  const corporateActions = [...(scenario.corporateActions ?? [])]
    .filter((action) => {
      const effectiveAt = timestamp(action.effectiveAt);
      return effectiveAt > startTimestamp && effectiveAt <= endTimestamp;
    })
    .sort(
      (left, right) =>
        timestamp(left.effectiveAt) - timestamp(right.effectiveAt),
    );
  const explicitFinancing = financingCosts.reduce(
    (sum, point) => sum + point.amount,
    0,
  );
  const unallocatedFinancing = Math.max(
    0,
    (input.financingPaid ?? explicitFinancing) - explicitFinancing,
  );
  const candlesBySymbol = sortedCandlesBySymbol(scenario);
  const benchmark = benchmarkSeriesFor(scenario);
  const benchmarkBaseline = benchmark[0]?.value;
  const marketTimes = scenario.candles.map((candle) => candle.closeTime);
  const timeline = [
    ...new Set([
      ...marketTimes,
      ...fills.map((fill) => fill.time),
      ...financingCosts.map((point) => point.time),
      ...corporateActions.map((action) => action.effectiveAt),
    ].map(timestamp)),
  ]
    .filter((time) => time > startTimestamp && time <= endTimestamp)
    .sort((a, b) => a - b)
    .map((time) => new Date(time).toISOString());

  let portfolio = emptyPortfolio(initialCash);
  const equity: EquityPoint[] = [
    {
      time: startTime,
      portfolioValue: initialCash,
      benchmarkValue: initialCash,
      isInitial: true,
    },
  ];
  let fillIndex = 0;
  let financingIndex = 0;
  let corporateActionIndex = 0;
  const latestRawSplitBySymbol = new Map<string, number>();

  for (let timeIndex = 0; timeIndex < timeline.length; timeIndex++) {
    const time = timeline[timeIndex];
    const timelineTimestamp = timestamp(time);
    let financingAtPoint = 0;
    while (
      financingIndex < financingCosts.length &&
      timestamp(financingCosts[financingIndex].time) <= timelineTimestamp
    ) {
      const cost = financingCosts[financingIndex].amount;
      portfolio = applyFinancingCost(portfolio, cost);
      financingAtPoint += cost;
      financingIndex++;
    }
    if (timeIndex === timeline.length - 1 && unallocatedFinancing > 0) {
      portfolio = applyFinancingCost(portfolio, unallocatedFinancing);
      financingAtPoint += unallocatedFinancing;
    }

    while (
      corporateActionIndex < corporateActions.length &&
      timestamp(corporateActions[corporateActionIndex].effectiveAt) <=
        timelineTimestamp
    ) {
      const action = corporateActions[corporateActionIndex];
      const shouldApply =
        (action.type === "split" &&
          scenario.meta.priceAdjustment === "raw") ||
        (action.type === "dividend" &&
          scenario.meta.priceAdjustment !== "total_return");
      if (shouldApply) {
        portfolio = applyCorporateAction(portfolio, action);
        if (action.type === "split") {
          latestRawSplitBySymbol.set(
            action.symbol,
            timestamp(action.effectiveAt),
          );
        }
      }
      corporateActionIndex++;
    }

    while (
      fillIndex < fills.length &&
      timestamp(fills[fillIndex].time) <= timelineTimestamp
    ) {
      portfolio = applyFill(portfolio, fills[fillIndex]);
      fillIndex++;
    }

    const prices = scenario.meta.symbols.flatMap((symbol) => {
      const candle = findLastCandleAtOrBefore(
        candlesBySymbol.get(symbol) ?? [],
        time,
      );
      if (!candle) return [];
      const latestRawSplit = latestRawSplitBySymbol.get(symbol);
      if (
        latestRawSplit !== undefined &&
        timestamp(candle.closeTime) < latestRawSplit
      ) {
        return [];
      }
      return [
        {
          symbol,
          time: candle.closeTime,
          price: candle.close,
          bid: candle.close,
          ask: candle.close,
        },
      ];
    });
    portfolio = markToMarket(portfolio, prices);
    const snapshot = snapshotPortfolio(portfolio, time);
    const benchmarkPoint = findLastBenchmarkAtOrBefore(benchmark, time);
    const benchmarkValue =
      benchmarkPoint && benchmarkBaseline && benchmarkBaseline !== 0
        ? (benchmarkPoint.value / benchmarkBaseline) * initialCash
        : initialCash;
    equity.push({
      time,
      portfolioValue: snapshot.totalValue,
      benchmarkValue,
      financingCost: financingAtPoint > 0 ? financingAtPoint : undefined,
    });
  }

  if (timeline.length === 0 && unallocatedFinancing > 0) {
    portfolio = applyFinancingCost(portfolio, unallocatedFinancing);
    equity.push({
      time:
        timestamp(scenario.meta.endTime) > startTimestamp
          ? scenario.meta.endTime
          : startTime,
      portfolioValue: snapshotPortfolio(portfolio, scenario.meta.endTime)
        .totalValue,
      benchmarkValue: initialCash,
      financingCost: unallocatedFinancing,
    });
  }

  if (
    input.finalEquityOverride !== undefined &&
    Number.isFinite(input.finalEquityOverride)
  ) {
    const last = equity[equity.length - 1];
    const adjustment = input.finalEquityOverride - last.portfolioValue;
    if (Math.abs(adjustment) > 1e-9) {
      if (last.isInitial) {
        equity.push({
          time:
            timestamp(scenario.meta.endTime) > startTimestamp
              ? scenario.meta.endTime
              : startTime,
          portfolioValue: input.finalEquityOverride,
          benchmarkValue: last.benchmarkValue,
          equityAdjustment: adjustment,
        });
      } else {
        last.portfolioValue = input.finalEquityOverride;
        last.equityAdjustment = adjustment;
      }
    }
  }

  return equity;
}

export type ReportInput = EquityCurveInput & {
  orders?: Order[];
  auditEvents?: AuditEvent[];
  journal?: JournalEntry[];
};

export type FinishedSessionReport = ReportPayload;

function partialFillOrderCount(orders: Order[], fills: Fill[]): number {
  const fillsByOrder = new Map<string, Fill[]>();
  for (const fill of fills) {
    const group = fillsByOrder.get(fill.orderId) ?? [];
    group.push(fill);
    fillsByOrder.set(fill.orderId, group);
  }
  return orders.filter((order) => {
    const orderFills = fillsByOrder.get(order.id) ?? [];
    const filledQuantity = orderFills.reduce(
      (sum, fill) => sum + fill.quantity,
      0,
    );
    return (
      order.status === "partially_filled" ||
      orderFills.length > 1 ||
      (filledQuantity > 1e-9 && filledQuantity + 1e-9 < order.quantity)
    );
  }).length;
}

function leverageByFillFor(
  scenario: ScenarioPackage,
  fills: Fill[],
  initialCash: number,
): Map<string, number> {
  const candlesBySymbol = sortedCandlesBySymbol(scenario);
  const result = new Map<string, number>();
  let portfolio = emptyPortfolio(initialCash);
  for (const fill of [...fills].sort(compareTimestamps)) {
    portfolio = applyFill(portfolio, fill);
    const prices = scenario.meta.symbols.flatMap((symbol) => {
      const candle = findLastCandleAtOrBefore(
        candlesBySymbol.get(symbol) ?? [],
        fill.time,
      );
      if (!candle) return [];
      return [
        {
          symbol,
          time: candle.closeTime,
          price: candle.close,
          bid: candle.close,
          ask: candle.close,
        },
      ];
    });
    portfolio = markToMarket(portfolio, prices);
    const snapshot = snapshotPortfolio(portfolio, fill.time);
    const grossNotional = Object.values(portfolio.positions).reduce(
      (sum, position) => sum + Math.abs(position.marketValue),
      0,
    );
    result.set(
      fill.id,
      snapshot.totalValue > 0
        ? grossNotional / snapshot.totalValue
        : Number.POSITIVE_INFINITY,
    );
  }
  return result;
}

function decisionReplayFor(
  fills: Fill[],
  orders: Order[],
  journal: JournalEntry[],
  auditEvents: AuditEvent[],
  outcomes: TradeOutcome[],
  equityCurve: EquityPoint[],
): DecisionReplayPoint[] {
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const journalByFill = new Map(
    journal
      .filter((entry) => entry.fillId)
      .map((entry) => [entry.fillId!, entry]),
  );
  const outcomesByFill = new Map(
    outcomes.map((outcome) => [outcome.fill.id, outcome]),
  );
  return [...fills].sort(compareTimestamps).map((fill) => {
    const fillTimestamp = timestamp(fill.time);
    const before = [...equityCurve]
      .reverse()
      .find((point) => timestamp(point.time) < fillTimestamp);
    const after = [...equityCurve]
      .reverse()
      .find((point) => timestamp(point.time) <= fillTimestamp);
    return {
      fill,
      order: ordersById.get(fill.orderId),
      journalEntry: journalByFill.get(fill.id),
      auditEvents: auditEvents
        .filter(
          (event) => event.fillId === fill.id || event.orderId === fill.orderId,
        )
        .sort(compareTimestamps),
      tradeOutcome: outcomesByFill.get(fill.id),
      equityBefore: before?.portfolioValue,
      equityAfter: after?.portfolioValue,
    };
  });
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundedScore(value: number): number {
  return Math.round(clamp(value) * 10) / 10;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const REASON_PATTERN =
  /\b(because|since|thesis|reason|expect|due to|trend|momentum|valuation|event|support|resistance|cunku|çünkü|nedeniyle|bekliyorum|tez)\b/i;
const RISK_PATTERN =
  /\b(risk|stop|invalidation|invalid|exit|downside|upside|target|size|loss|zarar|riskim|stop-loss|hedef)\b/i;

function journalQualityFor(
  fills: Fill[],
  journal: JournalEntry[],
): JournalQualitySummary {
  const orderIds = new Set(fills.map((fill) => fill.orderId));
  const fillsById = new Map(fills.map((fill) => [fill.id, fill]));
  const notesByOrder = new Map<string, string[]>();
  for (const entry of journal) {
    if (!entry.fillId || !entry.note.trim()) continue;
    const fill = fillsById.get(entry.fillId);
    if (!fill) continue;
    const notes = notesByOrder.get(fill.orderId) ?? [];
    notes.push(entry.note.trim());
    notesByOrder.set(fill.orderId, notes);
  }

  const executedDecisionCount = orderIds.size;
  const linkedEntryCount = notesByOrder.size;
  const coverageRate =
    executedDecisionCount > 0 ? linkedEntryCount / executedDecisionCount : 0;
  const linkedNotes = [...notesByOrder.values()].map((notes) => notes.join(" "));
  const reasonCount = linkedNotes.filter((note) => REASON_PATTERN.test(note)).length;
  const riskPlanCount = linkedNotes.filter((note) => RISK_PATTERN.test(note)).length;
  const reasonRate = linkedNotes.length > 0 ? reasonCount / linkedNotes.length : 0;
  const riskPlanRate =
    linkedNotes.length > 0 ? riskPlanCount / linkedNotes.length : 0;

  if (executedDecisionCount === 0) {
    return {
      status: "not_applicable",
      executedDecisionCount,
      linkedEntryCount,
      coverageRate,
      reasonRate,
      riskPlanRate,
      evidence: ["No executed decisions were available to journal."],
    };
  }

  const evidence = [
    `${linkedEntryCount} of ${executedDecisionCount} executed decisions had a linked journal entry.`,
  ];
  if (linkedNotes.length > 0) {
    evidence.push(
      `${reasonCount} linked notes stated a detectable reason; ${riskPlanCount} mentioned risk, invalidation, an exit, or a target.`,
      "Plan-following cannot be verified from free text alone; structured entry and exit-plan fields are not available.",
    );
  } else {
    evidence.push("No non-empty journal entry was linked to an executed fill.");
  }

  return {
    status: linkedNotes.length > 0 ? "assessed" : "insufficient_evidence",
    score: roundedScore(
      coverageRate * 50 + reasonRate * 25 + riskPlanRate * 25,
    ),
    executedDecisionCount,
    linkedEntryCount,
    coverageRate,
    reasonRate,
    riskPlanRate,
    evidence,
  };
}

function decisionConsistencyFor(
  fills: Fill[],
  flags: BehavioralFlag[],
  executionQuality: {
    forcedLiquidationCount: number;
    rejectedOrderCount: number;
  },
): DecisionConsistencySummary {
  const assessedDecisionCount = new Set(fills.map((fill) => fill.orderId)).size;
  const severeBehavioralFlagCount = flags.filter(
    (flag) => flag.severity >= 4,
  ).length;
  if (assessedDecisionCount === 0) {
    return {
      status: "not_applicable",
      assessedDecisionCount,
      behavioralFlagCount: flags.length,
      severeBehavioralFlagCount,
      forcedLiquidationCount: executionQuality.forcedLiquidationCount,
      evidence: ["No executed decisions were available for consistency scoring."],
    };
  }

  const behaviorPenalty = flags.reduce(
    (sum, flag) => sum + flag.severity * 4,
    0,
  );
  const liquidationPenalty = executionQuality.forcedLiquidationCount * 15;
  const rejectionPenalty = Math.min(
    20,
    executionQuality.rejectedOrderCount * 5,
  );
  const score = roundedScore(
    100 - behaviorPenalty - liquidationPenalty - rejectionPenalty,
  );
  const evidence = [
    `${flags.length} evidence-backed behavioral flags were detected across ${assessedDecisionCount} executed decisions.`,
    `${executionQuality.forcedLiquidationCount} forced liquidations and ${executionQuality.rejectedOrderCount} rejected orders affected discipline scoring.`,
    "Free-text notes do not provide enough structure to claim that exits matched stated plans.",
  ];
  return {
    status: "assessed",
    score,
    assessedDecisionCount,
    behavioralFlagCount: flags.length,
    severeBehavioralFlagCount,
    forcedLiquidationCount: executionQuality.forcedLiquidationCount,
    evidence,
  };
}

function scoreFor(
  fills: Fill[],
  metrics: ReportMetrics,
  journalQuality: JournalQualitySummary,
  decisionConsistency: DecisionConsistencySummary,
): ReportScore {
  const hasExecutedDecision = fills.length > 0;
  const riskAdjustedScore = roundedScore(
    metrics.sharpe === undefined
      ? 50 + clamp(metrics.totalReturn * 500, -25, 25)
      : 50 + metrics.sharpe * 20,
  );
  const benchmarkScore = roundedScore(50 + metrics.excessReturn * 1_000);
  const drawdownScore = roundedScore(100 - metrics.maxDrawdown * (100 / 0.3));
  const consistencyScore = decisionConsistency.score ?? 0;
  const journalScore = journalQuality.score ?? 0;
  const components: ReportScore["components"] = [
    {
      id: "risk_adjusted_return",
      label: "Risk-adjusted return",
      weight: 0.35,
      score: hasExecutedDecision ? riskAdjustedScore : undefined,
      status: hasExecutedDecision ? "scored" : "not_applicable",
      evidence:
        metrics.sharpe === undefined
          ? `Sharpe was unavailable because return variability was zero or insufficient; total return was ${percent(metrics.totalReturn)}.`
          : `Sharpe was ${metrics.sharpe.toFixed(2)} and total return was ${percent(metrics.totalReturn)}.`,
    },
    {
      id: "benchmark_outperformance",
      label: "Benchmark outperformance",
      weight: 0.25,
      score: hasExecutedDecision ? benchmarkScore : undefined,
      status: hasExecutedDecision ? "scored" : "not_applicable",
      evidence: `Excess return versus the scenario benchmark was ${percent(metrics.excessReturn)}.`,
    },
    {
      id: "drawdown_control",
      label: "Drawdown control",
      weight: 0.2,
      score: hasExecutedDecision ? drawdownScore : undefined,
      status: hasExecutedDecision ? "scored" : "not_applicable",
      evidence: `Maximum drawdown was ${percent(metrics.maxDrawdown)}; the scoring scale reaches zero at 30%.`,
    },
    {
      id: "decision_consistency",
      label: "Decision consistency",
      weight: 0.1,
      score: hasExecutedDecision ? consistencyScore : undefined,
      status: hasExecutedDecision ? "scored" : "not_applicable",
      evidence: decisionConsistency.evidence.join(" "),
    },
    {
      id: "journal_quality",
      label: "Journal quality",
      weight: 0.1,
      score: hasExecutedDecision ? journalScore : undefined,
      status: hasExecutedDecision ? "scored" : "not_applicable",
      evidence: journalQuality.evidence.join(" "),
    },
  ];
  const methodology =
    "Weighted score: 35% risk-adjusted return, 25% benchmark outperformance, 20% drawdown control, 10% decision consistency, and 10% journal quality.";
  if (!hasExecutedDecision) {
    return {
      status: "insufficient_evidence",
      components,
      methodology,
      reason:
        "No fills were executed, so an overall trading-skill score would reward inactivity rather than decision quality.",
    };
  }

  return {
    status: "scored",
    overall: roundedScore(
      components.reduce(
        (sum, component) => sum + (component.score ?? 0) * component.weight,
        0,
      ),
    ),
    components,
    methodology,
  };
}

const BEHAVIOR_PRACTICE: Record<
  BehavioralFlag["type"],
  { title: string; practice: string }
> = {
  panic_sell: {
    title: "Pre-commit crisis exits",
    practice:
      "Before entering, write the invalidation level and rehearse one replay where exits follow that level instead of the latest drawdown.",
  },
  fomo_buy: {
    title: "Add an entry cooldown",
    practice:
      "Require one full candle and a written entry condition after sharp rallies before opening a position.",
  },
  dip_catching: {
    title: "Demand reversal confirmation",
    practice:
      "Practice waiting for a predefined stabilization signal before buying a large decline.",
  },
  early_profit_take: {
    title: "Plan exits before entry",
    practice:
      "Record a target, invalidation, and trailing rule, then compare planned versus actual holding time.",
  },
  holding_loser: {
    title: "Enforce invalidation levels",
    practice:
      "Size the next replay so the written invalidation can be honored without changing the plan after entry.",
  },
  overtrading: {
    title: "Use a trade budget",
    practice:
      "Set a maximum decision count and minimum expected edge before replaying the same scenario.",
  },
  news_overreaction: {
    title: "Separate news from price confirmation",
    practice:
      "For each visible event, write what the price has already discounted before placing an order.",
  },
  excessive_leverage: {
    title: "Reduce position-size volatility",
    practice:
      "Repeat the scenario with a leverage ceiling and fixed risk per trade, then compare drawdown and excess return.",
  },
};

function recommendationsFor(
  fills: Fill[],
  closedTradeCount: number,
  metrics: ReportMetrics,
  flags: BehavioralFlag[],
  journalQuality: JournalQualitySummary,
): PracticeRecommendation[] {
  if (fills.length === 0) {
    return [
      {
        id: "complete-documented-decision",
        priority: 1,
        title: "Complete a documented decision",
        rationale:
          "The session contains no executed trade, so decision quality and execution discipline cannot be assessed.",
        evidence: "0 fills and 0 closed trade outcomes were recorded.",
        suggestedPractice:
          "Replay a short window, execute one thesis-based trade, and link a note with the reason, invalidation, and exit plan.",
      },
    ];
  }

  const candidates: PracticeRecommendation[] = [];
  if (journalQuality.coverageRate < 0.8) {
    candidates.push({
      id: "journal-coverage",
      priority: 1,
      title: "Journal every executed decision",
      rationale:
        "Sparse notes make it impossible to distinguish a repeatable process from an accidental outcome.",
      evidence: `${journalQuality.linkedEntryCount} of ${journalQuality.executedDecisionCount} executed decisions had a linked entry.`,
      suggestedPractice:
        "Before each order, record the reason, invalidation, intended size, and exit condition in one or two sentences.",
    });
  } else if (journalQuality.riskPlanRate < 0.5) {
    candidates.push({
      id: "journal-risk-plan",
      priority: 2,
      title: "Make risk explicit in notes",
      rationale:
        "Most linked notes did not include a detectable invalidation, exit, target, or risk statement.",
      evidence: `${percent(journalQuality.riskPlanRate)} of linked notes mentioned a risk-plan element.`,
      suggestedPractice:
        "Add a short 'wrong if / exit if' clause to every entry note.",
    });
  }

  const strongestFlag = [...flags].sort((a, b) => b.severity - a.severity)[0];
  if (strongestFlag) {
    const practice = BEHAVIOR_PRACTICE[strongestFlag.type];
    candidates.push({
      id: `behavior-${strongestFlag.type}`,
      priority: strongestFlag.severity >= 4 ? 1 : 2,
      title: practice.title,
      rationale: strongestFlag.evidence,
      evidence: `${strongestFlag.type} was detected at severity ${strongestFlag.severity}/5 across ${strongestFlag.tradeIds.length} fill(s).`,
      suggestedPractice: practice.practice,
    });
  }

  if (metrics.maxDrawdown >= 0.15) {
    candidates.push({
      id: "drawdown-control",
      priority: 1,
      title: "Set a session drawdown limit",
      rationale:
        "The realized equity path crossed a level where position sizing can dominate signal quality.",
      evidence: `Maximum drawdown was ${percent(metrics.maxDrawdown)}.`,
      suggestedPractice:
        "Repeat the scenario with half-sized positions and a written session loss limit; compare excess return and drawdown.",
    });
  }

  const executionDrag =
    metrics.initialEquity > 0
      ? (metrics.feesPaid + metrics.slippagePaid) / metrics.initialEquity
      : 0;
  if (executionDrag >= 0.01) {
    candidates.push({
      id: "execution-drag",
      priority: 2,
      title: "Reduce execution drag",
      rationale:
        "Fees and slippage consumed a material share of starting equity.",
      evidence: `Execution drag was ${percent(executionDrag)} of initial equity.`,
      suggestedPractice:
        "Use fewer, higher-conviction orders and compare market versus patient limit execution in the next replay.",
    });
  }

  if (closedTradeCount === 0) {
    candidates.push({
      id: "practice-exits",
      priority: 2,
      title: "Practice a complete trade lifecycle",
      rationale:
        "Open exposure can show mark-to-market results but provides no realized exit decision to evaluate.",
      evidence: `${fills.length} fill(s) were recorded but no position lot was closed.`,
      suggestedPractice:
        "Repeat the window with a predefined exit rule and close at least one position lot before the session ends.",
    });
  } else if (metrics.excessReturn < 0) {
    candidates.push({
      id: "benchmark-discipline",
      priority: 3,
      title: "Test trades against the passive alternative",
      rationale:
        "The active decisions did not improve on the scenario benchmark after observed costs.",
      evidence: `Excess return was ${percent(metrics.excessReturn)}.`,
      suggestedPractice:
        "Before each trade, state why changing exposure should beat simply holding the benchmark over the same horizon.",
    });
  }

  return candidates
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3)
    .map((recommendation, index) => ({
      ...recommendation,
      priority: (index + 1) as 1 | 2 | 3,
    }));
}

export function buildReport(input: ReportInput): FinishedSessionReport {
  const { scenario, fills, initialCash } = input;
  const equityCurve = buildEquityCurve(input);
  const portfolioValues = equityCurve.map((point) => point.portfolioValue);
  const benchmarkValues = equityCurve.map((point) => point.benchmarkValue);
  const finalEquity = portfolioValues[portfolioValues.length - 1] ?? initialCash;
  const benchmarkInitial = benchmarkValues[0] ?? initialCash;
  const benchmarkFinal =
    benchmarkValues[benchmarkValues.length - 1] ?? benchmarkInitial;
  const portfolioReturn = totalReturn(initialCash, finalEquity);
  const benchmarkReturnValue = benchmarkReturn(
    benchmarkInitial,
    benchmarkFinal,
  );
  const activeReturn = excessReturn(portfolioReturn, benchmarkReturnValue);
  const portfolioReturns = simpleReturns(portfolioValues);
  const periodsPerYear = periodsPerYearForGranularity(
    scenario.meta.defaultGranularity,
    scenario.meta.assetClass,
  );
  const drawdown = maxDrawdown(portfolioValues);
  const annualizedVol = annualizedVolatility(
    portfolioReturns,
    periodsPerYear,
  );
  const outcomes = tradeOutcomes(fills, finalEquity, initialCash);
  const realized = realizeTrades(fills);
  const realizedReturnByFill = new Map<string, number>();
  const realizedEntryTimeByFill = new Map<string, string>();
  const realizedSideByFill = new Map<string, "long" | "short">();
  for (const trade of realized) {
    realizedReturnByFill.set(
      trade.closingFill.id,
      trade.matchedCostBasis > 0
        ? trade.realizedPnl / trade.matchedCostBasis
        : 0,
    );
    realizedEntryTimeByFill.set(trade.closingFill.id, trade.entryTime);
    realizedSideByFill.set(trade.closingFill.id, trade.positionSide);
  }

  const fees = feesTotal(fills);
  const slippage = slippageTotal(fills);
  const orders = input.orders ?? [];
  const auditEvents = input.auditEvents ?? [];
  const journal = input.journal ?? [];
  const financingPaid =
    input.financingPaid ??
    (input.financingCosts ?? []).reduce(
      (sum, point) => sum + point.amount,
      0,
    );
  const liquidityParticipations = fills
    .map((fill) => fill.liquidityParticipation)
    .filter((value): value is number => value !== undefined);
  const executionQuality = {
    totalFills: fills.length,
    partialFillCount: partialFillOrderCount(orders, fills),
    rejectedOrderCount: orders.filter((order) => order.status === "rejected")
      .length,
    expiredOrderCount: orders.filter((order) => order.status === "expired")
      .length,
    forcedLiquidationCount: fills.filter((fill) => fill.forcedLiquidation)
      .length,
    marginEventCount: auditEvents.filter(
      (event) =>
        event.type === "margin_call" || event.type === "forced_liquidation",
    ).length,
    borrowCostPaid: financingPaid,
    averageLiquidityParticipation:
      liquidityParticipations.length > 0
        ? liquidityParticipations.reduce((sum, value) => sum + value, 0) /
          liquidityParticipations.length
        : undefined,
  };
  const auditSummary = {
    totalEvents: auditEvents.length,
    orderEvents: auditEvents.filter(
      (event) =>
        event.type.startsWith("order_") || event.type === "tif_expired",
    ).length,
    fillEvents: auditEvents.filter((event) => event.type === "fill").length,
    riskEvents: auditEvents.filter(
      (event) =>
        event.type === "margin_call" ||
        event.type === "forced_liquidation" ||
        event.type === "borrow_cost",
    ).length,
  };
  const candlesBySymbol = sortedCandlesBySymbol(scenario);
  const totalCandleCount = new Set(
    scenario.candles.map((candle) => timestamp(candle.closeTime)),
  ).size;
  const fillEffects = positionEffectsForFills(fills);
  const behavioralFlags = detectAllBehavioralFlags({
    fills,
    candlesBySymbol,
    totalCandleCount,
    feesPaid: fees,
    slippagePaid: slippage,
    initialEquity: initialCash,
    excessReturn: activeReturn,
    realizedTradeReturns: realizedReturnByFill,
    realizedTradeEntryTimes: realizedEntryTimeByFill,
    realizedTradeSides: realizedSideByFill,
    fillEffects,
    events: scenario.events,
    leverageByFill: leverageByFillFor(scenario, fills, initialCash),
  });
  const exposure = portfolioExposureTime(
    scenario.candles,
    fills,
    scenario.meta.symbols,
  );

  const metrics: ReportMetrics = {
    totalReturn: portfolioReturn,
    benchmarkReturn: benchmarkReturnValue,
    excessReturn: activeReturn,
    maxDrawdown: drawdown,
    volatility: annualizedVol,
    sharpe: sharpeRatio(portfolioReturns, periodsPerYear),
    sortino: sortinoRatio(portfolioReturns, periodsPerYear),
    calmar: calmarRatio(portfolioReturn, drawdown),
    winRate: winRate(outcomes),
    profitFactor: profitFactor(outcomes),
    averageWin: averageWin(outcomes),
    averageLoss: averageLoss(outcomes),
    exposureTime: exposure,
    turnover: turnover(fills),
    feesPaid: fees,
    slippagePaid: slippage,
    initialEquity: initialCash,
    finalEquity,
    benchmarkInitial,
    benchmarkFinal,
  };
  const journalQuality = journalQualityFor(fills, journal);
  const decisionConsistency = decisionConsistencyFor(
    fills,
    behavioralFlags,
    executionQuality,
  );
  const score = scoreFor(
    fills,
    metrics,
    journalQuality,
    decisionConsistency,
  );
  const recommendations = recommendationsFor(
    fills,
    outcomes.length,
    metrics,
    behavioralFlags,
    journalQuality,
  );
  const realizedTradePnl = outcomes.reduce(
    (sum, outcome) => sum + outcome.realizedPnl,
    0,
  );
  const attribution: PerformanceAttribution = {
    realizedTradePnl,
    unrealizedAndResidualPnl:
      finalEquity - initialCash - realizedTradePnl + financingPaid,
    feesPaid: fees,
    slippagePaid: slippage,
    financingPaid,
    benchmarkPnl: benchmarkFinal - benchmarkInitial,
    activePnl:
      finalEquity - initialCash - (benchmarkFinal - benchmarkInitial),
  };

  return {
    scenarioId: scenario.meta.id,
    scenarioTitle: scenario.meta.title,
    metrics,
    equityCurve,
    bestTrade: bestTrade(outcomes),
    worstTrade: worstTrade(outcomes),
    totalTrades: outcomes.length,
    closedTradeCount: outcomes.length,
    tradeOutcomes: outcomes,
    fills,
    behavioralFlags,
    journal,
    decisionReplay: decisionReplayFor(
      fills,
      orders,
      journal,
      auditEvents,
      outcomes,
      equityCurve,
    ),
    attribution,
    provenance: {
      license: scenario.meta.license,
      dataSources: [...scenario.meta.dataSources],
      sourceManifest: scenario.meta.sourceManifest
        ? [...scenario.meta.sourceManifest]
        : undefined,
      dataVersion: scenario.meta.dataVersion,
      generatedAt: scenario.meta.generatedAt,
      priceAdjustment: scenario.meta.priceAdjustment,
      marketCalendarId: scenario.meta.marketCalendarId,
      isSampleData: scenario.meta.isSampleData ?? false,
    },
    score,
    journalQuality,
    decisionConsistency,
    recommendations,
    executionQuality,
    auditSummary,
    orders,
    auditEvents,
  };
}
