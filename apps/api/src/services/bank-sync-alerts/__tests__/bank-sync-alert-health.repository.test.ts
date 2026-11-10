import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { addAccount, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { BankSyncFinality, BankSyncFlow, BankSyncIncident, BankSyncResult, BankSyncRolloutMode } from '@entity/BankSyncIncident';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';

import { loadConnectionHealth } from '../bank-sync-alert-health.repository';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-09T09:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

describe('loadConnectionHealth', () => {
  const db = useTestDatabase();
  let sequence = 0;

  async function connection(em: EntityManager, household: Household, input: { deleted?: boolean; owner?: Appuser; status?: EnableBankingConnectionStatus; withAccount?: 'closed' | 'deleted' | 'none' | 'open' } = {}) {
    sequence += 1;
    const owner = input.owner ?? household.appuser;
    const credential = em.create(EnableBankingCredential, {
      applicationId: `app-${sequence}`, appuserKey: owner, encryptionKeyVersion: 1, privateKeyAuthTag: 'tag', privateKeyCiphertext: 'ciphertext', privateKeyIv: 'iv', tenantKey: household.tenant,
    }, { partial: true });
    const created = em.create(EnableBankingConnection, {
      accessValidUntil: new Date(NOW.getTime() + 90 * DAY), appuserKey: owner, aspspCountry: 'PT', aspspName: `Bank ${sequence}`, deletedAt: input.deleted ? daysAgo(1) : undefined,
      enableBankingCredentialKey: credential, sessionId: `session-${sequence}`, state: `state-${sequence}`, status: input.status ?? EnableBankingConnectionStatus.LINKED, tenantKey: household.tenant,
    }, { partial: true });
    await em.flush();
    const withAccount = input.withAccount ?? 'open';
    if (withAccount !== 'none') {
      const account = await addAccount(em, household, { owner });
      em.assign(account, { closed: withAccount === 'closed', deletedAt: withAccount === 'deleted' ? daysAgo(1) : undefined, enableBankingConnectionKey: created });
      await em.flush();
    }
    return created;
  }

  async function incident(em: EntityManager, conn: EnableBankingConnection, input: { at: Date; code?: string; finality: BankSyncFinality; result: BankSyncResult }) {
    const success = input.result === BankSyncResult.SUCCESS;
    em.create(BankSyncIncident, {
      appuserKey: conn.appuserKey, attempts: 1, createdAt: input.at, errorCategory: success ? undefined : 'provider', errorCode: success ? undefined : (input.code ?? 'account_phase_failed'),
      finality: input.finality, flow: BankSyncFlow.SCHEDULED_REFRESH, incidentId: randomUUID(), requisitionId: conn.sessionId, result: input.result,
      rolloutMode: BankSyncRolloutMode.OFF, successAt: success ? input.at : undefined, updatedAt: input.at,
    }, { partial: true });
    await em.flush();
  }

  const failed = (at: Date, code?: string) => ({ at, code, finality: BankSyncFinality.TERMINAL_FAILURE, result: BankSyncResult.FAILURE });
  const succeeded = (at: Date) => ({ at, finality: BankSyncFinality.TERMINAL_SUCCESS, result: BankSyncResult.SUCCESS });

  it('reports the failures since the last successful sync, from the first one, with the latest code', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const conn = await connection(em, household);
    await incident(em, conn, failed(daysAgo(9), 'authentication'));
    await incident(em, conn, succeeded(daysAgo(5)));
    await incident(em, conn, failed(daysAgo(4), 'timeout'));
    await incident(em, conn, failed(daysAgo(3), 'account_phase_failed'));

    const [row] = await loadConnectionHealth(db.em(), { scope: 'all' });

    expect(row).toMatchObject({ aspspName: conn.aspspName, enableBankingConnectionKey: conn.enableBankingConnectionKey, failureStreak: { latestErrorCode: 'account_phase_failed', since: daysAgo(4) } });
  });

  it('has no streak once a sync succeeds again, and ignores runs still retrying or partly successful', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const recovered = await connection(em, household);
    await incident(em, recovered, failed(daysAgo(4)));
    await incident(em, recovered, succeeded(daysAgo(1)));
    const notFinal = await connection(em, household);
    await incident(em, notFinal, { at: daysAgo(4), finality: BankSyncFinality.NON_TERMINAL, result: BankSyncResult.FAILURE });
    await incident(em, notFinal, { at: daysAgo(3), finality: BankSyncFinality.TERMINAL_FAILURE, result: BankSyncResult.PARTIAL });

    const rows = await loadConnectionHealth(db.em(), { scope: 'all' });

    expect(rows.map((row) => row.failureStreak)).toEqual([null, null]);
  });

  it('leaves out connections that are gone, still pending, or have no account left to sync', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const kept = await connection(em, household, { status: EnableBankingConnectionStatus.EXPIRED });
    await connection(em, household, { deleted: true });
    await connection(em, household, { status: EnableBankingConnectionStatus.CREATED });
    await connection(em, household, { withAccount: 'none' });
    await connection(em, household, { withAccount: 'closed' });
    await connection(em, household, { withAccount: 'deleted' });

    const rows = await loadConnectionHealth(db.em(), { scope: 'all' });

    expect(rows.map((row) => row.enableBankingConnectionKey)).toEqual([kept.enableBankingConnectionKey]);
  });

  it('for a viewer, returns only the connections they own in their household', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const other = await seedHousehold(em);
    const mine = await connection(em, household);
    await connection(em, household, { owner: partner });
    await connection(em, other);
    // The partner's connection carries a private account: nothing about it may reach the owner.
    await em.nativeUpdate(Account, { accountOwnerAppuserKey: partner }, { isPrivate: true });

    const rows = await loadConnectionHealth(db.em(), { appuserKey: household.appuser.appuserKey, scope: 'viewer', tenantKey: household.tenant.tenantKey });

    expect(rows.map((row) => row.enableBankingConnectionKey)).toEqual([mine.enableBankingConnectionKey]);
    expect(rows[0]?.appuserKey).toBe(household.appuser.appuserKey);
  });

  it('reads a single connection for a send to re-check', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await connection(em, household);
    const target = await connection(em, household);

    const rows = await loadConnectionHealth(db.em(), { enableBankingConnectionKey: target.enableBankingConnectionKey, scope: 'connection' });

    expect(rows.map((row) => row.enableBankingConnectionKey)).toEqual([target.enableBankingConnectionKey]);
  });
});
