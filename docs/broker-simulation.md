# Broker Simulation

## Purpose

Market Time Machine should simulate trading as a broker-like experience, not as a perfect-price toy.

The execution engine must make trading decisions feel financially realistic while staying understandable and configurable.

## Simulation Modes

### Ideal Mode

Best for beginners and educational demos.

Characteristics:

- Simple fills
- Low or no fees
- Minimal slippage
- Clear explanations

### Realistic Mode

Best default for serious users.

Characteristics:

- Commission
- Spread
- Slippage
- Fractional constraints
- Market hours
- Cash and margin checks

### Harsh Mode

Best for professional training and stress testing.

Characteristics:

- Higher slippage
- Partial fills
- Volatility-aware execution
- Margin calls
- Borrow costs
- Liquidity constraints

## Order Types

Recommended order support:

- Market order
- Limit order
- Stop order
- Stop loss
- Take profit
- Trailing stop
- Bracket order
- Close position
- Partial close

Minimum viable professional set:

- Market
- Limit
- Stop loss
- Take profit

## Core Types

```ts
type Order = {
  id: string;
  sessionId: string;
  createdAt: string;
  symbol: string;
  side: "buy" | "sell" | "short" | "cover";
  type: "market" | "limit" | "stop" | "stop_loss" | "take_profit" | "trailing_stop";
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  trailingAmount?: number;
  timeInForce: "day" | "gtc" | "ioc";
  status: "pending" | "filled" | "partially_filled" | "cancelled" | "rejected" | "expired";
  note?: string;
};
```

```ts
type Fill = {
  id: string;
  orderId: string;
  time: string;
  symbol: string;
  side: Order["side"];
  quantity: number;
  price: number;
  commission: number;
  slippage: number;
  spreadCost: number;
};
```

```ts
type Position = {
  symbol: string;
  quantity: number;
  averagePrice: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
};
```

## Execution Model

```ts
type ExecutionModel = {
  commissionRateBps: number;
  fixedFee: number;
  spreadBps: number;
  slippageModel: "none" | "fixed_bps" | "volume_based" | "volatility_based";
  allowFractional: boolean;
  allowShort: boolean;
  maxLeverage: number;
  partialFills: boolean;
  marketHoursEnforced: boolean;
};
```

## Fill Price

For a buy market order:

```text
referencePrice = last visible tradable price
spreadCost = referencePrice * spreadBps / 10000
slippage = model(referencePrice, quantity, volume, volatility)
fillPrice = referencePrice + spreadCost + slippage
```

For a sell market order:

```text
fillPrice = referencePrice - spreadCost - slippage
```

## Liquidity and Volume

For realistic and harsh modes, order size should matter.

Possible rule:

```text
if order notional > maxParticipationRate * candleVolumeNotional:
  fill partially or apply larger slippage
```

This prevents unrealistic large trades in low-liquidity historical periods.

## Margin and Leverage

Professional mode should support:

- Cash account
- Margin account
- Long-only rules
- Short selling rules
- Maximum leverage
- Maintenance margin
- Forced liquidation
- Borrow cost

Example:

```ts
type MarginPolicy = {
  initialMarginRate: number;
  maintenanceMarginRate: number;
  liquidationThreshold: number;
  borrowRateBps: number;
};
```

## Market Hours

Different asset classes need different calendars.

Crypto:

- 24/7

US equities:

- Regular session
- Optional premarket and after-hours
- Exchange holidays

FX:

- Weekday global sessions
- Weekend gaps

The replay engine and execution engine should both know whether the instrument is tradable at `currentTime`.

## Corporate Actions

Equity simulations must account for:

- Splits
- Reverse splits
- Dividends
- Symbol changes
- Delistings

Chart display and portfolio accounting may need different price series:

- Raw historical prices for realistic visual experience
- Adjusted prices for benchmark calculations
- Corporate action events for position adjustments

## Rejection Reasons

Orders should be rejected with explicit reasons:

- Insufficient cash
- Insufficient position
- Market closed
- Quantity below lot size
- Exceeds leverage
- Exceeds liquidity limit
- Shorting disabled
- Instrument not tradable

## Design Principle

Broker realism should be configurable, not hidden.

Users should know whether they are playing with idealized fills or professional-grade execution constraints.

