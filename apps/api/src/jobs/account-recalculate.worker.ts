import type { EntityManager } from '@mikro-orm/postgresql';
import type { Job, JobWithMetadata } from 'pg-boss';

import { DI } from '@app/database/di';
import type { AccountRecalculatePayload } from '@app/jobs/account-recalculate.queue';
import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { runAccountRecalculation } from '@service/account/account-recalculation.service';
import backgroundOperationService from '@service/operations/background-operation.service';

/**
 * Work one `account.recalculate` run (`services/account/account-recalculation.service.ts`). The
 * rebuild is one database transaction, so a failed attempt changes nothing: while pg-boss has
 * retries left the operation goes back to `queued` and the error is rethrown so pg-boss retries;
 * on the last attempt the run is recorded as failed.
 */
export const handleAccountRecalculateJob = async (
  job: Job<Partial<AccountRecalculatePayload>> | JobWithMetadata<Partial<AccountRecalculatePayload>>,
  deps: { em?: EntityManager; run?: typeof runAccountRecalculation } = {},
) => {
  const { correlationId } = job.data;
  if (typeof correlationId !== 'string' || correlationId.length === 0) return false;
  try {
    return await (deps.run ?? runAccountRecalculation)(deps.em ?? DI.em, correlationId, job.id);
  } catch (error) {
    const retriesLeft = 'retryLimit' in job ? job.retryCount < job.retryLimit : false;
    if (retriesLeft) await backgroundOperationService.markAttemptFailedForRetry(correlationId, job.id, { errorCode: 'account.recalculate:failed', stage: 'account.recalculate:retrying' });
    else await backgroundOperationService.finishJob(correlationId, job.id, { errorCode: 'account.recalculate:failed', stage: 'account.recalculate:failed', status: BackgroundOperationStatus.FAILED });
    throw error;
  }
};
