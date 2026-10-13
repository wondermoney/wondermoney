export const ASSET_PRICE_REFRESH_QUEUE = 'asset-price.refresh';
export const ASSET_PRICE_REFRESH_CRON = '0 3 * * 1-5';
export const ASSET_PRICE_REFRESH_SINGLETON_KEY = 'asset-price.refresh';

export const ensureAssetPriceRefreshQueue = (boss: { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown> }) =>
  boss.createQueue(ASSET_PRICE_REFRESH_QUEUE, {
    policy: 'exclusive',
    retryLimit: 0,
  });

export const scheduleAssetPriceRefreshJob = (boss: { schedule: (name: string, cron: string, data?: null | Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> }) =>
  boss.schedule(ASSET_PRICE_REFRESH_QUEUE, ASSET_PRICE_REFRESH_CRON, {}, { key: ASSET_PRICE_REFRESH_SINGLETON_KEY, singletonKey: ASSET_PRICE_REFRESH_SINGLETON_KEY, tz: 'UTC' });
