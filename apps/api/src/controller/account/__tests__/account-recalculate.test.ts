import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Account } from '@entity/Account';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import accountRoutes from '@route/account';

/*
 * `POST /v1/account/:accountId/recalculate` queues a rebuild of the account's balances and answers
 * the background operation to follow. Any household member who can see the account may start it;
 * the other member's private account, like another household's, does not exist for them. Editing
 * a manual account's opening balance starts the same rebuild. What the rebuild does is
 * `account-recalculation.test.ts`'s concern.
 */
describe('recalculating an account over HTTP', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const send = vi.fn();
  const http = tenantHttp('/v1/account', accountRoutes, { enqueue: { send, sendAfter: vi.fn() } });
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue('job-1');
  });

  async function household() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const ownersPrivate = await addAccount(em, owner, { isPrivate: true, name: 'Owner private' });
    const neighbour = await seedHousehold(em);
    return { neighbour, owner, ownersPrivate, partner };
  }

  const queued = () => db.em().find(BackgroundOperation, { operationType: 'account.recalculate' });
  const recalculate = (accountKey: number) => `/v1/account/${accountKey}/recalculate`;

  it('queues a recalculation the member who started it can follow', async () => {
    const { owner } = await household();

    const response = await http.as(owner.appuser).post(recalculate(owner.account.accountKey)).send({});

    expect(response.status).toBe(202);
    expect(send).toHaveBeenCalledWith('account.recalculate', { correlationId: response.body.operationId }, expect.anything());
    expect(await db.em().findOneOrFail(BackgroundOperation, { correlationId: response.body.operationId })).toMatchObject({ status: BackgroundOperationStatus.QUEUED });
  });

  it('lets the partner recalculate a shared account', async () => {
    const { owner, partner } = await household();

    const response = await http.as(partner).post(recalculate(owner.account.accountKey)).send({});

    expect(response.status).toBe(202);
  });

  it('does not find the other member\'s private account, nor another household\'s', async () => {
    const { neighbour, owner, ownersPrivate, partner } = await household();

    const asPartner = await http.as(partner).post(recalculate(ownersPrivate.accountKey)).send({});
    const asNeighbour = await http.as(neighbour.appuser).post(recalculate(owner.account.accountKey)).send({});

    expect(asPartner.status).toBe(404);
    expect(asNeighbour.status).toBe(404);
    expect(await queued()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('answers the same operation while one is queued, and a minute\'s wait once it has run', async () => {
    const { owner } = await household();
    const first = await http.as(owner.appuser).post(recalculate(owner.account.accountKey)).send({});

    const again = await http.as(owner.appuser).post(recalculate(owner.account.accountKey)).send({});
    expect(again.status).toBe(202);
    expect(again.body.operationId).toBe(first.body.operationId);

    await db.em().nativeUpdate(BackgroundOperation, { correlationId: first.body.operationId }, { finishedAt: new Date(), status: BackgroundOperationStatus.SUCCEEDED });
    const tooSoon = await http.as(owner.appuser).post(recalculate(owner.account.accountKey)).send({});
    expect(tooSoon.status).toBe(429);
    expect(Number(tooSoon.headers['retry-after'])).toBeGreaterThan(0);
  });

  describe('editing the opening balance', () => {
    it('stores a manual account\'s opening values and starts a recalculation', async () => {
      const { owner, partner } = await household();

      const response = await http.as(partner).patch(`/v1/account/${owner.account.accountKey}`).send({ openingBalance: 250.5, openingBalanceDate: '2026-01-01' });

      expect(response.status).toBe(200);
      expect(response.body.operationId).toEqual(expect.any(String));
      expect(send).toHaveBeenCalledWith('account.recalculate', { correlationId: response.body.operationId }, expect.anything());
      const account = await db.em().findOneOrFail(Account, { accountKey: owner.account.accountKey }, { filters: false });
      expect(account.openingBalance).toBe(250.5);
      expect(account.openingBalanceDate?.toISOString().slice(0, 10)).toBe('2026-01-01');
    });

    it('refuses it on a synced account, whose balance comes from the bank', async () => {
      const { owner } = await household();
      const em = db.em();
      const credential = em.create(EnableBankingCredential, { applicationId: 'app-1', appuserKey: owner.appuser, encryptionKeyVersion: 1, privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', tenantKey: owner.tenant }, { partial: true });
      const connection = em.create(EnableBankingConnection, { appuserKey: owner.appuser, aspspCountry: 'PT', aspspName: 'Bank', enableBankingCredentialKey: credential, sessionId: 'session-1', state: 'state-1', status: EnableBankingConnectionStatus.LINKED, tenantKey: owner.tenant }, { partial: true });
      await em.flush();
      await em.nativeUpdate(Account, { accountKey: owner.account.accountKey }, { enableBankingConnectionKey: connection });

      const response = await http.as(owner.appuser).patch(`/v1/account/${owner.account.accountKey}`).send({ openingBalance: 10 });

      expect(response.status).toBe(400);
      expect(send).not.toHaveBeenCalled();
    });

    it('refuses an opening date in the future', async () => {
      const { owner } = await household();
      const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

      const response = await http.as(owner.appuser).patch(`/v1/account/${owner.account.accountKey}`).send({ openingBalanceDate: future });

      expect(response.status).toBe(400);
    });

    it('does not start anything for a plain rename', async () => {
      const { owner } = await household();

      const response = await http.as(owner.appuser).patch(`/v1/account/${owner.account.accountKey}`).send({ accountName: 'Renamed' });

      expect(response.status).toBe(200);
      expect(send).not.toHaveBeenCalled();
    });
  });
});
