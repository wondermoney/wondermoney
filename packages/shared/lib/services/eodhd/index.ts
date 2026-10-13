import { EODHDClient, EODHDError, EODHDRateLimitError } from 'eodhd';
import type {
  DateRange,
  DividendDataPoint,
  EodDataPoint,
  EodParams,
  RealTimeQuote,
  ScreenerItem,
  ScreenerParams,
  SearchParams,
  SearchResult,
} from 'eodhd';

export class EodhdError extends Error {
  constructor(
    message: string,
    public code: string,
    public status?: number,
    public original?: Error,
    // EODHD's rate-limit errors carry a retryAfter hint the provider itself
    // computed (unlike FMP, which never exposes its window) — worth keeping
    // on the wrapper error rather than making callers reach into `original`.
    public retryAfter?: number,
  ) {
    super(message);
    this.name = 'EodhdError';
  }
}

export interface EodhdConfig {
  apiKey?: string;
  baseUrl?: string;
  debug?: boolean;
}

export class Eodhd {
  private readonly client: EODHDClient;
  private readonly debug: boolean;

  constructor(config: EodhdConfig = {}) {
    const apiKey = config.apiKey || process.env.EODHD_API_KEY;
    if (!apiKey) {
      throw new EodhdError('Missing EODHD API key', 'NO_API_KEY');
    }
    this.debug = config.debug || false;

    this.client = new EODHDClient({ apiToken: apiKey, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}) });
    this.debug && console.info('📈 EODHD client initialized');
  }

  private handleError(error: unknown): EodhdError {
    if (error instanceof EODHDError) {
      const retryAfter = error instanceof EODHDRateLimitError ? error.retryAfter : undefined;
      return new EodhdError(error.message, error.code, error.statusCode, error, retryAfter);
    }
    const baseError = error as Error;
    return new EodhdError(baseError?.message || 'Unknown error', 'unknown', undefined, baseError);
  }

  /** End-of-day historical prices. @see https://eodhd.com/financial-apis/api-for-historical-data-and-volumes/ */
  async getEndOfDayPrices(ticker: string, params?: EodParams): Promise<EodDataPoint[]> {
    try {
      return await this.client.eod(ticker, params);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /** Live quote, delayed 15-20 min. @see https://eodhd.com/financial-apis/live-realtime-stocks-api/ */
  async getQuote(ticker: string): Promise<RealTimeQuote> {
    try {
      return await this.client.realTime(ticker);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /** Historical dividends. @see https://eodhd.com/financial-apis/api-splits-dividends/ */
  async getDividends(ticker: string, params?: DateRange): Promise<DividendDataPoint[]> {
    try {
      return await this.client.dividends(ticker, params);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /** Historical stock splits. @see https://eodhd.com/financial-apis/api-splits-dividends/ */
  async getSplits(ticker: string, params?: DateRange) {
    try {
      return await this.client.splits(ticker, params);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /** Search stocks/ETFs/funds/bonds/indices/crypto by name, symbol, or ISIN. */
  async search(query: string, params?: SearchParams): Promise<SearchResult[]> {
    try {
      return await this.client.search(query, params);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /** Screen stocks by financial filters and signals. @see https://eodhd.com/financial-apis/stock-market-screener-api/ */
  async getScreener(params?: ScreenerParams): Promise<ScreenerItem[]> {
    try {
      const { data } = await this.client.screener(params);
      return data;
    } catch (error) {
      throw this.handleError(error);
    }
  }
}

export default Eodhd;
