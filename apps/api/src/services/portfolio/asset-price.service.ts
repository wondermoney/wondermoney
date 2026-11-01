import { subDays } from 'date-fns';
import { sql } from 'kysely';

import { DI } from '@app/database/di';
import { sqlQuery, toDate } from '@app/database/sql';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetPrice } from '@entity/FinancialAssetPrice';

import eodhdClient from '../market-data/eodhd.service';

/**
 * Service for managing asset prices and EODHD API integration
 */
class AssetPriceService {
  private eodhd = eodhdClient;

  /**
   * Get current asset prices from database
   * @returns Array of asset prices with latest dates
   */
  async getCurrentAssetPrices(): Promise<
    {
      date: Date;
      financial_asset_key: number;
      price: number;
    }[]
  > {
    const prices = await sqlQuery(DI.em)
      .with('latest_prices', (db) =>
        db
          .selectFrom('financial_asset_price')
          .select(['financial_asset_key', sql<Date | string>`MAX(date)`.as('date')])
          .groupBy('financial_asset_key'))
      .selectFrom('financial_asset_price')
      .innerJoin('latest_prices', (join) =>
        join
          .onRef('financial_asset_price.financial_asset_key', '=', 'latest_prices.financial_asset_key')
          .onRef('financial_asset_price.date', '=', 'latest_prices.date'))
      .select(['latest_prices.financial_asset_key', 'latest_prices.date', 'financial_asset_price.price'])
      .execute();
    return prices.map((row) => ({
      date: toDate(row.date),
      financial_asset_key: row.financial_asset_key as number,
      price: row.price as number,
    }));
  }

  /**
   * Check if asset has recent price data
   * @param financialAsset - Financial asset entity
   * @param daysThreshold - Number of days to look back (default: 5)
   * @returns True if recent price exists
   */
  async hasRecentAssetPrice(financialAsset: FinancialAsset, daysThreshold = 5): Promise<boolean> {
    const recentPrice = await DI.em.findOne(FinancialAssetPrice, {
      date: {
        $gte: subDays(new Date(), daysThreshold),
      },
      financialAssetKey: financialAsset,
    });
    return !!recentPrice;
  }

  /**
   * Return the set of financial asset keys that already have a price within the given window.
   * Used to skip assets that don't need refreshing, in a single query rather than one per asset.
   * @param days - Freshness window in days (default: 1)
   */
  async getRecentlyPricedAssetKeys(days = 1): Promise<Set<number>> {
    const rows = await sqlQuery(DI.em)
      .selectFrom('financial_asset_price')
      .select('financial_asset_key')
      .distinct()
      .where('date', '>=', subDays(new Date(), days))
      .execute();
    return new Set(rows.map((row) => row.financial_asset_key as number));
  }

  /**
   * Fetch and save asset price from EODHD API.
   * Returns null (rather than persisting a NULL price, which violates the not-null constraint)
   * when the provider has no usable price/timestamp for the symbol.
   * @param financialAsset - Financial asset entity
   * @returns Saved asset price entity, or null when the provider returned no usable price
   */
  async fetchAndSaveAssetPrice(financialAsset: FinancialAsset): Promise<FinancialAssetPrice | null> {
    const quote = await this.eodhd.getQuote(financialAsset.symbol);
    // EODHD's declared type promises `close`/`timestamp`/`volume` are always numbers, but the
    // live API can still omit or null them for thinly-traded/delisted symbols — widen to `unknown`
    // so these defensive checks are real guards rather than lint-flagged dead conditions.
    const close: unknown = quote.close;
    const timestamp: unknown = quote.timestamp;
    const volume: unknown = quote.volume;
    const price = Number(close);
    if (close === null || close === undefined || !Number.isFinite(price)) {
      return null;
    }
    if (timestamp === null || timestamp === undefined || !Number.isFinite(Number(timestamp))) {
      return null;
    }
    return DI.em.upsert(FinancialAssetPrice, {
      date: new Date(Number(timestamp) * 1000),
      financialAssetKey: financialAsset,
      price,
      volume: Number.isFinite(Number(volume)) ? Number(volume) : 0,
    });
  }

  /**
   * Ensure asset has recent price, fetching from EODHD if needed
   * @param financialAsset - Financial asset entity
   * @param daysThreshold - Number of days to consider "recent"
   */
  async ensureRecentAssetPrice(financialAsset: FinancialAsset, daysThreshold = 5): Promise<void> {
    const hasRecent = await this.hasRecentAssetPrice(financialAsset, daysThreshold);
    if (!hasRecent) {
      await this.fetchAndSaveAssetPrice(financialAsset);
    }
  }

  /**
   * Get historical prices for performance calculation
   * @param appuserKey - User identifier
   * @param fromDate - Optional start date filter
   * @returns Array of historical price data
   */
  async getHistoricalPrices(
    appuserKey: string,
    fromDate?: Date,
  ): Promise<
    {
      date: Date;
      financial_asset_key: number;
      price: number;
      quantity: number;
    }[]
  > {
    const rows = await sqlQuery(DI.em)
      .selectFrom('financial_asset_price as fap')
      .innerJoin('financial_transaction as ft', 'fap.financial_asset_key', 'ft.financial_asset_key')
      .select(['fap.financial_asset_key', 'fap.date', 'fap.price', 'ft.quantity'])
      .where('ft.appuser_key', '=', appuserKey)
      .$if(Boolean(fromDate), (query) => query.where('fap.date', '>=', fromDate))
      .orderBy('fap.date', 'asc')
      .execute();
    return rows.map((row) => ({
      date: toDate(row.date as Date | string),
      financial_asset_key: row.financial_asset_key as number,
      price: row.price as number,
      quantity: row.quantity as number,
    }));
  }
  /**
   * Fetch historical prices for an index/benchmark from EODHD
   * @param symbol - Index symbol (e.g., '^GSPC' for S&P 500)
   * @param from - Start date (yyyy-MM-dd)
   * @param to - End date (yyyy-MM-dd)
   * @returns Array of date/value pairs
   */
  async getBenchmarkHistoricalPrices(
    symbol: string,
    from: string,
    to: string,
  ): Promise<{ date: string; value: number }[]> {
    try {
      // EODHD indices use a `.INDX` suffix (e.g. GSPC.INDX for the S&P 500) rather
      // than the caret prefix (^GSPC) callers of this method pass; translate at the
      // boundary rather than pushing this knowledge up into every caller.
      const eodhdSymbol = symbol.startsWith('^') ? `${symbol.slice(1)}.INDX` : symbol;
      const rows = await this.eodhd.getEndOfDayPrices(eodhdSymbol, { from, to });
      return rows
        .filter((row) => typeof row.date === 'string' && typeof row.close === 'number')
        .map((row) => ({ date: row.date, value: row.close }))
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      return [];
    }
  }
}

export default new AssetPriceService();
