import { DI } from '@app/database/di';
import { ACCOUNT_AUTO_SYNC_REQUISITION_OPERATION_TYPE, type AccountAutoSyncRequisitionJobPayload, buildAccountAutoSyncRequisitionCorrelationId, enqueueAccountAutoSyncRequisitionJob } from '@app/jobs/account-auto-sync.queue';
import type { Appuser } from '@entity/Appuser';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { enabledBankProviderIds, nonExpiringBankProviderIds } from '@service/bank-providers/registry';
import { BankSyncIncidentService } from '@service/bank-sync/bank-sync-incident.service';
import { accountAutoSyncConnectionSingletonKey, bankConnectionResourceId, bankSyncConnectionId, buildAccountAutoSyncRequisitionJobPayload } from '@service/bank-sync/bank-sync-job-payload';
import { bankSyncEnvironment, canonicalBankSyncDistinctId } from '@service/bank-sync/bank-sync-producer-policy';
import backgroundOperationService from '@service/operations/background-operation.service';

import { bankSyncMinIntervalHours } from './account-sync-interval';

const assertPositiveInteger = (name: string, value: number) => {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};

const parsePositiveInteger = (name: string, value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return assertPositiveInteger(name, parsed);
};

/**
 * One normalized entry per distinct connection (either a `NordigenRequisition` or an
 * `EnableBankingConnection`), built by the loop below. Everything from this
 * point on (`requisitions` slicing, incident allocation, queued-operation bookkeeping, job
 * enqueue) reads only these generic fields and never branches on provider again — the same
 * "normalize once, branch never again downstream" seam `account-initial-sync-enqueue.service.ts`
 * uses for its `NormalizedSyncTarget`.
 */
interface EligibleSyncTarget {
  appuserKey?: unknown;
  buildJobPayload: (incidentId: string) => AccountAutoSyncRequisitionJobPayload;
  correlationId: string;
  distinctId: string;
  requisitionId: string;
  resourceId: string;
  singletonKey: string;
}

export default {
  async enqueueDueAccountSyncs(input: { backgroundOperationService?: { attachQueueJob: (correlationId: string, queueJobId: string) => Promise<boolean>; createQueuedOperation: (input: Record<string, unknown>, transaction?: unknown) => Promise<unknown>; findByCorrelation?: (correlationId: string) => Promise<null | { queueJobId?: null | string; retryable?: boolean; status: string }>; markNeedsAction?: (correlationId: string, errorCode: string, stage?: string) => Promise<unknown>; resetRetryableQueueing?: (correlationId: string, transaction?: unknown) => Promise<boolean> }; bankSyncIncidentService?: BankSyncIncidentService; boss?: { send: (queue: string, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> }; limit?: number; maxEnqueued?: number; now?: Date; scheduleRunId?: string; send?: (queue: string, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>; staleHours?: number } = {}) {
    const now = input.now ?? new Date();
    const staleHours = input.staleHours ?? bankSyncMinIntervalHours();
    const limit = input.limit ?? 100;
    const maxEnqueuedInput = input.maxEnqueued === undefined
      ? (process.env['ACCOUNT_AUTO_SYNC_MAX_ENQUEUED'] === undefined ? undefined : parsePositiveInteger('ACCOUNT_AUTO_SYNC_MAX_ENQUEUED', process.env['ACCOUNT_AUTO_SYNC_MAX_ENQUEUED'], Number.MAX_SAFE_INTEGER))
      : assertPositiveInteger('maxEnqueued', input.maxEnqueued);
    const staleBefore = new Date(now.getTime() - staleHours * 60 * 60 * 1000);
    const staleOr = [{ refreshedAt: null }, { refreshedAt: { $lte: staleBefore } }];
    // Gated on the connection's real provider-returned `accessValidUntil`, on `lastSyncAttemptAt`
    // (so a failed attempt waits out the same interval as a successful one), and on
    // `nextEligibleSyncAt`, which a rate-limited sync sets from the provider's `Retry-After`.
    // One row per connection, whichever provider it belongs to: the scheduler never branches on
    // provider, it only reads the generic `BankConnection`.
    // A provider whose access never expires (SimpleFIN) leaves `accessValidUntil` null.
    const nonExpiring = nonExpiringBankProviderIds();
    const connections = await DI.em.find(BankConnection, {
      $and: [
        { $or: [{ lastSyncAttemptAt: null }, { lastSyncAttemptAt: { $lte: staleBefore } }] },
        { $or: [{ nextEligibleSyncAt: null }, { nextEligibleSyncAt: { $lte: now } }] },
        ...(nonExpiring.length > 0 ? [{ $or: [{ accessValidUntil: { $gt: now } }, { accessValidUntil: null, provider: { $in: nonExpiring } }] }] : []),
      ],
      ...(nonExpiring.length > 0 ? {} : { accessValidUntil: { $gt: now } }),
      accounts: { $some: { $and: [{ $or: staleOr }, { closed: false }, { deletedAt: undefined }] } },
      appuserKey: { $ne: null },
      deletedAt: undefined,
      provider: { $in: enabledBankProviderIds() },
      status: BankConnectionStatus.LINKED,
    }, { limit, orderBy: { bankConnectionKey: 'ASC' }, populate: ['appuserKey'] });
    const scheduleRunId = input.scheduleRunId ?? String(now.getTime());
    if (!scheduleRunId.trim()) throw new Error('scheduleRunId is required');
    const eligible = new Map<string, EligibleSyncTarget>();
    for (const connection of connections) {
      const connectionKey = connection.bankConnectionKey;
      const mapKey = `${connection.provider}:${connectionKey}`;
      if (eligible.has(mapKey)) continue;
      const owner = connection.appuserKey as undefined | { externalUserId?: string };
      const correlationId = buildAccountAutoSyncRequisitionCorrelationId(scheduleRunId, String(connectionKey));
      // The admin retry rebuilds the job with the same builders (`bank-sync-job-payload.ts`).
      eligible.set(mapKey, {
        appuserKey: connection.appuserKey,
        buildJobPayload: (incidentId) => buildAccountAutoSyncRequisitionJobPayload(connection, { incidentId, scheduleRunId }),
        correlationId,
        distinctId: canonicalBankSyncDistinctId(owner?.externalUserId),
        requisitionId: bankSyncConnectionId(connection),
        resourceId: bankConnectionResourceId(connectionKey),
        singletonKey: accountAutoSyncConnectionSingletonKey(connectionKey),
      });
    }
    const failures: { error: unknown; requisitionId: string }[] = [];
    let enqueued = 0;
    const send = input.send ?? input.boss?.send.bind(input.boss);
    const bg = input.backgroundOperationService ?? backgroundOperationService;
    const incidents = input.bankSyncIncidentService ?? new BankSyncIncidentService({ em: DI.em });
    const maxEnqueued = maxEnqueuedInput ?? eligible.size;
    const targets = Array.from(eligible.values());
    const rateLimited = Math.max(targets.length - maxEnqueued, 0);
    for (const target of targets.slice(0, maxEnqueued)) {
      try {
        const owner = target.appuserKey as undefined | { appuserKey?: number };
        if (!Number.isSafeInteger(owner?.appuserKey) || (owner?.appuserKey ?? 0) <= 0) throw new Error('Scheduled bank sync requisition has no owning appuser');
        const appuserKey = Number(owner?.appuserKey);
        const existing = await bg.findByCorrelation?.(target.correlationId);
        if (existing?.queueJobId && ['queued', 'running', 'succeeded'].includes(existing.status)) {
          enqueued += 1;
          continue;
        }
        const incident = await DI.em.transactional(async (em) => {
          const allocated = await incidents.allocateIncident({ appuserKey, correlationId: target.correlationId, distinctId: target.distinctId, environment: bankSyncEnvironment(), flow: 'scheduled-refresh', producer: 'pgboss-scheduled', requisitionId: target.requisitionId, userVisible: false }, em);
          if (existing && !existing.queueJobId && existing.retryable !== false && ['needs_action', 'queued'].includes(existing.status)) {
            if (!await bg.resetRetryableQueueing?.(target.correlationId, em)) throw new Error('Scheduled bank sync operation could not be reset for retry');
          } else if (!existing) {
            await bg.createQueuedOperation({ appuserKey: (target.appuserKey as Appuser | null | undefined) ?? null, correlationId: target.correlationId, operationType: ACCOUNT_AUTO_SYNC_REQUISITION_OPERATION_TYPE, resourceId: target.resourceId, retryable: true }, em);
          } else throw new Error('Scheduled bank sync operation is not reusable');
          return allocated;
        });
        const job = target.buildJobPayload(incident.incidentId);
        const jobId = await enqueueAccountAutoSyncRequisitionJob(job, { send, singletonKey: target.singletonKey });
        if (jobId) {
          const attached = await bg.attachQueueJob(target.correlationId, String(jobId));
          if (!attached) failures.push({ error: new Error('attach returned false'), requisitionId: target.requisitionId });
          else enqueued += 1;
        } else {
          failures.push({ error: new Error('enqueue returned null'), requisitionId: target.requisitionId });
        }
      } catch (error) {
        failures.push({ error, requisitionId: target.requisitionId });
      }
    }
    return { enqueued, failed: failures.length, failures, rateLimited, skipped: connections.length - eligible.size + rateLimited, total: connections.length };
  },
};
