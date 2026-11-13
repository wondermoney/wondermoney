import { type EntityManager, QueryOrder } from '@mikro-orm/core';

import type { Appuser } from '@entity/Appuser';
import { BackgroundOperation } from '@entity/BackgroundOperation';
import { BankSyncIncident } from '@entity/BankSyncIncident';
import { BankSyncIncidentAttempt } from '@entity/BankSyncIncidentAttempt';
import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { SimplefinConnection } from '@entity/SimplefinConnection';
import type { Tenant } from '@entity/Tenant';
import { NotFoundError } from '@utils/errors';

/* eslint-disable perfectionist/sort-modules */

/** The most recent runs a connection shows. */
export const BANK_SYNC_HISTORY_LIMIT = 20;

export interface BankSyncLastError {
  code: string;
  occurredAt: string;
}

export interface BankSyncHistoryRun {
  /** How many accounts the run covered, when the provider reported it. */
  accounts: null | number;
  /** The normalized failure code; null on a successful or still-running attempt. */
  errorCode: null | string;
  finishedAt: null | string;
  flow: 'initial-add' | 'scheduled-refresh' | null;
  result: 'failed' | 'full_success' | 'partial' | null;
  /** When the next attempt is due, for a rate-limited run. */
  retryAt: null | string;
  /** Transactions the run created, from its background operation's progress. */
  rowsCreated: null | number;
  startedAt: string;
}

/**
 * Per-connection sync history and the latest failure, both owner-scoped.
 *
 * A connection is per-user (not household-wide), so every lookup here carries
 * `appuserKey: appuser` and `tenantKey: tenant`; a connection belonging to the
 * caller's partner, or to another household, is a 404 rather than an empty list.
 *
 * Incidents identify a connection by the provider-issued `requisitionId`
 * (`sessionId`, falling back to the pre-link `state`), never by the local
 * connection key. That mapping lives here so callers cannot accidentally query
 * incidents by the wrong id space.
 */
export class BankSyncHistoryService {
  constructor(private readonly em: EntityManager) {}

  async getConnectionHistory(connectionId: number, appuser: Appuser, tenant: Tenant): Promise<BankSyncHistoryRun[]> {
    const connection = await this.findOwnedConnection(connectionId, appuser, tenant);
    return this.historyFor(connectionRequisitionId(connection), appuser, connection.nextEligibleSyncAt);
  }

  /**
   * The history of one of the caller's SimpleFIN connections. A separate id space from
   * `getConnectionHistory`'s Enable Banking keys; incidents name it by `BankConnection.externalId`.
   */
  async getSimplefinConnectionHistory(connectionId: number, appuser: Appuser, tenant: Tenant): Promise<BankSyncHistoryRun[]> {
    const connection = await this.em.findOne(
      SimplefinConnection,
      { appuserKey: appuser, deletedAt: undefined, simplefinConnectionKey: connectionId, tenantKey: tenant },
      { populate: ['bankConnectionKey'] },
    );
    const requisitionId = connection?.bankConnectionKey.externalId;
    if (!connection || !requisitionId) throw new NotFoundError('Bank connection not found');
    return this.historyFor(requisitionId, appuser, connection.bankConnectionKey.nextEligibleSyncAt);
  }

  private async historyFor(requisitionId: string, appuser: Appuser, nextEligibleSyncAt: Date | undefined): Promise<BankSyncHistoryRun[]> {

    const attempts = await this.em.find(
      BankSyncIncidentAttempt,
      { deletedAt: undefined, incidentKey: { appuserKey: appuser, deletedAt: undefined, requisitionId } },
      { limit: BANK_SYNC_HISTORY_LIMIT, orderBy: { startedAt: QueryOrder.DESC }, populate: ['incidentKey'] },
    );
    if (attempts.length === 0) return [];

    const rowsCreated = await this.loadRowsCreated(attempts);
    const runs = attempts.map((attempt) => toHistoryRun(attempt, rowsCreated.get(incidentOf(attempt).correlationId ?? '') ?? null));

    // A rate-limited run stores the provider's `Retry-After` when it gave one. When it
    // did not, the connection's own `nextEligibleSyncAt` is the time the scheduler will
    // try again, which is the useful answer for the newest run.
    const newest = runs[0];
    if (newest?.errorCode === 'rate_limited' && newest.retryAt === null && nextEligibleSyncAt) {
      newest.retryAt = nextEligibleSyncAt.toISOString();
    }
    return runs;
  }

  /**
   * The newest failure per requisition id, for the connection list. One query
   * for every connection the caller can see.
   */
  async getLastErrorByRequisitionId(appuser: Appuser, requisitionIds: string[]): Promise<Map<string, BankSyncLastError>> {
    const unique = [...new Set(requisitionIds.filter((id) => id.length > 0))];
    if (unique.length === 0) return new Map();

    const incidents = await this.em.find(
      BankSyncIncident,
      { appuserKey: appuser, deletedAt: undefined, errorCode: { $ne: null }, requisitionId: { $in: unique } },
      { fields: ['errorCode', 'requisitionId', 'updatedAt'], orderBy: { updatedAt: QueryOrder.DESC } },
    );

    const lastError = new Map<string, BankSyncLastError>();
    for (const incident of incidents) {
      if (!incident.requisitionId || !incident.errorCode || lastError.has(incident.requisitionId)) continue;
      lastError.set(incident.requisitionId, { code: incident.errorCode, occurredAt: incident.updatedAt.toISOString() });
    }
    return lastError;
  }

  private async findOwnedConnection(connectionId: number, appuser: Appuser, tenant: Tenant): Promise<EnableBankingConnection> {
    const connection = await this.em.findOne(EnableBankingConnection, {
      appuserKey: appuser,
      deletedAt: undefined,
      enableBankingConnectionKey: connectionId,
      tenantKey: tenant,
    });
    if (!connection) throw new NotFoundError('Bank connection not found');
    return connection;
  }

  /** Transactions created per correlation id, as the sync worker last reported them. */
  private async loadRowsCreated(attempts: BankSyncIncidentAttempt[]): Promise<Map<string, number>> {
    const correlationIds = [...new Set(attempts.map((attempt) => incidentOf(attempt).correlationId).filter((id): id is string => Boolean(id)))];
    if (correlationIds.length === 0) return new Map();

    const operations = await this.em.find(
      BackgroundOperation,
      { correlationId: { $in: correlationIds } },
      { fields: ['correlationId', 'progress'] },
    );
    const rowsCreated = new Map<string, number>();
    for (const operation of operations) {
      const value = operation.progress?.['transactionsCreated'];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        rowsCreated.set(operation.correlationId, value);
      }
    }
    return rowsCreated;
  }
}

/** The provider-issued id incidents store for this connection. */
export function connectionRequisitionId(connection: Pick<EnableBankingConnection, 'sessionId' | 'state'>): string {
  return connection.sessionId ?? connection.state;
}

function incidentOf(attempt: BankSyncIncidentAttempt): BankSyncIncident {
  return attempt.incidentKey;
}

export function toHistoryRun(attempt: BankSyncIncidentAttempt, rowsCreated: null | number): BankSyncHistoryRun {
  const incident = incidentOf(attempt);
  const finishedAt = attempt.completedAt ?? null;
  const retryAfterSeconds = incident.retryAfterSeconds;
  const retryAt = attempt.errorCode === 'rate_limited' && finishedAt && typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
    ? new Date(finishedAt.getTime() + retryAfterSeconds * 1000).toISOString()
    : null;

  return {
    accounts: attempt.accountCount ?? null,
    errorCode: attempt.completedAt ? attempt.errorCode ?? null : null,
    finishedAt: finishedAt?.toISOString() ?? null,
    flow: incident.flow ?? null,
    result: attempt.completedAt ? attempt.result ?? null : null,
    retryAt,
    rowsCreated,
    startedAt: attempt.startedAt.toISOString(),
  };
}

/* eslint-enable perfectionist/sort-modules */
