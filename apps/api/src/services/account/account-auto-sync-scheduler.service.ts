import { DI } from '@app/database/di';
import { ACCOUNT_AUTO_SYNC_REQUISITION_OPERATION_TYPE, type AccountAutoSyncRequisitionJobPayload, buildAccountAutoSyncRequisitionCorrelationId, enqueueAccountAutoSyncRequisitionJob } from '@app/jobs/account-auto-sync.queue';
import { BANK_SYNC_PROVIDER_DISABLED } from '@config/env';
import { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { BankSyncIncidentService } from '@service/bank-sync/bank-sync-incident.service';
import { bankSyncEnvironment, canonicalBankSyncDistinctId } from '@service/bank-sync/bank-sync-producer-policy';
import backgroundOperationService from '@service/operations/background-operation.service';

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
 * Phase 1e: one normalized entry per distinct connection (either a `NordigenRequisition` or an
 * `EnableBankingConnection`), built by the two per-provider loops below. Everything from this
 * point on (`requisitions` slicing, incident allocation, queued-operation bookkeeping, job
 * enqueue) reads only these generic fields and never branches on provider again — the same
 * "normalize once, branch never again downstream" seam `account-initial-sync-enqueue.service.ts`
 * uses for its `NormalizedSyncTarget` (Phase 1d).
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
    // Phase 0 kill-switch: the shared GoCardless credential is being cancelled, so skip the
    // sweep entirely rather than let it enqueue jobs against a dead provider. Bail before the
    // Account/requisition query even runs — nothing is queried, nothing is enqueued. This also
    // gates the Enable Banking sweep added in Phase 1e, per the same flag.
    if (BANK_SYNC_PROVIDER_DISABLED) {
      return { enqueued: 0, failed: 0, failures: [], rateLimited: 0, skipped: 0, total: 0 };
    }
    const now = input.now ?? new Date();
    const staleHours = input.staleHours ?? 20;
    const limit = input.limit ?? 100;
    const maxEnqueuedInput = input.maxEnqueued === undefined
      ? (process.env['ACCOUNT_AUTO_SYNC_MAX_ENQUEUED'] === undefined ? undefined : parsePositiveInteger('ACCOUNT_AUTO_SYNC_MAX_ENQUEUED', process.env['ACCOUNT_AUTO_SYNC_MAX_ENQUEUED'], Number.MAX_SAFE_INTEGER))
      : assertPositiveInteger('maxEnqueued', input.maxEnqueued);
    const staleBefore = new Date(now.getTime() - staleHours * 60 * 60 * 1000);
    const staleOr = [{ refreshedAt: null }, { refreshedAt: { $lte: staleBefore } }];
    // GoCardless query — byte-for-byte unchanged from pre-Phase-1e. Left as its own `em.find`
    // call (rather than folded into a single `$or`'d query) because a nullable-FK `$or` across
    // two entirely different relations (`nordigenRequisitionKey` / `enableBankingConnectionKey`)
    // can't express "match either relation's own nested conditions" as one MikroORM criteria
    // object without an outer `$or` that would swallow this literal `nordigenRequisitionKey: {...}`
    // shape one level down — which would silently stop matching real rows (a to-one relation
    // filter effectively requires the FK to be populated) while also being invisible to a
    // simple `toHaveBeenCalledWith(expect.objectContaining({ nordigenRequisitionKey: ... }))`
    // assertion. Two parallel queries, unioned in application code below, keep both providers'
    // filters simple, correct, and independently testable.
    // Gated on the connection's real provider-returned `accessValidUntil` (Phase 1a).
    const enableBankingAccounts = await DI.em.find(Account, {
      $or: staleOr,
      closed: false,
      deletedAt: undefined,
      enableBankingConnectionKey: { accessValidUntil: { $gt: now }, appuserKey: { $ne: null }, deletedAt: undefined, status: EnableBankingConnectionStatus.LINKED },
    }, { limit, orderBy: { accountKey: 'ASC' }, populate: ['enableBankingConnectionKey', 'enableBankingConnectionKey.appuserKey'] });
    const accounts = enableBankingAccounts as { enableBankingConnectionKey?: unknown }[];
    const scheduleRunId = input.scheduleRunId ?? String(now.getTime());
    if (!scheduleRunId.trim()) throw new Error('scheduleRunId is required');
    const eligible = new Map<string, EligibleSyncTarget>();
    for (const account of accounts) {
      const enableBankingConnection = account.enableBankingConnectionKey as
        | undefined
        | { appuserKey?: unknown; enableBankingConnectionKey: number; sessionId?: string; state: string };
      if (enableBankingConnection) {
        const connectionKey = enableBankingConnection.enableBankingConnectionKey;
        const mapKey = `enable_banking:${connectionKey}`;
        if (eligible.has(mapKey)) continue;
        const owner = enableBankingConnection.appuserKey as undefined | { externalUserId?: string };
        const correlationId = buildAccountAutoSyncRequisitionCorrelationId(scheduleRunId, String(connectionKey));
        // Enable Banking has no requisition-style opaque id post-link; `sessionId` is the closest
        // provider-issued identity (falling back to the pre-link correlation `state`) — same
        // judgment call as `account-initial-sync-enqueue.service.ts`'s `requisitionIdForAnalytics`.
        const connectionId = enableBankingConnection.sessionId ?? enableBankingConnection.state;
        eligible.set(mapKey, {
          appuserKey: enableBankingConnection.appuserKey,
          buildJobPayload: (incidentId) => ({
            appuserKey: getAppuserKeyNumber(enableBankingConnection.appuserKey),
            connectionId,
            correlationId,
            enableBankingConnectionKey: String(connectionKey),
            incidentId,
            provider: 'enable_banking',
            scheduleRunId,
          }),
          correlationId,
          distinctId: canonicalBankSyncDistinctId(owner?.externalUserId),
          requisitionId: connectionId,
          resourceId: `enable-banking-connection:${connectionKey}`,
          singletonKey: `account.auto-sync.connection:${connectionKey}`,
        });
      }
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
    return { enqueued, failed: failures.length, failures, rateLimited, skipped: accounts.length - eligible.size + rateLimited, total: accounts.length };
  },
};

function getAppuserKeyNumber(appuserKey: unknown): number {
  if (typeof appuserKey === 'number') return appuserKey;
  if (appuserKey && typeof appuserKey === 'object' && typeof (appuserKey as { appuserKey?: unknown }).appuserKey === 'number') return (appuserKey as { appuserKey: number }).appuserKey;
  return 0;
}
