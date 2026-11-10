import type { EntityManager } from '@mikro-orm/postgresql';
import type { Job, JobWithMetadata } from 'pg-boss';

import { DI } from '@app/database/di';
import type { RuleApplyPayload } from '@app/jobs/rule-apply.queue';
import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import backgroundOperationService from '@service/operations/background-operation.service';
import { runRuleRun } from '@service/rules/rule-run.service';

/**
 * Work one `rule.apply` run (`services/rules/rule-run.service.ts`). A failed attempt rolls back
 * only its open batch: while pg-boss has retries left the operation goes back to `queued` and the
 * error is rethrown so pg-boss retries, carrying on from the last committed batch; on the last
 * attempt the run is recorded as failed. A worker that dies outright never reaches this catch;
 * pg-boss hands the same job back and the run resumes the same way.
 */
export const handleRuleApplyJob = async (
  job: Job<Partial<RuleApplyPayload>> | JobWithMetadata<Partial<RuleApplyPayload>>,
  deps: { em?: EntityManager; run?: typeof runRuleRun } = {},
) => {
  const { correlationId } = job.data;
  if (typeof correlationId !== 'string' || correlationId.length === 0) return false;
  try {
    return await (deps.run ?? runRuleRun)(deps.em ?? DI.em, correlationId, job.id);
  } catch (error) {
    const retriesLeft = 'retryLimit' in job ? job.retryCount < job.retryLimit : false;
    if (retriesLeft) await backgroundOperationService.markAttemptFailedForRetry(correlationId, job.id, { errorCode: 'rule.apply:failed', stage: 'rule.apply:retrying' });
    else await backgroundOperationService.finishJob(correlationId, job.id, { errorCode: 'rule.apply:failed', stage: 'rule.apply:failed', status: BackgroundOperationStatus.FAILED });
    throw error;
  }
};
