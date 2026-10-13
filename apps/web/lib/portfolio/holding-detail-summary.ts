import {
  isTransactionItem,
  type PortfolioTransaction,
} from "@/lib/api/portfolio/portfolioTransactionTypes";
import type { PortfolioHolding } from "@/lib/api/portfolio/usePortfoliosHoldings";

export interface HoldingPositionSummary {
  symbol: string;
  name: string;
  type: string;
  logoUrl?: string;
  currency: string;
  quantity: number;
  averageCost: number;
  investedAmount: number;
  currentPrice: number | null;
  currentValue: number | null;
  unrealizedGains: number | null;
  unrealizedGainsPercentage: number | null;
  portfolioWeight: number | null;
  isInvalid?: boolean;
  invalidReason?: string | null;
}

export interface HoldingActivitySummary {
  transactionCount: number;
  firstTransactionDate: Date | null;
  lastTransactionDate: Date | null;
  totalBought: number;
  totalSold: number;
  dividendsReceived: number;
  netInvested: number;
}

const parseAmount = (value: unknown): number => {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseSettlementAmount = (
  appuserSettlementAmount: unknown,
  settlementAmount: unknown,
): number => {
  const fallback =
    appuserSettlementAmount === null ||
    appuserSettlementAmount === undefined ||
    appuserSettlementAmount === ""
      ? settlementAmount
      : appuserSettlementAmount;
  return parseAmount(fallback);
};

const normalizeType = (value: unknown): string =>
  String(value ?? "").trim().toLowerCase();

export function buildHoldingPositionSummary(
  holding: PortfolioHolding,
): HoldingPositionSummary {
  const holdingWithDetails = holding as PortfolioHolding & {
    financialAssetSymbol?: string;
    financialAssetName?: string;
    financialAssetType?: string;
    financialAssetLogoUrl?: string;
  };
  return {
    symbol: holdingWithDetails.financialAssetSymbol,
    name: holdingWithDetails.financialAssetName,
    type: holdingWithDetails.financialAssetType,
    logoUrl: holdingWithDetails.financialAssetLogoUrl,
    currency: holding.currency,
    quantity: holding.quantity,
    averageCost: holding.averageBuyPrice,
    investedAmount: holding.quantity * holding.averageBuyPrice,
    currentPrice: holding.currentPrice,
    currentValue: holding.currentValue,
    unrealizedGains: holding.unrealizedGains,
    unrealizedGainsPercentage: holding.unrealizedGainsPercentage,
    portfolioWeight: holding.allocation,
    isInvalid: holding.isInvalid,
    invalidReason: holding.invalidReason,
  };
}

export function buildHoldingActivitySummary(
  transactions: PortfolioTransaction[],
): HoldingActivitySummary {
  let totalBought = 0;
  let totalSold = 0;
  let dividendsReceived = 0;

  const dates = transactions.map((item) => new Date(item.transactionDate).getTime());
  for (const item of transactions) {
    if (!isTransactionItem(item)) continue;
    const amount = parseSettlementAmount(
      item.appuserSettlementAmount,
      item.settlementAmount,
    );
    const type = normalizeType(item.financialTransactionTypeKey.name);
    if (type === "buy") totalBought += amount;
    else if (type === "sell") totalSold += Math.abs(amount);
    else if (type === "dividend") dividendsReceived += amount;
  }

  return {
    transactionCount: transactions.length,
    firstTransactionDate: dates.length ? new Date(Math.min(...dates)) : null,
    lastTransactionDate: dates.length ? new Date(Math.max(...dates)) : null,
    totalBought,
    totalSold,
    dividendsReceived,
    netInvested: totalBought - totalSold,
  };
}
