import type {
  BenchmarkPoint,
  Candle,
  CorporateAction,
  Granularity,
  IndicatorSnapshot,
  Instrument,
  MarketCalendar,
  MarketEvent,
  ScenarioPackage,
} from "../../types";
import type { BrokerConfig, ScenarioMeta } from "../../types/scenario";
import { validateScenarioDrillDefinitions } from "../practice/drillAuthoring";
import { timestampMs } from "../replay/timestamps";

export type ValidationLevel = "error" | "warning";

export type ValidationIssue = {
  level: ValidationLevel;
  code: string;
  message: string;
  path?: string;
};

export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/;

export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!ISO_8601.test(value)) return false;
  return timestampMs(value) !== undefined;
}

const ADJECTIVE_RUN = "(?:\\w+\\s+){0,3}";

const HINDSIGHT_PATTERNS: RegExp[] = [
  new RegExp(
    `\\btrigger(?:ed|ing)?\\s+(?:a|the|an)\\s+${ADJECTIVE_RUN}(?:rally|crash|sell[\\s-]?off|bull\\s+run|bear\\s+market|reversal|boom|bust|collapse)`,
    "i",
  ),
  new RegExp(
    `\\b(?:kick(?:ed|ing)?|spark(?:ed|ing)?|set)\\s+off\\s+(?:a|the)\\s+${ADJECTIVE_RUN}(?:rally|crash|bull|bear|boom|bust)`,
    "i",
  ),
  /\b(?:would|went)\s+(?:later\s+|on\s+to\s+)/i,
  /\bin\s+(?:hindsight|retrospect)\b/i,
  /\bbefore\s+the\s+(?:crash|rally|bottom|top|peak|sell[\s-]?off|collapse)\b/i,
  /\bahead\s+of\s+the\s+(?:rally|crash|bottom|top|peak)\b/i,
  /\bwhat\s+followed\s+was\b/i,
  /\bmark(?:ed|ing)?\s+the\s+(?:start|beginning|top|bottom)\s+of\s+(?:a|the)\s+(?:bull|bear|rally|crash)/i,
];

export function findHindsightPatterns(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of HINDSIGHT_PATTERNS) {
    const match = text.match(pattern);
    if (match) hits.push(match[0]);
  }
  return hits;
}

const GRANULARITY_MS: Record<Granularity, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export function validateScenarioMeta(meta: ScenarioMeta): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!meta.id) {
    issues.push({
      level: "error",
      code: "meta.id_missing",
      message: "Scenario id is required",
      path: "meta.id",
    });
  }
  if (!meta.title) {
    issues.push({
      level: "error",
      code: "meta.title_missing",
      message: "Scenario title is required",
      path: "meta.title",
    });
  }
  if (!isIsoTimestamp(meta.startTime)) {
    issues.push({
      level: "error",
      code: "meta.start_time_invalid",
      message: `Scenario startTime is not a valid ISO 8601 timestamp: ${meta.startTime}`,
      path: "meta.startTime",
    });
  }
  if (!isIsoTimestamp(meta.endTime)) {
    issues.push({
      level: "error",
      code: "meta.end_time_invalid",
      message: `Scenario endTime is not a valid ISO 8601 timestamp: ${meta.endTime}`,
      path: "meta.endTime",
    });
  }
  if (
    isIsoTimestamp(meta.startTime) &&
    isIsoTimestamp(meta.endTime) &&
    Date.parse(meta.endTime) <= Date.parse(meta.startTime)
  ) {
    issues.push({
      level: "error",
      code: "meta.range_inverted",
      message: "Scenario endTime must be strictly after startTime",
      path: "meta.endTime",
    });
  }
  if (!meta.symbols || meta.symbols.length === 0) {
    issues.push({
      level: "error",
      code: "meta.symbols_empty",
      message: "Scenario must declare at least one symbol",
      path: "meta.symbols",
    });
  }
  if (!meta.license) {
    issues.push({
      level: "error",
      code: "meta.license_missing",
      message: "Scenario license is required",
      path: "meta.license",
    });
  }
  if (!meta.dataSources || meta.dataSources.length === 0) {
    issues.push({
      level: "warning",
      code: "meta.data_sources_empty",
      message: "Scenario should declare at least one data source",
      path: "meta.dataSources",
    });
  }
  if (!Number.isFinite(meta.initialCash) || meta.initialCash <= 0) {
    issues.push({
      level: "error",
      code: "meta.initial_cash_invalid",
      message: "Scenario initialCash must be a positive number",
      path: "meta.initialCash",
    });
  }
  if (meta.generatedAt && !isIsoTimestamp(meta.generatedAt)) {
    issues.push({
      level: "error",
      code: "meta.generated_at_invalid",
      message: `Scenario generatedAt is not a valid ISO 8601 timestamp: ${meta.generatedAt}`,
      path: "meta.generatedAt",
    });
  }
  if (
    meta.priceAdjustment &&
    !["raw", "split_adjusted", "total_return"].includes(meta.priceAdjustment)
  ) {
    issues.push({
      level: "error",
      code: "meta.price_adjustment_invalid",
      message: "Scenario priceAdjustment must be raw, split_adjusted, or total_return",
      path: "meta.priceAdjustment",
    });
  }
  if (
    meta.estimatedMinutes !== undefined &&
    (!Number.isFinite(meta.estimatedMinutes) || meta.estimatedMinutes <= 0)
  ) {
    issues.push({
      level: "error",
      code: "meta.estimated_minutes_invalid",
      message: "Scenario estimatedMinutes must be a positive number",
      path: "meta.estimatedMinutes",
    });
  }
  if (
    meta.dataFidelity &&
    !["observed", "derived", "synthetic", "mixed"].includes(meta.dataFidelity)
  ) {
    issues.push({
      level: "error",
      code: "meta.data_fidelity_invalid",
      message: "Scenario dataFidelity must be observed, derived, synthetic, or mixed",
      path: "meta.dataFidelity",
    });
  }
  for (const [field, values] of [
    ["learningObjectives", meta.learningObjectives],
    ["observedFields", meta.observedFields],
    ["derivedFields", meta.derivedFields],
  ] as const) {
    if (
      values !== undefined &&
      (!Array.isArray(values) ||
        values.some((value) => typeof value !== "string" || !value.trim()))
    ) {
      issues.push({
        level: "error",
        code: `meta.${field}_invalid`,
        message: `Scenario ${field} must contain non-empty strings`,
        path: `meta.${field}`,
      });
    }
  }
  return issues;
}

export function validateInstruments(
  instruments: Instrument[],
  meta: ScenarioMeta,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (instruments.length === 0) {
    issues.push({
      level: "error",
      code: "instruments.empty",
      message: "Scenario must declare at least one instrument",
      path: "instruments",
    });
    return issues;
  }
  const symbolSet = new Set(instruments.map((i) => i.symbol));
  if (symbolSet.size !== instruments.length) {
    issues.push({
      level: "error",
      code: "instruments.duplicate_symbols",
      message: "Instrument symbols must be unique",
      path: "instruments",
    });
  }
  for (const declared of meta.symbols) {
    if (!symbolSet.has(declared)) {
      issues.push({
        level: "error",
        code: "instruments.symbol_not_declared",
        message: `Scenario meta references symbol ${declared} but no instrument declares it`,
        path: `meta.symbols[${declared}]`,
      });
    }
  }
  for (let index = 0; index < instruments.length; index++) {
    const instrument = instruments[index];
    if (
      instrument.tradable !== undefined &&
      typeof instrument.tradable !== "boolean"
    ) {
      issues.push({
        level: "error",
        code: "instruments.tradable_invalid",
        message: `Instrument ${instrument.symbol} tradable must be boolean`,
        path: `instruments[${index}].tradable`,
      });
    }
  }
  return issues;
}

export function validateCandles(
  candles: Candle[],
  knownSymbols: Set<string>,
  granularity: Granularity,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (candles.length === 0) {
    issues.push({
      level: "error",
      code: "candles.empty",
      message: "Scenario has no candles",
      path: "candles",
    });
    return issues;
  }
  const expectedMs = GRANULARITY_MS[granularity];
  const previousBySymbol = new Map<string, Candle>();
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const path = `candles[${i}]`;
    if (!knownSymbols.has(c.symbol)) {
      issues.push({
        level: "error",
        code: "candles.symbol_unknown",
        message: `Candle references unknown symbol ${c.symbol}`,
        path,
      });
    }
    if (!isIsoTimestamp(c.openTime)) {
      issues.push({
        level: "error",
        code: "candles.open_time_invalid",
        message: `Candle openTime is not a valid ISO 8601 timestamp: ${c.openTime}`,
        path: `${path}.openTime`,
      });
    }
    if (!isIsoTimestamp(c.closeTime)) {
      issues.push({
        level: "error",
        code: "candles.close_time_invalid",
        message: `Candle closeTime is not a valid ISO 8601 timestamp: ${c.closeTime}`,
        path: `${path}.closeTime`,
      });
    }
    if (
      isIsoTimestamp(c.openTime) &&
      isIsoTimestamp(c.closeTime) &&
      Date.parse(c.closeTime) <= Date.parse(c.openTime)
    ) {
      issues.push({
        level: "error",
        code: "candles.range_inverted",
        message: "Candle closeTime must be strictly after openTime",
        path,
      });
    }
    const ohlcFields = [
      ["open", c.open],
      ["high", c.high],
      ["low", c.low],
      ["close", c.close],
    ] as const;
    const hasInvalidOhlc = ohlcFields.some(
      ([, value]) => !Number.isFinite(value) || value <= 0,
    );
    for (const [field, value] of ohlcFields) {
      if (!Number.isFinite(value) || value <= 0) {
        issues.push({
          level: "error",
          code: "candles.ohlc_value_invalid",
          message: `Candle ${field} must be a finite positive number`,
          path: `${path}.${field}`,
        });
      }
    }
    if (
      c.adjustedClose !== undefined &&
      (!Number.isFinite(c.adjustedClose) || c.adjustedClose <= 0)
    ) {
      issues.push({
        level: "error",
        code: "candles.adjusted_close_invalid",
        message: "Candle adjustedClose must be a finite positive number",
        path: `${path}.adjustedClose`,
      });
    }
    if (
      !hasInvalidOhlc &&
      (!(c.high >= c.open && c.high >= c.close && c.high >= c.low) ||
        !(c.low <= c.open && c.low <= c.close && c.low <= c.high))
    ) {
      issues.push({
        level: "error",
        code: "candles.ohlc_inconsistent",
        message:
          "Candle high/low must bracket open and close (high >= max(open,close,low), low <= min(open,close,high))",
        path,
      });
    }
    if (!Number.isFinite(c.volume)) {
      issues.push({
        level: "error",
        code: "candles.volume_invalid",
        message: "Candle volume must be a finite non-negative number",
        path: `${path}.volume`,
      });
    } else if (c.volume < 0) {
      issues.push({
        level: "error",
        code: "candles.negative_volume",
        message: "Candle volume must be a finite non-negative number",
        path: `${path}.volume`,
      });
    }
    const prev = previousBySymbol.get(c.symbol);
    if (prev) {
      if (
        isIsoTimestamp(prev.closeTime) &&
        isIsoTimestamp(c.closeTime) &&
        Date.parse(c.closeTime) < Date.parse(prev.closeTime)
      ) {
        issues.push({
          level: "error",
          code: "candles.not_sorted",
          message: `Candles for ${c.symbol} are not sorted by closeTime`,
          path,
        });
      }
      if (
        isIsoTimestamp(prev.closeTime) &&
        isIsoTimestamp(c.openTime) &&
        Date.parse(c.openTime) < Date.parse(prev.closeTime) - 1
      ) {
        issues.push({
          level: "error",
          code: "candles.overlap",
          message: `Candles for ${c.symbol} overlap at index ${i}`,
          path,
        });
      }
      if (
        expectedMs &&
        isIsoTimestamp(prev.openTime) &&
        isIsoTimestamp(c.openTime)
      ) {
        const delta = Date.parse(c.openTime) - Date.parse(prev.openTime);
        if (delta > expectedMs * 2) {
          issues.push({
            level: "warning",
            code: "candles.gap",
            message: `Possible gap (${Math.round(delta / expectedMs)} intervals) between candles for ${c.symbol}`,
            path,
          });
        }
      }
    }
    previousBySymbol.set(c.symbol, c);
  }
  return issues;
}

export function validateEvents(
  events: MarketEvent[],
  knownSymbols: Set<string>,
  meta: ScenarioMeta,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  const startMs = isIsoTimestamp(meta.startTime)
    ? Date.parse(meta.startTime)
    : Number.NaN;
  const endMs = isIsoTimestamp(meta.endTime)
    ? Date.parse(meta.endTime)
    : Number.NaN;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const path = `events[${i}]`;
    if (!ev.id) {
      issues.push({
        level: "error",
        code: "events.id_missing",
        message: "Event id is required",
        path,
      });
    } else if (seenIds.has(ev.id)) {
      issues.push({
        level: "error",
        code: "events.id_duplicate",
        message: `Duplicate event id: ${ev.id}`,
        path,
      });
    } else {
      seenIds.add(ev.id);
    }
    if (!isIsoTimestamp(ev.happenedAt)) {
      issues.push({
        level: "error",
        code: "events.happened_at_invalid",
        message: `Event happenedAt is not a valid ISO 8601 timestamp: ${ev.happenedAt}`,
        path: `${path}.happenedAt`,
      });
    }
    if (!ev.publishedAt) {
      issues.push({
        level: "error",
        code: "events.published_at_missing",
        message: `Event ${ev.id} is missing publishedAt`,
        path: `${path}.publishedAt`,
      });
    } else if (!isIsoTimestamp(ev.publishedAt)) {
      issues.push({
        level: "error",
        code: "events.published_at_invalid",
        message: `Event publishedAt is not a valid ISO 8601 timestamp: ${ev.publishedAt}`,
        path: `${path}.publishedAt`,
      });
    }
    if (
      isIsoTimestamp(ev.happenedAt) &&
      isIsoTimestamp(ev.publishedAt) &&
      Date.parse(ev.publishedAt) < Date.parse(ev.happenedAt)
    ) {
      issues.push({
        level: "warning",
        code: "events.published_before_happened",
        message: `Event ${ev.id} publishedAt precedes happenedAt — verify this is intentional (e.g., pre-announcement)`,
        path,
      });
    }
    if (!ev.affectedSymbols || ev.affectedSymbols.length === 0) {
      issues.push({
        level: "warning",
        code: "events.affected_symbols_empty",
        message: `Event ${ev.id} declares no affectedSymbols`,
        path: `${path}.affectedSymbols`,
      });
    } else {
      for (const symbol of ev.affectedSymbols) {
        if (!knownSymbols.has(symbol)) {
          issues.push({
            level: "error",
            code: "events.symbol_unknown",
            message: `Event ${ev.id} references unknown symbol ${symbol}`,
            path: `${path}.affectedSymbols`,
          });
        }
      }
    }
    if (!ev.source?.trim()) {
      issues.push({
        level: "warning",
        code: "events.source_missing",
        message: `Event ${ev.id} is missing a source label`,
        path: `${path}.source`,
      });
    }
    if (!ev.sourceUrl?.trim()) {
      issues.push({
        level: "warning",
        code: "events.source_url_missing",
        message: `Event ${ev.id} is missing a traceable source URL`,
        path: `${path}.sourceUrl`,
      });
    }
    if (
      isIsoTimestamp(ev.publishedAt) &&
      Number.isFinite(startMs) &&
      Number.isFinite(endMs)
    ) {
      const pubMs = Date.parse(ev.publishedAt);
      if (pubMs < startMs || pubMs > endMs) {
        issues.push({
          level: "warning",
          code: "events.outside_scenario_range",
          message: `Event ${ev.id} publishedAt falls outside scenario range — keep only if intentional pre/post context`,
          path,
        });
      }
    }
    const corpus = `${ev.title}\n${ev.summary}`;
    const hindsight = findHindsightPatterns(corpus);
    if (hindsight.length > 0) {
      issues.push({
        level: "warning",
        code: "events.hindsight_phrasing",
        message: `Event ${ev.id} may contain hindsight phrasing: ${hindsight
          .map((h) => `"${h}"`)
          .join(", ")}`,
        path: `${path}.summary`,
      });
    }
  }
  return issues;
}

export function validateBenchmarks(
  benchmarks: BenchmarkPoint[],
  knownSymbols: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (let i = 0; i < benchmarks.length; i++) {
    const b = benchmarks[i];
    const path = `benchmarks[${i}]`;
    if (!isIsoTimestamp(b.time)) {
      issues.push({
        level: "error",
        code: "benchmarks.time_invalid",
        message: `Benchmark time is not a valid ISO 8601 timestamp: ${b.time}`,
        path: `${path}.time`,
      });
    }
    if (!knownSymbols.has(b.symbol)) {
      issues.push({
        level: "warning",
        code: "benchmarks.symbol_unknown",
        message: `Benchmark references symbol ${b.symbol} not present in instruments`,
        path: `${path}.symbol`,
      });
    }
    if (!Number.isFinite(b.value)) {
      issues.push({
        level: "error",
        code: "benchmarks.value_invalid",
        message: "Benchmark value must be a finite number",
        path,
      });
    }
  }
  return issues;
}

export function validateIndicators(
  indicators: IndicatorSnapshot[],
  knownSymbols: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (let i = 0; i < indicators.length; i++) {
    const snap = indicators[i];
    const path = `indicators[${i}]`;
    if (!isIsoTimestamp(snap.time)) {
      issues.push({
        level: "error",
        code: "indicators.time_invalid",
        message: `Indicator time is not a valid ISO 8601 timestamp: ${snap.time}`,
        path: `${path}.time`,
      });
    }
    if (!isIsoTimestamp(snap.availableAt)) {
      issues.push({
        level: "error",
        code: "indicators.available_at_invalid",
        message: `Indicator availableAt is not a valid ISO 8601 timestamp: ${snap.availableAt}`,
        path: `${path}.availableAt`,
      });
    }
    if (
      isIsoTimestamp(snap.time) &&
      isIsoTimestamp(snap.availableAt) &&
      Date.parse(snap.availableAt) < Date.parse(snap.time)
    ) {
      issues.push({
        level: "warning",
        code: "indicators.available_before_time",
        message:
          "Indicator availableAt precedes its observation time — verify pre-release intent",
        path,
      });
    }
    if (!knownSymbols.has(snap.symbol)) {
      issues.push({
        level: "warning",
        code: "indicators.symbol_unknown",
        message: `Indicator ${snap.name} references symbol ${snap.symbol} not present in instruments`,
        path: `${path}.symbol`,
      });
    }
    if (typeof snap.value === "number") {
      if (!Number.isFinite(snap.value)) {
        issues.push({
          level: "error",
          code: "indicators.value_invalid",
          message: "Indicator value must be finite",
          path: `${path}.value`,
        });
      }
    } else if (
      !snap.value ||
      typeof snap.value !== "object" ||
      Array.isArray(snap.value)
    ) {
      issues.push({
        level: "error",
        code: "indicators.value_invalid",
        message: "Indicator value must be a finite number or numeric record",
        path: `${path}.value`,
      });
    } else {
      for (const [key, value] of Object.entries(snap.value)) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          issues.push({
            level: "error",
            code: "indicators.value_invalid",
            message: "Indicator record values must be finite numbers",
            path: `${path}.value.${key}`,
          });
        }
      }
    }
  }
  return issues;
}

export function validateBroker(broker: BrokerConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!broker) {
    issues.push({
      level: "error",
      code: "broker.missing",
      message: "Broker assumptions are required",
      path: "broker",
    });
    return issues;
  }
  if (!broker.baseCurrency) {
    issues.push({
      level: "error",
      code: "broker.base_currency_missing",
      message: "Broker baseCurrency is required",
      path: "broker.baseCurrency",
    });
  }
  if (
    !Number.isFinite(broker.commissionRateBps) ||
    broker.commissionRateBps < 0
  ) {
    issues.push({
      level: "error",
      code: "broker.commission_negative",
      message: "Broker commissionRateBps must be a finite non-negative number",
      path: "broker.commissionRateBps",
    });
  }
  if (!Number.isFinite(broker.fixedFee) || broker.fixedFee < 0) {
    issues.push({
      level: "error",
      code: "broker.fixed_fee_invalid",
      message: "Broker fixedFee must be a finite non-negative number",
      path: "broker.fixedFee",
    });
  }
  if (!Number.isFinite(broker.spreadBps) || broker.spreadBps < 0) {
    issues.push({
      level: "error",
      code: "broker.spread_negative",
      message: "Broker spreadBps must be a finite non-negative number",
      path: "broker.spreadBps",
    });
  }
  if (!Number.isFinite(broker.maxLeverage) || broker.maxLeverage < 1) {
    issues.push({
      level: "error",
      code: "broker.max_leverage_too_low",
      message: "Broker maxLeverage must be finite and at least 1",
      path: "broker.maxLeverage",
    });
  }
  if (broker.slippageModel === "fixed_bps" && broker.slippageBps == null) {
    issues.push({
      level: "warning",
      code: "broker.slippage_bps_missing",
      message: "slippageModel=fixed_bps but slippageBps is not set",
      path: "broker.slippageBps",
    });
  }
  if (
    broker.slippageBps !== undefined &&
    (!Number.isFinite(broker.slippageBps) || broker.slippageBps < 0)
  ) {
    issues.push({
      level: "error",
      code: "broker.slippage_bps_invalid",
      message: "Broker slippageBps must be a finite non-negative number",
      path: "broker.slippageBps",
    });
  }
  if (
    broker.maxParticipationRate !== undefined &&
    (!Number.isFinite(broker.maxParticipationRate) ||
      broker.maxParticipationRate <= 0 ||
      broker.maxParticipationRate > 1)
  ) {
    issues.push({
      level: "error",
      code: "broker.max_participation_invalid",
      message: "Broker maxParticipationRate must be greater than 0 and at most 1",
      path: "broker.maxParticipationRate",
    });
  }
  if (
    broker.partialFillPolicy === "volume_limited" &&
    broker.maxParticipationRate === undefined
  ) {
    issues.push({
      level: "error",
      code: "broker.max_participation_missing",
      message:
        "partialFillPolicy=volume_limited requires maxParticipationRate",
      path: "broker.maxParticipationRate",
    });
  }
  if (
    broker.borrowRateBps !== undefined &&
    (!Number.isFinite(broker.borrowRateBps) || broker.borrowRateBps < 0)
  ) {
    issues.push({
      level: "error",
      code: "broker.borrow_rate_invalid",
      message: "Broker borrowRateBps must be a finite non-negative number",
      path: "broker.borrowRateBps",
    });
  }
  if (
    !["none", "fixed_bps", "volume_based", "volatility_based"].includes(
      broker.slippageModel,
    )
  ) {
    issues.push({
      level: "error",
      code: "broker.slippage_model_invalid",
      message: "Broker slippageModel is not supported",
      path: "broker.slippageModel",
    });
  }
  if (
    broker.partialFillPolicy !== undefined &&
    !["disabled", "volume_limited"].includes(broker.partialFillPolicy)
  ) {
    issues.push({
      level: "error",
      code: "broker.partial_fill_policy_invalid",
      message: "Broker partialFillPolicy is not supported",
      path: "broker.partialFillPolicy",
    });
  }
  if (
    broker.stopFillPolicy !== undefined &&
    !["trigger_price", "gap_open"].includes(broker.stopFillPolicy)
  ) {
    issues.push({
      level: "error",
      code: "broker.stop_fill_policy_invalid",
      message: "Broker stopFillPolicy is not supported",
      path: "broker.stopFillPolicy",
    });
  }
  if (
    broker.marginCallPolicy !== undefined &&
    ![
      "disabled",
      "liquidate_on_threshold",
      "reject_new_orders",
    ].includes(broker.marginCallPolicy)
  ) {
    issues.push({
      level: "error",
      code: "broker.margin_call_policy_invalid",
      message: "Broker marginCallPolicy is not supported",
      path: "broker.marginCallPolicy",
    });
  }
  return issues;
}

export function validateMarketCalendar(
  calendar: MarketCalendar | undefined,
  meta: ScenarioMeta,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!calendar) {
    if (meta.marketCalendarId) {
      issues.push({
        level: "warning",
        code: "calendar.missing",
        message: "Scenario declares marketCalendarId but has no marketCalendar object",
        path: "marketCalendar",
      });
    }
    return issues;
  }
  if (!calendar.id) {
    issues.push({
      level: "error",
      code: "calendar.id_missing",
      message: "Market calendar id is required",
      path: "marketCalendar.id",
    });
  }
  if (meta.marketCalendarId && calendar.id !== meta.marketCalendarId) {
    issues.push({
      level: "error",
      code: "calendar.id_mismatch",
      message: "meta.marketCalendarId does not match marketCalendar.id",
      path: "meta.marketCalendarId",
    });
  }
  if (calendar.sessions.length === 0) {
    issues.push({
      level: "warning",
      code: "calendar.sessions_empty",
      message: "Market calendar has no sessions; broker market-hours checks may reject orders",
      path: "marketCalendar.sessions",
    });
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: calendar.timezone }).format(
      new Date(0),
    );
  } catch {
    issues.push({
      level: "error",
      code: "calendar.timezone_invalid",
      message: "Market calendar timezone must be a valid IANA timezone",
      path: "marketCalendar.timezone",
    });
  }
  const sessionKeys = new Set<string>();
  for (let index = 0; index < calendar.sessions.length; index++) {
    const session = calendar.sessions[index];
    const path = `marketCalendar.sessions[${index}]`;
    if (
      !Number.isInteger(session.dayOfWeek) ||
      session.dayOfWeek < 0 ||
      session.dayOfWeek > 6
    ) {
      issues.push({
        level: "error",
        code: "calendar.day_invalid",
        message: "Market calendar dayOfWeek must be an integer from 0 to 6",
        path: `${path}.dayOfWeek`,
      });
    }
    for (const [field, value] of [
      ["open", session.open],
      ["close", session.close],
    ] as const) {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        issues.push({
          level: "error",
          code: "calendar.time_invalid",
          message: `Market calendar ${field} must use 24-hour HH:MM format`,
          path: `${path}.${field}`,
        });
      }
    }
    const key = `${session.dayOfWeek}:${session.open}:${session.close}`;
    if (sessionKeys.has(key)) {
      issues.push({
        level: "error",
        code: "calendar.session_duplicate",
        message: "Market calendar sessions must be unique",
        path,
      });
    }
    sessionKeys.add(key);
  }
  const holidays = new Set<string>();
  for (let index = 0; index < (calendar.holidays ?? []).length; index++) {
    const holiday = calendar.holidays![index];
    const parsed = new Date(`${holiday}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(holiday) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== holiday
    ) {
      issues.push({
        level: "error",
        code: "calendar.holiday_invalid",
        message: "Market calendar holidays must be real YYYY-MM-DD dates",
        path: `marketCalendar.holidays[${index}]`,
      });
    }
    if (holidays.has(holiday)) {
      issues.push({
        level: "error",
        code: "calendar.holiday_duplicate",
        message: "Market calendar holidays must be unique",
        path: `marketCalendar.holidays[${index}]`,
      });
    }
    holidays.add(holiday);
  }
  return issues;
}

export function validateCorporateActions(
  actions: CorporateAction[] | undefined,
  knownSymbols: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (let i = 0; i < (actions ?? []).length; i++) {
    const action = actions![i];
    const path = `corporateActions[${i}]`;
    if (!knownSymbols.has(action.symbol)) {
      issues.push({
        level: "error",
        code: "corporate_actions.symbol_unknown",
        message: `Corporate action references unknown symbol ${action.symbol}`,
        path: `${path}.symbol`,
      });
    }
    if (!isIsoTimestamp(action.effectiveAt)) {
      issues.push({
        level: "error",
        code: "corporate_actions.effective_at_invalid",
        message: "Corporate action effectiveAt must be ISO 8601",
        path: `${path}.effectiveAt`,
      });
    }
    if (
      (action.type === "split" && action.ratio === undefined) ||
      (action.ratio !== undefined &&
        (!Number.isFinite(action.ratio) || action.ratio <= 0))
    ) {
      issues.push({
        level: "error",
        code: "corporate_actions.split_ratio_invalid",
        message:
          "Corporate action ratio must be a finite positive number, and splits require it",
        path: `${path}.ratio`,
      });
    }
    if (
      (action.type === "dividend" && action.amount === undefined) ||
      (action.amount !== undefined &&
        (!Number.isFinite(action.amount) || action.amount <= 0))
    ) {
      issues.push({
        level: "error",
        code: "corporate_actions.dividend_amount_invalid",
        message:
          "Corporate action amount must be a finite positive number, and dividends require it",
        path: `${path}.amount`,
      });
    }
  }
  return issues;
}

export function validateScenarioPackage(
  pkg: ScenarioPackage,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  issues.push(...validateScenarioMeta(pkg.meta));
  issues.push(...validateInstruments(pkg.instruments, pkg.meta));
  const knownSymbols = new Set(pkg.instruments.map((i) => i.symbol));
  issues.push(
    ...validateCandles(pkg.candles, knownSymbols, pkg.meta.defaultGranularity),
  );
  issues.push(...validateEvents(pkg.events, knownSymbols, pkg.meta));
  issues.push(...validateBenchmarks(pkg.benchmarks, knownSymbols));
  issues.push(...validateIndicators(pkg.indicators, knownSymbols));
  issues.push(...validateBroker(pkg.broker));
  issues.push(...validateMarketCalendar(pkg.marketCalendar, pkg.meta));
  if (pkg.broker.marketHoursEnforced && !pkg.marketCalendar) {
    issues.push({
      level: "error",
      code: "calendar.required_for_enforcement",
      message:
        "A market calendar is required when broker market-hours enforcement is enabled",
      path: "marketCalendar",
    });
  }
  issues.push(...validateCorporateActions(pkg.corporateActions, knownSymbols));
  const authoredDrills = validateScenarioDrillDefinitions(pkg.drills, pkg);
  issues.push(
    ...authoredDrills.issues.map((issue) => ({
      level: "error" as const,
      code: issue.code,
      message: issue.message,
      path: issue.path,
    })),
  );
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings,
  };
}
