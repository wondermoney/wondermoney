export const EXCHANGE_RATE_REFRESH_QUEUE = 'exchange-rate.refresh';
export const EXCHANGE_RATE_REFRESH_CRON = '30 17 * * 1-5';
export const EXCHANGE_RATE_REFRESH_SINGLETON_KEY = 'exchange-rate.refresh';

// `retryLimit` was 0, so a single ECB blip lost the whole weekday's rates until the next
// run — and multi-currency balances drift silently in the meantime. The insert is
// `on conflict ... ignore`, so re-running is free; see the worker for why the operation
// row must also be reset for a retry to actually execute.
export const ensureExchangeRateRefreshQueue = (boss: { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown> }) => boss.createQueue(EXCHANGE_RATE_REFRESH_QUEUE, { expireInSeconds: 900, policy: 'exclusive', retryBackoff: true, retryDelay: 300, retryLimit: 2 });
export const scheduleExchangeRateRefreshJob = (boss: { schedule: (name: string, cron: string, data?: null | Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> }) => boss.schedule(EXCHANGE_RATE_REFRESH_QUEUE, EXCHANGE_RATE_REFRESH_CRON, {}, { key: EXCHANGE_RATE_REFRESH_SINGLETON_KEY, singletonKey: EXCHANGE_RATE_REFRESH_SINGLETON_KEY, tz: 'UTC' });
