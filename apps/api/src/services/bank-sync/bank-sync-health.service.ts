import type { EntityManager } from '@mikro-orm/postgresql';

import { BankConnectionStatus } from '@entity/BankConnection';
import { compiledBankProvider } from '@service/bank-providers/registry';
import type { BankConnectionInstitution } from '@service/bank-providers/types';

/* eslint-disable perfectionist/sort-modules */

/**
 * Instance-wide bank sync health, for the operator: is bank sync broken, and where?
 *
 * Built on the per-connection sync history (`bank_sync_incident` and its attempts, the rows the
 * connection history endpoint reads) and the provider-agnostic `bank_connection` table. An
 * incident names its connection by the provider-issued id (`requisition_id`), which is the
 * connection's `externalId`, else its `state`, else its key: the same identity the scheduler and
 * the initial sync give it.
 *
 * **Aggregates only.** Nothing here returns a user, household, account or connection
 * identifier, an account name, an IBAN or a transaction description: only providers,
 * institutions, statuses, normalized error codes, counts and timestamps. The failing list has
 * one row per connection but no id for it; acting on a connection is not this view's job.
 */

/** A connection counts as failing once its failures have lasted this long. */
export const FAILING_THRESHOLD_HOURS = 48;
/** The window for the per-institution success rate. */
export const SUCCESS_RATE_WINDOW_DAYS = 7;
/** An institution with this many failing connections stands out. */
export const ATTENTION_FAILING_CONNECTIONS = 2;
/** ...or one whose success rate over at least this many attempts is below the next value. */
export const ATTENTION_MIN_ATTEMPTS = 3;
export const ATTENTION_SUCCESS_RATE = 0.5;

const HOUR_MS = 60 * 60 * 1000;

export interface BankSyncErrorCodeCount {
  errorCode: string;
  /** Sync runs (incidents) with at least one attempt that ended with this code in the window. */
  incidents: number;
}

export interface BankSyncInstitutionLabel {
  country: null | string;
  /** The provider's institution id, e.g. `enable_banking:pt:example-bank`; `unknown` when no attempt or connection names one. */
  id: string;
  name: null | string;
}

export interface BankSyncInstitutionHealth {
  /** Completed attempts in the window. */
  attempts: number;
  failed: number;
  /** Connections at this institution failing for longer than the threshold. */
  failingConnections: number;
  institution: BankSyncInstitutionLabel;
  /** True when the institution has many failing connections or a low success rate. */
  needsAttention: boolean;
  partial: number;
  provider: null | string;
  succeeded: number;
  /** Fully successful attempts over all completed attempts in the window; null with none. */
  successRate: null | number;
}

export interface BankSyncHealth {
  connections: {
    byStatus: Record<BankConnectionStatus, number>;
    /** Connections failing for longer than the threshold (see the failing list). */
    failing: number;
    total: number;
  };
  failingThresholdHours: number;
  generatedAt: string;
  incidentsByErrorCode: {
    last7Days: BankSyncErrorCodeCount[];
    last24Hours: BankSyncErrorCodeCount[];
  };
  /** Worst first: those needing attention, then by failing connections, failures and success rate. */
  institutions: BankSyncInstitutionHealth[];
  successRateWindowDays: number;
}

export interface FailingBankConnection {
  /** The normalized code of the latest failed attempt. */
  errorCode: null | string;
  /** The first failed attempt after the last success. */
  failingSince: string;
  institution: BankSyncInstitutionLabel;
  lastAttemptAt: string;
  /** The last attempt that brought data back (full or partial); null when none ever did. */
  lastSuccessAt: null | string;
  provider: string;
  status: BankConnectionStatus;
}

export interface FailingBankConnections {
  connections: FailingBankConnection[];
  generatedAt: string;
  thresholdHours: number;
}

export interface BankSyncHealthOptions {
  now?: Date;
}

interface ConnectionRow {
  key: number;
  live: boolean;
  provider: string;
  requisitionId: string;
  status: BankConnectionStatus;
}

interface StreakRow {
  failingSince: Date | null;
  lastAttemptAt: Date;
  lastSuccessAt: Date | null;
  latestErrorCode: null | string;
  latestResult: string;
  requisitionId: string;
}

interface InstitutionAttemptRow {
  failed: number;
  institutionId: null | string;
  partial: number;
  requisitionId: null | string;
  succeeded: number;
}

interface ErrorCodeRow {
  errorCode: string;
  last7Days: number;
  last24Hours: number;
}

interface FailingConnectionInternal extends FailingBankConnection {
  connectionKey: number;
}

/** The provider-issued id incidents store for a `bank_connection` row. */
const CONNECTION_REQUISITION_ID = 'coalesce(bc.external_id, bc.state, bc.bank_connection_key::text)';

const UNKNOWN_INSTITUTION: BankSyncInstitutionLabel = { country: null, id: 'unknown', name: null };

export async function getBankSyncHealth(em: EntityManager, options: BankSyncHealthOptions = {}): Promise<BankSyncHealth> {
  const now = options.now ?? new Date();
  const windowStart = new Date(now.getTime() - SUCCESS_RATE_WINDOW_DAYS * 24 * HOUR_MS);
  const dayStart = new Date(now.getTime() - 24 * HOUR_MS);

  const connections = await loadConnections(em);
  const failing = await findFailing(em, connections, now);

  const byStatus = Object.fromEntries(Object.values(BankConnectionStatus).map((status) => [status, 0])) as Record<BankConnectionStatus, number>;
  let total = 0;
  for (const connection of connections) {
    if (!connection.live) continue;
    byStatus[connection.status] += 1;
    total += 1;
  }

  const errorCodes = await em.execute<ErrorCodeRow[]>(
    `select a.error_code as "errorCode",
            (count(distinct a.bank_sync_incident_key) filter (where a.completed_at >= ?))::int as "last24Hours",
            count(distinct a.bank_sync_incident_key)::int as "last7Days"
       from bank_sync_incident_attempt a
       join bank_sync_incident i on i.bank_sync_incident_key = a.bank_sync_incident_key
      where a.deleted_at is null and i.deleted_at is null
        and a.error_code is not null
        and a.completed_at >= ? and a.completed_at <= ?
      group by a.error_code`,
    [dayStart, windowStart, now],
  );

  const attemptRows = await em.execute<InstitutionAttemptRow[]>(
    `select i.requisition_id as "requisitionId",
            coalesce(a.institution_id, i.institution_id) as "institutionId",
            (count(*) filter (where a.result = 'full_success'))::int as "succeeded",
            (count(*) filter (where a.result = 'partial'))::int as "partial",
            (count(*) filter (where a.result = 'failed'))::int as "failed"
       from bank_sync_incident_attempt a
       join bank_sync_incident i on i.bank_sync_incident_key = a.bank_sync_incident_key
      where a.deleted_at is null and i.deleted_at is null
        and a.result is not null
        and a.completed_at >= ? and a.completed_at <= ?
      group by 1, 2`,
    [windowStart, now],
  );

  const connectionByRequisition = new Map(connections.map((connection) => [connection.requisitionId, connection]));
  const attributed = attemptRows.map((row) => ({ connection: row.requisitionId ? connectionByRequisition.get(row.requisitionId) : undefined, row }));
  const labels = await describeInstitutions(em, attributed.flatMap(({ connection }) => (connection ? [connection] : [])));

  const institutions = new Map<string, BankSyncInstitutionHealth>();
  const institutionFor = (label: BankSyncInstitutionLabel, provider: null | string): BankSyncInstitutionHealth => {
    let entry = institutions.get(label.id);
    if (!entry) {
      entry = { attempts: 0, failed: 0, failingConnections: 0, institution: label, needsAttention: false, partial: 0, provider, succeeded: 0, successRate: null };
      institutions.set(label.id, entry);
    }
    entry.provider ??= provider;
    if (entry.institution.name === null && label.name !== null) entry.institution = label;
    return entry;
  };

  for (const { connection, row } of attributed) {
    const label = (connection && labels.get(connection.key)) ?? (row.institutionId ? { country: null, id: row.institutionId, name: null } : UNKNOWN_INSTITUTION);
    const entry = institutionFor(label, connection?.provider ?? null);
    entry.succeeded += row.succeeded;
    entry.partial += row.partial;
    entry.failed += row.failed;
    entry.attempts += row.succeeded + row.partial + row.failed;
  }
  for (const connection of failing) {
    institutionFor(connection.institution, connection.provider).failingConnections += 1;
  }
  for (const entry of institutions.values()) {
    entry.successRate = entry.attempts === 0 ? null : Math.round((entry.succeeded / entry.attempts) * 10_000) / 10_000;
    entry.needsAttention = entry.failingConnections >= ATTENTION_FAILING_CONNECTIONS
      || (entry.attempts >= ATTENTION_MIN_ATTEMPTS && entry.successRate !== null && entry.successRate < ATTENTION_SUCCESS_RATE);
  }

  return {
    connections: { byStatus, failing: failing.length, total },
    failingThresholdHours: FAILING_THRESHOLD_HOURS,
    generatedAt: now.toISOString(),
    incidentsByErrorCode: {
      last7Days: sortCounts(errorCodes.map((row) => ({ errorCode: row.errorCode, incidents: row.last7Days }))),
      last24Hours: sortCounts(errorCodes.filter((row) => row.last24Hours > 0).map((row) => ({ errorCode: row.errorCode, incidents: row.last24Hours }))),
    },
    institutions: [...institutions.values()].sort(compareInstitutions),
    successRateWindowDays: SUCCESS_RATE_WINDOW_DAYS,
  };
}

export async function listFailingBankConnections(em: EntityManager, options: BankSyncHealthOptions = {}): Promise<FailingBankConnections> {
  const now = options.now ?? new Date();
  const failing = await findFailing(em, await loadConnections(em), now);

  const perInstitution = new Map<string, number>();
  for (const connection of failing) perInstitution.set(connection.institution.id, (perInstitution.get(connection.institution.id) ?? 0) + 1);
  // Institutions with the most failing connections first, then the longest-failing.
  failing.sort((a, b) => (perInstitution.get(b.institution.id) ?? 0) - (perInstitution.get(a.institution.id) ?? 0)
    || a.institution.id.localeCompare(b.institution.id)
    || a.failingSince.localeCompare(b.failingSince));

  return {
    connections: failing.map(({ connectionKey: _connectionKey, ...connection }) => connection),
    generatedAt: now.toISOString(),
    thresholdHours: FAILING_THRESHOLD_HOURS,
  };
}

/** Every connection, deleted ones included so their past attempts still count for their institution. */
async function loadConnections(em: EntityManager): Promise<ConnectionRow[]> {
  return em.execute<ConnectionRow[]>(
    `select bc.bank_connection_key as "key", bc.provider, bc.status,
            ${CONNECTION_REQUISITION_ID} as "requisitionId",
            (bc.deleted_at is null) as "live"
       from bank_connection bc`,
  );
}

/**
 * Live connections whose latest completed attempt failed and whose run of failures (since the
 * last attempt that brought data back) started more than the threshold ago.
 */
async function findFailing(em: EntityManager, connections: ConnectionRow[], now: Date): Promise<FailingConnectionInternal[]> {
  const streaks = await em.execute<StreakRow[]>(
    `with completed as (
       select i.requisition_id, a.result, a.error_code, a.completed_at,
              max(a.completed_at) filter (where a.result <> 'failed') over (partition by i.requisition_id) as last_success_at
         from bank_sync_incident_attempt a
         join bank_sync_incident i on i.bank_sync_incident_key = a.bank_sync_incident_key
        where a.deleted_at is null and i.deleted_at is null
          and a.completed_at is not null and a.result is not null and a.completed_at <= ?
          and i.requisition_id in (select ${CONNECTION_REQUISITION_ID} from bank_connection bc where bc.deleted_at is null)
     )
     select requisition_id as "requisitionId",
            max(last_success_at) as "lastSuccessAt",
            max(completed_at) as "lastAttemptAt",
            (array_agg(result order by completed_at desc))[1] as "latestResult",
            (array_agg(error_code order by completed_at desc))[1] as "latestErrorCode",
            min(completed_at) filter (where result = 'failed' and (last_success_at is null or completed_at > last_success_at)) as "failingSince"
       from completed
      group by requisition_id`,
    [now],
  );

  const threshold = now.getTime() - FAILING_THRESHOLD_HOURS * HOUR_MS;
  const liveByRequisition = new Map(connections.filter((connection) => connection.live).map((connection) => [connection.requisitionId, connection]));
  const candidates = streaks.flatMap((streak) => {
    const connection = liveByRequisition.get(streak.requisitionId);
    if (!connection || streak.latestResult !== 'failed' || !streak.failingSince) return [];
    if (toDate(streak.failingSince).getTime() > threshold) return [];
    return [{ connection, streak }];
  });

  const labels = await describeInstitutions(em, candidates.map(({ connection }) => connection));
  return candidates.map(({ connection, streak }) => ({
    connectionKey: connection.key,
    errorCode: streak.latestErrorCode,
    failingSince: toDate(streak.failingSince ?? streak.lastAttemptAt).toISOString(),
    institution: labels.get(connection.key) ?? UNKNOWN_INSTITUTION,
    lastAttemptAt: toDate(streak.lastAttemptAt).toISOString(),
    lastSuccessAt: streak.lastSuccessAt ? toDate(streak.lastSuccessAt).toISOString() : null,
    provider: connection.provider,
    status: connection.status,
  }));
}

/** Each connection's institution, asked of its provider (compiled in, whether or not it is enabled now). */
async function describeInstitutions(em: EntityManager, connections: ConnectionRow[]): Promise<Map<number, BankSyncInstitutionLabel>> {
  const byProvider = new Map<string, number[]>();
  for (const connection of connections) {
    const keys = byProvider.get(connection.provider) ?? [];
    if (!keys.includes(connection.key)) keys.push(connection.key);
    byProvider.set(connection.provider, keys);
  }
  const labels = new Map<number, BankSyncInstitutionLabel>();
  for (const [providerId, keys] of byProvider) {
    const described: Map<number, BankConnectionInstitution> = await compiledBankProvider(providerId)?.describeInstitutions?.(em, keys) ?? new Map();
    for (const [key, institution] of described) {
      labels.set(key, { country: institution.country ?? null, id: institution.id, name: institution.name });
    }
  }
  return labels;
}

function compareInstitutions(a: BankSyncInstitutionHealth, b: BankSyncInstitutionHealth): number {
  return Number(b.needsAttention) - Number(a.needsAttention)
    || b.failingConnections - a.failingConnections
    || b.failed - a.failed
    || (a.successRate ?? 2) - (b.successRate ?? 2)
    || a.institution.id.localeCompare(b.institution.id);
}

function sortCounts(counts: BankSyncErrorCodeCount[]): BankSyncErrorCodeCount[] {
  return counts.sort((a, b) => b.incidents - a.incidents || a.errorCode.localeCompare(b.errorCode));
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/* eslint-enable perfectionist/sort-modules */
