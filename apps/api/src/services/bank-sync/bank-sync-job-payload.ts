import { type AccountAutoSyncRequisitionJobPayloadBank, buildAccountAutoSyncRequisitionCorrelationId } from '@app/jobs/account-auto-sync.queue';
import { type AccountInitialSyncJobPayloadBank, buildAccountInitialSyncCorrelationId } from '@app/jobs/account-initial-sync.queue';

/**
 * The bank-sync job payloads, built in one place. The producers (the initial-sync enqueue and the
 * auto-sync scheduler) and the admin retry (`background-operation-retry-registry.ts`) all build
 * their jobs here, so a retried job is exactly what the producer would have enqueued and the two
 * cannot drift apart again.
 *
 * Every field comes from the provider-agnostic `BankConnection` row, so a payload never names a
 * provider-specific table or key.
 */
export interface BankSyncJobConnection {
  appuserKey?: unknown;
  bankConnectionKey: number;
  externalId?: null | string;
  provider: string;
  state?: null | string;
}

const BANK_CONNECTION_RESOURCE_PREFIX = 'bank-connection:';

/** The `BackgroundOperation.resourceId` of a bank-sync operation. */
export const bankConnectionResourceId = (bankConnectionKey: number | string) => `${BANK_CONNECTION_RESOURCE_PREFIX}${bankConnectionKey}`;

/**
 * The `bankConnectionKey` a bank-sync operation names, or null. Operations stored before the
 * provider interface (`enable-banking-connection:<key>`, `nordigen-requisition:<key>`) index
 * other tables and return null: they are never coerced onto a `BankConnection`.
 */
export function parseBankConnectionResourceId(resourceId: null | string | undefined): null | number {
  const match = /^bank-connection:(\d+)$/.exec(resourceId ?? '');
  if (!match) return null;
  const key = Number(match[1]);
  return Number.isSafeInteger(key) && key > 0 ? key : null;
}

/**
 * The provider's session or consent id, which the job carries as `connectionId` and the incident
 * records as its `requisitionId`. The pre-link `state` and then the key are fallbacks; only a
 * linked connection is ever synced.
 */
export const bankSyncConnectionId = (connection: BankSyncJobConnection) => connection.externalId ?? connection.state ?? String(connection.bankConnectionKey);

/** One scheduled sync per connection at a time, whichever run enqueued it. */
export const accountAutoSyncConnectionSingletonKey = (bankConnectionKey: number | string) => `account.auto-sync.connection:${bankConnectionKey}`;

export function buildAccountAutoSyncRequisitionJobPayload(connection: BankSyncJobConnection, input: { incidentId: string; scheduleRunId: string }): AccountAutoSyncRequisitionJobPayloadBank {
  const bankConnectionKey = String(connection.bankConnectionKey);
  return {
    appuserKey: appuserKeyOf(connection.appuserKey) ?? 0,
    bankConnectionKey,
    connectionId: bankSyncConnectionId(connection),
    correlationId: buildAccountAutoSyncRequisitionCorrelationId(input.scheduleRunId, bankConnectionKey),
    incidentId: input.incidentId,
    provider: connection.provider,
    scheduleRunId: input.scheduleRunId,
  };
}

export function buildAccountInitialSyncJobPayload(connection: BankSyncJobConnection, incidentId: string): AccountInitialSyncJobPayloadBank {
  const bankConnectionKey = String(connection.bankConnectionKey);
  return {
    bankConnectionKey,
    connectionId: bankSyncConnectionId(connection),
    correlationId: buildAccountInitialSyncCorrelationId(bankConnectionKey),
    incidentId,
    provider: connection.provider,
  };
}

/** The numeric key of an appuser given as a key, an entity or a reference. */
export function appuserKeyOf(appuser: unknown): number | undefined {
  if (typeof appuser === 'number') return appuser;
  if (appuser && typeof appuser === 'object' && typeof (appuser as { appuserKey?: unknown }).appuserKey === 'number') return (appuser as { appuserKey: number }).appuserKey;
  return undefined;
}
