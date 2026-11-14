import { DI } from '@app/database/di';
import { ensureAccountAutoSyncRequisitionQueue, ensureAccountAutoSyncScheduleQueue } from '@app/jobs/account-auto-sync.queue';
import { buildAccountInitialSyncCorrelationId, ensureAccountInitialSyncQueue } from '@app/jobs/account-initial-sync.queue';
import { ASSET_PRICE_REFRESH_QUEUE, ASSET_PRICE_REFRESH_SINGLETON_KEY, ensureAssetPriceRefreshQueue } from '@app/jobs/asset-price-refresh.queue';
import { ensureFoundationQueue } from '@app/jobs/queue';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { getBankProvider } from '@service/bank-providers/registry';
import { BankSyncIncidentService } from '@service/bank-sync/bank-sync-incident.service';
import {
  accountAutoSyncConnectionSingletonKey,
  bankSyncConnectionId,
  buildAccountAutoSyncRequisitionJobPayload,
  buildAccountInitialSyncJobPayload,
  parseBankConnectionResourceId,
} from '@service/bank-sync/bank-sync-job-payload';
import { bankSyncEnvironment, canonicalBankSyncDistinctId } from '@service/bank-sync/bank-sync-producer-policy';
import type { RecoveryTransport } from '@service/queue/recovery-transport';
import { ConflictError } from '@utils/errors';

export const BACKGROUND_OPERATION_RETRY_TYPES = ['foundation.health-check', 'account.auto-sync.schedule', 'account.auto-sync.requisition', 'account.initial-sync', 'asset-price.refresh'] as const;

export type BackgroundOperationRetryType = typeof BACKGROUND_OPERATION_RETRY_TYPES[number];

/** The stored operation a retry rebuilds its job from. */
export interface RetryOperation {
  appuserKey?: unknown;
  correlationId: string;
  operationType: string;
  resourceId?: string;
  tenantKey?: unknown;
}

interface RetrySpec {
  buildPayload: (operation: RetryOperation) => Promise<Record<string, unknown>>;
  buildSingletonKey?: (operation: RetryOperation) => Promise<string>;
  ensureQueue: (boss: RecoveryTransport) => Promise<unknown>;
  queueName: string;
}

const FOUNDATION_QUEUE = 'foundation.health-check';
const ACCOUNT_QUEUE = 'account.initial-sync';
const AUTO_ACCOUNT_SCHEDULE_QUEUE = 'account.auto-sync.schedule';
const AUTO_ACCOUNT_QUEUE = 'account.auto-sync.requisition';
const buildFoundationPayload: RetrySpec['buildPayload'] = (operation) => Promise.resolve({ correlationId: operation.correlationId });

function resolveSync<T>(callback: () => T): Promise<T> {
  try {
    return Promise.resolve(callback());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

const keyOf = (value: unknown, field: 'appuserKey' | 'tenantKey'): number | undefined => {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && typeof (value as Record<string, unknown>)[field] === 'number') return (value as Record<string, number>)[field];
  return undefined;
};

/**
 * The `bankConnectionKey` a bank-sync operation names. Operations stored before the bank
 * provider interface (`enable-banking-connection:`, `nordigen-requisition:`) are refused: their
 * keys index other tables and their correlation ids name those keys, so the worker could never
 * accept a job rebuilt from them.
 */
function bankConnectionKeyOf(operation: RetryOperation): number {
  const key = parseBankConnectionResourceId(operation.resourceId);
  if (key === null) throw new ConflictError('Operation resource is malformed');
  return key;
}

/**
 * The connection a bank-sync retry syncs, checked as the worker would check it, and against the
 * stored operation: the same owner and household the producer recorded.
 */
async function loadRetryConnection(operation: RetryOperation) {
  const bankConnectionKey = bankConnectionKeyOf(operation);
  const connection = await DI.em.findOne(BankConnection, { bankConnectionKey, deletedAt: undefined }, { populate: ['appuserKey'] });
  if (connection?.status !== BankConnectionStatus.LINKED) throw new ConflictError('Operation connection not found');
  if (!getBankProvider(connection.provider)) throw new ConflictError('Operation bank provider is not enabled');
  const owner = connection.appuserKey as undefined | { appuserKey?: number; externalUserId?: string };
  const ownerKey = owner?.appuserKey;
  if (ownerKey === undefined || !Number.isSafeInteger(ownerKey) || ownerKey <= 0) throw new ConflictError('Operation connection owner not found');
  const operationOwner = keyOf(operation.appuserKey, 'appuserKey');
  if (operationOwner !== undefined && operationOwner !== ownerKey) throw new ConflictError('Operation connection belongs to another user');
  const operationTenant = keyOf(operation.tenantKey, 'tenantKey');
  if (operationTenant !== undefined && operationTenant !== keyOf(connection.tenantKey, 'tenantKey')) throw new ConflictError('Operation connection belongs to another household');
  return { connection, owner: { appuserKey: ownerKey, externalUserId: owner?.externalUserId } };
}

// The incident is keyed by the operation's correlation id, so a retry finds the one its producer
// allocated and the job carries that incident's id.
async function retryIncidentId(operation: RetryOperation, owner: { appuserKey: number; externalUserId?: string }, connectionId: string, scheduled: boolean) {
  const incident = await new BankSyncIncidentService({ em: DI.em }).completeOrAllocateLegacyIncident({
    appuserKey: owner.appuserKey, correlationId: operation.correlationId,
    distinctId: canonicalBankSyncDistinctId(owner.externalUserId), environment: bankSyncEnvironment(),
    flow: scheduled ? 'scheduled-refresh' : 'initial-add', producer: scheduled ? 'pgboss-scheduled' : 'pgboss-initial',
    requisitionId: connectionId,
    userVisible: !scheduled,
  });
  return incident.incidentId;
}

const buildAccountInitialSyncPayload: RetrySpec['buildPayload'] = async (operation) => {
  const { connection, owner } = await loadRetryConnection(operation);
  if (operation.correlationId !== buildAccountInitialSyncCorrelationId(String(connection.bankConnectionKey))) throw new ConflictError('Operation correlation is malformed');
  const incidentId = await retryIncidentId(operation, owner, bankSyncConnectionId(connection), false);
  return { ...buildAccountInitialSyncJobPayload(connection, incidentId) };
};

const buildAccountAutoSyncPayload: RetrySpec['buildPayload'] = async (operation) => {
  const { connection, owner } = await loadRetryConnection(operation);
  const prefix = `${AUTO_ACCOUNT_QUEUE}:`;
  const suffix = `:${String(connection.bankConnectionKey)}`;
  const scheduleRunId = operation.correlationId.startsWith(prefix) && operation.correlationId.endsWith(suffix)
    ? operation.correlationId.slice(prefix.length, -suffix.length) : '';
  if (!scheduleRunId.trim()) throw new ConflictError('Operation correlation is malformed');
  const incidentId = await retryIncidentId(operation, owner, bankSyncConnectionId(connection), true);
  return { ...buildAccountAutoSyncRequisitionJobPayload(connection, { incidentId, scheduleRunId }) };
};
const buildAccountAutoSyncSchedulePayload: RetrySpec['buildPayload'] = (operation) => Promise.resolve({ correlationId: operation.correlationId });
const buildAccountAutoSyncSingletonKey: NonNullable<RetrySpec['buildSingletonKey']> = (operation) => resolveSync(() => accountAutoSyncConnectionSingletonKey(bankConnectionKeyOf(operation)));

const specs: Record<BackgroundOperationRetryType, RetrySpec> = {
  'account.auto-sync.requisition': { buildPayload: buildAccountAutoSyncPayload, buildSingletonKey: buildAccountAutoSyncSingletonKey, ensureQueue: ensureAccountAutoSyncRequisitionQueue, queueName: AUTO_ACCOUNT_QUEUE },
  'account.auto-sync.schedule': { buildPayload: buildAccountAutoSyncSchedulePayload, ensureQueue: ensureAccountAutoSyncScheduleQueue, queueName: AUTO_ACCOUNT_SCHEDULE_QUEUE },
  'account.initial-sync': { buildPayload: buildAccountInitialSyncPayload, ensureQueue: ensureAccountInitialSyncQueue, queueName: ACCOUNT_QUEUE },
  'asset-price.refresh': {
    buildPayload: (operation) => Promise.resolve({ correlationId: operation.correlationId }),
    buildSingletonKey: () => Promise.resolve(ASSET_PRICE_REFRESH_SINGLETON_KEY),
    ensureQueue: ensureAssetPriceRefreshQueue,
    queueName: ASSET_PRICE_REFRESH_QUEUE,
  },
  'foundation.health-check': { buildPayload: buildFoundationPayload, ensureQueue: ensureFoundationQueue, queueName: FOUNDATION_QUEUE },
};

export const getBackgroundOperationRetrySpec = (operationType: string) => (operationType in specs ? specs[operationType as BackgroundOperationRetryType] : null);

