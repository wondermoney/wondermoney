import type { Enqueue, EnqueueExecutionOptions } from '@service/queue/enqueue';
import { QUEUE_REGISTRY } from '@service/queue/queues';

export const HISTORICAL_ASSET_PRICE_BACKFILL_QUEUE = 'asset-price.historical-backfill';
export const HISTORICAL_ASSET_PRICE_BACKFILL_OPERATION_TYPE = 'asset-price.historical-backfill';

/**
 * An unset `policy` means pg-boss's `standard` — no concurrency constraint at
 * all. Every queue in this system declares one. `singleton`
 * caps the queue at one *active* job, which is the shape this work actually has:
 * a bulk provider fetch that should not run twice over the same portfolio, and
 * that already runs one-at-a-time under `batchSize: 1` on a single worker — the
 * declaration is what makes that survive a second worker replica.
 *
 * `expireInSeconds` is explicit because a historical backfill can legitimately
 * run for many minutes and the 900 s default is not obviously enough; 1 h is.
 */
export const ensureHistoricalAssetPriceBackfillQueue = (boss: { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown> }) =>
  boss.createQueue(HISTORICAL_ASSET_PRICE_BACKFILL_QUEUE, {
    expireInSeconds: 3_600,
    policy: 'singleton',
    retryLimit: 0,
  });

QUEUE_REGISTRY.set(HISTORICAL_ASSET_PRICE_BACKFILL_QUEUE, { ensure: ensureHistoricalAssetPriceBackfillQueue, name: HISTORICAL_ASSET_PRICE_BACKFILL_QUEUE });

/**
 * Enqueues a backfill keyed on the portfolio, so a user who triggers an import
 * twice gets one job rather than two racing ones.
 *
 * The helper optionally accepts a caller-side execution deadline; it is not a
 * pg-boss send option and is never passed as part of the job payload.
 */
export const enqueueHistoricalAssetPriceBackfillJob = (
  enqueue: Enqueue,
  payload: Record<string, unknown> & { portfolioId?: number },
  execution?: EnqueueExecutionOptions,
) => enqueue.send(
  HISTORICAL_ASSET_PRICE_BACKFILL_QUEUE,
  payload,
  { singletonKey: `${HISTORICAL_ASSET_PRICE_BACKFILL_QUEUE}:portfolio:${payload.portfolioId ?? 'unknown'}` },
  execution,
);
