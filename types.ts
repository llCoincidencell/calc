export interface Transaction {
  id: string;
  symbol: string;
  price: number;
  quantity: number;
  timestamp: number;
  isActive?: boolean;
  type: 'BUY' | 'SELL'; // Added type distinction
}

export interface PortfolioSummary {
  totalQuantity: number;
  totalCost: number;
  averageCost: number;
}

export interface SimulationResult {
  currentValue: number;
  profitOrLossTotal: number;
  profitOrLossPerShare: number;
  percentageChange: number;
  status: 'PROFIT' | 'LOSS' | 'NEUTRAL';
}