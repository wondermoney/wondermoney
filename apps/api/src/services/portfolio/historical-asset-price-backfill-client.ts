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
