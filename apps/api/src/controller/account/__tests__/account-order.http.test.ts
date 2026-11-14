import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Account } from '@entity/Account';
import { AppuserAccountPosition } from '@entity/AppuserAccountPosition';
import accountRoutes from '@route/account';

/*
 * Account order is per member, not per household: each person keeps their own list, and an
 * account the caller cannot see (another household's, or the other member's private one) is
 * refused rather than silently ordered.
 */
describe('PUT /v1/account/order', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/account', accountRoutes);

  const keysOf = (response: { body: { accounts: { accountKey: number }[] } }) =>
    response.body.accounts.map((account) => account.accountKey);

  async function seedClosedAccount(household: Household, name: string): Promise<Account> {
    const em = db.em();
    const account = em.create(Account, {
      accountName: name,
      accountOwnerAppuserKey: household.appuser,
      balance: 0,
      closed: true,
      currencyKey: household.currency,
      isPrivate: false,
      tenantKey: household.tenant,
    }, { partial: true });
    await em.flush();
    return account;
  }

  it('saves the caller\'s order and returns it from the accounts list', async () => {
    const household = await seedHousehold(db.em());
    const alpha = await addAccount(db.em(), household, { name: 'Alpha' });
    const beta = await addAccount(db.em(), household, { name: 'Beta' });

    const saved = await http.as(household.appuser).put('/v1/account/order').send({ accountIds: [beta.accountKey, alpha.accountKey] });
    expect(saved.status).toBe(200);

    const list = await http.as(household.appuser).get('/v1/account');
    expect(list.status).toBe(200);
    expect(keysOf(list)).toEqual([beta.accountKey, alpha.accountKey, household.account.accountKey]);
  });

  it('rejects an account from another household and writes nothing', async () => {
    const household = await seedHousehold(db.em());
    const alpha = await addAccount(db.em(), household, { name: 'Alpha' });
    const beta = await addAccount(db.em(), household, { name: 'Beta' });
    const other = await seedHousehold(db.em());
    const foreign = await addAccount(db.em(), other, { name: 'Foreign' });

    const response = await http.as(household.appuser).put('/v1/account/order').send({ accountIds: [alpha.accountKey, foreign.accountKey] });

    expect(response.status).toBe(400);
    await expect(db.em().count(AppuserAccountPosition, {})).resolves.toBe(0);
    const list = await http.as(household.appuser).get('/v1/account');
    expect(keysOf(list)).toEqual([alpha.accountKey, beta.accountKey, household.account.accountKey]);
  });

  it('rejects another member\'s private account', async () => {
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    const shared = await addAccount(db.em(), household, { name: 'Shared' });
    const privateAccount = await addAccount(db.em(), household, { isPrivate: true, name: 'Private', owner: partner });

    const response = await http.as(household.appuser).put('/v1/account/order').send({ accountIds: [shared.accountKey, privateAccount.accountKey] });

    expect(response.status).toBe(400);
    await expect(db.em().count(AppuserAccountPosition, {})).resolves.toBe(0);
  });

  it('keeps each member\'s order to themselves', async () => {
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    const alpha = await addAccount(db.em(), household, { name: 'Alpha' });
    const beta = await addAccount(db.em(), household, { name: 'Beta' });

    await http.as(household.appuser).put('/v1/account/order').send({ accountIds: [beta.accountKey, alpha.accountKey] });
    await http.as(partner).put('/v1/account/order').send({ accountIds: [alpha.accountKey, beta.accountKey] });

    const ownerList = await http.as(household.appuser).get('/v1/account');
    const partnerList = await http.as(partner).get('/v1/account');
    expect(keysOf(ownerList)).toEqual([beta.accountKey, alpha.accountKey, household.account.accountKey]);
    expect(keysOf(partnerList)).toEqual([alpha.accountKey, beta.accountKey, household.account.accountKey]);
  });

  it('puts unordered and new accounts after ordered ones, by name', async () => {
    const household = await seedHousehold(db.em());
    const zulu = await addAccount(db.em(), household, { name: 'Zulu' });
    const alpha = await addAccount(db.em(), household, { name: 'Alpha' });
    const mike = await addAccount(db.em(), household, { name: 'Mike' });

    await http.as(household.appuser).put('/v1/account/order').send({ accountIds: [mike.accountKey] });

    const ordered = await http.as(household.appuser).get('/v1/account');
    expect(keysOf(ordered)).toEqual([mike.accountKey, alpha.accountKey, household.account.accountKey, zulu.accountKey]);

    const beta = await addAccount(db.em(), household, { name: 'Beta' });
    const withNew = await http.as(household.appuser).get('/v1/account');
    expect(keysOf(withNew)).toEqual([mike.accountKey, alpha.accountKey, beta.accountKey, household.account.accountKey, zulu.accountKey]);
  });

  it('ignores closed accounts instead of ordering them', async () => {
    const household = await seedHousehold(db.em());
    const alpha = await addAccount(db.em(), household, { name: 'Alpha' });
    const beta = await addAccount(db.em(), household, { name: 'Beta' });
    const closed = await seedClosedAccount(household, 'Aaa closed');

    const response = await http.as(household.appuser).put('/v1/account/order').send({ accountIds: [alpha.accountKey, closed.accountKey, beta.accountKey] });

    expect(response.status).toBe(200);
    await expect(db.em().count(AppuserAccountPosition, {})).resolves.toBe(2);
    const list = await http.as(household.appuser).get('/v1/account');
    expect(keysOf(list)).toEqual([alpha.accountKey, beta.accountKey, closed.accountKey, household.account.accountKey]);
  });

  it('leaves the saved order untouched when a later request is refused', async () => {
    const household = await seedHousehold(db.em());
    const alpha = await addAccount(db.em(), household, { name: 'Alpha' });
    const beta = await addAccount(db.em(), household, { name: 'Beta' });
    const other = await seedHousehold(db.em());
    const foreign = await addAccount(db.em(), other, { name: 'Foreign' });

    await http.as(household.appuser).put('/v1/account/order').send({ accountIds: [beta.accountKey, alpha.accountKey] });
    const refused = await http.as(household.appuser).put('/v1/account/order').send({ accountIds: [alpha.accountKey, foreign.accountKey] });
    expect(refused.status).toBe(400);

    const list = await http.as(household.appuser).get('/v1/account');
    expect(keysOf(list)).toEqual([beta.accountKey, alpha.accountKey, household.account.accountKey]);
  });
});
