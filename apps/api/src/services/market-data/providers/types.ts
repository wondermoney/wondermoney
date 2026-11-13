import type { MarketDataProviderId } from '@config/market-data-providers';

export type { MarketDataProviderId } from '@config/market-data-providers';

/**
 * What a market-data provider can be asked. Fundamentals are not here: no provider on this
 * server serves them (`controller/financial-markets.ts` answers those routes with a 404).
 */
export const MARKET_DATA_CAPABILITIES = ['search', 'quote', 'dailyHistory', 'dividends', 'splits'] as const;

export type MarketDataCapability = (typeof MARKET_DATA_CAPABILITIES)[number];

/*
 * The shapes below are EODHD's, field for field, because every caller was written against them
 * and EODHD stays the default provider: its adapter passes its answers through untouched. Another
 * adapter fills in what its source has and leaves the rest null.
 */

/** A security a search found. `Code` is the symbol and `Exchange` its exchange code. */
export interface SecurityMatch {
  Code: string;
  Country: string;
  Currency: string;
  Exchange: string;
  ISIN: string;
  Name: string;
  Type: string;
}

/** The latest price. `timestamp` is in Unix seconds; `change_p` is a percentage. */
export interface MarketQuote {
  change: null | number;
  change_p: null | number;
  close: null | number;
  code: string;
  high: null | number;
  low: null | number;
  open: null | number;
  previousClose: null | number;
  timestamp: null | number;
  volume: null | number;
}

/** One trading day. `date` is `YYYY-MM-DD`. */
export interface DailyBar {
  adjusted_close: null | number;
  close: number;
  date: string;
  high: null | number;
  low: null | number;
  open: null | number;
  volume: null | number;
}

/** A dividend per share, in the security's currency. */
export interface DividendEvent {
  currency?: string;
  date: string;
  declarationDate?: string;
  paymentDate?: string;
  period?: string;
  recordDate?: string;
  unadjustedValue?: number;
  value: number;
}

/** A split, `split` as `"new/old"` (`"4/1"` for four-for-one). */
export interface SplitEvent {
  date: string;
  split: string;
}

/** `YYYY-MM-DD` bounds, both inclusive and both optional. */
export interface DateRange {
  from?: string;
  to?: string;
}

/**
 * One market-data source. It declares what it can be asked (`capabilities`, each with its method)
 * and which symbols it knows (`covers`); the registry skips it for anything else. A method answers
 * with an empty list or a quote without a price when the provider has nothing for the symbol, and
 * throws when the provider failed.
 */
export interface MarketDataProvider {
  readonly capabilities: readonly MarketDataCapability[];
  /** Whether a symbol is one this provider prices (its exchanges, its asset class). */
  covers(symbol: string): boolean;
  dailyHistory?(symbol: string, range: DateRange): Promise<DailyBar[]>;
  dividends?(symbol: string, range?: DateRange): Promise<DividendEvent[]>;
  readonly id: MarketDataProviderId;
  /** Whether it can run on this server: EODHD needs `EODHD_API_KEY`, the free providers nothing. */
  isConfigured(): boolean;
  /** How people see the provider's name. */
  readonly label: string;
  quote?(symbol: string): Promise<MarketQuote>;
  search?(query: string): Promise<SecurityMatch[]>;
  splits?(symbol: string, range?: DateRange): Promise<SplitEvent[]>;
}
