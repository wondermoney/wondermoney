import type { EntityManager } from '@mikro-orm/core';

import { EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import type { ConnectionHealth } from '@service/bank-sync-alerts/bank-sync-alert-policy';

export interface ConnectionHealthRow extends ConnectionHealth {
  /** The connection's owner. Only they can reconnect it, so only they are told about it. */
  appuserKey: number;
  aspspCountry: string;
  aspspName: string;
  enableBankingConnectionKey: number;
  tenantKey: null | number;
}

export type ConnectionHealthScope =
  | { appuserKey: number; scope: 'viewer'; tenantKey: number }
  | { enableBankingConnectionKey: number; scope: 'connection' }
  | { scope: 'all' };

interface RawRow {
  accessValidUntil: Date | null | string;
  appuserKey: number;
  aspspCountry: string;
  aspspName: string;
  enableBankingConnectionKey: number;
  failingSince: Date | null | string;
  latestErrorCode: null | string;
  status: EnableBankingConnectionStatus;
  tenantKey: null | number;
}

/**
 * The health of every Enable Banking connection that could need an alert: linked or ended
 * (`expired`), not deleted, with at least one open account still attached (a reconnect moves the
 * accounts to the new connection, and an emptied one has nothing left to sync).
 *
 * The failure streak comes from the connection's bank-sync incidents (matched on the requisition
 * id the producers record: the session id, or the pre-link `state`): the final, fully failed runs
 * since the last successful one. A partial run delivered data, and a run still retrying has not
 * failed yet, so neither counts.
 *
 * Scopes: `all` for the daily sweep (a worker runs with no tenant filter); `viewer` for the
 * in-app alerts, which must return only the viewer's own connections in their household (the
 * other members' connections, and so their private accounts, stay out); `connection` for a send
 * re-checking its alert.
 */
export async function loadConnectionHealth(em: EntityManager, scope: ConnectionHealthScope): Promise<ConnectionHealthRow[]> {
  const params: unknown[] = [];
  let where = '';
  if (scope.scope === 'viewer') {
    where = 'and c.appuser_key = ? and c.tenant_key = ?';
    params.push(scope.appuserKey, scope.tenantKey);
  } else if (scope.scope === 'connection') {
    where = 'and c.enable_banking_connection_key = ?';
    params.push(scope.enableBankingConnectionKey);
  }

  const rows: RawRow[] = await em.getConnection().execute(
    `select c.enable_banking_connection_key as "enableBankingConnectionKey", c.appuser_key as "appuserKey", c.tenant_key as "tenantKey",
            c.aspsp_name as "aspspName", c.aspsp_country as "aspspCountry", c.access_valid_until as "accessValidUntil", c.status,
            streak.since as "failingSince", streak.latest_error_code as "latestErrorCode"
     from enable_banking_connection c
     left join lateral (
       select max(coalesce(s.success_at, s.updated_at)) as at
       from bank_sync_incident s
       where s.appuser_key = c.appuser_key and s.requisition_id in (c.session_id, c.state)
         and s.deleted_at is null and s.finality = 'terminal_success'
     ) last_success on true
     left join lateral (
       select min(f.created_at) as since, (array_agg(f.error_code order by f.created_at desc))[1] as latest_error_code
       from bank_sync_incident f
       where f.appuser_key = c.appuser_key and f.requisition_id in (c.session_id, c.state)
         and f.deleted_at is null and f.finality = 'terminal_failure' and f.result = 'failure'
         and (last_success.at is null or f.created_at > last_success.at)
     ) streak on true
     where c.deleted_at is null and c.appuser_key is not null
       and c.status in ('${EnableBankingConnectionStatus.LINKED}', '${EnableBankingConnectionStatus.EXPIRED}')
       and exists (select 1 from account a where a.enable_banking_connection_key = c.enable_banking_connection_key and a.deleted_at is null and a.closed = false)
       ${where}
     order by c.enable_banking_connection_key`,
    params,
  );

  return rows.map((row) => ({
    accessValidUntil: toDate(row.accessValidUntil),
    appuserKey: row.appuserKey,
    aspspCountry: row.aspspCountry,
    aspspName: row.aspspName,
    enableBankingConnectionKey: row.enableBankingConnectionKey,
    failureStreak: row.failingSince ? { latestErrorCode: row.latestErrorCode, since: toDate(row.failingSince) ?? new Date(Number.NaN) } : null,
    status: row.status,
    tenantKey: row.tenantKey,
  }));
}

function toDate(value: Date | null | string): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}
