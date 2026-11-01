import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { type TestDatabase, useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Appuser } from '@entity/Appuser';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import householdRoutes from '@route/household';
import scheduler from '@service/account/account-auto-sync-scheduler.service';

/*
 * When a partner leaves (or is removed from) a household, their financial history stays with the
 * household but their bank feed must stop: the household keeps the data it already has, and the
 * ex-partner's new bank transactions must not keep landing in a household they no longer belong to.
 */
async function linkBank(db: TestDatabase, household: Household, member: Appuser) {
  const em = db.em();
  const credential = em.create(EnableBankingCredential, {
    applicationId: `app-${member.appuserKey}`, appuserKey: member, encryptionKeyVersion: 1,
    privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', tenantKey: household.tenant,
  }, { partial: true });
  const connection = em.create(EnableBankingConnection, {
    accessValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), appuserKey: member, aspspCountry: 'PT', aspspName: 'Bank',
    enableBankingCredentialKey: credential, sessionId: `session-${member.appuserKey}`, state: `state-${member.appuserKey}`,
    status: EnableBankingConnectionStatus.LINKED, tenantKey: household.tenant,
  }, { partial: true });
  await em.flush();
  const account = await addAccount(em, household, { name: 'Partner bank account', owner: member });
  account.enableBankingConnectionKey = connection;
  await em.flush();
  return connection;
}

/** Account keys the scheduled bank refresh would pull right now. */
async function accountsDueForBankSync() {
  const result = await scheduler.enqueueDueAccountSyncs({
    backgroundOperationService: { attachQueueJob: () => Promise.resolve(true), createQueuedOperation: () => Promise.resolve(undefined) },
    send: () => Promise.resolve('job'),
  });
  return result.total;
}

describe('leaving a household stops the departed member\'s bank sync', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/household', householdRoutes);

  it('a partner who leaves no longer has their bank synced into the household', async () => {
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    await linkBank(db, household, partner);
    expect(await accountsDueForBankSync()).toBe(1);

    const response = await http.as(partner).delete(`/v1/household/members/${partner.appuserKey}`);

    expect(response.status).toBe(200);
    expect(await accountsDueForBankSync()).toBe(0);
  });

  it('a partner the owner removes no longer has their bank synced into the household', async () => {
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    await linkBank(db, household, partner);

    const response = await http.as(household.appuser).delete(`/v1/household/members/${partner.appuserKey}`);

    expect(response.status).toBe(200);
    expect(await accountsDueForBankSync()).toBe(0);
  });

  it('the owner\'s own bank keeps syncing when the partner leaves', async () => {
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    await linkBank(db, household, household.appuser);

    await http.as(partner).delete(`/v1/household/members/${partner.appuserKey}`);

    expect(await accountsDueForBankSync()).toBe(1);
  });
});
