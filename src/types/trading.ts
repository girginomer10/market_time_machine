export type OrderSide = "buy" | "sell";

export type OrderType = "market" | "limit" | "stop_loss" | "take_profit";

export type TimeInForce = "day" | "gtc";

export type OrderStatus =
  | "pending"
  | "filled"
  | "partially_filled"
  | "cancelled"
  | "rejected"
  | "expired";

export type Order = {
  id: string;
  createdAt: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: number;
  triggerPrice?: number;
  ocoGroupId?: string;
  timeInForce?: TimeInForce;
  expiresAt?: string;
  remainingQuantity?: number;
  filledQuantity?: number;
  averageFillPrice?: number;
  rejectionCode?: string;
  triggeredAt?: string;
  closedAt?: string;
  status: OrderStatus;
  rejectionReason?: string;
  note?: string;
};

export type FillReason =
  | "user_order"
  | "working_order"
  | "forced_liquidation"
  | "borrow_cost";

export type ExecutionPriceSource =
  | "market"
  | "limit"
  | "stop_trigger"
  | "gap_open"
  | "forced_liquidation"
  | "financing";

export type Fill = {
  id: string;
  orderId: string;
  time: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  referencePrice: number;
  commission: number;
  spreadCost: number;
  slippage: number;
  totalCost: number;
  reason?: FillReason;
  liquidityParticipation?: number;
  executionPriceSource?: ExecutionPriceSource;
  forcedLiquidation?: boolean;
  note?: string;
};

export type Position = {
  symbol: string;
  quantity: number;
  averagePrice: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
};

export type PortfolioSnapshot = {
  time: string;
  cash: number;
  positionsValue: number;
  totalValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  feesPaid: number;
  slippagePaid: number;
  financingPaid?: number;
};

export type MarginSnapshot = {
  cash: number;
  positionsGrossNotional: number;
  positionsNetValue: number;
  equity: number;
  initialMarginRequirement: number;
  maintenanceMarginRequirement: number;
  liquidationLevel: number;
  excessEquity: number;
  marginUtilization: number;
  isMarginCall: boolean;
  requiresLiquidation: boolean;
};

export type RiskSnapshot = {
  buyingPower: number;
  leverage: number;
  exposurePct: number;
  liquidationWarning: boolean;
};

export type AuditEventType =
  | "replay_step"
  | "order_placed"
  | "order_rejected"
  | "order_cancelled"
  | "order_updated"
  | "fill"
  | "margin_call"
  | "forced_liquidation"
  | "borrow_cost"
  | "tif_expired";

export type AuditEvent = {
  id: string;
  time: string;
  type: AuditEventType;
  message: string;
  orderId?: string;
  fillId?: string;
  symbol?: string;
};

export type JournalEntry = {
  id: string;
  time: string;
  fillId?: string;
  note: string;
  symbol?: string;
};
