import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));

import { addAccount, addPartner, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Account } from '@entity/Account';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditLog } from '@entity/TransactionAuditLog';
import accountRoutes from '@route/account';
import netWorthRoutes from '@route/net-worth';
import reportRoutes from '@route/reports';

/*
 * "Spent by" and joint accounts over HTTP, as members of one household and a neighbour see them.
 * Attribution moves money between members in reports; it never lets anyone see or change a row they
 * could not before.
 */
describe('member attribution over HTTP', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const accounts = tenantHttp('/v1/account', accountRoutes);
  const reports = tenantHttp('/v1/reports', reportRoutes);
  const netWorth = tenantHttp('/v1/net-worth', netWorthRoutes);
  const JULY = '?fromDate=2026-07-01T00:00:00.000Z&toDate=2026-07-31T23:59:59.999Z&timezone=UTC';

  async function household() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const viewer = await addPartner(em, owner, { role: HouseholdRole.VIEWER });
    const partnersPrivate = await addAccount(em, owner, { appuserCurrencyBalance: 900, balance: 900, isPrivate: true, owner: partner });
    const groceries = await addTransaction(em, owner, { amount: -40, date: new Date('2026-07-10T12:00:00Z'), status: 'BOOKED' });
    const secret = await addTransaction(em, owner, { account: partnersPrivate, amount: -80, appuser: partner, date: new Date('2026-07-11T12:00:00Z'), status: 'BOOKED' });
    const neighbour = await seedHousehold(em);
    const neighbours = await addTransaction(em, neighbour, { amount: -500, date: new Date('2026-07-10T12:00:00Z'), status: 'BOOKED' });
    return { groceries, neighbour, neighbours, owner, partner, partnersPrivate, secret, viewer };
  }

  const stored = async (transaction: Transaction) => db.em().findOneOrFail(Transaction, { transactionKey: transaction.transactionKey }, { filters: false });

  describe('PATCH /v1/account/transaction/:id with attributedAppuserKey', () => {
    it('attributes a transaction to another member, records it, and answers the new attribution', async () => {
      const { groceries, owner, partner } = await household();

      const response = await accounts.as(owner.appuser).patch(`/v1/account/transaction/${groceries.transactionKey}`).send({ attributedAppuserKey: partner.appuserKey });

      expect(response.status).toBe(200);
      expect(response.body.transaction.attribution).toEqual({ appuserKey: partner.appuserKey, displayName: 'Partner', overridden: true });
      expect((await stored(groceries)).attributedAppuserKey?.appuserKey).toBe(partner.appuserKey);
      const history = await db.em().find(TransactionAuditLog, { transactionKey: groceries }, { filters: false });
      expect(history.map((entry) => entry.changes)).toContainEqual({ attribution: { from: null, to: partner.appuserKey } });
    });

    it('moves the money into that member\'s report total', async () => {
      const { groceries, owner, partner } = await household();
      await accounts.as(owner.appuser).patch(`/v1/account/transaction/${groceries.transactionKey}`).send({ attributedAppuserKey: partner.appuserKey });

      const partners = await reports.as(owner.appuser).get(`/v1/reports/spending-by-category${JULY}&memberKeys=${partner.appuserKey}`);
      const owners = await reports.as(owner.appuser).get(`/v1/reports/spending-by-category${JULY}&memberKeys=${owner.appuser.appuserKey}`);

      expect(partners.status).toBe(200);
      expect((partners.body.data as { totalAmount: number }[]).map((row) => row.totalAmount)).toEqual([40]);
      expect(owners.body.data).toEqual([]);
    });

    it('takes Shared, and null back to the account\'s owner', async () => {
      const { groceries, owner } = await household();
      const patch = (value: unknown) => accounts.as(owner.appuser).patch(`/v1/account/transaction/${groceries.transactionKey}`).send({ attributedAppuserKey: value });

      expect((await patch('shared')).body.transaction.attribution).toEqual({ appuserKey: null, displayName: null, overridden: true });
      expect((await stored(groceries)).attributedToShared).toBe(true);
      expect((await patch(null)).body.transaction.attribution).toEqual({ appuserKey: owner.appuser.appuserKey, displayName: 'Owner', overridden: false });
      expect(await stored(groceries)).toMatchObject({ attributedAppuserKey: null, attributedToShared: false });
    });

    it('refuses someone outside the household, and a former member', async () => {
      const { groceries, neighbour, owner, partner } = await household();
      const em = db.em();
      const membership = await em.findOneOrFail(AppuserTenant, { appuserKey: partner, tenantKey: owner.tenant }, { filters: false });
      membership.recordActive = false;
      await em.flush();
      const patch = (appuserKey: number) => accounts.as(owner.appuser).patch(`/v1/account/transaction/${groceries.transactionKey}`).send({ attributedAppuserKey: appuserKey });

      expect((await patch(neighbour.appuser.appuserKey)).status).toBe(400);
      expect((await patch(partner.appuserKey)).status).toBe(400);
      expect((await stored(groceries)).attributedAppuserKey ?? null).toBeNull();
    });

    it('cannot reach another household\'s transaction, or the other member\'s private one', async () => {
      const { neighbours, owner, secret } = await household();

      const neighbour = await accounts.as(owner.appuser).patch(`/v1/account/transaction/${neighbours.transactionKey}`).send({ attributedAppuserKey: owner.appuser.appuserKey });
      const privateRow = await accounts.as(owner.appuser).patch(`/v1/account/transaction/${secret.transactionKey}`).send({ attributedAppuserKey: owner.appuser.appuserKey });

      expect(neighbour.status).toBe(404);
      expect(privateRow.status).toBe(404);
      expect((await stored(neighbours)).attributedAppuserKey ?? null).toBeNull();
      expect((await stored(secret)).attributedAppuserKey ?? null).toBeNull();
    });

    it('is a write a viewer cannot make', async () => {
      const { groceries, viewer } = await household();

      const response = await accounts.as(viewer).patch(`/v1/account/transaction/${groceries.transactionKey}`).send({ attributedAppuserKey: viewer.appuserKey });

      expect(response.status).toBe(403);
    });
  });

  describe('filtering by a member', () => {
    it('never shows the owner the partner\'s private account, in the list, the reports or net worth', async () => {
      const { owner, partner, partnersPrivate } = await household();

      const listed = await accounts.as(owner.appuser).get(`/v1/account/transaction${JULY}&memberKeys=${partner.appuserKey}`);
      const report = await reports.as(owner.appuser).get(`/v1/reports/cashflow${JULY}&memberKeys=${partner.appuserKey}`);
      const worth = await netWorth.as(owner.appuser).get(`/v1/net-worth?member=${partner.appuserKey}`);

      expect(listed.status).toBe(200);
      expect(listed.body.transactions).toEqual([]);
      expect(report.body.data).toEqual([]);
      expect(worth.status).toBe(200);
      expect(worth.body.totalNetWorth).toBe(0);
      expect((worth.body.rows as { id: number }[]).map((row) => row.id)).not.toContain(partnersPrivate.accountKey);
    });

    it('refuses a member filter that is no key', async () => {
      const { owner } = await household();

      expect((await accounts.as(owner.appuser).get('/v1/account/transaction?memberKeys=everyone')).status).toBe(400);
      expect((await netWorth.as(owner.appuser).get('/v1/net-worth?member=-1')).status).toBe(400);
    });
  });

  describe('joint accounts', () => {
    it('lets the owner mark their account joint, and shows each account\'s attribution', async () => {
      const { owner } = await household();

      const response = await accounts.as(owner.appuser).patch(`/v1/account/${owner.account.accountKey}`).send({ isJoint: true });
      const listed = await accounts.as(owner.appuser).get('/v1/account');

      expect(response.status).toBe(200);
      expect((await db.em().findOneOrFail(Account, { accountKey: owner.account.accountKey }, { filters: false })).isJoint).toBe(true);
      const account = (listed.body.accounts as { accountKey: number; attribution: unknown; isJoint: boolean; ownerAppuserKey: number }[]).find((row) => row.accountKey === owner.account.accountKey);
      expect(account).toMatchObject({ attribution: { appuserKey: null, displayName: null }, isJoint: true, ownerAppuserKey: owner.appuser.appuserKey });
    });

    it('is the owner\'s to change, not another member\'s', async () => {
      const { owner, partner } = await household();

      const response = await accounts.as(partner).patch(`/v1/account/${owner.account.accountKey}`).send({ isJoint: true });

      expect(response.status).toBe(403);
      expect((await db.em().findOneOrFail(Account, { accountKey: owner.account.accountKey }, { filters: false })).isJoint).toBe(false);
    });
  });
});
