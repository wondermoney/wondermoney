import { DI } from '@app/database/di';
import { ensureAccountAutoSyncRequisitionQueue, ensureAccountAutoSyncScheduleQueue } from '@app/jobs/account-auto-sync.queue';
import { ensureAccountCsvImportQueue } from '@app/jobs/account-csv-import.queue';
import { ensureAccountInitialSyncQueue } from '@app/jobs/account-initial-sync.queue';
import { ASSET_PRICE_REFRESH_QUEUE, ASSET_PRICE_REFRESH_SINGLETON_KEY, ensureAssetPriceRefreshQueue } from '@app/jobs/asset-price-refresh.queue';
import { ensureFoundationQueue } from '@app/jobs/queue';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { BankSyncIncidentService } from '@service/bank-sync/bank-sync-incident.service';
import { bankSyncEnvironment, canonicalBankSyncDistinctId } from '@service/bank-sync/bank-sync-producer-policy';
import type { RecoveryTransport } from '@service/queue/recovery-transport';
import { ConflictError } from '@utils/errors';

export const BACKGROUND_OPERATION_RETRY_TYPES = ['foundation.health-check', 'account.auto-sync.schedule', 'account.auto-sync.requisition', 'account.initial-sync', 'account.csv-import', 'asset-price.refresh'] as const;

export type BackgroundOperationRetryType = typeof BACKGROUND_OPERATION_RETRY_TYPES[number];

interface RetrySpec {
  buildPayload: (operation: { correlationId: string; operationType: string; resourceId?: string }) => Promise<Record<string, unknown>>;
  buildSingletonKey?: (operation: { correlationId: string; operationType: string; resourceId?: string }) => Promise<string>;
  ensureQueue: (boss: RecoveryTransport) => Promise<unknown>;
  queueName: string;
}

const FOUNDATION_QUEUE = 'foundation.health-check';
const ACCOUNT_QUEUE = 'account.initial-sync';
const AUTO_ACCOUNT_SCHEDULE_QUEUE = 'account.auto-sync.schedule';
const AUTO_ACCOUNT_QUEUE = 'account.auto-sync.requisition';
const ACCOUNT_CSV_QUEUE = 'account.csv-import';
const buildFoundationPayload: RetrySpec['buildPayload'] = (operation) => Promise.resolve({ correlationId: operation.correlationId });

function resolveSync<T>(callback: () => T): Promise<T> {
  try {
    return Promise.resolve(callback());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

// Only Enable Banking operations are retryable. Legacy `nordigen-requisition:` operations
// fall through the resourceId match below and are rejected: there is no requisition sync path,
// and the two key spaces index different tables, so a legacy payload must never be
// coerced onto an Enable Banking connection.
const buildAccountInitialSyncPayload: RetrySpec['buildPayload'] = async (operation) => {
  if (!operation.resourceId) throw new ConflictError('Operation resource is malformed');
  const match = /^enable-banking-connection:(\d+)$/.exec(operation.resourceId);
  if (!match) throw new ConflictError('Operation resource is malformed');

  const enableBankingConnectionKey = Number(match[1]);
  const connection = await DI.em.findOne(EnableBankingConnection, { deletedAt: undefined, enableBankingConnectionKey }, { populate: ['appuserKey'] });
  if (connection?.status !== EnableBankingConnectionStatus.LINKED) throw new ConflictError('Operation connection not found');
  const owner = connection.appuserKey as undefined | { appuserKey?: number; externalUserId?: string };
  if (!Number.isSafeInteger(owner?.appuserKey)) throw new ConflictError('Operation connection owner not found');
  const connectionId = connection.sessionId ?? connection.state;
  const scheduled = operation.operationType === 'account.auto-sync.requisition';
  const incident = await new BankSyncIncidentService({ em: DI.em }).completeOrAllocateLegacyIncident({
    appuserKey: Number(owner?.appuserKey), correlationId: operation.correlationId,
    distinctId: canonicalBankSyncDistinctId(owner?.externalUserId), environment: bankSyncEnvironment(),
    flow: scheduled ? 'scheduled-refresh' : 'initial-add', producer: scheduled ? 'pgboss-scheduled' : 'pgboss-initial',
    requisitionId: connectionId,
    userVisible: operation.operationType === 'account.initial-sync',
  });

  return { connectionId, correlationId: operation.correlationId, enableBankingConnectionKey: String(enableBankingConnectionKey), incidentId: incident.incidentId, provider: 'enable_banking' };
};

const buildAccountAutoSyncPayload: RetrySpec['buildPayload'] = async (operation) => {
  const payload = await buildAccountInitialSyncPayload(operation);
  const prefix = 'account.auto-sync.requisition:';
  const suffix = `:${String(payload['enableBankingConnectionKey'])}`;
  if (!operation.correlationId.startsWith(prefix) || !operation.correlationId.endsWith(suffix)) throw new ConflictError('Operation correlation is malformed');
  return { ...payload, scheduleRunId: operation.correlationId.slice(prefix.length, -suffix.length) };
};
const buildAccountAutoSyncSchedulePayload: RetrySpec['buildPayload'] = (operation) => Promise.resolve({ correlationId: operation.correlationId });
const buildAccountAutoSyncSingletonKey: NonNullable<RetrySpec['buildSingletonKey']> = (operation) => resolveSync(() => {
  if (!operation.resourceId) throw new ConflictError('Operation resource is malformed');
  const match = /^enable-banking-connection:(\d+)$/.exec(operation.resourceId);
  if (!match) throw new ConflictError('Operation resource is malformed');
  return `account.auto-sync.connection:${match[1]}`;
});

const buildAccountCsvImportPayload: RetrySpec['buildPayload'] = (operation) => resolveSync(() => {
  if (!operation.resourceId) throw new ConflictError('Operation resource is malformed');
  const match = /^account-csv-import:(\d+):([^:]*):([^:]+):(.+)$/.exec(operation.resourceId);
  if (!match) throw new ConflictError('Operation resource is malformed');
  const bankName = safeDecodeURIComponent(match[2] ?? '');
  return { accountKey: Number(match[1]), bankName, bucket: match[3], correlationId: operation.correlationId, key: match[4] };
});


function safeDecodeURIComponent(value: string) {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ConflictError('Operation resource is malformed');
  }
}

const specs: Record<BackgroundOperationRetryType, RetrySpec> = {
  'account.auto-sync.requisition': { buildPayload: buildAccountAutoSyncPayload, buildSingletonKey: buildAccountAutoSyncSingletonKey, ensureQueue: ensureAccountAutoSyncRequisitionQueue, queueName: AUTO_ACCOUNT_QUEUE },
  'account.auto-sync.schedule': { buildPayload: buildAccountAutoSyncSchedulePayload, ensureQueue: ensureAccountAutoSyncScheduleQueue, queueName: AUTO_ACCOUNT_SCHEDULE_QUEUE },
  'account.csv-import': { buildPayload: buildAccountCsvImportPayload, ensureQueue: ensureAccountCsvImportQueue, queueName: ACCOUNT_CSV_QUEUE },
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

