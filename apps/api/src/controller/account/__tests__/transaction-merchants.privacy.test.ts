import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addMerchant, addPartner, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import accountRoutes from '@route/account';

/*
 * The merchant picker lists the household's merchants. A merchant the household only knows from
 * one member's private account is part of that account's transactions, so the other member must
 * not see it; a merchant that also appears on something they can see stays listed for both.
 */
describe('transaction merchants and private accounts', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/account', accountRoutes);

  async function householdWithPrivateSpending() {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const privateAccount = await addAccount(em, household, { isPrivate: true });
    const privateOnly = await addMerchant(em, household, 'Private Clinic');
    const shared = await addMerchant(em, household, 'Supermarket');
    const unused = await addMerchant(em, household, 'Corner Shop');
    await addTransaction(em, household, { account: privateAccount, amount: -80, date: new Date(), merchant: privateOnly, status: 'BOOKED' });
    await addTransaction(em, household, { account: privateAccount, amount: -20, date: new Date(), merchant: shared, status: 'BOOKED' });
    await addTransaction(em, household, { amount: -30, date: new Date(), merchant: shared, status: 'BOOKED' });
    return { household, partner, privateOnly, shared, unused };
  }

  const names = (body: { transactionMerchants: { name: string }[] }) => body.transactionMerchants.map((merchant) => merchant.name).sort();

  it('hides a merchant seen only on another member\'s private account', async () => {
    const { partner } = await householdWithPrivateSpending();

    const response = await http.as(partner).get('/v1/account/transaction-merchants');

    expect(response.status).toBe(200);
    expect(names(response.body)).toEqual(['Corner Shop', 'Supermarket']);
  });

  it('hides it from a search for it as well', async () => {
    const { partner } = await householdWithPrivateSpending();

    const response = await http.as(partner).get('/v1/account/transaction-merchants?search=clinic');

    expect(names(response.body)).toEqual([]);
  });

  it('still lists it for the account owner', async () => {
    const { household } = await householdWithPrivateSpending();

    const response = await http.as(household.appuser).get('/v1/account/transaction-merchants');

    expect(names(response.body)).toEqual(['Corner Shop', 'Private Clinic', 'Supermarket']);
  });

  it('lists it again once the owner makes the account shared', async () => {
    const { household, partner } = await householdWithPrivateSpending();
    const accounts = await http.as(household.appuser).get('/v1/account');
    const privateAccount = (accounts.body.accounts as { accountKey: number; isPrivate: boolean }[]).find((account) => account.isPrivate);
    await http.as(household.appuser).patch(`/v1/account/${privateAccount?.accountKey}`).send({ isPrivate: false });

    const response = await http.as(partner).get('/v1/account/transaction-merchants');

    expect(names(response.body)).toEqual(['Corner Shop', 'Private Clinic', 'Supermarket']);
  });
});
