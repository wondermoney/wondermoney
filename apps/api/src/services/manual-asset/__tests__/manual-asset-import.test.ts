import { describe, expect, it } from 'vitest';

import { addPartner, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Appuser } from '@entity/Appuser';
import { ManualAsset } from '@entity/ManualAsset';
import { ManualAssetKind } from '@service/manual-asset/manual-asset-types';
import { getManualAsset, type ImportManualAssetRow, importManualAssets, listManualAssets } from '@service/manual-asset/manual-asset.service';
import { importManualAssetsSchema } from '@validators/manual-asset';

/*
 * A manual-assets file (name, kind, value, valuation date, currency): every row becomes an asset
 * with that valuation, owned by the importer, in their household, and private when the row says
 * so, exactly as creating the assets one by one. A bad row fails the whole file.
 */
describe('manual assets import', () => {
  const db = useTestDatabase();

  const viewerOf = (appuser: Appuser, household: Household, currencyCode = 'EUR') => ({ appuserKey: appuser.appuserKey, currencyCode, tenantKey: household.tenant.tenantKey });

  const rows: ImportManualAssetRow[] = [
    { currencyCode: 'EUR', kind: ManualAssetKind.PROPERTY, name: 'Flat', valuationDate: new Date('2025-06-30T00:00:00Z'), value: 250_000 },
    { currencyCode: 'usd', kind: ManualAssetKind.VEHICLE, name: 'Car', valuationDate: new Date('2025-01-15T00:00:00Z'), value: 18_000 },
    { currencyCode: 'EUR', isPrivate: true, kind: ManualAssetKind.VALUABLE, name: 'Watch', value: 4_000 },
  ];

  it('creates each asset with its valuation on its date and in its currency', async () => {
    const household = await seedHousehold(db.em());
    await currencyFor(db.em(), 'USD');
    const viewer = viewerOf(household.appuser, household);

    const result = await importManualAssets(db.em(), viewer, rows, new Date('2025-07-01T12:00:00Z'));

    expect(result.assets.map((asset) => asset.name)).toEqual(['Flat', 'Car', 'Watch']);
    const [flat, car, watch] = await Promise.all(result.assets.map((asset) => getManualAsset(db.em(), viewer, asset.manualAssetKey, new Date('2025-07-01T12:00:00Z'))));
    expect(flat!.asset).toMatchObject({ currency: 'EUR', isOwner: true, isPrivate: false, kind: 'property', value: 250_000 });
    expect(flat!.valuations).toEqual([expect.objectContaining({ date: '2025-06-30', value: 250_000 })]);
    expect(car!.asset).toMatchObject({ currency: 'USD', kind: 'vehicle' });
    expect(car!.valuations).toEqual([expect.objectContaining({ date: '2025-01-15', value: 18_000 })]);
    // No date: valued today, as a single create would.
    expect(watch!.valuations).toEqual([expect.objectContaining({ date: '2025-07-01', value: 4_000 })]);
  });

  it("puts the assets in the importer's household, and keeps private rows from the partner", async () => {
    const household = await seedHousehold(db.em());
    await currencyFor(db.em(), 'USD');
    const partner = await addPartner(db.em(), household);
    const other = await seedHousehold(db.em());

    await importManualAssets(db.em(), viewerOf(household.appuser, household), rows);

    const assets = await db.em().find(ManualAsset, {}, { filters: false, populate: ['ownerAppuserKey', 'tenantKey'] });
    expect(assets.every((asset) => asset.tenantKey.tenantKey === household.tenant.tenantKey && asset.ownerAppuserKey.appuserKey === household.appuser.appuserKey)).toBe(true);
    const partnerView = await listManualAssets(db.em(), viewerOf(partner, household));
    expect(partnerView.assets.map((asset) => asset.name).sort()).toEqual(['Car', 'Flat']);
    const outsiderView = await listManualAssets(db.em(), viewerOf(other.appuser, other));
    expect(outsiderView.assets).toEqual([]);
  });

  it('creates nothing when a row names an unknown currency', async () => {
    const household = await seedHousehold(db.em());

    await expect(importManualAssets(db.em(), viewerOf(household.appuser, household), [rows[0]!, { ...rows[0]!, currencyCode: 'XYZ', name: 'Elsewhere' }])).rejects.toThrow(/rows 2/);

    await expect(db.em().count(ManualAsset, {}, { filters: false })).resolves.toBe(0);
  });

  describe('the file shape', () => {
    const parse = (assets: unknown[]) => importManualAssetsSchema.safeParse({ body: { assets } });

    it('accepts the template columns and normalises the currency code', () => {
      const parsed = parse([{ currencyCode: 'eur', kind: 'property', name: 'Flat', valuationDate: '2025-06-30', value: 250000 }]);

      expect(parsed.success && parsed.data.body.assets[0]).toMatchObject({ currencyCode: 'EUR', valuationDate: new Date('2025-06-30T00:00:00.000Z') });
    });

    it.each([
      ['an unknown kind', { kind: 'boat' }],
      ['a negative value', { value: -1 }],
      ['a future valuation date', { valuationDate: '2999-01-01' }],
      ['a blank name', { name: '  ' }],
    ])('refuses the whole file for %s', (_, change) => {
      expect(parse([{ currencyCode: 'EUR', kind: 'property', name: 'Flat', value: 1 }, { currencyCode: 'EUR', kind: 'property', name: 'Flat', value: 1, ...change }]).success).toBe(false);
    });

    it('refuses an empty file', () => {
      expect(parse([]).success).toBe(false);
    });
  });
});
