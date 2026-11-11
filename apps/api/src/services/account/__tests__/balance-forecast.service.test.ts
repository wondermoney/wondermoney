import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { addAccount, addPartner, currencyFor, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Account } from '@entity/Account';
import type { Currency } from '@entity/Currency';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { RecurringSeries } from '@entity/RecurringSeries';
import type { Tenant } from '@entity/Tenant';
import { RecurringAmountType, RecurringCadence, RecurringOccurrenceMatchStatus, RecurringSeriesSource, RecurringSeriesStatus, RecurringSeriesType } from '@service/recurring/recurring-types';

import { forecastBalances } from '../balance-forecast.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const from = day('2026-03-01');

interface SeriesInput {
  account?: Account;
  amountType?: RecurringAmountType;
  averageAmount?: null | number;
  currencyKey: Currency;
  displayName: string;
  expectedAmount?: null | number;
  expectedAmountMax?: null | number;
  nextExpectedAt: Date;
  tenantKey: Tenant;
}

async function addOccurrence(
  em: EntityManager,
  input: { amount: number; currencyKey: Currency; date: Date; matchStatus: RecurringOccurrenceMatchStatus; series: RecurringSeries },
) {
  em.create(RecurringOccurrence, {
    amount: input.amount,
    currencyKey: input.currencyKey,
    matchStatus: input.matchStatus,
    occurrenceDate: input.date,
    recurringSeriesKey: input.series,
  }, { partial: true });
  await em.flush();
}

async function addSeries(em: EntityManager, input: SeriesInput) {
  const series = em.create(RecurringSeries, {
    accountKey: input.account,
    amountType: input.amountType ?? RecurringAmountType.fixed,
    averageAmount: input.averageAmount,
    cadence: RecurringCadence.monthly,
    cadenceConfidence: 100,
    confidenceScore: 100,
    currencyKey: input.currencyKey,
    detectionVersion: 1,
    displayName: input.displayName,
    expectedAmount: input.expectedAmount,
    expectedAmountMax: input.expectedAmountMax,
    nextExpectedAt: input.nextExpectedAt,
    normalizedMerchantKey: input.displayName.toLowerCase(),
    occurrenceCount: 1,
    source: RecurringSeriesSource.detected,
    status: RecurringSeriesStatus.confirmed,
    tenantKey: input.tenantKey,
    type: RecurringSeriesType.bill,
  }, { partial: true });
  await em.flush();
  return series;
}

describe('forecastBalances', () => {
  const db = useTestDatabase();

  it('returns a daily series and its low point from the current balance and the projected bills', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await addSeries(em, { account: household.account, currencyKey: household.currency, displayName: 'Rent', expectedAmount: 100, nextExpectedAt: day('2026-03-06'), tenantKey: household.tenant });

    const forecast = await forecastBalances(em, { days: 30, from, tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });

    expect(forecast.accounts).toHaveLength(1);
    expect(forecast.accounts[0]!.points).toHaveLength(30);
    expect(forecast.accounts[0]!.points[0]).toEqual({ balance: 1000, date: '2026-03-01' });
    expect(forecast.accounts[0]!.points[5]).toEqual({ balance: 900, date: '2026-03-06' });
    expect(forecast.accounts[0]!.lowPoint).toEqual({ balance: 900, date: '2026-03-06' });
    expect(forecast.accounts[0]!.projected).toEqual([
      { accountKey: household.account.accountKey, amount: 100, currency: 'EUR', date: '2026-03-06', name: 'Rent', seriesKey: expect.any(Number) },
    ]);
    expect(forecast.total).toMatchObject({ currency: 'EUR', lowPoint: { balance: 900, date: '2026-03-06' }, openingBalance: 1000 });
  });

  it('drops a bill already paid early, so it never counts twice', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const series = await addSeries(em, { account: household.account, currencyKey: household.currency, displayName: 'Rent', expectedAmount: 100, nextExpectedAt: day('2026-03-06'), tenantKey: household.tenant });
    await addOccurrence(em, { amount: 100, currencyKey: household.currency, date: day('2026-03-04'), matchStatus: RecurringOccurrenceMatchStatus.matched, series });

    const forecast = await forecastBalances(em, { days: 30, from, tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });

    expect(forecast.accounts[0]!.projected).toEqual([]);
    expect(forecast.accounts[0]!.points.every((point) => point.balance === 1000)).toBe(true);
    expect(forecast.accounts[0]!.lowPoint).toEqual({ balance: 1000, date: '2026-03-01' });
    expect(forecast.totals[0]!.projected).toEqual([]);
  });

  it('keeps each account in its own currency and reports a total per currency', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const usd = await currencyFor(em, 'USD');
    const usdAccount = await addAccount(em, household, { balance: 500, currency: usd, name: 'Dollar account' });
    await addSeries(em, { account: household.account, currencyKey: household.currency, displayName: 'Rent', expectedAmount: 100, nextExpectedAt: day('2026-03-06'), tenantKey: household.tenant });
    await addSeries(em, { account: usdAccount, currencyKey: usd, displayName: 'Phone', expectedAmount: 50, nextExpectedAt: day('2026-03-07'), tenantKey: household.tenant });

    const forecast = await forecastBalances(em, { days: 30, from, tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });

    expect(forecast.accounts.map((series) => [series.currency, series.lowPoint])).toEqual([
      ['EUR', { balance: 900, date: '2026-03-06' }],
      ['USD', { balance: 450, date: '2026-03-07' }],
    ]);
    expect(forecast.totals.map((total) => [total.currency, total.openingBalance, total.lowPoint])).toEqual([
      ['EUR', 1000, { balance: 900, date: '2026-03-06' }],
      ['USD', 500, { balance: 450, date: '2026-03-07' }],
    ]);
    expect(forecast.total).toBeNull();
  });

  it('counts a series with no account toward the total only', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await addSeries(em, { currencyKey: household.currency, displayName: 'Household insurance', expectedAmount: 100, nextExpectedAt: day('2026-03-06'), tenantKey: household.tenant });

    const forecast = await forecastBalances(em, {
      accountKeys: [household.account.accountKey],
      days: 30,
      from,
      tenantKey: household.tenant.tenantKey,
      viewerAppuserKey: household.appuser.appuserKey,
    });

    expect(forecast.accounts[0]!.points.every((point) => point.balance === 1000)).toBe(true);
    expect(forecast.accounts[0]!.projected).toEqual([]);
    expect(forecast.totals[0]!.lowPoint).toEqual({ balance: 900, date: '2026-03-06' });
    expect(forecast.totals[0]!.projected).toHaveLength(1);
    expect(forecast.total).toBe(forecast.totals[0]);
  });

  it('uses a variable bill\'s average and a fixed bill\'s expected amount', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await addSeries(em, { account: household.account, currencyKey: household.currency, displayName: 'Fixed bill', expectedAmount: 40, nextExpectedAt: day('2026-03-06'), tenantKey: household.tenant });
    await addSeries(em, {
      account: household.account,
      amountType: RecurringAmountType.variable,
      averageAmount: 80,
      currencyKey: household.currency,
      displayName: 'Variable bill',
      expectedAmount: 50,
      expectedAmountMax: 120,
      nextExpectedAt: day('2026-03-06'),
      tenantKey: household.tenant,
    });

    const forecast = await forecastBalances(em, { days: 30, from, tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });

    expect(forecast.accounts[0]!.projected.map((item) => [item.name, item.amount])).toEqual([
      ['Fixed bill', 40],
      ['Variable bill', 80],
    ]);
    expect(forecast.accounts[0]!.lowPoint).toEqual({ balance: 880, date: '2026-03-06' });
  });

  it('shows the owner their private account but never another member or another household', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const privateAccount = await addAccount(em, household, { balance: 500, isPrivate: true, name: 'Private savings' });
    await addSeries(em, { account: household.account, currencyKey: household.currency, displayName: 'Shared rent', expectedAmount: 100, nextExpectedAt: day('2026-03-06'), tenantKey: household.tenant });
    await addSeries(em, { account: privateAccount, currencyKey: household.currency, displayName: 'Private gym', expectedAmount: 200, nextExpectedAt: day('2026-03-06'), tenantKey: household.tenant });

    const neighbour = await seedHousehold(em);
    await addSeries(em, { account: neighbour.account, currencyKey: neighbour.currency, displayName: 'Neighbour rent', expectedAmount: 999, nextExpectedAt: day('2026-03-06'), tenantKey: neighbour.tenant });

    const asPartner = await forecastBalances(em, { days: 30, from, tenantKey: household.tenant.tenantKey, viewerAppuserKey: partner.appuserKey });
    expect(asPartner.accounts.map((series) => series.accountKey)).toEqual([household.account.accountKey]);
    expect(asPartner.totals).toEqual([expect.objectContaining({ lowPoint: { balance: 900, date: '2026-03-06' }, openingBalance: 1000 })]);
    expect(asPartner.totals[0]!.projected.map((item) => item.name)).toEqual(['Shared rent']);

    const asOwner = await forecastBalances(em, { days: 30, from, tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
    expect(asOwner.accounts.map((series) => series.accountKey).sort((a, b) => a - b)).toEqual([household.account.accountKey, privateAccount.accountKey].sort((a, b) => a - b));
    expect(asOwner.totals).toEqual([expect.objectContaining({ lowPoint: { balance: 1200, date: '2026-03-06' }, openingBalance: 1500 })]);
    expect(asOwner.totals[0]!.projected.map((item) => item.name).sort()).toEqual(['Private gym', 'Shared rent']);

    // Asking for the partner's private account explicitly finds nothing: it is invisible.
    const hidden = await forecastBalances(em, {
      accountKeys: [privateAccount.accountKey],
      days: 30,
      from,
      tenantKey: household.tenant.tenantKey,
      viewerAppuserKey: partner.appuserKey,
    });
    expect(hidden.accounts).toEqual([]);
    expect(hidden.totals).toEqual([]);
    expect(hidden.total).toBeNull();
  });

  it('rejects a window outside the supported range', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const request = { days: 29, from, tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey };

    await expect(forecastBalances(em, request)).rejects.toBeInstanceOf(RangeError);
    await expect(forecastBalances(em, { ...request, days: 91 })).rejects.toBeInstanceOf(RangeError);
  });
});
