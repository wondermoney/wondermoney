import { UniqueConstraintViolationException } from '@mikro-orm/core';
import * as Sentry from '@sentry/node';

import { DI } from '@app/database/di';
import { type AccountInitialSyncJobPayload, buildAccountInitialSyncCorrelationId, enqueueAccountInitialSyncJob } from '@app/jobs/account-initial-sync.queue';
import type { Appuser } from '@entity/Appuser';
import { BackgroundOperation } from '@entity/BackgroundOperation';
import { BankSyncFlow, BankSyncIncident, BankSyncProducer } from '@entity/BankSyncIncident';
import type { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { BankSyncIncidentService } from '@service/bank-sync/bank-sync-incident.service';
import { bankSyncEnvironment, canonicalBankSyncDistinctId } from '@service/bank-sync/bank-sync-producer-policy';
import backgroundOperationService from '@service/operations/background-operation.service';
import type { Enqueue } from '@service/queue/enqueue';
import logger from '@utils/logger';
import { isCanonicalUuidV4 } from '@validators/shared';

const OPERATION_TYPE = 'account.initial-sync';

export interface AccountInitialSyncEnqueueResult {
  incidentId: string;
  operation: BackgroundOperation;
}

/**
 * Phase 1d: the normalized shape both providers reduce to before the shared allocation/enqueue
 * body below (which never branches on provider again). Duck-typed on `enableBankingConnectionKey`
 * presence rather than `instanceof EnableBankingConnection` — the existing GoCardless test suite
 * constructs plain `{ nordigenRequisitionKey, requisitionId, appuserKey, tenantKey }` object
 * literals, not real entity instances, and this keeps those working unmodified.
 * `requisitionIdForAnalytics`/`resourceId` follow the same "provider-agnostic identity field,
 * not renamed" judgment call documented in the two sync services.
 */
interface NormalizedSyncTarget {
  appuser: undefined | { appuserKey?: number; externalUserId?: string };
  buildJobPayload: (incidentId: string) => AccountInitialSyncJobPayload;
  correlationId: string;
  requisitionIdForAnalytics: string;
  resourceId: string;
  tenantKey?: number;
}

class AccountInitialSyncEnqueueService {
  async enqueue(syncTarget: EnableBankingConnection, deps: { bankSyncIncidentService?: BankSyncIncidentService; enqueue: Enqueue; }): Promise<AccountInitialSyncEnqueueResult> {
    const target = this.normalizeSyncTarget(syncTarget);
    const { appuser, buildJobPayload, correlationId, requisitionIdForAnalytics, resourceId } = target;
    if (!Number.isSafeInteger(appuser?.appuserKey) || (appuser?.appuserKey ?? 0) <= 0) {
      throw new AccountInitialSyncQueueError('Account initial sync requisition has no owning appuser', false);
    }
    const distinctId = canonicalBankSyncDistinctId(appuser?.externalUserId);
    const appuserKey = Number(appuser?.appuserKey);
    const incidentService = deps.bankSyncIncidentService ?? new BankSyncIncidentService({
      em: DI.em,
      transitionBackgroundOperation: async (em, context) => {
        const changed = await backgroundOperationService.applyBankSyncPreEnqueueTransition(em, { correlationId, errorCode: context.event.error_code ?? 'queue_unavailable' });
        if (!changed) throw new Error('Account initial sync pre-enqueue transition failed');
      },
    });
    const existing = await DI.em.findOne(BackgroundOperation, { correlationId, deletedAt: undefined });
    if (existing) return this.reconcileExistingOperation(existing, correlationId, appuserKey);

    // RAD-244: trust only the tenant stored on the requisition. Stop inferring
    // a tenant from a current AppuserTenant membership — a user who ever had
    // a second subscription context could otherwise route a sync to the
    // wrong tenant. The stored tenant is the one that was active when the
    // bank was linked.
    const requisitionTenantKey = target.tenantKey;
    if (!Number.isInteger(requisitionTenantKey) || (requisitionTenantKey ?? 0) <= 0) {
      throw new AccountInitialSyncQueueError('Account initial sync requisition is missing tenant ownership; refusing to enqueue', false);
    }

    let incident: Awaited<ReturnType<BankSyncIncidentService['allocateIncident']>> | undefined;
    let acceptedResult: AccountInitialSyncEnqueueResult | undefined;

    try {
      let allocation: { incident: Awaited<ReturnType<BankSyncIncidentService['allocateIncident']>>; operation: BackgroundOperation };
      try {
        allocation = await DI.em.transactional(async (em) => {
          const allocated = await incidentService.allocateIncident({
            appuserKey, correlationId, distinctId, environment: bankSyncEnvironment(),
            flow: 'initial-add', producer: 'pgboss-initial', requisitionId: requisitionIdForAnalytics, userVisible: true,
          }, em);
          let queued: BackgroundOperation;
          try {
            queued = await backgroundOperationService.createQueuedOperation({
              appuserKey: appuser as unknown as Appuser,
              correlationId,
              operationType: OPERATION_TYPE,
              resourceId,
              retryable: true,
              tenantKey: requisitionTenantKey,
            }, em);
          } catch (error) {
            if (isAllocationUniqueViolation(error)) throw new OperationAllocationUniqueViolation('Concurrent operation allocation');
            throw error;
          }
          return { incident: allocated, operation: queued };
        });
      } catch (error) {
        if (!(error instanceof OperationAllocationUniqueViolation)) throw error;
        const concurrent = await DI.em.findOne(BackgroundOperation, { correlationId, deletedAt: undefined });
        if (!concurrent) throw error;
        return await this.reconcileExistingOperation(concurrent, correlationId, appuserKey);
      }
      incident = allocation.incident;
      const { operation } = allocation;

      const jobId = await enqueueAccountInitialSyncJob(buildJobPayload(incident.incidentId), { enqueue: deps.enqueue });
      if (!jobId) {
        await this.recordPreEnqueueFailure(incidentService, incident.incidentId, 'enqueue-null');
        throw new AccountInitialSyncQueueError('Account initial sync queue returned no job id', false, incident.incidentId);
      }
      acceptedResult = { incidentId: incident.incidentId, operation };

      try {
        const attached = await backgroundOperationService.attachQueueJob(correlationId, String(jobId));
        if (!attached) this.safeWarn('attach-queue-job', 'Account initial sync job accepted without attached queue id');
      } catch {
        this.safeWarn('attach-queue-job', 'Account initial sync job accepted without attached queue id');
      }

      return acceptedResult;
    } catch (error) {
      if (acceptedResult) return acceptedResult;
      // Log the ACTUAL underlying error (queue adapter/send failure). Without this the user only ever sees the generic
      // `queue_unavailable` redirect and prod logs have no root cause (RAD-372).
      this.safeError('pre-acceptance', 'Failed to enqueue account initial sync', error);
      if (error instanceof AccountInitialSyncQueueError) throw error;
      if (incident) await this.recordPreEnqueueFailure(incidentService, incident.incidentId, 'enqueue-rejected');
      throw new AccountInitialSyncQueueError('Account initial sync queue failed before acceptance', false, incident?.incidentId);
    }
  }

  /**
   * Phase 1d client-construction-analog seam for the enqueue path — the only place this service
   * branches on provider. `enableBankingConnectionKey` presence (not `instanceof`) is the
   * discriminator so plain-object test fixtures keep working — see `NormalizedSyncTarget`'s
   * docblock above.
   */
  private normalizeSyncTarget(syncTarget: EnableBankingConnection): NormalizedSyncTarget {
    {
      const connection = syncTarget;
      if (!Number.isSafeInteger(connection.enableBankingConnectionKey) || connection.enableBankingConnectionKey <= 0) {
        throw new AccountInitialSyncQueueError('Account initial sync connection identifiers are invalid', false);
      }
      const enableBankingConnectionKey = String(connection.enableBankingConnectionKey);
      const correlationId = buildAccountInitialSyncCorrelationId(enableBankingConnectionKey);
      // Enable Banking has no requisition-style opaque id post-link; `sessionId` is the closest
      // provider-issued identity (falling back to the pre-link correlation `state` — defensive,
      // shouldn't happen since only a `linked` connection reaches this enqueue call).
      const requisitionIdForAnalytics = connection.sessionId ?? connection.state;
      return {
        appuser: connection.appuserKey as unknown as NormalizedSyncTarget['appuser'],
        buildJobPayload: (incidentId) => ({ connectionId: requisitionIdForAnalytics, correlationId, enableBankingConnectionKey, incidentId, provider: 'enable_banking' }),
        correlationId,
        requisitionIdForAnalytics,
        resourceId: `enable-banking-connection:${enableBankingConnectionKey}`,
        tenantKey: connection.tenantKey?.tenantKey,
      };
    }

  }

  private async reconcileExistingOperation(operation: BackgroundOperation, correlationId: string, appuserKey: number): Promise<AccountInitialSyncEnqueueResult> {
    const operationOwner = typeof operation.appuserKey === 'object' ? operation.appuserKey.appuserKey : operation.appuserKey;
    if (operationOwner !== appuserKey || operation.operationType !== OPERATION_TYPE) {
      throw new AccountInitialSyncQueueError('Account initial sync operation identity is invalid', false);
    }
    const incident = await DI.em.findOne(BankSyncIncident, { correlationId, deletedAt: undefined });
    const incidentOwner = typeof incident?.appuserKey === 'object' ? incident.appuserKey.appuserKey : incident?.appuserKey;
    if (!incident || incidentOwner !== appuserKey || incident.flow !== BankSyncFlow.INITIAL_ADD
      || incident.producer !== BankSyncProducer.INITIAL || incident.userVisible !== true
      || !isCanonicalUuidV4(incident.incidentId)) {
      throw new AccountInitialSyncQueueError('Account initial sync incident identity is invalid', false);
    }
    return { incidentId: incident.incidentId, operation };
  }

  private async recordPreEnqueueFailure(incidentService: BankSyncIncidentService, incidentId: string, queueIdentity: string) {
    try {
      const attempt = await incidentService.startAttempt({ incidentId, queueAttempt: 1, queueJobId: `pre-enqueue:${queueIdentity}` });
      await incidentService.finalizeAttempt({ attempt: attempt.attempt, errorCategory: 'queue', errorCode: 'queue_unavailable', final: false, incidentId, result: 'failed', treatmentEligible: false });
    } catch {
      this.safeWarn('record-pre-enqueue-failure', 'Account initial sync failure recording failed');
    }
  }

  private safeError(stage: string, message: string, error?: unknown) {
    try {
      const errorInfo =
        error instanceof Error
          ? { errorMessage: error.message, errorName: error.name, errorStack: error.stack }
          : error === undefined
            ? {}
            : { errorValue: String(error) };
      logger.error({ stage, ...errorInfo }, message);
      // Also surface the underlying pg-boss failure in Sentry. Pino logs alone are easy to
      // miss, and the user only ever sees a generic `queue_unavailable` redirect — without
      // this, a queue outage has no visible, groupable root cause on the dashboard (RAD-372).
      if (error !== undefined) {
        Sentry.captureException(error, { extra: { message }, tags: { stage, subsystem: 'account-initial-sync-enqueue' } });
      }
    } catch {
      return;
    }
  }

  private safeWarn(stage: string, message: string) {
    try {
      logger.warn({ stage }, message);
    } catch {
      return;
    }
  }
}

class OperationAllocationUniqueViolation extends Error {}

export class AccountInitialSyncQueueError extends Error {
  constructor(message: string, public readonly queueAccepted: boolean, public readonly incidentId?: string) {
    super(message);
    this.name = 'AccountInitialSyncQueueError';
  }
}

function isAllocationUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) return true;
  if (!error || typeof error !== 'object') return false;
  const structured = error as { cause?: { code?: unknown; sqlState?: unknown }; code?: unknown; sqlState?: unknown };
  return structured.code === '23505' || structured.sqlState === '23505'
    || structured.cause?.code === '23505' || structured.cause?.sqlState === '23505';
}

export default new AccountInitialSyncEnqueueService();
