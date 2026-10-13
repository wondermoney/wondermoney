import type { Job } from 'pg-boss';

import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import exchangeRateRefreshService from '@service/market-data/exchange-rate-refresh.service';
import backgroundOperationService from '@service/operations/background-operation.service';

function isDuplicate(error: unknown) { const err = error as { cause?: { code?: unknown }; code?: unknown; constructor?: { name?: string }; name?: unknown }; return err.code === '23505' || err.name === 'UniqueConstraintViolationException' || err.constructor?.name === 'UniqueConstraintViolationException' || err.cause?.code === '23505'; }

export const handleExchangeRateRefreshJob = async (job: Job<{ correlationId?: string }>, deps: { backgroundOperationService?: typeof backgroundOperationService; exchangeRateRefreshService?: typeof exchangeRateRefreshService } = {}) => {
  const bg = deps.backgroundOperationService ?? backgroundOperationService;
  const correlationId = job.data.correlationId ?? `exchange-rate.refresh:${job.id}`;
  try { await bg.createQueuedOperation({ correlationId, operationType: 'exchange-rate.refresh', resourceId: 'exchange-rate-refresh:scheduled-run', retryable: false }); } catch (error) { if (!isDuplicate(error)) throw error; }
  const claimed = await bg.claimJobStart(correlationId, job.id); if (!claimed) return false;
  await bg.attachQueueJob(correlationId, job.id);
  try {
    await bg.heartbeatJob(correlationId, job.id, { stage: 'exchange-rate.refresh:running' });
    const result = await (deps.exchangeRateRefreshService ?? exchangeRateRefreshService).refreshExchangeRates();
    await bg.heartbeatJob(correlationId, job.id, { progress: result, stage: 'exchange-rate.refresh:completed' });
    const finished = await bg.finishJob(correlationId, job.id, { retryable: false, stage: 'exchange-rate.refresh:succeeded', status: BackgroundOperationStatus.SUCCEEDED });
    if (!finished) throw new Error('exchange-rate.refresh job failed to finish');
    return true;
  } catch (error) {
    // Reset the operation to `queued` rather than terminal-failing it, and rethrow so
    // pg-boss actually retries. Raising this queue's `retryLimit` alone would have done
    // nothing: `finishJob(FAILED)` is terminal, so the retry's `claimJobStart` finds no
    // `queued` row and silently returns false. If pg-boss then exhausts its retries, the
    // leftover `queued` + non-retryable row is escalated to `needs_action` by
    // `background-operation.recovery` rather than being re-enqueued in a loop.
    await bg.markAttemptFailedForRetry(correlationId, job.id, { errorCode: 'exchange_rate_refresh_failed', stage: 'exchange-rate.refresh:failed' });
    throw error;
  }
};
