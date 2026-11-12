import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addPartner, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Appuser } from '@entity/Appuser';
import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { ExchangeRateOverride } from '@entity/ExchangeRateOverride';
import { Loan } from '@entity/Loan';
import { LoanAdjustment } from '@entity/LoanAdjustment';
import loanRoutes from '@route/loan';
import manualAssetRoutes from '@route/manual-asset';
import { LoanAdjustmentType } from '@service/loan/loan-types';

/*
 * A loan can say which of the household's assets it finances (a mortgage on the home). The link is
 * presentation only: the asset shows its value, the debt secured against it and the equity
 * between them, in the asset's currency. A member's loans are their own, so the equity an asset
 * shows is against the viewer's loans.
 */
describe('a loan secured against an asset', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const loans = tenantHttp('/v1/loan', loanRoutes);
  const assets = tenantHttp('/v1/manual-assets', manualAssetRoutes);

  interface LinkedLoan { currency: string; loanKey: number; name: string; outstandingPrincipal: number; outstandingPrincipalInAssetCurrency: null | number }
  interface AssetDto { equity: null | number; linkedDebt: null | number; linkedLoans: LinkedLoan[]; manualAssetKey: number; unconvertedLoanCurrencies: string[]; value: null | number }
  interface LoanDto { loanKey: number; outstandingPrincipal: number; securedAsset: null | { currency: string; key: number; name: string; value: null | number } }

  const DAY_MS = 86_400_000;
  const isoDaysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

  async function households() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const neighbour = await seedHousehold(em);
    return { neighbour, owner, partner };
  }

  async function createAsset(user: Appuser, household: Household, body: Record<string, unknown> = {}): Promise<AssetDto> {
    const response = await assets.as(user).post('/v1/manual-assets').send({ currencyKey: household.currency.currencyKey, kind: 'property', name: 'Home', value: 300_000, ...body });
    expect(response.status).toBe(201);
    return response.body.asset as AssetDto;
  }

  function postLoan(user: Appuser, currency: Currency, body: Record<string, unknown> = {}) {
    return loans.as(user).post('/v1/loan').send({ currencyKey: currency.currencyKey, name: 'Mortgage', openingBalanceDate: '2026-01-01', openingPrincipalBalance: 200_000, type: 'MORTGAGE', ...body });
  }

  async function createLoan(user: Appuser, currency: Currency, body: Record<string, unknown> = {}): Promise<LoanDto> {
    const response = await postLoan(user, currency, body);
    expect(response.status).toBe(201);
    return response.body.loan as LoanDto;
  }

  async function assetFor(user: Appuser, asset: AssetDto): Promise<AssetDto> {
    const response = await assets.as(user).get(`/v1/manual-assets/${asset.manualAssetKey}`);
    expect(response.status).toBe(200);
    return response.body.asset as AssetDto;
  }

  async function loanFor(user: Appuser, loan: LoanDto): Promise<LoanDto> {
    const response = await loans.as(user).get(`/v1/loan/${loan.loanKey}`);
    expect(response.status).toBe(200);
    return response.body.loan as LoanDto;
  }

  describe('linking', () => {
    it('links a new loan to an asset and names the asset on the loan', async () => {
      const { owner } = await households();
      const home = await createAsset(owner.appuser, owner);

      const loan = await createLoan(owner.appuser, owner.currency, { securedAssetKey: home.manualAssetKey });

      expect(loan.securedAsset).toEqual({ currency: 'EUR', key: home.manualAssetKey, name: 'Home', value: 300_000 });
      const listed = await loans.as(owner.appuser).get('/v1/loan');
      expect(listed.body.loans[0].securedAsset).toMatchObject({ key: home.manualAssetKey });
      expect((await loans.as(owner.appuser).get(`/v1/loan/${loan.loanKey}/summary`)).body.loan.securedAsset).toMatchObject({ key: home.manualAssetKey });
    });

    it('links, moves and unlinks an existing loan', async () => {
      const { owner } = await households();
      const home = await createAsset(owner.appuser, owner);
      const car = await createAsset(owner.appuser, owner, { kind: 'vehicle', name: 'Car', value: 20_000 });
      const loan = await createLoan(owner.appuser, owner.currency);
      expect(loan.securedAsset).toBeNull();
      const patch = (body: Record<string, unknown>) => loans.as(owner.appuser).patch(`/v1/loan/${loan.loanKey}`).send(body);

      expect((await patch({ securedAssetKey: home.manualAssetKey })).body.loan.securedAsset).toMatchObject({ key: home.manualAssetKey });
      expect((await patch({ securedAssetKey: car.manualAssetKey })).body.loan.securedAsset).toMatchObject({ key: car.manualAssetKey, name: 'Car' });
      expect((await patch({ name: 'Renamed' })).body.loan.securedAsset).toMatchObject({ key: car.manualAssetKey });
      expect((await assetFor(owner.appuser, home)).linkedLoans).toEqual([]);

      const unlinked = await patch({ securedAssetKey: null });

      expect(unlinked.status).toBe(200);
      expect(unlinked.body.loan.securedAsset).toBeNull();
      expect((await assetFor(owner.appuser, car)).linkedLoans).toEqual([]);
    });

    it("links to the household's shared asset, whoever added it", async () => {
      const { owner, partner } = await households();
      const home = await createAsset(owner.appuser, owner);

      const loan = await createLoan(partner, owner.currency, { securedAssetKey: home.manualAssetKey });

      expect(loan.securedAsset).toMatchObject({ key: home.manualAssetKey });
    });

    it("answers 404 for another household's asset and leaves the loan as it was", async () => {
      const { neighbour, owner } = await households();
      const theirs = await createAsset(neighbour.appuser, neighbour, { name: 'Their flat' });
      const loan = await createLoan(owner.appuser, owner.currency);

      expect((await postLoan(owner.appuser, owner.currency, { securedAssetKey: theirs.manualAssetKey })).status).toBe(404);
      expect((await loans.as(owner.appuser).patch(`/v1/loan/${loan.loanKey}`).send({ name: 'Taken', securedAssetKey: theirs.manualAssetKey })).status).toBe(404);

      expect(await loanFor(owner.appuser, loan)).toMatchObject({ securedAsset: null });
      expect((await loans.as(owner.appuser).get('/v1/loan')).body.loans).toHaveLength(1);
      expect((await db.em().findOneOrFail(Loan, { loanKey: loan.loanKey })).name).toBe('Mortgage');
      expect((await assetFor(neighbour.appuser, theirs)).linkedLoans).toEqual([]);
    });

    it("answers 404 for the other member's private asset and for a deleted one", async () => {
      const { owner, partner } = await households();
      const secret = await createAsset(owner.appuser, owner, { isPrivate: true, name: 'Secret flat' });
      const gone = await createAsset(owner.appuser, owner, { name: 'Sold house' });
      await assets.as(owner.appuser).delete(`/v1/manual-assets/${gone.manualAssetKey}`);

      expect((await postLoan(partner, owner.currency, { securedAssetKey: secret.manualAssetKey })).status).toBe(404);
      expect((await postLoan(owner.appuser, owner.currency, { securedAssetKey: gone.manualAssetKey })).status).toBe(404);
      expect((await postLoan(owner.appuser, owner.currency, { securedAssetKey: secret.manualAssetKey })).status).toBe(201);
    });

    it("stops showing an asset its owner made private since, without leaking it", async () => {
      const { owner, partner } = await households();
      const home = await createAsset(owner.appuser, owner);
      const loan = await createLoan(partner, owner.currency, { securedAssetKey: home.manualAssetKey });

      await assets.as(owner.appuser).patch(`/v1/manual-assets/${home.manualAssetKey}`).send({ isPrivate: true });

      expect((await loanFor(partner, loan)).securedAsset).toBeNull();
    });
  });

  describe('deleting the asset', () => {
    it('clears the link and leaves every loan on it intact, the other member\'s too', async () => {
      const { owner, partner } = await households();
      const home = await createAsset(owner.appuser, owner);
      const first = await createLoan(owner.appuser, owner.currency, { securedAssetKey: home.manualAssetKey });
      const second = await createLoan(partner, owner.currency, { name: 'Second mortgage', openingPrincipalBalance: 30_000, securedAssetKey: home.manualAssetKey });

      expect((await assets.as(partner).delete(`/v1/manual-assets/${home.manualAssetKey}`)).status).toBe(204);

      expect(await loanFor(owner.appuser, first)).toMatchObject({ outstandingPrincipal: 200_000, securedAsset: null });
      expect(await loanFor(partner, second)).toMatchObject({ outstandingPrincipal: 30_000, securedAsset: null });
      const stored = await db.em().find(Loan, { loanKey: { $in: [first.loanKey, second.loanKey] } });
      expect(stored.map((loan) => [loan.deletedAt ?? null, loan.securedAssetKey ?? null])).toEqual([[null, null], [null, null]]);
    });
  });

  describe('equity', () => {
    it('is the value less every loan secured against the asset', async () => {
      const { owner } = await households();
      const home = await createAsset(owner.appuser, owner);
      const first = await createLoan(owner.appuser, owner.currency, { securedAssetKey: home.manualAssetKey });
      const second = await createLoan(owner.appuser, owner.currency, { name: 'Second mortgage', openingPrincipalBalance: 30_000.5, securedAssetKey: home.manualAssetKey });

      const asset = await assetFor(owner.appuser, home);

      expect(asset).toMatchObject({ equity: 69_999.5, linkedDebt: 230_000.5, unconvertedLoanCurrencies: [], value: 300_000 });
      expect(asset.linkedLoans).toEqual([
        { currency: 'EUR', loanKey: first.loanKey, name: 'Mortgage', outstandingPrincipal: 200_000, outstandingPrincipalInAssetCurrency: 200_000 },
        { currency: 'EUR', loanKey: second.loanKey, name: 'Second mortgage', outstandingPrincipal: 30_000.5, outstandingPrincipalInAssetCurrency: 30_000.5 },
      ]);
      const listed = await assets.as(owner.appuser).get('/v1/manual-assets');
      expect(listed.body.assets[0]).toMatchObject({ equity: 69_999.5, linkedDebt: 230_000.5 });
    });

    it('is the whole value with no loan, and negative when the debt is larger', async () => {
      const { owner } = await households();
      const home = await createAsset(owner.appuser, owner);
      const car = await createAsset(owner.appuser, owner, { kind: 'vehicle', name: 'Car', value: 15_000 });
      await createLoan(owner.appuser, owner.currency, { name: 'Car loan', openingPrincipalBalance: 18_000, securedAssetKey: car.manualAssetKey, type: 'AUTO_LOAN' });

      expect(await assetFor(owner.appuser, home)).toMatchObject({ equity: 300_000, linkedDebt: 0, linkedLoans: [] });
      expect(await assetFor(owner.appuser, car)).toMatchObject({ equity: -3000, linkedDebt: 18_000 });
    });

    it("uses today's outstanding principal: lender adjustments to date count, future-dated ones do not", async () => {
      const { owner } = await households();
      const home = await createAsset(owner.appuser, owner);
      const loan = await createLoan(owner.appuser, owner.currency, { securedAssetKey: home.manualAssetKey });
      const em = db.em();
      const stored = await em.findOneOrFail(Loan, { loanKey: loan.loanKey });
      const adjust = (type: LoanAdjustmentType, amount: number, effectiveDate: string) =>
        em.create(LoanAdjustment, { amount, createdByAppuserKey: owner.appuser, effectiveDate: new Date(`${effectiveDate}T00:00:00Z`), loanKey: stored, tenantKey: owner.tenant, type }, { partial: true });
      adjust(LoanAdjustmentType.PRINCIPAL_DECREASE, 10_000, isoDaysFromNow(-30));
      adjust(LoanAdjustmentType.BALANCE_CORRECTION, 1, isoDaysFromNow(30));
      await em.flush();

      const asset = await assetFor(owner.appuser, home);

      expect(asset).toMatchObject({ equity: 110_000, linkedDebt: 190_000 });
      expect(asset.linkedLoans[0]?.outstandingPrincipal).toBe((await loanFor(owner.appuser, loan)).outstandingPrincipal);
    });

    it("counts only the viewer's own loans, since loans are personal", async () => {
      const { owner, partner } = await households();
      const home = await createAsset(owner.appuser, owner);
      await createLoan(owner.appuser, owner.currency, { securedAssetKey: home.manualAssetKey });
      await createLoan(partner, owner.currency, { name: 'PARTNER-LOAN', openingPrincipalBalance: 50_000, securedAssetKey: home.manualAssetKey });

      expect(await assetFor(owner.appuser, home)).toMatchObject({ equity: 100_000, linkedDebt: 200_000, linkedLoans: [expect.objectContaining({ name: 'Mortgage' })] });
      expect(await assetFor(partner, home)).toMatchObject({ equity: 250_000, linkedDebt: 50_000, linkedLoans: [expect.objectContaining({ name: 'PARTNER-LOAN' })] });
    });

    it('has no equity for an archived asset, which has no value today', async () => {
      const { owner } = await households();
      const home = await createAsset(owner.appuser, owner);
      await createLoan(owner.appuser, owner.currency, { securedAssetKey: home.manualAssetKey });

      const archived = await assets.as(owner.appuser).patch(`/v1/manual-assets/${home.manualAssetKey}`).send({ archived: true });

      expect(archived.body.asset).toMatchObject({ equity: null, linkedDebt: 200_000, value: null });
    });

    describe('in another currency', () => {
      it("converts each loan into the asset's currency at the latest rate", async () => {
        const { owner } = await households();
        const em = db.em();
        const gbp = await currencyFor(em, 'GBP');
        em.create(ExchangeRate, { date: new Date(Date.now() - 40 * DAY_MS), fromCurrency: gbp, rate: 1.1, toCurrency: owner.currency }, { partial: true });
        em.create(ExchangeRate, { date: new Date(Date.now() - 2 * DAY_MS), fromCurrency: gbp, rate: 1.2, toCurrency: owner.currency }, { partial: true });
        em.create(ExchangeRate, { date: new Date(Date.now() + 5 * DAY_MS), fromCurrency: gbp, rate: 9, toCurrency: owner.currency }, { partial: true });
        await em.flush();
        const home = await createAsset(owner.appuser, owner);
        await createLoan(owner.appuser, owner.currency, { securedAssetKey: home.manualAssetKey });
        await createLoan(owner.appuser, gbp, { name: 'UK loan', openingPrincipalBalance: 10_000, securedAssetKey: home.manualAssetKey });

        const asset = await assetFor(owner.appuser, home);

        expect(asset).toMatchObject({ equity: 88_000, linkedDebt: 212_000, unconvertedLoanCurrencies: [] });
        expect(asset.linkedLoans[1]).toEqual(expect.objectContaining({ currency: 'GBP', outstandingPrincipal: 10_000, outstandingPrincipalInAssetCurrency: 12_000 }));
      });

      it("uses the household's own exchange-rate override, never another household's", async () => {
        const { neighbour, owner } = await households();
        const em = db.em();
        const usd = await currencyFor(em, 'USD');
        em.create(ExchangeRate, { date: new Date(Date.now() - 2 * DAY_MS), fromCurrency: owner.currency, rate: 1.1, toCurrency: usd }, { partial: true });
        em.create(ExchangeRateOverride, { date: new Date(Date.now() - DAY_MS), fromCurrency: owner.currency, rate: 1.25, tenantKey: owner.tenant, toCurrency: usd }, { partial: true });
        em.create(ExchangeRateOverride, { date: new Date(Date.now() - DAY_MS), fromCurrency: owner.currency, rate: 2, tenantKey: neighbour.tenant, toCurrency: usd }, { partial: true });
        await em.flush();
        const condo = await createAsset(owner.appuser, owner, { currencyKey: usd.currencyKey, name: 'Condo', value: 100_000 });
        await createLoan(owner.appuser, owner.currency, { openingPrincipalBalance: 40_000, securedAssetKey: condo.manualAssetKey });

        expect(await assetFor(owner.appuser, condo)).toMatchObject({ equity: 50_000, linkedDebt: 50_000 });
      });

      it('has no equity when a loan has no rate, and says which currency is missing', async () => {
        const { owner } = await households();
        const jpy = await currencyFor(db.em(), 'JPY');
        const home = await createAsset(owner.appuser, owner);
        await createLoan(owner.appuser, owner.currency, { securedAssetKey: home.manualAssetKey });
        await createLoan(owner.appuser, jpy, { name: 'Yen loan', openingPrincipalBalance: 1_000_000, securedAssetKey: home.manualAssetKey });

        const asset = await assetFor(owner.appuser, home);

        expect(asset).toMatchObject({ equity: null, linkedDebt: null, unconvertedLoanCurrencies: ['JPY'], value: 300_000 });
        expect(asset.linkedLoans.map((loan) => loan.outstandingPrincipalInAssetCurrency)).toEqual([200_000, null]);
      });
    });
  });
});
