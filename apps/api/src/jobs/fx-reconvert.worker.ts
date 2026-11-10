import type { EntityManager } from '@mikro-orm/postgresql';
import type { Job } from 'pg-boss';

import { DI } from '@app/database/di';
import type { FxReconvertPayload } from '@app/jobs/fx-reconvert.queue';
import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { type FxOverridePair, reconvertFx, reconvertFxForOverride } from '@service/currency/fx-reconvert.service';
import backgroundOperationService from '@service/operations/background-operation.service';

const OPERATION_TYPE = 'fx.reconvert';

function isDuplicate(error: unknown) { const err = error as { cause?: { code?: unknown }; code?: unknown; constructor?: { name?: string }; name?: unknown }; return err.code === '23505' || err.name === 'UniqueConstraintViolationException' || err.constructor?.name === 'UniqueConstraintViolationException' || err.cause?.code === '23505'; }

/**
 * One pass of `reconvertFx` (or, for a payload naming an override's household pair,
 * `reconvertFxForOverride`), recorded as a `fx.reconvert` background operation whose progress holds
 * the run's counts. A failed run resets the operation to `queued` and rethrows so pg-boss retries;
 * the pass is idempotent and each account commits on its own, so a retry only finds what is left.
 */
export const handleFxReconvertJob = async (
  job: Job<Partial<FxReconvertPayload>>,
  deps: { backgroundOperationService?: typeof backgroundOperationService; em?: EntityManager; reconvert?: typeof reconvertFx; reconvertOverride?: typeof reconvertFxForOverride } = {},
) => {
  const bg = deps.backgroundOperationService ?? backgroundOperationService;
  const correlationId = job.data.correlationId ?? `${OPERATION_TYPE}:${job.id}`;
  const dryRun = job.data.dryRun === true;
  const override = overridePairOf(job.data.override);
  const resourceId = override ? `fx-reconvert:override:${override.tenantKey}:${override.fromCurrency}:${override.toCurrency}` : dryRun ? 'fx-reconvert:dry-run' : 'fx-reconvert:run';
  try { await bg.createQueuedOperation({ correlationId, operationType: OPERATION_TYPE, resourceId, retryable: false }); } catch (error) { if (!isDuplicate(error)) throw error; }
  const claimed = await bg.claimJobStart(correlationId, job.id); if (!claimed) return false;
  await bg.attachQueueJob(correlationId, job.id);
  try {
    await bg.heartbeatJob(correlationId, job.id, { stage: `${OPERATION_TYPE}:running` });
    const em = deps.em ?? DI.em;
    const result = override ? await (deps.reconvertOverride ?? reconvertFxForOverride)(em, override, { dryRun }) : await (deps.reconvert ?? reconvertFx)(em, { dryRun });
    await bg.heartbeatJob(correlationId, job.id, { progress: { ...result }, stage: `${OPERATION_TYPE}:completed` });
    // Accounts that failed were rolled back and are retried by the next pass; the run shows as
    // partial so the admin list says so.
    const status = result.accountsFailed > 0 ? BackgroundOperationStatus.PARTIAL : BackgroundOperationStatus.SUCCEEDED;
    const finished = await bg.finishJob(correlationId, job.id, { retryable: false, stage: `${OPERATION_TYPE}:${status}`, status });
    if (!finished) throw new Error('fx.reconvert job failed to finish');
    return true;
  } catch (error) {
    await bg.markAttemptFailedForRetry(correlationId, job.id, { errorCode: 'fx_reconvert_failed', stage: `${OPERATION_TYPE}:failed` });
    throw error;
  }
};

/** The payload's household pair, or undefined when it names none (or a malformed one). */
function overridePairOf(value: unknown): FxOverridePair | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { fromCurrency, tenantKey, toCurrency } = value as Partial<FxOverridePair>;
  if (typeof fromCurrency !== 'string' || typeof toCurrency !== 'string' || typeof tenantKey !== 'number' || !Number.isInteger(tenantKey)) return undefined;
  return { fromCurrency, tenantKey, toCurrency };
}
