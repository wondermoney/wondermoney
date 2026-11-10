import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { addPartner, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addExchangeRate } from '@app/__tests__/__helpers__/portfolio-fixtures';
import type { Appuser } from '@entity/Appuser';
import type { Currency } from '@entity/Currency';
import { Loan } from '@entity/Loan';
import { LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';
import { ManualAssetKind } from '@service/manual-asset/manual-asset-types';
import { addValuation, createManualAsset, type CreateManualAssetInput, updateManualAsset } from '@service/manual-asset/manual-asset.service';
import { getNetWorthHistoryReport } from '@service/reports/netWorthHistory.service';

import { NetWorthService } from '../net-worth.service';

/*
 * Manually valued assets in net worth. The household's current account holds 1000 EUR and was
 * opened six months ago, so every history point counts it at 1000. Assets are added on top, each
 * at its latest valuation on or before the date, converted into the viewer's currency.
 */
describe('net worth with manually valued assets', () => {
  const db = useTestDatabase();

  const now = new Date();
  const monthsAgo = (months: number, dayOfMonth = 1) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, dayOfMonth));
  const endOfMonthAgo = (months: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 0));
  const isoDate = (date: Date) => date.toISOString().slice(0, 10);
  const pointOn = <T extends { date: string }>(history: { points: T[] }, date: Date) => history.points.find((point) => point.date === isoDate(date));

  async function household() {
    const em = db.em();
    const seeded = await seedHousehold(em);
    await em.getConnection().execute(
      'update "account" set "created_at" = ?, "appuser_currency_balance" = 1000, "opening_balance" = 1000, "opening_balance_date" = ? where "account_key" = ?',
      [monthsAgo(6), monthsAgo(6), seeded.account.accountKey],
    );
    return seeded;
  }

  const viewerOf = (appuser: Appuser, seeded: Household, currencyCode = 'EUR') => ({ appuserKey: appuser.appuserKey, currencyCode, tenantKey: seeded.tenant.tenantKey });

  async function addAsset(em: EntityManager, seeded: Household, input: Partial<CreateManualAssetInput> & { currency?: Currency; owner?: Appuser; value: number }) {
    const { currency, owner, ...rest } = input;
    return createManualAsset(em, viewerOf(owner ?? seeded.appuser, seeded), { currencyKey: (currency ?? seeded.currency).currencyKey, kind: ManualAssetKind.PROPERTY, name: 'Home', ...rest });
  }

  describe('today', () => {
    it('adds an asset to the total, under its own heading and row', async () => {
      const seeded = await household();
      const home = await addAsset(db.em(), seeded, { value: 250_000 });

      const summary = await new NetWorthService().getNetWorth(seeded.appuser);

      expect(summary).toMatchObject({ assets: { accounts: 1000, manualAssets: 250_000, portfolios: 0 }, isComplete: true, liabilities: { loans: 0 }, totalNetWorth: 251_000, unconvertedCurrencies: [] });
      expect(summary.rows).toContainEqual({ balance: 250_000, id: home.manualAssetKey, name: 'Home', type: 'manualAssets' });
    });

    it('counts each asset once: the total is accounts plus portfolios plus assets minus loans', async () => {
      const seeded = await household();
      const em = db.em();
      await addAsset(em, seeded, { value: 250_000 });
      await addAsset(em, seeded, { kind: ManualAssetKind.VEHICLE, name: 'Car', value: 9000 });
      em.create(Loan, { currencyKey: seeded.currency, includeInNetWorth: true, name: 'Mortgage', openingBalanceDate: new Date('2026-01-01'), openingPrincipalBalance: 180_000, ownerAppuserKey: seeded.appuser, paymentFrequency: LoanPaymentFrequency.MONTHLY, rateType: LoanRateType.FIXED, status: LoanStatus.ACTIVE, tenantKey: seeded.tenant, type: LoanType.MORTGAGE }, { partial: true });
      await em.flush();

      const summary = await new NetWorthService().getNetWorth(seeded.appuser);

      expect(summary.assets).toEqual({ accounts: 1000, manualAssets: 259_000, portfolios: 0 });
      expect(summary.liabilities.loans).toBe(180_000);
      expect(summary.totalNetWorth).toBe(80_000);
      expect(summary.rows.filter((row) => row.type === 'manualAssets')).toHaveLength(2);
      expect(summary.rows.reduce((total, row) => total + row.balance, 0)).toBe(summary.totalNetWorth);
    });

    it('uses the latest valuation, not an older or a backdated one', async () => {
      const seeded = await household();
      const em = db.em();
      const home = await addAsset(em, seeded, { valuationDate: monthsAgo(3), value: 200_000 });
      await addValuation(em, viewerOf(seeded.appuser, seeded), home.manualAssetKey, { date: monthsAgo(1), value: 230_000 });
      await addValuation(em, viewerOf(seeded.appuser, seeded), home.manualAssetKey, { date: monthsAgo(5), value: 150_000 });

      const summary = await new NetWorthService().getNetWorth(seeded.appuser);

      expect(summary.assets.manualAssets).toBe(230_000);
    });

    it('never counts another household\'s asset', async () => {
      const mine = await household();
      const theirs = await household();
      await addAsset(db.em(), theirs, { value: 900_000 });

      const summary = await new NetWorthService().getNetWorth(mine.appuser);

      expect(summary).toMatchObject({ assets: { manualAssets: 0 }, totalNetWorth: 1000 });
      expect(summary.rows.filter((row) => row.type === 'manualAssets')).toEqual([]);
    });

    it('keeps the owner\'s private asset out of the partner\'s total and rows', async () => {
      const seeded = await household();
      const em = db.em();
      const partner = await addPartner(em, seeded);
      await addAsset(em, seeded, { name: 'Shared car', value: 9000 });
      await addAsset(em, seeded, { isPrivate: true, name: 'Watch', value: 4000 });

      const forOwner = await new NetWorthService().getNetWorth(seeded.appuser);
      const forPartner = await new NetWorthService().getNetWorth(partner);

      expect(forOwner.assets.manualAssets).toBe(13_000);
      expect(forPartner.assets.manualAssets).toBe(9000);
      expect(forPartner.totalNetWorth).toBe(10_000);
      expect(forPartner.rows.map((row) => row.name)).not.toContain('Watch');
      expect(JSON.stringify(forPartner)).not.toContain('Watch');
    });

    it('leaves an archived asset out', async () => {
      const seeded = await household();
      const em = db.em();
      const car = await addAsset(em, seeded, { name: 'Car', value: 9000 });
      await updateManualAsset(em, viewerOf(seeded.appuser, seeded), car.manualAssetKey, { archived: true });

      const summary = await new NetWorthService().getNetWorth(seeded.appuser);

      expect(summary).toMatchObject({ assets: { manualAssets: 0 }, isComplete: true, totalNetWorth: 1000 });
    });

    it('converts an asset in another currency at the latest rate', async () => {
      const seeded = await household();
      const em = db.em();
      const usd = await currencyFor(em, 'USD');
      await addExchangeRate(em, usd, seeded.currency, isoDate(monthsAgo(2)), 0.8);
      await addExchangeRate(em, usd, seeded.currency, isoDate(monthsAgo(1)), 0.9);
      await addAsset(em, seeded, { currency: usd, name: 'Flat abroad', value: 100_000 });

      const summary = await new NetWorthService().getNetWorth(seeded.appuser);

      expect(summary).toMatchObject({ assets: { manualAssets: 90_000 }, isComplete: true, totalNetWorth: 91_000 });
    });

    it('with mixed currencies and one rate missing, counts what converts and reports the rest', async () => {
      const seeded = await household();
      const em = db.em();
      const usd = await currencyFor(em, 'USD');
      const jpy = await currencyFor(em, 'JPY');
      await addExchangeRate(em, usd, seeded.currency, isoDate(monthsAgo(1)), 0.9);
      await addAsset(em, seeded, { value: 250_000 });
      await addAsset(em, seeded, { currency: usd, name: 'Flat abroad', value: 100_000 });
      await addAsset(em, seeded, { currency: jpy, name: 'Cabin', value: 9_000_000 });

      const summary = await new NetWorthService().getNetWorth(seeded.appuser);

      // The cabin is neither added at face value (9 000 000) nor at a rate of 1.
      expect(summary.assets.manualAssets).toBe(340_000);
      expect(summary.totalNetWorth).toBe(341_000);
      expect(summary.isComplete).toBe(false);
      expect(summary.unsupportedCurrencies).toEqual({ accounts: 0, loans: 0, manualAssets: 1, portfolios: 0 });
      expect(summary.unconvertedCurrencies).toEqual(['JPY']);
      expect(summary.rows.map((row) => row.name)).not.toContain('Cabin');
    });

    it('shows the partner the household\'s asset in the partner\'s own currency', async () => {
      const seeded = await household();
      const em = db.em();
      const usd = await currencyFor(em, 'USD');
      const partner = await addPartner(em, seeded, { currency: usd });
      await addExchangeRate(em, seeded.currency, usd, isoDate(monthsAgo(1)), 1.1);
      await addAsset(em, seeded, { value: 100_000 });

      const summary = await new NetWorthService().getNetWorth(partner);

      expect(summary).toMatchObject({ assets: { manualAssets: 110_000 }, currencyCode: 'USD' });
    });
  });

  describe('history', () => {
    it('values the asset at each point by its latest valuation on or before that date', async () => {
      const seeded = await household();
      const em = db.em();
      const home = await addAsset(em, seeded, { valuationDate: monthsAgo(3, 10), value: 200_000 });
      await addValuation(em, viewerOf(seeded.appuser, seeded), home.manualAssetKey, { date: monthsAgo(1, 15), value: 230_000 });

      const history = await new NetWorthService().getNetWorthHistory(seeded.appuser, { months: 6 });

      // Before the first valuation the asset is not counted, and the point is still complete.
      expect(pointOn(history, endOfMonthAgo(4))).toMatchObject({ accountsTotal: 1000, isComplete: true, manualAssetsTotal: 0, totalNetWorth: 1000 });
      expect(pointOn(history, endOfMonthAgo(3))).toMatchObject({ isComplete: true, manualAssetsTotal: 200_000, totalNetWorth: 201_000 });
      expect(pointOn(history, endOfMonthAgo(2))).toMatchObject({ manualAssetsTotal: 200_000, totalNetWorth: 201_000 });
      expect(pointOn(history, endOfMonthAgo(1))).toMatchObject({ manualAssetsTotal: 230_000, totalNetWorth: 231_000 });
      expect(history.points.at(-1)).toMatchObject({ date: isoDate(now), manualAssetsTotal: 230_000, totalNetWorth: 231_000 });
    });

    it('steps on the day of a valuation, not at the next month end', async () => {
      const seeded = await household();
      const em = db.em();
      const home = await addAsset(em, seeded, { valuationDate: monthsAgo(3, 10), value: 200_000 });
      await addValuation(em, viewerOf(seeded.appuser, seeded), home.manualAssetKey, { date: monthsAgo(1, 15), value: 230_000 });

      const history = await new NetWorthService().getNetWorthHistory(seeded.appuser, { months: 6 });

      expect(pointOn(history, monthsAgo(1, 15))).toMatchObject({ manualAssetsTotal: 230_000, totalNetWorth: 231_000 });
      expect(pointOn(history, monthsAgo(3, 10))).toMatchObject({ manualAssetsTotal: 200_000, totalNetWorth: 201_000 });
    });

    it('ends today on the same figure as the net worth summary', async () => {
      const seeded = await household();
      const em = db.em();
      await addAsset(em, seeded, { growthRule: { annualRatePercent: 5 }, valuationDate: monthsAgo(3, 10), value: 200_000 });

      const service = new NetWorthService();
      const [summary, history] = await Promise.all([service.getNetWorth(seeded.appuser), service.getNetWorthHistory(seeded.appuser, { months: 3 })]);

      expect(history.points.at(-1)).toMatchObject({ manualAssetsTotal: summary.assets.manualAssets, totalNetWorth: summary.totalNetWorth });
      expect(summary.assets.manualAssets).toBeGreaterThan(200_000);
    });

    it('grows between valuations when the asset has a growth rule', async () => {
      const seeded = await household();
      await addAsset(db.em(), seeded, { growthRule: { annualRatePercent: 10 }, valuationDate: monthsAgo(4, 1), value: 100_000 });

      const history = await new NetWorthService().getNetWorthHistory(seeded.appuser, { months: 4 });

      const [first, second] = [pointOn(history, endOfMonthAgo(3)), pointOn(history, endOfMonthAgo(2))];
      expect(first?.manualAssetsTotal).toBeGreaterThan(100_000);
      expect(second?.manualAssetsTotal).toBeGreaterThan(first?.manualAssetsTotal ?? Infinity);
    });

    it('converts at the rate in force at each point, not today\'s', async () => {
      const seeded = await household();
      const em = db.em();
      const usd = await currencyFor(em, 'USD');
      await addExchangeRate(em, usd, seeded.currency, isoDate(monthsAgo(12)), 0.8);
      await addExchangeRate(em, usd, seeded.currency, isoDate(monthsAgo(1, 5)), 0.9);
      await addAsset(em, seeded, { currency: usd, valuationDate: monthsAgo(4), value: 100_000 });

      const history = await new NetWorthService().getNetWorthHistory(seeded.appuser, { months: 4 });

      expect(pointOn(history, endOfMonthAgo(2))).toMatchObject({ manualAssetsTotal: 80_000, totalNetWorth: 81_000 });
      expect(pointOn(history, endOfMonthAgo(1))).toMatchObject({ manualAssetsTotal: 90_000, totalNetWorth: 91_000 });
    });

    it('leaves a point incomplete, with no total, when an asset has no rate on that date', async () => {
      const seeded = await household();
      const em = db.em();
      const usd = await currencyFor(em, 'USD');
      // The first rate is published a month ago: earlier points have none.
      await addExchangeRate(em, usd, seeded.currency, isoDate(monthsAgo(1, 5)), 0.9);
      await addAsset(em, seeded, { currency: usd, valuationDate: monthsAgo(4), value: 100_000 });

      const history = await new NetWorthService().getNetWorthHistory(seeded.appuser, { months: 4 });

      expect(pointOn(history, endOfMonthAgo(2))).toMatchObject({ accountsTotal: 1000, isComplete: false, manualAssetsTotal: null, totalNetWorth: null });
      expect(pointOn(history, endOfMonthAgo(1))).toMatchObject({ isComplete: true, manualAssetsTotal: 90_000, totalNetWorth: 91_000 });
    });

    it('marks today incomplete when an asset cannot be converted today', async () => {
      const seeded = await household();
      const em = db.em();
      const jpy = await currencyFor(em, 'JPY');
      await addAsset(em, seeded, { currency: jpy, value: 9_000_000 });

      const history = await new NetWorthService().getNetWorthHistory(seeded.appuser, { months: 2 });

      expect(history.points.at(-1)).toMatchObject({ isComplete: false, manualAssetsTotal: 0, totalNetWorth: 1000 });
    });

    it('keeps an archived asset in the history before it was archived', async () => {
      const seeded = await household();
      const em = db.em();
      const car = await addAsset(em, seeded, { name: 'Car', valuationDate: monthsAgo(3, 10), value: 9000 });
      await updateManualAsset(em, viewerOf(seeded.appuser, seeded), car.manualAssetKey, { archived: true });

      const history = await new NetWorthService().getNetWorthHistory(seeded.appuser, { months: 4 });

      expect(pointOn(history, endOfMonthAgo(2))).toMatchObject({ manualAssetsTotal: 9000, totalNetWorth: 10_000 });
      expect(history.points.at(-1)).toMatchObject({ manualAssetsTotal: 0, totalNetWorth: 1000 });
    });

    it('never shows the partner the owner\'s private asset, at any point', async () => {
      const seeded = await household();
      const em = db.em();
      const partner = await addPartner(em, seeded);
      await addAsset(em, seeded, { isPrivate: true, name: 'Watch', valuationDate: monthsAgo(3, 10), value: 4000 });
      await addAsset(em, seeded, { name: 'Shared car', valuationDate: monthsAgo(3, 10), value: 9000 });

      const forPartner = await new NetWorthService().getNetWorthHistory(partner, { months: 4 });
      const forOwner = await new NetWorthService().getNetWorthHistory(seeded.appuser, { months: 4 });

      for (const point of forPartner.points) expect([0, 9000]).toContain(point.manualAssetsTotal);
      expect(pointOn(forPartner, endOfMonthAgo(1))?.manualAssetsTotal).toBe(9000);
      expect(pointOn(forOwner, endOfMonthAgo(1))?.manualAssetsTotal).toBe(13_000);
      // The private asset's valuation day is not a point of the partner's history either.
      const privateOnly = await household();
      const lodger = await addPartner(em, privateOnly);
      await addAsset(em, privateOnly, { isPrivate: true, name: 'Ring', valuationDate: monthsAgo(2, 17), value: 500 });
      expect(pointOn(await new NetWorthService().getNetWorthHistory(lodger, { months: 4 }), monthsAgo(2, 17))).toBeUndefined();
    });

    it('never counts another household\'s asset at any point', async () => {
      const mine = await household();
      const theirs = await household();
      await addAsset(db.em(), theirs, { valuationDate: monthsAgo(3, 10), value: 900_000 });

      const history = await new NetWorthService().getNetWorthHistory(mine.appuser, { months: 4 });

      for (const point of history.points) expect(point).toMatchObject({ manualAssetsTotal: 0, totalNetWorth: 1000 });
    });

    it('counts assets as assets in the net worth history report', async () => {
      const seeded = await household();
      await addAsset(db.em(), seeded, { valuationDate: monthsAgo(3, 10), value: 200_000 });

      const rows = await getNetWorthHistoryReport({ filters: {}, tenant: seeded.tenant, user: seeded.appuser } as Parameters<typeof getNetWorthHistoryReport>[0]);

      expect(rows.at(-1)).toMatchObject({ breakdown: { assets: 201_000, liabilities: 0 }, netWorth: 201_000 });
    });
  });
});
