import { useMemo, useState } from "react";
import {
  type BrokerMode,
  useSessionStore,
} from "../../store/sessionStore";
import { formatCurrency, formatNumber, formatPct } from "../../utils/format";
import type { TradablePrice } from "../../types";

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
    description: "No spread, fees, or slippage. Useful for learning timing.",
  },
  {
    value: "realistic",
    label: "Realistic",
    description: "Broker-like fees, spread, fixed slippage, and shorting.",
  },
  {
    value: "harsh",
    label: "Harsh",
    description: "Stricter fills, higher costs, no fractional lots.",
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
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const totalReturn = useMemo(
    () => (initialCash > 0 ? totalValue / initialCash - 1 : 0),
    [initialCash, totalValue],
  );

  const placeOrder = (side: "buy" | "sell") => {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      clearRejection();
      return;
    }
    const result =
      orderType === "market"
        ? submitMarketOrder({
            symbol,
            side,
            type: "market",
            quantity: qty,
            note: note.trim() || undefined,
          })
        : submitLimitOrder({
            symbol,
            side,
            type: "limit",
            quantity: qty,
            limitPrice: Number(limitPrice),
            note: note.trim() || undefined,
          });
    if (result.ok) {
      setNote("");
    }
  };

  const isFinished = status === "finished";
  const heldQty = position?.quantity ?? 0;
  const brokerLocked = fills.length > 0;
  const canSell = broker.allowShort || heldQty > 0;
  const notionalPrice =
    orderType === "limit" && Number.isFinite(Number(limitPrice))
      ? Number(limitPrice)
      : tradablePrice?.price;

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Trade {symbol}</span>
        <span className="panel-sub">
          {tradablePrice
            ? `${formatCurrency(tradablePrice.price)} · spread ${formatCurrency(
                tradablePrice.ask - tradablePrice.bid,
              )}`
            : "no quote yet"}
        </span>
      </div>
      <div className="metric-row">
        <div className="metric">
          <span className="metric-label">Cash</span>
          <span className="metric-value">{formatCurrency(cash)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Positions value</span>
          <span className="metric-value">{formatCurrency(positionsValue)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Total value</span>
          <span className="metric-value">{formatCurrency(totalValue)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Total return</span>
          <span
            className={`metric-value ${
              totalReturn >= 0 ? "pos" : "neg"
            }`}
          >
            {formatPct(totalReturn)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Realized P/L</span>
          <span
            className={`metric-value ${
              realizedPnl >= 0 ? "pos" : "neg"
            }`}
          >
            {formatCurrency(realizedPnl)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Unrealized P/L</span>
          <span
            className={`metric-value ${
              unrealizedPnl >= 0 ? "pos" : "neg"
            }`}
          >
            {formatCurrency(unrealizedPnl)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Position</span>
          <span className="metric-value">
            {formatNumber(heldQty, 6)} {symbol.replace("USD", "")}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Avg entry</span>
          <span className="metric-value">
            {position && Math.abs(position.quantity) > 0
              ? formatCurrency(position.averagePrice)
              : "—"}
          </span>
        </div>
      </div>
      <div className="trade-form">
        <div className="broker-box">
          <div className="broker-head">
            <span className="metric-label">Broker model</span>
            <span className="panel-sub">
              {brokerLocked ? "locked after first fill" : "select before trading"}
            </span>
          </div>
          <div className="broker-modes" role="radiogroup" aria-label="Broker model">
            {BROKER_MODES.map((mode) => (
              <button
                key={mode.value}
                className={brokerMode === mode.value ? "active" : ""}
                onClick={() => setBrokerMode(mode.value)}
                disabled={isFinished || brokerLocked}
                role="radio"
                aria-checked={brokerMode === mode.value}
                title={mode.description}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div className="broker-summary">
            <span>{broker.commissionRateBps} bps commission</span>
            <span>{broker.spreadBps} bps spread</span>
            <span>{broker.slippageModel.replace("_", " ")}</span>
            <span>{broker.allowShort ? "shorting on" : "long only"}</span>
          </div>
        </div>
        <div className="order-type-row" role="radiogroup" aria-label="Order type">
          <button
            className={orderType === "market" ? "active" : ""}
            onClick={() => setOrderType("market")}
            role="radio"
            aria-checked={orderType === "market"}
            disabled={isFinished}
          >
            Market
          </button>
          <button
            className={orderType === "limit" ? "active" : ""}
            onClick={() => {
              setOrderType("limit");
              if (!limitPrice && tradablePrice) {
                setLimitPrice(String(Math.round(tradablePrice.price)));
              }
            }}
            role="radio"
            aria-checked={orderType === "limit"}
            disabled={isFinished}
          >
            Limit
          </button>
        </div>
        <div className="qty-row">
          <label htmlFor="qty">Qty</label>
          <input
            id="qty"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0.05"
            disabled={isFinished}
          />
          <span className="panel-sub">
            {notionalPrice && Number.isFinite(Number(quantity))
              ? formatCurrency(Number(quantity) * notionalPrice)
              : ""}
          </span>
        </div>
        {orderType === "limit" ? (
          <div className="qty-row">
            <label htmlFor="limit-price">Limit</label>
            <input
              id="limit-price"
              inputMode="decimal"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={tradablePrice ? String(Math.round(tradablePrice.price)) : "0"}
              disabled={isFinished}
            />
            <span className="panel-sub">fills when touched</span>
          </div>
        ) : null}
        <textarea
          className="note-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Decision note: why are you entering, what would invalidate this trade?"
          disabled={isFinished}
        />
        <div className="action-row">
          <button
            className="btn success"
            onClick={() => placeOrder("buy")}
            disabled={isFinished || !tradablePrice}
          >
            Buy
          </button>
          <button
            className="btn danger"
            onClick={() => placeOrder("sell")}
            disabled={isFinished || !tradablePrice || !canSell}
          >
            {heldQty <= 0 && broker.allowShort ? "Short" : "Sell"}
          </button>
        </div>
        {rejectionMessage ? (
          <div className="rejection" role="alert">
            <span>Order rejected: {rejectionMessage}</span>
            <button onClick={clearRejection}>dismiss</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
