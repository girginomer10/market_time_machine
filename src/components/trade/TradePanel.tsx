import { useMemo, useState } from "react";
import {
  type BrokerMode,
  useSessionStore,
} from "../../store/sessionStore";
import { formatCurrency, formatNumber, formatPct } from "../../utils/format";
import type {
  MarginSnapshot,
  OrderType,
  RiskSnapshot,
  TimeInForce,
  TradablePrice,
} from "../../types";
import { estimateOneWaySpreadCost } from "./costEstimates";

const ZERO_EPSILON = 0.0000001;

const BROKER_MODES: Array<{
  value: BrokerMode;
  label: string;
  description: string;
}> = [
  {
    value: "scenario",
    label: "Scenario",
    description: "Curated assumptions from the scenario package.",
  },
  {
    value: "ideal",
    label: "Ideal",
    description: "No spread, fees, or slippage.",
  },
  {
    value: "realistic",
    label: "Realistic",
    description: "Broker-like costs and shorting.",
  },
  {
    value: "harsh",
    label: "Harsh",
    description: "Stress-test fills and lot rules.",
  },
];

type TicketOrderType = OrderType | "bracket";

type Props = {
  tradablePrice?: TradablePrice;
  currency?: string;
  cash: number;
  positionsValue: number;
  totalValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  initialCash: number;
  margin?: MarginSnapshot;
  risk?: RiskSnapshot;
};

function toneFor(value: number): "pos" | "neg" | "neutral" {
  if (value > ZERO_EPSILON) return "pos";
  if (value < -ZERO_EPSILON) return "neg";
  return "neutral";
}

function signedPct(value: number): string {
  const formatted = formatPct(value);
  if (Math.abs(value) <= ZERO_EPSILON || formatted === "—") return formatted;
  return value > 0 ? `+${formatted}` : formatted;
}

export default function TradePanel({
  tradablePrice,
  currency = "USD",
  cash,
  positionsValue,
  totalValue,
  realizedPnl,
  unrealizedPnl,
  initialCash,
  margin,
  risk,
}: Props) {
  const submitMarketOrder = useSessionStore((s) => s.submitMarketOrder);
  const submitLimitOrder = useSessionStore((s) => s.submitLimitOrder);
  const submitPendingOrder = useSessionStore((s) => s.submitPendingOrder);
  const submitBracketOrder = useSessionStore((s) => s.submitBracketOrder);
  const rejectionMessage = useSessionStore((s) => s.rejectionMessage);
  const clearRejection = useSessionStore((s) => s.clearRejection);
  const status = useSessionStore((s) => s.status);
  const symbol = useSessionStore((s) => s.primarySymbol);
  const broker = useSessionStore((s) => s.broker);
  const brokerMode = useSessionStore((s) => s.brokerMode);
  const scenarioMode = useSessionStore((s) => s.mode);
  const setBrokerMode = useSessionStore((s) => s.setBrokerMode);
  const fills = useSessionStore((s) => s.fills);
  const orders = useSessionStore((s) => s.orders);
  const positionsBySymbol = useSessionStore((s) => s.portfolio.positions);

  const [quantity, setQuantity] = useState<string>("0.05");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<TicketOrderType>("market");
  const [limitPrice, setLimitPrice] = useState<string>("");
  const [targetPrice, setTargetPrice] = useState<string>("");
  // Daily scenarios expose each bar at its close, so a DAY order entered there
  // has no remaining same-session candle to execute against. GTC is the safe
  // default while DAY remains available for deliberate session-only orders.
  const [timeInForce, setTimeInForce] = useState<TimeInForce>("gtc");
  const [note, setNote] = useState<string>("");
  const [inputError, setInputError] = useState<string>();

  const totalReturn = useMemo(
    () => (initialCash > 0 ? totalValue / initialCash - 1 : 0),
    [initialCash, totalValue],
  );
  const totalPnl = totalValue - initialCash;
  const grossExposure =
    totalValue > 0
      ? Math.max(
          0,
          risk?.exposurePct ??
            (margin?.positionsGrossNotional ?? Math.abs(positionsValue)) /
              totalValue,
        )
      : 0;
  const exposureBarWidth = Math.min(1, grossExposure);
  const openPositions = useMemo(
    () =>
      Object.values(positionsBySymbol)
        .filter((candidate) => Math.abs(candidate.quantity) > ZERO_EPSILON)
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [positionsBySymbol],
  );
  const position = positionsBySymbol[symbol];
  const heldQty = position?.quantity ?? 0;
  const marketPrice = tradablePrice?.price ?? position?.marketPrice;
  const hasTriggerPrice = orderType !== "market" && orderType !== "bracket";
  const hasBracketPrices = orderType === "bracket";
  const notionalPrice =
    hasTriggerPrice && Number.isFinite(Number(limitPrice))
      ? Number(limitPrice)
      : marketPrice;
  const numericQuantity = Number(quantity);
  const expectedNotional =
    notionalPrice && Number.isFinite(numericQuantity)
      ? numericQuantity * notionalPrice
      : undefined;
  const commission =
    expectedNotional !== undefined
      ? expectedNotional * (broker.commissionRateBps / 10000) + broker.fixedFee
      : undefined;
  const estimatedSpread =
    expectedNotional !== undefined && orderType === "market"
      ? estimateOneWaySpreadCost(expectedNotional, broker.spreadBps)
      : undefined;
  const estimatedSlippage =
    expectedNotional !== undefined &&
    orderType === "market" &&
    broker.slippageModel !== "none"
      ? expectedNotional * ((broker.slippageBps ?? 0) / 10000)
      : 0;

  const isFinished = status === "finished";
  const workingOrderCount = orders.filter(
    (order) =>
      order.status === "pending" || order.status === "partially_filled",
  ).length;
  const brokerLocked =
    fills.length > 0 ||
    workingOrderCount > 0 ||
    scenarioMode === "professional" ||
    scenarioMode === "blind" ||
    scenarioMode === "challenge";
  const canSell = broker.allowShort || heldQty > 0;
  const canBracket =
    orderType === "bracket" &&
    heldQty !== 0 &&
    ((heldQty > 0 && side === "sell") || (heldQty < 0 && side === "buy"));
  const canSubmit =
    orderType === "bracket" ? canBracket : side === "buy" || canSell;

  const pendingPriceLabel =
    orderType === "limit"
      ? "Limit"
      : orderType === "stop_loss"
        ? "Stop"
        : "Target";
  const orderLabel = orderType.replace("_", " ");

  function defaultPriceFor(
    nextType: TicketOrderType,
    nextSide: "buy" | "sell",
  ): string {
    if (!tradablePrice) return "";
    const price = tradablePrice.price;
    const multiplier =
      nextType === "stop_loss"
        ? nextSide === "sell"
          ? 0.95
          : 1.05
        : nextType === "take_profit"
          ? nextSide === "sell"
            ? 1.05
            : 0.95
          : 1;
    return String(Math.round(price * multiplier * 100) / 100);
  }

  function selectOrderType(nextType: TicketOrderType): void {
    const nextSide =
      nextType !== "limit" && nextType !== "market" && heldQty > 0
        ? "sell"
        : nextType !== "limit" && nextType !== "market" && heldQty < 0
          ? "buy"
          : side;
    setOrderType(nextType);
    setSide(nextSide);
    if (nextType === "bracket" && heldQty !== 0) {
      setQuantity(String(Math.abs(heldQty)));
    }
    if (nextType !== "market") {
      setLimitPrice(
        defaultPriceFor(
          nextType === "bracket" ? "stop_loss" : nextType,
          nextSide,
        ),
      );
    }
    if (nextType === "bracket") {
      setTargetPrice(defaultPriceFor("take_profit", nextSide));
    }
    setInputError(undefined);
  }

  function selectSide(nextSide: "buy" | "sell"): void {
    setSide(nextSide);
    if (orderType === "bracket") {
      setLimitPrice(defaultPriceFor("stop_loss", nextSide));
      setTargetPrice(defaultPriceFor("take_profit", nextSide));
    } else if (orderType === "stop_loss" || orderType === "take_profit") {
      setLimitPrice(defaultPriceFor(orderType, nextSide));
    }
    setInputError(undefined);
  }

  const placeOrder = () => {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      clearRejection();
      setInputError("Enter a positive quantity.");
      return;
    }
    if (hasTriggerPrice) {
      const price = Number(limitPrice);
      if (!Number.isFinite(price) || price <= 0) {
        clearRejection();
        setInputError(
          `Enter a positive ${pendingPriceLabel.toLowerCase()} price.`,
        );
        return;
      }
    }
    if (hasBracketPrices) {
      const stop = Number(limitPrice);
      const target = Number(targetPrice);
      if (
        !Number.isFinite(stop) ||
        stop <= 0 ||
        !Number.isFinite(target) ||
        target <= 0
      ) {
        clearRejection();
        setInputError("Enter positive stop and target prices.");
        return;
      }
      if (Math.abs(stop - target) <= ZERO_EPSILON) {
        clearRejection();
        setInputError("Stop and target prices must be different.");
        return;
      }
    }
    setInputError(undefined);
    const result = (() => {
      if (orderType === "market") {
        return submitMarketOrder({
          symbol,
          side,
          type: "market",
          quantity: qty,
          timeInForce,
          note: note.trim() || undefined,
        });
      }
      if (orderType === "limit") {
        return submitLimitOrder({
          symbol,
          side,
          type: "limit",
          quantity: qty,
          limitPrice: Number(limitPrice),
          timeInForce,
          note: note.trim() || undefined,
        });
      }
      if (orderType === "bracket") {
        return submitBracketOrder({
          symbol,
          side,
          quantity: qty,
          stopPrice: Number(limitPrice),
          targetPrice: Number(targetPrice),
          timeInForce,
          note: note.trim() || undefined,
        });
      }
      return submitPendingOrder({
        symbol,
        side,
        type: orderType,
        quantity: qty,
        triggerPrice: Number(limitPrice),
        timeInForce,
        note: note.trim() || undefined,
      });
    })();
    if (result.ok) {
      setNote("");
    }
  };

  return (
    <div className="trade-stack">
      <section className="panel panel-portfolio">
        <div className="panel-head">
          <span className="panel-title">Portfolio</span>
          <span className="panel-meta">{currency.toUpperCase()}</span>
        </div>
        <div className="portfolio-hero">
          <span className="hero-label">Total value</span>
          <span className={`hero-value ${toneFor(totalReturn)}`}>
            {formatCurrency(totalValue, currency)}
          </span>
          <span className={`hero-sub ${toneFor(totalReturn)}`}>
            {signedPct(totalReturn)} · {formatCurrency(totalPnl, currency)}
          </span>
          <span className="hero-from">
            from {formatCurrency(initialCash, currency)}
          </span>
        </div>
        <div className="portfolio-split">
          <Metric label="Cash" value={formatCurrency(cash, currency)} />
          <Metric
            label="Net position value"
            value={formatCurrency(positionsValue, currency)}
          />
          <Metric
            label="Realized P/L"
            value={formatCurrency(realizedPnl, currency)}
            tone={toneFor(realizedPnl)}
          />
          <Metric
            label="Unrealized P/L"
            value={formatCurrency(unrealizedPnl, currency)}
            tone={toneFor(unrealizedPnl)}
          />
        </div>
        <div
          className="exposure-bar"
          role="meter"
          aria-label="Gross portfolio exposure"
          aria-valuemin={0}
          aria-valuemax={Math.max(1, grossExposure)}
          aria-valuenow={grossExposure}
          aria-valuetext={formatPct(grossExposure)}
        >
          <span
            className="exposure-cash"
            style={{ width: `${(1 - exposureBarWidth) * 100}%` }}
          />
          <span
            className="exposure-position"
            style={{ width: `${exposureBarWidth * 100}%` }}
          />
        </div>
        <div className="exposure-label">
          Gross exposure {formatPct(grossExposure)}
        </div>
        <div className="position-card">
          <div className="position-card-head">
            <strong>Open positions</strong>
            <span>
              {openPositions.length} {openPositions.length === 1 ? "symbol" : "symbols"}
            </span>
          </div>
          {openPositions.length === 0 ? (
            <div className="position-empty">No open positions.</div>
          ) : (
            <div className="open-position-list" aria-label="Open positions">
              {openPositions.map((candidate) => (
                <article className="open-position-row" key={candidate.symbol}>
                  <div className="open-position-head">
                    <strong>{candidate.symbol}</strong>
                    <span>
                      {candidate.quantity > 0 ? "Long" : "Short"}
                    </span>
                  </div>
                  <div className="position-grid">
                    <Metric
                      label="Qty"
                      value={formatNumber(candidate.quantity, 6)}
                    />
                    <Metric
                      label="Avg"
                      value={formatCurrency(candidate.averagePrice, currency)}
                    />
                    <Metric
                      label="Mark"
                      value={formatCurrency(candidate.marketPrice, currency)}
                    />
                    <Metric
                      label="Unrealized"
                      value={formatCurrency(candidate.unrealizedPnl, currency)}
                      tone={toneFor(candidate.unrealizedPnl)}
                    />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel panel-risk">
        <div className="panel-head">
          <span className="panel-title">Risk and margin</span>
          <span className={risk?.liquidationWarning ? "panel-meta neg" : "panel-meta"}>
            {risk?.liquidationWarning ? "Warning" : "Normal"}
          </span>
        </div>
        <div className="risk-grid">
          <Metric
            label="Equity"
            value={margin ? formatCurrency(margin.equity, currency) : "—"}
            tone={margin && margin.equity < 0 ? "neg" : "neutral"}
          />
          <Metric
            label="Buying power"
            value={risk ? formatCurrency(risk.buyingPower, currency) : "—"}
          />
          <Metric
            label="Leverage"
            value={
              risk && Number.isFinite(risk.leverage)
                ? `${formatNumber(risk.leverage, 2)}x`
                : "—"
            }
            tone={risk && risk.leverage > broker.maxLeverage ? "neg" : "neutral"}
          />
          <Metric
            label="Margin excess"
            value={margin ? formatCurrency(margin.excessEquity, currency) : "—"}
            tone={margin && margin.excessEquity < 0 ? "neg" : "neutral"}
          />
        </div>
        <div className="margin-meter" aria-label="Margin utilization">
          <span
            className={risk?.liquidationWarning ? "danger" : ""}
            style={{
              width: `${Math.min(100, (margin?.marginUtilization ?? 0) * 100)}%`,
            }}
          />
        </div>
        <div className="risk-note">
          {margin?.requiresLiquidation
            ? "Liquidation threshold has been breached."
            : margin?.isMarginCall
              ? "Maintenance margin is under pressure."
              : "Margin state is within broker limits."}
        </div>
      </section>

      <section className="panel panel-order">
        <div className="panel-head">
          <span className="panel-title">Order ticket</span>
          <span className="panel-meta">
            {tradablePrice
              ? `${formatCurrency(tradablePrice.price, currency)} mark`
              : "No quote yet"}
          </span>
        </div>
        <div className="seg buy-sell" role="radiogroup" aria-label="Side">
          <button
            className={side === "buy" ? "active buy" : ""}
            onClick={() => selectSide("buy")}
            role="radio"
            aria-checked={side === "buy"}
            disabled={isFinished}
          >
            Buy
          </button>
          <button
            className={side === "sell" ? "active sell" : ""}
            onClick={() => selectSide("sell")}
            role="radio"
            aria-checked={side === "sell"}
            disabled={isFinished}
          >
            {heldQty <= 0 && broker.allowShort ? "Short" : "Sell"}
          </button>
        </div>
        <div className="seg order-type-row" role="radiogroup" aria-label="Order type">
          <button
            className={orderType === "market" ? "active" : ""}
            onClick={() => selectOrderType("market")}
            role="radio"
            aria-checked={orderType === "market"}
            disabled={isFinished}
          >
            Market
          </button>
          <button
            className={orderType === "limit" ? "active" : ""}
            onClick={() => selectOrderType("limit")}
            role="radio"
            aria-checked={orderType === "limit"}
            disabled={isFinished}
          >
            Limit
          </button>
          <button
            className={orderType === "stop_loss" ? "active" : ""}
            onClick={() => selectOrderType("stop_loss")}
            role="radio"
            aria-checked={orderType === "stop_loss"}
            disabled={isFinished}
          >
            Stop
          </button>
          <button
            className={orderType === "take_profit" ? "active" : ""}
            onClick={() => selectOrderType("take_profit")}
            role="radio"
            aria-checked={orderType === "take_profit"}
            disabled={isFinished}
          >
            Target
          </button>
          <button
            className={orderType === "bracket" ? "active" : ""}
            onClick={() => selectOrderType("bracket")}
            role="radio"
            aria-checked={orderType === "bracket"}
            disabled={isFinished}
          >
            Bracket
          </button>
        </div>
        <div className="field-row">
          <label htmlFor="qty">Qty</label>
          <input
            id="qty"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => {
              setQuantity(e.target.value);
              setInputError(undefined);
            }}
            placeholder="0.05"
            disabled={isFinished}
            aria-invalid={Boolean(inputError)}
            aria-describedby={inputError ? "order-input-error" : undefined}
          />
        </div>
        {hasTriggerPrice ? (
          <div className="field-row">
            <label htmlFor="limit-price">{pendingPriceLabel}</label>
            <input
              id="limit-price"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={limitPrice}
              onChange={(e) => {
                setLimitPrice(e.target.value);
                setInputError(undefined);
              }}
              placeholder={tradablePrice ? String(Math.round(tradablePrice.price)) : "0"}
              disabled={isFinished}
            />
          </div>
        ) : null}
        {hasBracketPrices ? (
          <>
            <div className="field-row">
              <label htmlFor="bracket-stop-price">Stop</label>
              <input
                id="bracket-stop-price"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={limitPrice}
                onChange={(e) => {
                  setLimitPrice(e.target.value);
                  setInputError(undefined);
                }}
                placeholder={tradablePrice ? defaultPriceFor("stop_loss", side) : "0"}
                disabled={isFinished}
              />
            </div>
            <div className="field-row">
              <label htmlFor="bracket-target-price">Target</label>
              <input
                id="bracket-target-price"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={targetPrice}
                onChange={(e) => {
                  setTargetPrice(e.target.value);
                  setInputError(undefined);
                }}
                placeholder={tradablePrice ? defaultPriceFor("take_profit", side) : "0"}
                disabled={isFinished}
              />
            </div>
          </>
        ) : null}
        <div className="field-row">
          <label htmlFor="time-in-force">Time in force</label>
          <select
            id="time-in-force"
            value={timeInForce}
            onChange={(event) =>
              setTimeInForce(event.target.value as TimeInForce)
            }
            disabled={isFinished}
          >
            <option value="day">Day · expires after this session</option>
            <option value="gtc">GTC · works until cancelled</option>
          </select>
        </div>
        <div className="ticket-summary">
          <Row label="Expected notional" value={expectedNotional} currency={currency} />
          <Row
            label={`${broker.commissionRateBps} bps commission`}
            value={commission}
            currency={currency}
          />
          <Row
            label={`${broker.spreadBps} bps spread`}
            value={estimatedSpread}
            currency={currency}
          />
          <Row
            label={`${broker.slippageModel.replace("_", " ")} slippage`}
            value={estimatedSlippage}
            currency={currency}
          />
        </div>
        <textarea
          className="note-input"
          aria-label="Decision note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Decision note: why this trade, and what would invalidate it?"
          disabled={isFinished}
        />
        <button
          className={`place ${side === "buy" ? "place-buy" : "place-sell"}`}
          onClick={placeOrder}
          disabled={isFinished || !tradablePrice || !canSubmit}
        >
          {!canSubmit
            ? orderType === "bracket"
              ? "Open position required"
              : "Insufficient position"
            : orderType === "bracket"
              ? "Place bracket exit"
              : `Place ${orderLabel} ${side === "buy" ? "buy" : heldQty <= 0 && broker.allowShort ? "short" : "sell"}`}
        </button>
        {inputError ? (
          <div className="rejection" id="order-input-error" role="alert">
            {inputError}
          </div>
        ) : null}
        {rejectionMessage ? (
          <div className="rejection" role="alert">
            <span>Order rejected: {rejectionMessage}</span>
            <button onClick={clearRejection}>Dismiss</button>
          </div>
        ) : null}
        <div className="broker-block">
          <div className="broker-head">
            <span>Broker model</span>
            <small>
              {brokerLocked
                ? scenarioMode === "professional" ||
                  scenarioMode === "blind" ||
                  scenarioMode === "challenge"
                  ? `Locked in ${scenarioMode} mode`
                  : `Locked after trading starts${workingOrderCount > 0 ? ` · ${workingOrderCount} working` : ""}`
                : "Select before trading"}
            </small>
          </div>
          <div className="broker-grid" role="radiogroup" aria-label="Broker model">
            {BROKER_MODES.map((mode) => (
              <button
                key={mode.value}
                className={brokerMode === mode.value ? "broker-pill active" : "broker-pill"}
                onClick={() => setBrokerMode(mode.value)}
                disabled={isFinished || brokerLocked}
                role="radio"
                aria-checked={brokerMode === mode.value}
                title={mode.description}
              >
                <span>{mode.label}</span>
                <small>{mode.description}</small>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "neutral";
}) {
  return (
    <div className="mini-metric">
      <span>{label}</span>
      <strong className={tone ?? ""}>{value}</strong>
    </div>
  );
}

function Row({
  label,
  value,
  currency,
}: {
  label: string;
  value?: number;
  currency: string;
}) {
  return (
    <div className="kv-row">
      <span>{label}</span>
      <strong>
        {value === undefined ? "—" : formatCurrency(value, currency)}
      </strong>
    </div>
  );
}
