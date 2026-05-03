import { useMemo, useState } from "react";
import {
  type BrokerMode,
  useSessionStore,
} from "../../store/sessionStore";
import { formatCurrency, formatNumber, formatPct } from "../../utils/format";
import type { OrderType, TradablePrice } from "../../types";
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

type Props = {
  tradablePrice?: TradablePrice;
  cash: number;
  positionsValue: number;
  totalValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  initialCash: number;
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
  cash,
  positionsValue,
  totalValue,
  realizedPnl,
  unrealizedPnl,
  initialCash,
}: Props) {
  const submitMarketOrder = useSessionStore((s) => s.submitMarketOrder);
  const submitLimitOrder = useSessionStore((s) => s.submitLimitOrder);
  const submitPendingOrder = useSessionStore((s) => s.submitPendingOrder);
  const rejectionMessage = useSessionStore((s) => s.rejectionMessage);
  const clearRejection = useSessionStore((s) => s.clearRejection);
  const status = useSessionStore((s) => s.status);
  const symbol = useSessionStore((s) => s.primarySymbol);
  const broker = useSessionStore((s) => s.broker);
  const brokerMode = useSessionStore((s) => s.brokerMode);
  const setBrokerMode = useSessionStore((s) => s.setBrokerMode);
  const fills = useSessionStore((s) => s.fills);
  const position = useSessionStore(
    (s) => s.portfolio.positions[s.primarySymbol],
  );

  const [quantity, setQuantity] = useState<string>("0.05");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [limitPrice, setLimitPrice] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const totalReturn = useMemo(
    () => (initialCash > 0 ? totalValue / initialCash - 1 : 0),
    [initialCash, totalValue],
  );
  const totalPnl = totalValue - initialCash;
  const exposure =
    totalValue > 0 ? Math.max(0, Math.min(1, positionsValue / totalValue)) : 0;
  const heldQty = position?.quantity ?? 0;
  const marketPrice = tradablePrice?.price ?? position?.marketPrice;
  const hasTriggerPrice = orderType !== "market";
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
  const brokerLocked = fills.length > 0;
  const canSell = broker.allowShort || heldQty > 0;
  const canSubmit = side === "buy" || canSell;

  const pendingPriceLabel =
    orderType === "limit"
      ? "Limit"
      : orderType === "stop_loss"
        ? "Stop"
        : "Target";
  const orderLabel = orderType.replace("_", " ");

  function defaultPriceFor(
    nextType: OrderType,
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

  function selectOrderType(nextType: OrderType): void {
    const nextSide =
      nextType !== "limit" && heldQty > 0
        ? "sell"
        : nextType !== "limit" && heldQty < 0
          ? "buy"
          : side;
    setOrderType(nextType);
    setSide(nextSide);
    if (nextType !== "market") {
      setLimitPrice(defaultPriceFor(nextType, nextSide));
    }
  }

  const placeOrder = () => {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      clearRejection();
      return;
    }
    const result = (() => {
      if (orderType === "market") {
        return submitMarketOrder({
          symbol,
          side,
          type: "market",
          quantity: qty,
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
          note: note.trim() || undefined,
        });
      }
      return submitPendingOrder({
        symbol,
        side,
        type: orderType,
        quantity: qty,
        triggerPrice: Number(limitPrice),
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
          <span className="panel-meta">USD</span>
        </div>
        <div className="portfolio-hero">
          <span className="hero-label">Total value</span>
          <span className={`hero-value ${toneFor(totalReturn)}`}>
            {formatCurrency(totalValue)}
          </span>
          <span className={`hero-sub ${toneFor(totalReturn)}`}>
            {signedPct(totalReturn)} · {formatCurrency(totalPnl)}
          </span>
          <span className="hero-from">
            from {formatCurrency(initialCash)}
          </span>
        </div>
        <div className="portfolio-split">
          <Metric label="Cash" value={formatCurrency(cash)} />
          <Metric label="Position value" value={formatCurrency(positionsValue)} />
          <Metric
            label="Realized P/L"
            value={formatCurrency(realizedPnl)}
            tone={toneFor(realizedPnl)}
          />
        </div>
        <div className="exposure-bar" aria-label="Portfolio exposure">
          <span
            className="exposure-cash"
            style={{ width: `${(1 - exposure) * 100}%` }}
          />
          <span
            className="exposure-position"
            style={{ width: `${exposure * 100}%` }}
          />
        </div>
        <div className="position-card">
          <div className="position-card-head">
            <strong>{symbol}</strong>
            <span>{heldQty === 0 ? "Flat" : heldQty > 0 ? "Long" : "Short"}</span>
          </div>
          {heldQty === 0 ? (
            <div className="position-empty">No open position.</div>
          ) : (
            <div className="position-grid">
              <Metric label="Qty" value={formatNumber(heldQty, 6)} />
              <Metric
                label="Avg"
                value={formatCurrency(position?.averagePrice ?? 0)}
              />
              <Metric
                label="Mark"
                value={marketPrice ? formatCurrency(marketPrice) : "—"}
              />
              <Metric
                label="Unrealized"
                value={formatCurrency(unrealizedPnl)}
                tone={toneFor(unrealizedPnl)}
              />
            </div>
          )}
        </div>
      </section>

      <section className="panel panel-order">
        <div className="panel-head">
          <span className="panel-title">Order ticket</span>
          <span className="panel-meta">
            {tradablePrice
              ? `${formatCurrency(tradablePrice.price)} mark`
              : "No quote yet"}
          </span>
        </div>
        <div className="seg buy-sell" role="radiogroup" aria-label="Side">
          <button
            className={side === "buy" ? "active buy" : ""}
            onClick={() => setSide("buy")}
            role="radio"
            aria-checked={side === "buy"}
            disabled={isFinished}
          >
            Buy
          </button>
          <button
            className={side === "sell" ? "active sell" : ""}
            onClick={() => setSide("sell")}
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
        </div>
        <div className="field-row">
          <label htmlFor="qty">Qty</label>
          <input
            id="qty"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0.05"
            disabled={isFinished}
          />
        </div>
        {hasTriggerPrice ? (
          <div className="field-row">
            <label htmlFor="limit-price">{pendingPriceLabel}</label>
            <input
              id="limit-price"
              inputMode="decimal"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={tradablePrice ? String(Math.round(tradablePrice.price)) : "0"}
              disabled={isFinished}
            />
          </div>
        ) : null}
        <div className="ticket-summary">
          <Row label="Expected notional" value={expectedNotional} />
          <Row label={`${broker.commissionRateBps} bps commission`} value={commission} />
          <Row label={`${broker.spreadBps} bps spread`} value={estimatedSpread} />
          <Row label={`${broker.slippageModel.replace("_", " ")} slippage`} value={estimatedSlippage} />
        </div>
        <textarea
          className="note-input"
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
            ? "Insufficient position"
            : `Place ${orderLabel} ${side === "buy" ? "buy" : heldQty <= 0 && broker.allowShort ? "short" : "sell"}`}
        </button>
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
              {brokerLocked ? "Locked after first fill" : "Select before trading"}
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

function Row({ label, value }: { label: string; value?: number }) {
  return (
    <div className="kv-row">
      <span>{label}</span>
      <strong>{value === undefined ? "—" : formatCurrency(value)}</strong>
    </div>
  );
}
