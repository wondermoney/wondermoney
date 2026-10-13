import { enqueueHistoricalAssetPriceBackfillJob } from '@app/jobs/historical-asset-price-backfill.queue';
import type { Enqueue } from '@service/queue/enqueue';
import logger from '@utils/logger';

export interface HistoricalAssetPriceBackfillItem {
  earliestTransactionDate?: string;
  financialAssetId: number;
  financialAssetKey?: number;
  symbol: string;
  transactionDate?: string;
}

export interface HistoricalAssetPriceBackfillRequest {
  items: HistoricalAssetPriceBackfillItem[];
  portfolioId: number;
}

export function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const correlationId = () => `asset-price.historical-backfill:${Date.now()}:${Math.random().toString(16).slice(2)}`;

interface HistoricalAssetPriceBackfillTriggerOptions {
  enqueue: Enqueue;
  throwOnFailure?: boolean;
}

/**
 * Triggers the historical price backfill over pg-boss.
 *
 * There used to be `lambda` and `http` runners here, selected by
 * `HISTORICAL_ASSET_PRICE_BACKFILL_RUNNER`, which POSTed the request to
 * `HISTORICAL_ASSET_PRICE_BACKFILL_URL` instead of enqueuing it. Both are gone, because the
 * host that variable pointed at does not exist: `wm-asset-prices-historical-{production,staging}
 * .wonder.money` resolve on no nameserver — checked against Cloudflare and Google, with
 * `api.wonder.money` as a control. Neither environment selected those runners either
 * (prod-worker's value was empty, staging's was `pgboss`, and both mean pg-boss), so the
 * branches were unreachable *and* pointed nowhere.
 *
 * The worker that drains this queue is `jobs/historical-asset-price-backfill.worker.ts` and is
 * unaffected.
 */
class HistoricalAssetPriceBackfillClient {
  async trigger(
    request: HistoricalAssetPriceBackfillRequest,
    options: HistoricalAssetPriceBackfillTriggerOptions,
  ): Promise<void> {
    try {
      // Timeout is an unknown-acceptance outcome. Never retry automatically: the
      // queue may have accepted work even though the caller deadline elapsed.
      await enqueueHistoricalAssetPriceBackfillJob(options.enqueue, { ...request, correlationId: correlationId() }, { timeoutMs: 7_000 });
    } catch (error) {
      logger.warn({ error, portfolioId: request.portfolioId }, 'Historical asset price backfill enqueue failed');
      if (options.throwOnFailure) throw error;
    }
  }
}

export default new HistoricalAssetPriceBackfillClient();
