import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import type { EntityManager } from '@mikro-orm/postgresql';

import { addAccount, addOwnership, addPartner, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { setTenantContext } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { parseMemberFilter, SHARED_MEMBER } from '@service/household/member-attribution';
import { NetWorthService } from '@service/net-worth/net-worth.service';
import { roundDisplay } from '@utils/money';

/*
 * Ownership shares in per-member net worth. The owner keeps their books in EUR, the partner in USD
 * (1 EUR = 1.25 USD, 1 USD = 0.8 EUR); Kid in EUR; a former member has left.
 *
 *   A  the owner's current account      1000 EUR   owner 60 / partner 40
 *   B  the partner's account             500 USD   partner 50 / Kid 25 / owner 25   (400 EUR)
 *   C  a joint account                   300 EUR   owner 50 / partner 50            (joint, but split)
 *   D  a joint account                    70 EUR   no shares: Shared
 *   E  the owner's credit card       -333.33 EUR   owner 33.33 / partner 33.33 / Kid 33.34
 *   F  the owner's savings               100 EUR   owner 70 / the former member 30
 *   G  the owner's private account       200 EUR   no shares: the owner's
 *   H  the partner's private account    5000 USD   partner 50 / owner 50, never shown to the owner
 *
 * For the owner (EUR): owner 600 + 100 + 150 - 111.0989 + 70 + 200 = 1008.9011, partner
 * 400 + 200 + 150 - 111.0989 = 638.9011, Kid 100 - 111.1322 = -11.1322, Shared 70 + 30 = 100;
 * household 1736.67.
 */
describe('ownership shares in per-member net worth', () => {
  const db = useTestDatabase();
  const service = new NetWorthService();
  const DAY = 86_400_000;
  const longAgo = new Date(Date.now() - 400 * DAY);
  const opened = new Date(Date.now() - 200 * DAY);

  interface Scenario {
    accounts: Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H', Account>;
    former: Appuser;
    household: Household;
    kid: Appuser;
    owner: Appuser;
    partner: Appuser;
  }
  let scenario: Scenario;

  async function addRate(em: EntityManager, from: Currency, to: Currency, rate: number) {
    em.create(ExchangeRate, { date: longAgo, fromCurrency: from, rate, toCurrency: to }, { partial: true });
    await em.flush();
  }

  async function seed(): Promise<Scenario> {
    const em = db.em();
    const household = await seedHousehold(em);
    const owner = household.appuser;
    const eur = household.currency;
    const usd = await currencyFor(em, 'USD');
    await addRate(em, eur, usd, 1.25);
    await addRate(em, usd, eur, 0.8);
    const partner = await addPartner(em, household, { currency: usd });
    const kid = await addPartner(em, household);
    const former = await addPartner(em, household);

    const A = household.account;
    A.appuserCurrencyBalance = 1000;
    const account = (balance: number, input: Parameters<typeof addAccount>[2] = {}) => addAccount(em, household, { appuserCurrencyBalance: balance, balance, ...input });
    const B = await account(500, { currency: usd, name: 'B', owner: partner });
    const C = await account(300, { name: 'C' });
    const D = await account(70, { name: 'D' });
    C.isJoint = true;
    D.isJoint = true;
    const E = await account(-333.33, { name: 'E' });
    const F = await account(100, { name: 'F' });
    const G = await account(200, { isPrivate: true, name: 'G' });
    const H = await account(5000, { currency: usd, isPrivate: true, name: 'H', owner: partner });
    await em.flush();
    // Every account opened at its balance long ago, so the history has points to split.
    for (const opening of [A, B, C, D, E, F, G, H]) {
      await em.nativeUpdate(Account, { accountKey: opening.accountKey }, { createdAt: opened, openingBalance: opening.balance ?? 0, openingBalanceDate: opened }, { filters: false });
    }
    return { accounts: { A, B, C, D, E, F, G, H }, former, household, kid, owner, partner };
  }

  async function addShares() {
    const em = db.em();
    const { accounts: { A, B, C, E, F, H }, former, household, kid, owner, partner } = scenario;
    await addOwnership(em, household, A, [[owner, 6000], [partner, 4000]]);
    await addOwnership(em, household, B, [[partner, 5000], [kid, 2500], [owner, 2500]]);
    await addOwnership(em, household, C, [[owner, 5000], [partner, 5000]]);
    await addOwnership(em, household, E, [[owner, 3333], [partner, 3333], [kid, 3334]]);
    await addOwnership(em, household, F, [[owner, 7000], [former, 3000]]);
    await addOwnership(em, household, H, [[partner, 5000], [owner, 5000]]);
    const membership = await em.findOneOrFail(AppuserTenant, { appuserKey: former, tenantKey: household.tenant });
    membership.recordActive = false;
    await em.flush();
  }

  beforeEach(async () => {
    scenario = await seed();
  });

  // Net worth reads accounts through the tenant filter, armed for the viewer as a request arms it.
  const asViewer = (viewer: Appuser) => {
    DI.em = db.em();
    setTenantContext(DI.em, { appuserKey: viewer.appuserKey, tenantKey: scenario.household.tenant.tenantKey });
  };
  const members = (part?: string) => parseMemberFilter(part === undefined ? undefined : [part]);
  const netWorth = (part?: string, viewer: Appuser = scenario.owner) => {
    asViewer(viewer);
    return service.getNetWorth(viewer, { members: members(part) });
  };
  const history = (part?: string, viewer: Appuser = scenario.owner) => {
    asViewer(viewer);
    return service.getNetWorthHistory(viewer, { members: members(part), months: 3 });
  };
  const parts = () => [scenario.owner, scenario.partner, scenario.kid].map((member) => String(member.appuserKey)).concat(SHARED_MEMBER);
  const sum = (values: number[]) => roundDisplay(values.reduce((total, value) => total + value, 0));

  it('splits each account by its shares, and the members plus Shared add up to the household, across currencies', async () => {
    await addShares();

    const totals = await Promise.all(parts().map(async (part) => (await netWorth(part)).totalNetWorth));

    expect(totals.map(roundDisplay)).toEqual([1008.9, 638.9, -11.13, 100]);
    expect(sum(totals)).toBe(roundDisplay((await netWorth()).totalNetWorth));
    expect(roundDisplay((await netWorth()).totalNetWorth)).toBe(1736.67);
  });

  it('adds up for a viewer in another currency too, with their own private account in their figure', async () => {
    await addShares();
    const { partner } = scenario;

    const totals = await Promise.all(parts().map(async (part) => (await netWorth(part, partner)).totalNetWorth));
    const household = await netWorth(undefined, partner);

    expect(household.currencyCode).toBe('USD');
    expect(sum(totals)).toBe(roundDisplay(household.totalNetWorth));
    // The partner's half of their private 5000 USD is in their figure; the owner's private account is not theirs to see.
    const own = await netWorth(String(partner.appuserKey), partner);
    expect(own.rows.find((row) => row.id === scenario.accounts.H.accountKey)).toMatchObject({ balance: 2500, sharePercent: 50 });
  });

  it('splits a liability like an asset', async () => {
    await addShares();

    const card = async (part: string) => (await netWorth(part)).rows.find((row) => row.id === scenario.accounts.E.accountKey);

    expect(await card(String(scenario.owner.appuserKey))).toMatchObject({ balance: -111.0989, sharePercent: 33.33 });
    expect(await card(String(scenario.kid.appuserKey))).toMatchObject({ balance: -111.1322, sharePercent: 33.34 });
    expect(await card(SHARED_MEMBER)).toBeUndefined();
  });

  it('leaves out an account hidden from the viewer, whatever share it gives them', async () => {
    await addShares();

    const own = await netWorth(String(scenario.owner.appuserKey));

    expect(own.rows.map((row) => row.id)).not.toContain(scenario.accounts.H.accountKey);
    expect(roundDisplay(own.totalNetWorth)).toBe(1008.9);
  });

  it('counts only former members\' shares of a split account as Shared, and a joint account with no shares wholly', async () => {
    await addShares();

    const shared = await netWorth(SHARED_MEMBER);

    expect(shared.rows.map((row) => [row.id, row.balance])).toEqual(expect.arrayContaining([[scenario.accounts.D.accountKey, 70], [scenario.accounts.F.accountKey, 30]]));
    expect(shared.rows).toHaveLength(2);
  });

  it('gives a former member\'s share back to them when they rejoin', async () => {
    await addShares();
    const em = db.em();
    await em.nativeUpdate(AppuserTenant, { appuserKey: scenario.former, tenantKey: scenario.household.tenant }, { recordActive: true });

    expect((await netWorth(String(scenario.former.appuserKey))).totalNetWorth).toBe(30);
    expect((await netWorth(SHARED_MEMBER)).totalNetWorth).toBe(70);
  });

  it('leaves the household\'s net worth and history exactly as they were', async () => {
    const before = await netWorth();
    const historyBefore = await history();

    await addShares();

    expect(await netWorth()).toEqual(before);
    expect(await history()).toEqual(historyBefore);
  });

  it('applies today\'s shares at every point of a member\'s history, and every point adds up to the household\'s', async () => {
    await addShares();

    const household = await history();
    const byPart = await Promise.all(parts().map((part) => history(part)));

    expect(household.points.length).toBeGreaterThanOrEqual(3);
    household.points.forEach((point, index) => {
      expect(point.isComplete).toBe(true);
      expect(sum(byPart.map((member) => member.points[index]?.totalNetWorth ?? Number.NaN))).toBe(roundDisplay(point.totalNetWorth));
    });
    expect(byPart[0]?.points.map((point) => roundDisplay(point.totalNetWorth))).toEqual(household.points.map(() => 1008.9));
  });
});
