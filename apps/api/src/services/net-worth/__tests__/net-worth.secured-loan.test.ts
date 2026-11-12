import { describe, expect, it } from 'vitest';

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Loan } from '@entity/Loan';
import { ManualAsset } from '@entity/ManualAsset';
import { LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';
import { ManualAssetKind } from '@service/manual-asset/manual-asset-types';
import { createManualAsset } from '@service/manual-asset/manual-asset.service';

import { NetWorthService } from '../net-worth.service';

/*
 * Securing a loan against an asset is presentation only: net worth still counts the asset at its
 * value and the loan at its balance, each once, today and in every history point.
 */
describe('net worth with a loan secured against an asset', () => {
  const db = useTestDatabase();

  it('is identical with and without the link', async () => {
    const em = db.em();
    const seeded = await seedHousehold(em);
    const viewer = { appuserKey: seeded.appuser.appuserKey, currencyCode: 'EUR', tenantKey: seeded.tenant.tenantKey };
    const valuationDate = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 1));
    const home = await createManualAsset(em, viewer, { currencyKey: seeded.currency.currencyKey, kind: ManualAssetKind.PROPERTY, name: 'Home', valuationDate, value: 300_000 });
    const loanFields = { currencyKey: seeded.currency, includeInNetWorth: true, openingBalanceDate: new Date('2026-01-01'), ownerAppuserKey: seeded.appuser, paymentFrequency: LoanPaymentFrequency.MONTHLY, rateType: LoanRateType.FIXED, status: LoanStatus.ACTIVE, tenantKey: seeded.tenant, type: LoanType.MORTGAGE };
    const first = em.create(Loan, { ...loanFields, name: 'Mortgage', openingPrincipalBalance: 200_000 }, { partial: true });
    const second = em.create(Loan, { ...loanFields, name: 'Second mortgage', openingPrincipalBalance: 30_000 }, { partial: true });
    await em.flush();

    const service = new NetWorthService();
    const measure = async () => ({
      history: await service.getNetWorthHistory(seeded.appuser, { months: 3 }),
      today: await service.getNetWorth(seeded.appuser),
    });
    const unlinked = await measure();

    const asset = await em.findOneOrFail(ManualAsset, { manualAssetKey: home.manualAssetKey });
    first.securedAssetKey = asset;
    second.securedAssetKey = asset;
    await em.flush();
    const linked = await measure();

    expect(unlinked.today).toMatchObject({ assets: { manualAssets: 300_000 }, liabilities: { loans: 230_000 }, totalNetWorth: 71_000 });
    expect(linked).toEqual(unlinked);
  });
});
