import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { Portfolio } from '@entity/Portfolio';
import portfolioRoutes from '@route/portfolio';

/*
 * Linking a portfolio to the account that holds it. Any household member may link a household
 * portfolio to an account they can see. A private account stays private: the other member cannot
 * link to it, never sees that a portfolio is linked to it, and cannot undo or replace that link.
 */
describe('linking a portfolio to its account', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/portfolio', portfolioRoutes);

  let household: Household;
  let partner: Appuser;
  let outsider: Household;
  let brokerage: Account;
  let privateBrokerage: Account;
  let portfolioKey: number;

  beforeEach(async () => {
    const em = db.em();
    household = await seedHousehold(em);
    partner = await addPartner(em, household);
    outsider = await seedHousehold(em);
    brokerage = await addAccount(em, household, { name: 'Brokerage' });
    privateBrokerage = await addAccount(em, household, { isPrivate: true, name: 'Private brokerage' });
    const portfolio = em.create(Portfolio, { currencyKey: household.currency, name: 'Shares', portfolioOwnerAppuserKey: household.appuser, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    portfolioKey = portfolio.portfolioKey;
  });

  const storedLink = async () => {
    const portfolio = await db.em().findOneOrFail(Portfolio, { portfolioKey }, { filters: false });
    return { accountKey: portfolio.linkedAccountKey?.accountKey ?? null, mode: portfolio.accountBalanceMode ?? null, name: portfolio.name };
  };
  const link = (user: Appuser, account: Account, mode = 'includes_holdings') =>
    http.as(user).put(`/v1/portfolio/${portfolioKey}`).send({ accountLink: { accountId: account.accountKey, mode } });

  it('links a portfolio to an account with how its balance counts, and shows the link', async () => {
    expect((await link(household.appuser, brokerage, 'cash_only')).status).toBe(200);

    await expect(storedLink()).resolves.toMatchObject({ accountKey: brokerage.accountKey, mode: 'cash_only' });
    const { body } = await http.as(household.appuser).get(`/v1/portfolio/${portfolioKey}`);
    expect(body.portfolio.accountLink).toEqual({ accountKey: brokerage.accountKey, accountName: 'Brokerage', mode: 'cash_only' });
  });

  it('unlinks with a null link', async () => {
    await link(household.appuser, brokerage);

    expect((await http.as(household.appuser).put(`/v1/portfolio/${portfolioKey}`).send({ accountLink: null })).status).toBe(200);

    await expect(storedLink()).resolves.toMatchObject({ accountKey: null, mode: null });
  });

  it('refuses a link without the answer to how the balance counts', async () => {
    const response = await http.as(household.appuser).put(`/v1/portfolio/${portfolioKey}`).send({ accountLink: { accountId: brokerage.accountKey } });

    expect(response.status).toBe(400);
    await expect(storedLink()).resolves.toMatchObject({ accountKey: null });
  });

  it('refuses an account of another household', async () => {
    expect((await link(household.appuser, outsider.account)).status).toBe(404);

    await expect(storedLink()).resolves.toMatchObject({ accountKey: null });
  });

  it('lets the partner link a shared account', async () => {
    expect((await link(partner, brokerage)).status).toBe(200);

    await expect(storedLink()).resolves.toMatchObject({ accountKey: brokerage.accountKey });
  });

  it('can link when the portfolio is created', async () => {
    const response = await http.as(household.appuser).post('/v1/portfolio').send({ accountLink: { accountId: brokerage.accountKey, mode: 'includes_holdings' }, currencyId: household.currency.currencyKey, name: 'New' });

    expect(response.status).toBe(201);
    const created = await db.em().findOneOrFail(Portfolio, { portfolioKey: response.body.portfolio.portfolioKey }, { filters: false });
    expect(created).toMatchObject({ accountBalanceMode: 'includes_holdings', linkedAccountKey: { accountKey: brokerage.accountKey } });
  });

  describe('a private account', () => {
    it('lets its owner link it', async () => {
      expect((await link(household.appuser, privateBrokerage)).status).toBe(200);

      await expect(storedLink()).resolves.toMatchObject({ accountKey: privateBrokerage.accountKey });
    });

    it('does not let the other member link it', async () => {
      expect((await link(partner, privateBrokerage)).status).toBe(404);

      await expect(storedLink()).resolves.toMatchObject({ accountKey: null });
    });

    it('still shows the other member the portfolio, without the link', async () => {
      await link(household.appuser, privateBrokerage);

      const single = await http.as(partner).get(`/v1/portfolio/${portfolioKey}`);
      const list = await http.as(partner).get('/v1/portfolio');

      expect(single.status).toBe(200);
      expect(single.body.portfolio.accountLink).toBeNull();
      expect(list.body.portfolios).toEqual([expect.objectContaining({ accountLink: null, portfolioKey })]);
      expect(JSON.stringify([single.body, list.body])).not.toContain('Private brokerage');
    });

    it('keeps the link when the other member edits the portfolio', async () => {
      await link(household.appuser, privateBrokerage);

      expect((await http.as(partner).put(`/v1/portfolio/${portfolioKey}`).send({ name: 'Renamed' })).status).toBe(200);

      await expect(storedLink()).resolves.toEqual({ accountKey: privateBrokerage.accountKey, mode: 'includes_holdings', name: 'Renamed' });
    });

    it('does not let the other member replace or remove the link', async () => {
      await link(household.appuser, privateBrokerage);

      expect((await link(partner, brokerage)).status).toBe(403);
      expect((await http.as(partner).put(`/v1/portfolio/${portfolioKey}`).send({ accountLink: null })).status).toBe(403);

      await expect(storedLink()).resolves.toMatchObject({ accountKey: privateBrokerage.accountKey });
    });

    it('names the member who holds the link, and nothing about their account', async () => {
      await link(household.appuser, privateBrokerage);

      const response = await link(partner, brokerage);

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: 'portfolio_link_held_by_member', details: { linkedBy: 'Owner' } });
      expect(JSON.stringify(response.body)).not.toContain('Private brokerage');
      expect(JSON.stringify(response.body)).not.toContain(String(privateBrokerage.accountKey));
    });

    it('names the member by their email address when they have no first name', async () => {
      await link(household.appuser, privateBrokerage);
      await db.em().nativeUpdate(Appuser, { appuserKey: household.appuser.appuserKey }, { firstName: '  ' });

      const response = await http.as(partner).put(`/v1/portfolio/${portfolioKey}`).send({ accountLink: null });

      expect(response.status).toBe(403);
      expect(response.body.details).toEqual({ linkedBy: household.appuser.emailAddress });
    });
  });
});
