import type { EntityManager } from '@mikro-orm/postgresql';
import { subDays } from 'date-fns';

import { sqlQuery, toDate } from '@app/database/sql';

import { type MarketDataProviderStatus, marketDataProviderStatus } from './registry';

export interface MarketDataSourcesReport {
  providers: MarketDataProviderStatus[];
  recent: { days: number; sources: RecentPriceSource[] };
}

export interface RecentPriceSource {
  /** Distinct assets priced by it. */
  assets: number;
  /** Its newest stored price. */
  latest: Date;
  /** Prices it stored in the window. */
  prices: number;
  /** The provider id; null for prices stored before sources were recorded. */
  source: null | string;
}

/**
 * Where this server's recent market prices came from, per provider, for operators: the listed
 * providers and how many prices each stored in the last `days`. Shared catalogue data, no tenant.
 * The window keeps it on the `(date, financial_asset_key)` primary key.
 */
export async function getMarketDataSources(em: EntityManager, options: { days?: number; now?: Date } = {}): Promise<MarketDataSourcesReport> {
  const days = options.days ?? 7;
  const rows = (await sqlQuery(em)
    .selectFrom('financial_asset_price')
    .select((eb) => [
      'source',
      eb.fn.countAll().as('prices'),
      eb.fn.count('financial_asset_key').distinct().as('assets'),
      eb.fn.max('date').as('latest'),
    ])
    .where('date', '>=', subDays(options.now ?? new Date(), days))
    .groupBy('source')
    .orderBy('source')
    .execute()) as { assets: number | string; latest: Date | string; prices: number | string; source: null | string }[];
  return {
    providers: marketDataProviderStatus(),
    recent: {
      days,
      sources: rows.map((row) => ({ assets: Number(row.assets), latest: toDate(row.latest), prices: Number(row.prices), source: row.source })),
    },
  };
}
