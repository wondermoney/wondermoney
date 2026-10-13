import type { Job } from 'pg-boss';

import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { isMarketDataEnabled } from '@service/market-data/eodhd.service';
import backgroundOperationService from '@service/operations/background-operation.service';
import assetPriceRefreshService from '@service/portfolio/asset-price-refresh.service';

interface BgDeps { attachQueueJob?: (correlationId: string, queueJobId: string) => Promise<boolean>; claimJobStart: (correlationId: string, queueJobId: string) => Promise<boolean>; createQueuedOperation: (input: { correlationId: string; operationType: string; resourceId: string; retryable?: boolean }) => Promise<unknown>; finishJob: (correlationId: string, queueJobId: string, input: { retryable?: boolean; stage?: string; status: BackgroundOperationStatus }) => Promise<boolean>; heartbeatJob: (correlationId: string, queueJobId: string, input: { progress?: Record<string, unknown>; stage?: string }) => Promise<boolean>; }

function isDuplicate(error: unknown) {
  const err = error as { cause?: { code?: unknown }; code?: unknown; constructor?: { name?: string }; name?: unknown };
  if (err.code === '23505') return true;
  if (err.name === 'UniqueConstraintViolationException') return true;
  if (err.constructor?.name === 'UniqueConstraintViolationException') return true;
  if (err.cause?.code === '23505') return true;
  return false;
}

export const handleAssetPriceRefreshJob = async (job: Job<{ correlationId?: string }>, deps: { assetPriceRefreshService?: typeof assetPriceRefreshService; backgroundOperationService?: BgDeps } = {}) => {
  // No market-data provider configured: there are no prices to fetch.
  if (!isMarketDataEnabled()) return false;
  const bg = deps.backgroundOperationService ?? backgroundOperationService;
  const correlationId = job.data.correlationId ?? `asset-price.refresh:${job.id}`;
  try { await bg.createQueuedOperation({ correlationId, operationType: 'asset-price.refresh', resourceId: 'asset-price-refresh:scheduled-run', retryable: true }); } catch (error) { if (!isDuplicate(error)) throw error; }
  const claimed = await bg.claimJobStart(correlationId, job.id); if (!claimed) return false;
  if (bg.attachQueueJob) await bg.attachQueueJob(correlationId, job.id);
  try {
    await bg.heartbeatJob(correlationId, job.id, { stage: 'asset-price.refresh:running' });
    const result = await (deps.assetPriceRefreshService ?? assetPriceRefreshService).refreshAllActiveAssets();
    await bg.heartbeatJob(correlationId, job.id, { progress: { ...result }, stage: 'asset-price.refresh:completed' });
    const status = result.failed > 0 ? (result.refreshed + result.skipped > 0 ? BackgroundOperationStatus.PARTIAL : BackgroundOperationStatus.FAILED) : BackgroundOperationStatus.SUCCEEDED;
    const stage = status === BackgroundOperationStatus.SUCCEEDED ? 'asset-price.refresh:succeeded' : status === BackgroundOperationStatus.PARTIAL ? 'asset-price.refresh:partial' : 'asset-price.refresh:failed';
    const finished = await bg.finishJob(correlationId, job.id, { retryable: status !== BackgroundOperationStatus.SUCCEEDED, stage, status });
    if (!finished) throw new Error('asset-price.refresh job failed to finish');
    return true;
  } catch {
    const finished = await bg.finishJob(correlationId, job.id, { retryable: true, stage: 'asset-price.refresh:failed', status: BackgroundOperationStatus.FAILED });
    // BackgroundOperation is the retry/visibility source of truth; do not rethrow after terminal FAILED because pg-boss retry would re-run against a terminal operation and no-op.
    if (!finished) throw new Error('asset-price.refresh job failed to finish');
    return false;
  }
};
