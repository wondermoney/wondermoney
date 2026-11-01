import { startOfMonth } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addPartner, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import accountRoutes from '@route/account';

/*
 * The account metrics and the monthly cashflow are hand-written SQL, outside the ORM's tenant
 * filter, so each carries its own household and privacy predicates. A member sees the household's
 * shared accounts and their own private ones, never the other member's private account, and
 * nothing of another household.
 */
describe('account aggregates, households and private accounts', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/account', accountRoutes);
  const inThisMonth = () => new Date(startOfMonth(new Date()).getTime() + 12 * 60 * 60 * 1000);

  async function twoHouseholds() {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const privateAccount = await addAccount(em, household, { isPrivate: true, name: 'Private savings' });
    await addTransaction(em, household, { amount: -20, date: inThisMonth(), status: 'BOOKED' });
    await addTransaction(em, household, { account: privateAccount, amount: -80, date: inThisMonth(), status: 'BOOKED' });
    const deleted = await addTransaction(em, household, { amount: -1000, date: inThisMonth(), status: 'BOOKED' });
    await em.getConnection().execute('update "transaction" set "deleted_at" = now() where "transaction_key" = ?', [deleted.transactionKey]);
    const closedAccount = await addAccount(em, household, { name: 'Deleted account' });
    await em.getConnection().execute('update "account" set "deleted_at" = now() where "account_key" = ?', [closedAccount.accountKey]);

    const neighbour = await seedHousehold(em);
    await addTransaction(em, neighbour, { amount: -500, date: inThisMonth(), status: 'BOOKED' });
    return { household, neighbour, partner, privateAccount };
  }

  const accountKeys = (body: { metrics: { accountKey: number }[] }) => body.metrics.map((row) => row.accountKey).sort((a, b) => a - b);

  describe('all-accounts metrics', () => {
    it('shows the other member the shared account only', async () => {
      const { household, partner } = await twoHouseholds();

      const response = await http.as(partner).get('/v1/account/metrics');

      expect(response.status).toBe(200);
      expect(accountKeys(response.body)).toEqual([household.account.accountKey]);
      expect(response.body.metrics).toEqual([expect.objectContaining({ outflowCurrentPeriod: 20, transactionCountCurrentPeriod: 1 })]);
    });

    it('shows the owner their private account too', async () => {
      const { household, privateAccount } = await twoHouseholds();

      const response = await http.as(household.appuser).get('/v1/account/metrics');

      expect(accountKeys(response.body)).toEqual([household.account.accountKey, privateAccount.accountKey].sort((a, b) => a - b));
      expect(response.body.metrics).toEqual(expect.arrayContaining([
        expect.objectContaining({ accountKey: privateAccount.accountKey, outflowCurrentPeriod: 80 }),
        expect.objectContaining({ accountKey: household.account.accountKey, outflowCurrentPeriod: 20 }),
      ]));
    });

    it('shows another household nothing of this one', async () => {
      const { neighbour } = await twoHouseholds();

      const response = await http.as(neighbour.appuser).get('/v1/account/metrics');

      expect(accountKeys(response.body)).toEqual([neighbour.account.accountKey]);
      expect(response.body.metrics).toEqual([expect.objectContaining({ outflowCurrentPeriod: 500 })]);
    });
  });

  describe('one account\'s metrics', () => {
    it('returns nothing for the other member\'s private account', async () => {
      const { partner, privateAccount } = await twoHouseholds();

      const response = await http.as(partner).get(`/v1/account/${privateAccount.accountKey}/metrics`);

      expect(response.status).toBe(200);
      expect(response.body.metrics).toEqual([]);
    });

    it('returns the owner\'s own private account', async () => {
      const { household, privateAccount } = await twoHouseholds();

      const response = await http.as(household.appuser).get(`/v1/account/${privateAccount.accountKey}/metrics`);

      expect(response.body.metrics).toEqual([expect.objectContaining({ accountKey: privateAccount.accountKey, outflowCurrentPeriod: 80 })]);
    });

    it('returns nothing for another household\'s account', async () => {
      const { household, neighbour } = await twoHouseholds();

      const response = await http.as(household.appuser).get(`/v1/account/${neighbour.account.accountKey}/metrics`);

      expect(response.body.metrics).toEqual([]);
    });
  });

  describe('monthly cashflow', () => {
    it('leaves the other member\'s private account out', async () => {
      const { partner } = await twoHouseholds();

      const response = await http.as(partner).get('/v1/account/cashflow');

      expect(response.status).toBe(200);
      expect(response.body.cashflow).toEqual([expect.objectContaining({ amount: -20 })]);
    });

    it('counts the owner\'s private account for the owner', async () => {
      const { household } = await twoHouseholds();

      const response = await http.as(household.appuser).get('/v1/account/cashflow');

      expect(response.body.cashflow).toEqual([expect.objectContaining({ amount: -100, date: expect.stringMatching(/^\d{4}-\d{2}-01T00:00:00\.000Z$/) })]);
    });

    it('shows another household only its own money', async () => {
      const { neighbour } = await twoHouseholds();

      const response = await http.as(neighbour.appuser).get('/v1/account/cashflow');

      expect(response.body.cashflow).toEqual([expect.objectContaining({ amount: -500 })]);
    });
  });
});
