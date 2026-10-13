import type { Job } from 'pg-boss';

import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { isMarketDataEnabled } from '@service/market-data/eodhd.service';
import backgroundOperationService from '@service/operations/background-operation.service';
import historicalAssetPriceBackfillService from '@service/portfolio/historical-asset-price-backfill.service';

import { HISTORICAL_ASSET_PRICE_BACKFILL_OPERATION_TYPE } from './historical-asset-price-backfill.queue';

function isDuplicate(error: unknown) {
  const err = error as { cause?: { code?: unknown }; code?: unknown; constructor?: { name?: string }; name?: unknown };
  return err.code === '23505' || err.name === 'UniqueConstraintViolationException' || err.constructor?.name === 'UniqueConstraintViolationException' || err.cause?.code === '23505';
}

export const handleHistoricalAssetPriceBackfillJob = async (
  job: Job<{ correlationId?: string; items?: never[]; portfolioId?: number }>,
  deps: { backgroundOperationService?: typeof backgroundOperationService; historicalAssetPriceBackfillService?: typeof historicalAssetPriceBackfillService } = {},
) => {
  // No market-data provider configured: there is no price history to fetch.
  if (!isMarketDataEnabled()) return false;
  const bg = deps.backgroundOperationService ?? backgroundOperationService;
  const correlationId = job.data.correlationId ?? `asset-price.historical-backfill:${job.id}`;
  try { await bg.createQueuedOperation({ correlationId, operationType: HISTORICAL_ASSET_PRICE_BACKFILL_OPERATION_TYPE, resourceId: `portfolio:${job.data.portfolioId ?? 'unknown'}`, retryable: false }); } catch (error) { if (!isDuplicate(error)) throw error; }
  const claimed = await bg.claimJobStart(correlationId, job.id); if (!claimed) return false;
  await bg.attachQueueJob(correlationId, job.id);
  try {
    await bg.heartbeatJob(correlationId, job.id, { stage: 'asset-price.historical-backfill:running' });
    const result = await (deps.historicalAssetPriceBackfillService ?? historicalAssetPriceBackfillService).backfillHistoricalAssetPrices(job.data as unknown as Parameters<typeof historicalAssetPriceBackfillService.backfillHistoricalAssetPrices>[0]);
    await bg.heartbeatJob(correlationId, job.id, { progress: result as unknown as Record<string, unknown>, stage: 'asset-price.historical-backfill:completed' });
    const status = result.failed > 0 ? (result.inserted + result.skipped > 0 ? BackgroundOperationStatus.PARTIAL : BackgroundOperationStatus.FAILED) : BackgroundOperationStatus.SUCCEEDED;
    const stage = status === BackgroundOperationStatus.SUCCEEDED ? 'asset-price.historical-backfill:succeeded' : status === BackgroundOperationStatus.PARTIAL ? 'asset-price.historical-backfill:partial' : 'asset-price.historical-backfill:failed';
    const finished = await bg.finishJob(correlationId, job.id, { retryable: false, stage, status });
    if (!finished) throw new Error('asset-price.historical-backfill job failed to finish');
    return true;
  } catch (error) {
    const finished = await bg.finishJob(correlationId, job.id, { retryable: false, stage: 'asset-price.historical-backfill:failed', status: BackgroundOperationStatus.FAILED });
    if (!finished) throw new Error('asset-price.historical-backfill job failed to finish');
    throw error;
  }
};
