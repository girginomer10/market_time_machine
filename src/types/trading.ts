export type OrderSide = "buy" | "sell";

export type OrderType = "market" | "limit" | "stop_loss" | "take_profit";

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
  status: OrderStatus;
  rejectionReason?: string;
  note?: string;
};

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
};

export type JournalEntry = {
  id: string;
  time: string;
  fillId?: string;
  note: string;
  symbol?: string;
};
