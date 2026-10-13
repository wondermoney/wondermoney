export enum FinancialTransactionType {
  BUY = 'BUY',
  SELL = 'SELL',
  DIVIDEND = 'DIVIDEND',
  WITHDRAWAL = 'WITHDRAWAL',
  DEPOSIT = 'DEPOSIT',
  OFFER = 'OFFER',
}

// Some have symbol but not name. Crypto doesnt have an exchange in the sense of a stock exchange, but we use the broker name.
export interface FinancialTransaction {
  transactionDate: Date;
  assetName?: string;
  brokerAssetName?: string;
  brokerTicker?: string;
  isin?: string;
  brokerExchange?: string;
  assetSymbol: string;
  exchange?: string;
  exchangeAlias?: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  totalLocalPrice?: number;
  totalPrice: number;
  exchangeRate?: number;
  financialTransactionType?: FinancialTransactionType;
  externalTransactionId?: string;
  internalTransactionId: string;
  feeAmount?: number;
  feeCurrency?: string;
  notes?: string;
}

export type FinancialTransactionsParserResult = Array<FinancialTransaction>;

export const SUPPORTED_BROKERS_CSV_IMPORT = [
  'degiro',
  'ikbr',
  'trading212',
  'coinbase',
] as const;
export type SupportedBroker = (typeof SUPPORTED_BROKERS_CSV_IMPORT)[number];
