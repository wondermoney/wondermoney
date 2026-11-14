import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { type TestDatabase, useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { SimplefinConnection } from '@entity/SimplefinConnection';
import scheduler from '@service/account/account-auto-sync-scheduler.service';

import { deleteWonderMoneyAccount } from '../account-deletion.service';

/*
 * Deleting an account ends the person's bank feeds: in every household they belonged to, their
 * Enable Banking and SimpleFIN connections are revoked (the SimpleFIN credential destroyed) and the
 * scheduled refresh stops pulling them. The other members' own connections are not touched.
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
let sequence = 0;

interface LinkedBank {
  bankConnection: BankConnection;
  detail: EnableBankingConnection | SimplefinConnection;
}

async function deleteAccountOf(db: TestDatabase, member: Appuser) {
  const appuser = await db.em().findOneOrFail(Appuser, { appuserKey: member.appuserKey });
  await deleteWonderMoneyAccount(appuser, { adminEmail: vi.fn(), authAdmin: { deleteUser: vi.fn() }, sentry: { captureException: vi.fn() } });
}

async function expectActive(db: TestDatabase, linked: LinkedBank) {
  const { bankConnection, detail } = await stored(db, linked);
  expect(bankConnection.deletedAt ?? null).toBeNull();
  expect(detail.deletedAt ?? null).toBeNull();
  if (detail instanceof SimplefinConnection) expect(detail.accessUrlCiphertext).toBe('cipher');
}

async function expectRevoked(db: TestDatabase, linked: LinkedBank) {
  const { bankConnection, detail } = await stored(db, linked);
  expect(bankConnection.deletedAt).toBeInstanceOf(Date);
  expect(detail.deletedAt).toBeInstanceOf(Date);
  if (detail instanceof SimplefinConnection) expect(detail.accessUrlCiphertext ?? null).toBeNull();
}

async function linkEnableBanking(db: TestDatabase, household: Household, member: Appuser): Promise<LinkedBank> {
  const em = db.em();
  const id = ++sequence;
  const bankConnection = em.create(BankConnection, {
    accessValidUntil: new Date(Date.now() + THIRTY_DAYS_MS), appuserKey: member, externalId: `session-${id}`,
    provider: 'enable_banking', status: BankConnectionStatus.LINKED, tenantKey: household.tenant,
  }, { partial: true });
  const detail = em.create(EnableBankingConnection, {
    accessValidUntil: new Date(Date.now() + THIRTY_DAYS_MS), appuserKey: member, aspspCountry: 'PT', aspspName: 'Example Bank',
    bankConnectionKey: bankConnection, sessionId: `session-${id}`, state: `state-${id}`,
    status: EnableBankingConnectionStatus.LINKED, tenantKey: household.tenant,
  }, { partial: true });
  await em.flush();
  const account = await addAccount(em, household, { name: `Bank account ${id}`, owner: member });
  account.bankConnectionKey = bankConnection;
  await em.flush();
  return { bankConnection, detail };
}

async function linkSimplefin(db: TestDatabase, household: Household, member: Appuser): Promise<LinkedBank> {
  const em = db.em();
  const id = ++sequence;
  const bankConnection = em.create(BankConnection, {
    appuserKey: member, externalId: `simplefin:${id}`, provider: 'simplefin', status: BankConnectionStatus.LINKED, tenantKey: household.tenant,
  }, { partial: true });
  const detail = em.create(SimplefinConnection, {
    accessUrlAuthTag: 'tag', accessUrlCiphertext: 'cipher', accessUrlIv: 'iv', appuserKey: member, bankConnectionKey: bankConnection,
    encryptionKeyVersion: 1, serverHost: 'simplefin.example.test', tenantKey: household.tenant,
  }, { partial: true });
  await em.flush();
  const account = await addAccount(em, household, { name: `SimpleFIN account ${id}`, owner: member });
  account.bankConnectionKey = bankConnection;
  await em.flush();
  return { bankConnection, detail };
}

async function stored(db: TestDatabase, linked: LinkedBank) {
  const em = db.em();
  const bankConnection = await em.findOneOrFail(BankConnection, { bankConnectionKey: linked.bankConnection.bankConnectionKey }, { filters: false });
  const detail = linked.detail instanceof SimplefinConnection
    ? await em.findOneOrFail(SimplefinConnection, { simplefinConnectionKey: linked.detail.simplefinConnectionKey }, { filters: false })
    : await em.findOneOrFail(EnableBankingConnection, { enableBankingConnectionKey: linked.detail.enableBankingConnectionKey }, { filters: false });
  return { bankConnection, detail };
}

/** How many bank connections the scheduled refresh would pull right now. */
async function connectionsDueForBankSync() {
  const result = await scheduler.enqueueDueAccountSyncs({
    backgroundOperationService: { attachQueueJob: () => Promise.resolve(true), createQueuedOperation: () => Promise.resolve(undefined) },
    send: () => Promise.resolve('job'),
  });
  return result.total;
}

describe('deleting an account revokes that person\'s bank connections', () => {
  const db = useTestDatabase();
  // SimpleFIN is opt-in for operators; the scheduler only picks enabled providers.
  beforeEach(() => vi.stubEnv('BANK_PROVIDERS', 'enable_banking,simplefin'));
  afterEach(() => vi.unstubAllEnvs());

  it('revokes a household owner\'s own Enable Banking and SimpleFIN connections, and stops their sync', async () => {
    const household = await seedHousehold(db.em());
    const enableBanking = await linkEnableBanking(db, household, household.appuser);
    const simplefin = await linkSimplefin(db, household, household.appuser);
    expect(await connectionsDueForBankSync()).toBe(2);

    await deleteAccountOf(db, household.appuser);

    await expectRevoked(db, enableBanking);
    await expectRevoked(db, simplefin);
    expect(await connectionsDueForBankSync()).toBe(0);
  });

  it('revokes a member\'s connections in every household they belong to, and leaves the other members\' connections alone', async () => {
    const shared = await seedHousehold(db.em());
    const own = await seedHousehold(db.em());
    const member = own.appuser;
    const em = db.em();
    em.create(AppuserTenant, { appuserKey: member, recordActive: true, role: HouseholdRole.MEMBER, tenantKey: shared.tenant }, { partial: true });
    await em.flush();
    const bystander = await addPartner(db.em(), shared);

    const memberInShared = [await linkEnableBanking(db, shared, member), await linkSimplefin(db, shared, member)];
    const memberInOwn = [await linkEnableBanking(db, own, member), await linkSimplefin(db, own, member)];
    const others = [
      await linkEnableBanking(db, shared, shared.appuser),
      await linkSimplefin(db, shared, shared.appuser),
      await linkEnableBanking(db, shared, bystander),
    ];
    expect(await connectionsDueForBankSync()).toBe(7);

    await deleteAccountOf(db, member);

    for (const linked of [...memberInShared, ...memberInOwn]) await expectRevoked(db, linked);
    for (const linked of others) await expectActive(db, linked);
    expect(await connectionsDueForBankSync()).toBe(others.length);
  });
});
