import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

interface Currency {
  currencyKey: number;
  code: SupportedCurrencyCodes;
  num: string;
  decimalDigits: number;
  description: string;
}

interface FinancialTransactionType {
  financialTransactionTypeKey: number;
  name: string;
}

interface FinancialBroker {
  financialBrokerKey: number;
  name: string;
}

interface FinancialAssetType {
  name: string;
}

interface FinancialAssetExchange {
  name: string;
  acronym: string;
  alias?: string;
}

interface FinancialAsset {
  financialAssetKey: number;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  symbol: string;
  financialAssetCompanyKey: number;
  financialAssetExchangeKey: number;
  deletedAt?: string;
  currencyKey?: Currency;
  financialAssetTypeKey?: FinancialAssetType;
  logoUrl?: string;
  esgScore?: string;
}

interface Portfolio {
  portfolioKey: number;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  tenantKey: number;
  appuserKey: number;
  balance: string;
  currencyKey: Currency;
  currencyDenominatedBalance: string;
  excluded: boolean;
  favored: boolean;
  deletedAt?: string;
  closed?: boolean;
  refreshedAt?: string;
}

export interface PortfolioTransactionItem {
  itemType?: "TRANSACTION";
  transactionKey: number;
  transactionDate: Date;
  quantity: string;
  currencyKey: Pick<Currency, "code" | "currencyKey">;
  financialTransactionTypeKey: Pick<
    FinancialTransactionType,
    "name" | "financialTransactionTypeKey"
  >;
  financialBrokerKey: Pick<FinancialBroker, "name" | "financialBrokerKey">;
  originalAmount: string;
  originalCurrencyKey: Pick<Currency, "code" | "currencyKey">;
  originalUnitAmount: string;
  settlementUnitAmount: string;
  settlementAmount: string;
  settlementCurrencyKey: Pick<Currency, "code" | "currencyKey">;
  settlementExchangeRate: string;
  appuserUnitAmount: string;
  appuserSettlementAmount: string;
  appuserCurrencyExchangeRate: string;
  feeAmount: string;
  feeCurrencyKey: Pick<Currency, "code" | "currencyKey">;
  notes?: string;
  financialAssetKey: Pick<
    FinancialAsset,
    "name" | "symbol" | "logoUrl" | "esgScore"
  >;
  financialAssetExchangeKey: Pick<FinancialAssetExchange, "name">;
  portfolioKey: Pick<Portfolio, "name" | "portfolioKey">;
}

export interface PortfolioStockSplitItem {
  id: string;
  itemType: "STOCK_SPLIT";
  transactionDate: Date | string;
  financialAssetKey: Pick<
    FinancialAsset,
    "financialAssetKey" | "name" | "symbol" | "logoUrl" | "esgScore"
  >;
  portfolioKey?: Pick<Portfolio, "name" | "portfolioKey">;
  numerator: number;
  denominator: number;
  splitRatio: string;
  editable: false;
}

export type PortfolioTransaction =
  | PortfolioTransactionItem
  | PortfolioStockSplitItem;

export function isStockSplit(
  item: PortfolioTransaction,
): item is PortfolioStockSplitItem {
  return item.itemType === "STOCK_SPLIT";
}

export function isTransactionItem(
  item: PortfolioTransaction,
): item is PortfolioTransactionItem {
  return !isStockSplit(item);
}
