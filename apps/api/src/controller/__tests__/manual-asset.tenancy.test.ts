import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addPartner, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { ExchangeRate } from '@entity/ExchangeRate';
import { ExchangeRateOverride } from '@entity/ExchangeRateOverride';
import { Transaction } from '@entity/Transaction';
import manualAssetRoutes from '@route/manual-asset';

/*
 * A manually valued asset (a home, a car) belongs to the household. Both members see and manage
 * a shared one; a private one exists only for its owner; another household sees nothing. Its
 * value is its latest valuation, and recording one never creates a transaction.
 */
describe('manual assets', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/manual-assets', manualAssetRoutes);

  interface AssetDto {
    archived: boolean;
    currency: string;
    growthRule: null | { annualRatePercent: number; startDate: null | string };
    isOwner: boolean;
    isPrivate: boolean;
    kind: string;
    lastValuation: null | { date: string; manualAssetValuationKey: number; value: number };
    manualAssetKey: number;
    name: string;
    purchaseDate: null | string;
    purchasePrice: null | number;
    userCurrency: string;
    value: null | number;
    valueInUserCurrency: null | number;
  }

  const todayIso = () => new Date().toISOString().slice(0, 10);
  const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  async function createAsset(user: Appuser, household: Household, body: Record<string, unknown> = {}): Promise<AssetDto> {
    const response = await http.as(user).post('/v1/manual-assets').send({ currencyKey: household.currency.currencyKey, kind: 'property', name: 'Home', value: 250_000, ...body });
    expect(response.status).toBe(201);
    return response.body.asset as AssetDto;
  }

  async function listed(user: Appuser): Promise<AssetDto[]> {
    const response = await http.as(user).get('/v1/manual-assets');
    expect(response.status).toBe(200);
    return response.body.assets as AssetDto[];
  }

  /** Owner and partner share one household; a neighbour lives next door. */
  async function households() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const neighbour = await seedHousehold(em);
    return { neighbour, owner, partner };
  }

  describe('household scoping', () => {
    it('shows a shared asset to both members and to no other household', async () => {
      const { neighbour, owner, partner } = await households();
      const home = await createAsset(owner.appuser, owner);

      expect((await listed(owner.appuser)).map((asset) => asset.manualAssetKey)).toEqual([home.manualAssetKey]);
      expect((await listed(partner)).map((asset) => asset.manualAssetKey)).toEqual([home.manualAssetKey]);
      expect(await listed(neighbour.appuser)).toEqual([]);
    });

    it('answers 404 to every read and write from another household', async () => {
      const { neighbour, owner } = await households();
      const home = await createAsset(owner.appuser, owner);
      const path = `/v1/manual-assets/${home.manualAssetKey}`;
      const valuationKey = home.lastValuation?.manualAssetValuationKey;
      const asNeighbour = http.as(neighbour.appuser);

      expect((await asNeighbour.get(path)).status).toBe(404);
      expect((await asNeighbour.patch(path).send({ name: 'Mine now' })).status).toBe(404);
      expect((await asNeighbour.delete(path)).status).toBe(404);
      expect((await asNeighbour.get(`${path}/valuations`)).status).toBe(404);
      expect((await asNeighbour.post(`${path}/valuations`).send({ value: 1 })).status).toBe(404);
      expect((await asNeighbour.patch(`${path}/valuations/${valuationKey}`).send({ value: 1 })).status).toBe(404);
      expect((await asNeighbour.delete(`${path}/valuations/${valuationKey}`)).status).toBe(404);

      const unchanged = await http.as(owner.appuser).get(path);
      expect(unchanged.body.asset).toMatchObject({ name: 'Home', value: 250_000 });
      expect(unchanged.body.valuations).toHaveLength(1);
    });

    it('does not reach another household\'s valuation through one\'s own asset', async () => {
      const { neighbour, owner } = await households();
      const home = await createAsset(owner.appuser, owner);
      const theirs = await createAsset(neighbour.appuser, neighbour, { name: 'Their flat', value: 90_000 });
      const theirValuation = theirs.lastValuation?.manualAssetValuationKey;

      const response = await http.as(owner.appuser).patch(`/v1/manual-assets/${home.manualAssetKey}/valuations/${theirValuation}`).send({ value: 1 });

      expect(response.status).toBe(404);
      expect((await listed(neighbour.appuser))[0]?.value).toBe(90_000);
    });

    it('lets the partner rename and revalue a shared asset', async () => {
      const { owner, partner } = await households();
      const home = await createAsset(owner.appuser, owner);

      const renamed = await http.as(partner).patch(`/v1/manual-assets/${home.manualAssetKey}`).send({ name: 'Our home' });
      const revalued = await http.as(partner).post(`/v1/manual-assets/${home.manualAssetKey}/valuations`).send({ value: 260_000 });

      expect(renamed.status).toBe(200);
      expect(revalued.status).toBe(200);
      expect((await listed(owner.appuser))[0]).toMatchObject({ isOwner: true, name: 'Our home', value: 260_000 });
      expect((await listed(partner))[0]).toMatchObject({ isOwner: false });
    });
  });

  describe('private assets', () => {
    it('hides a private asset and its valuations from the other household member', async () => {
      const { owner, partner } = await households();
      const shared = await createAsset(owner.appuser, owner, { name: 'Shared car', value: 9000 });
      const secret = await createAsset(owner.appuser, owner, { isPrivate: true, name: 'Watch', value: 4000 });
      const path = `/v1/manual-assets/${secret.manualAssetKey}`;
      const asPartner = http.as(partner);

      expect((await listed(partner)).map((asset) => asset.manualAssetKey)).toEqual([shared.manualAssetKey]);
      expect((await asPartner.get(path)).status).toBe(404);
      expect((await asPartner.get(`${path}/valuations`)).status).toBe(404);
      expect((await asPartner.patch(path).send({ name: 'Found it' })).status).toBe(404);
      expect((await asPartner.post(`${path}/valuations`).send({ value: 1 })).status).toBe(404);
      expect((await asPartner.delete(path)).status).toBe(404);
      expect((await listed(owner.appuser)).map((asset) => asset.name).sort()).toEqual(['Shared car', 'Watch']);
    });

    it('leaves a private asset out of the total the partner sees', async () => {
      const { owner, partner } = await households();
      await createAsset(owner.appuser, owner, { name: 'Shared car', value: 9000 });
      await createAsset(owner.appuser, owner, { isPrivate: true, name: 'Watch', value: 4000 });

      const forOwner = await http.as(owner.appuser).get('/v1/manual-assets');
      const forPartner = await http.as(partner).get('/v1/manual-assets');

      expect(forOwner.body.summary).toMatchObject({ isComplete: true, totalValue: 13_000 });
      expect(forPartner.body.summary).toMatchObject({ isComplete: true, totalValue: 9000 });
    });

    it('lets only the owner change whether an asset is private', async () => {
      const { owner, partner } = await households();
      const home = await createAsset(owner.appuser, owner);
      const path = `/v1/manual-assets/${home.manualAssetKey}`;

      const byPartner = await http.as(partner).patch(path).send({ isPrivate: true });
      expect(byPartner.status).toBe(403);
      expect(byPartner.body.code).toBe('manual_asset_owner_required');
      expect(await listed(partner)).toHaveLength(1);

      expect((await http.as(owner.appuser).patch(path).send({ isPrivate: true })).status).toBe(200);
      expect(await listed(partner)).toEqual([]);
    });
  });

  describe('valuations', () => {
    it('creates the asset with its first valuation and no transaction', async () => {
      const { owner } = await households();

      const home = await createAsset(owner.appuser, owner, { valuationDate: daysAgoIso(10) });

      expect(home).toMatchObject({ archived: false, currency: 'EUR', kind: 'property', lastValuation: { date: daysAgoIso(10), value: 250_000 }, value: 250_000, valueInUserCurrency: 250_000 });
      expect(await db.em().count(Transaction, {})).toBe(0);
    });

    it('records the purchase as the first valuation when it is earlier than the current one', async () => {
      const { owner } = await households();

      const home = await createAsset(owner.appuser, owner, { purchaseDate: '2020-03-01', purchasePrice: 180_000 });

      const detail = await http.as(owner.appuser).get(`/v1/manual-assets/${home.manualAssetKey}`);
      expect(detail.body.asset).toMatchObject({ purchaseDate: '2020-03-01', purchasePrice: 180_000, value: 250_000 });
      expect(detail.body.valuations.map((valuation: { date: string; value: number }) => [valuation.date, valuation.value])).toEqual([[todayIso(), 250_000], ['2020-03-01', 180_000]]);
    });

    it('updating the value adds a valuation, keeps the history stepped and never creates a transaction', async () => {
      const { owner } = await households();
      const home = await createAsset(owner.appuser, owner, { valuationDate: daysAgoIso(40), value: 200_000 });
      const path = `/v1/manual-assets/${home.manualAssetKey}`;

      const response = await http.as(owner.appuser).post(`${path}/valuations`).send({ date: daysAgoIso(5), note: 'Agent estimate', value: 230_000 });

      expect(response.status).toBe(201);
      expect(response.body.asset.value).toBe(230_000);
      const detail = await http.as(owner.appuser).get(path);
      expect(detail.body.history).toEqual([
        { date: daysAgoIso(40), value: 200_000 },
        { date: daysAgoIso(5), value: 230_000 },
        { date: todayIso(), value: 230_000 },
      ]);
      expect(detail.body.valuations[0]).toMatchObject({ date: daysAgoIso(5), note: 'Agent estimate', value: 230_000 });
      expect(await db.em().count(Transaction, {})).toBe(0);
      expect((await db.em().findOneOrFail(Account, { accountKey: owner.account.accountKey })).balance).toBe(1000);
    });

    it('replaces the valuation already recorded for that day instead of adding a second', async () => {
      const { owner } = await households();
      const home = await createAsset(owner.appuser, owner);
      const path = `/v1/manual-assets/${home.manualAssetKey}`;

      const response = await http.as(owner.appuser).post(`${path}/valuations`).send({ value: 255_000 });

      expect(response.status).toBe(200);
      const detail = await http.as(owner.appuser).get(path);
      expect(detail.body.valuations).toHaveLength(1);
      expect(detail.body.asset.value).toBe(255_000);
    });

    it('a backdated valuation does not change today\'s value', async () => {
      const { owner } = await households();
      const home = await createAsset(owner.appuser, owner);

      await http.as(owner.appuser).post(`/v1/manual-assets/${home.manualAssetKey}/valuations`).send({ date: '2021-01-01', value: 150_000 });

      expect((await listed(owner.appuser))[0]?.value).toBe(250_000);
    });

    it('edits and deletes a valuation, but keeps the last one', async () => {
      const { owner } = await households();
      const home = await createAsset(owner.appuser, owner, { valuationDate: daysAgoIso(30) });
      const path = `/v1/manual-assets/${home.manualAssetKey}`;
      const first = home.lastValuation?.manualAssetValuationKey;
      const second = (await http.as(owner.appuser).post(`${path}/valuations`).send({ value: 300_000 })).body.valuation.manualAssetValuationKey as number;

      expect((await http.as(owner.appuser).patch(`${path}/valuations/${second}`).send({ value: 310_000 })).status).toBe(200);
      expect((await listed(owner.appuser))[0]?.value).toBe(310_000);

      expect((await http.as(owner.appuser).patch(`${path}/valuations/${second}`).send({ date: daysAgoIso(30) })).status).toBe(409);

      expect((await http.as(owner.appuser).delete(`${path}/valuations/${second}`)).status).toBe(204);
      expect((await listed(owner.appuser))[0]?.value).toBe(250_000);

      const last = await http.as(owner.appuser).delete(`${path}/valuations/${first}`);
      expect(last.status).toBe(409);
      expect(last.body.code).toBe('manual_asset_last_valuation');
    });

    it('rejects a negative value, a far-future date and an unknown kind', async () => {
      const { owner } = await households();
      const base = { currencyKey: owner.currency.currencyKey, kind: 'property', name: 'Home', value: 1 };
      const post = (body: Record<string, unknown>) => http.as(owner.appuser).post('/v1/manual-assets').send({ ...base, ...body });

      expect((await post({ value: -5 })).status).toBe(400);
      expect((await post({ valuationDate: '2999-01-01' })).status).toBe(400);
      expect((await post({ kind: 'spaceship' })).status).toBe(400);
      expect((await post({ currencyKey: 999_999 })).status).toBe(400);
      expect((await post({ growthRule: { annualRatePercent: -100 } })).status).toBe(400);
      expect(await listed(owner.appuser)).toEqual([]);
    });
  });

  describe('growth rule', () => {
    it('reports today\'s value compounded from the last valuation', async () => {
      const { owner } = await households();

      const home = await createAsset(owner.appuser, owner, { growthRule: { annualRatePercent: 5 }, valuationDate: daysAgoIso(365), value: 100_000 });

      expect(home.growthRule).toEqual({ annualRatePercent: 5, startDate: null });
      expect(home.lastValuation?.value).toBe(100_000);
      expect(home.value).toBe(105_000);
    });

    it('goes back to the last valuation when the rule is removed', async () => {
      const { owner } = await households();
      const home = await createAsset(owner.appuser, owner, { growthRule: { annualRatePercent: 5 }, valuationDate: daysAgoIso(365), value: 100_000 });

      const response = await http.as(owner.appuser).patch(`/v1/manual-assets/${home.manualAssetKey}`).send({ growthRule: null });

      expect(response.body.asset).toMatchObject({ growthRule: null, value: 100_000 });
    });
  });

  describe('archiving and deleting', () => {
    it('keeps an archived asset listed but out of the total', async () => {
      const { owner } = await households();
      const car = await createAsset(owner.appuser, owner, { kind: 'vehicle', name: 'Car', value: 9000 });
      await createAsset(owner.appuser, owner);

      const response = await http.as(owner.appuser).patch(`/v1/manual-assets/${car.manualAssetKey}`).send({ archived: true });

      expect(response.body.asset).toMatchObject({ archived: true, lastValuation: { value: 9000 }, value: null });
      const list = await http.as(owner.appuser).get('/v1/manual-assets');
      expect(list.body.assets).toHaveLength(2);
      expect(list.body.summary.totalValue).toBe(250_000);

      const restored = await http.as(owner.appuser).patch(`/v1/manual-assets/${car.manualAssetKey}`).send({ archived: false });
      expect(restored.body.asset).toMatchObject({ archived: false, value: 9000 });
    });

    it('removes a deleted asset for both members', async () => {
      const { owner, partner } = await households();
      const home = await createAsset(owner.appuser, owner);

      expect((await http.as(partner).delete(`/v1/manual-assets/${home.manualAssetKey}`)).status).toBe(204);

      expect(await listed(owner.appuser)).toEqual([]);
      expect((await http.as(owner.appuser).get(`/v1/manual-assets/${home.manualAssetKey}`)).status).toBe(404);
    });
  });

  describe('currencies', () => {
    it('converts each asset into the viewer\'s currency at the latest rate', async () => {
      const { owner } = await households();
      const em = db.em();
      const usd = await currencyFor(em, 'USD');
      em.create(ExchangeRate, { date: new Date('2026-01-01T00:00:00Z'), fromCurrency: usd, rate: 0.9, toCurrency: owner.currency }, { partial: true });
      await em.flush();

      const flat = await createAsset(owner.appuser, owner, { currencyKey: usd.currencyKey, name: 'Flat abroad', value: 100_000 });
      await createAsset(owner.appuser, owner, { value: 50_000 });

      expect(flat).toMatchObject({ currency: 'USD', userCurrency: 'EUR', value: 100_000, valueInUserCurrency: 90_000 });
      const list = await http.as(owner.appuser).get('/v1/manual-assets');
      expect(list.body.summary).toEqual({ currencyCode: 'EUR', isComplete: true, totalValue: 140_000, unconvertedAssets: 0, unconvertedCurrencies: [] });
    });

    it('leaves an asset with no rate out of the total and says which currency is missing', async () => {
      const { owner } = await households();
      const jpy = await currencyFor(db.em(), 'JPY');

      const cabin = await createAsset(owner.appuser, owner, { currencyKey: jpy.currencyKey, name: 'Cabin', value: 9_000_000 });
      await createAsset(owner.appuser, owner, { value: 50_000 });

      expect(cabin).toMatchObject({ value: 9_000_000, valueInUserCurrency: null });
      const list = await http.as(owner.appuser).get('/v1/manual-assets');
      expect(list.body.summary).toEqual({ currencyCode: 'EUR', isComplete: false, totalValue: 50_000, unconvertedAssets: 1, unconvertedCurrencies: ['JPY'] });
    });

    it("values an asset at the household's own exchange-rate override, never another household's", async () => {
      const { neighbour, owner } = await households();
      const em = db.em();
      const xof = await currencyFor(em, 'XOF');
      em.create(ExchangeRateOverride, { date: new Date('2026-01-01T00:00:00Z'), fromCurrency: xof, rate: 0.0015, tenantKey: owner.tenant, toCurrency: owner.currency }, { partial: true });
      em.create(ExchangeRateOverride, { date: new Date('2026-01-01T00:00:00Z'), fromCurrency: xof, rate: 0.002, tenantKey: neighbour.tenant, toCurrency: neighbour.currency }, { partial: true });
      await em.flush();

      await createAsset(owner.appuser, owner, { currencyKey: xof.currencyKey, name: 'Plot of land', value: 10_000_000 });

      expect((await listed(owner.appuser))[0]).toMatchObject({ currency: 'XOF', valueInUserCurrency: 15_000 });
    });

    it('shows the partner the value in their own currency', async () => {
      const em = db.em();
      const owner = await seedHousehold(em);
      const usd = await currencyFor(em, 'USD');
      const partner = await addPartner(em, owner, { currency: usd });
      em.create(ExchangeRate, { date: new Date('2026-01-01T00:00:00Z'), fromCurrency: owner.currency, rate: 1.1, toCurrency: usd }, { partial: true });
      await em.flush();
      await createAsset(owner.appuser, owner, { value: 100_000 });

      expect((await listed(partner))[0]).toMatchObject({ currency: 'EUR', userCurrency: 'USD', value: 100_000, valueInUserCurrency: 110_000 });
    });
  });
});
