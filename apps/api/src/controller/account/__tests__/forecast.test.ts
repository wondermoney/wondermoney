import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Account } from '@entity/Account';
import { RecurringSeries } from '@entity/RecurringSeries';
import type { Tenant } from '@entity/Tenant';
import accountRoutes from '@route/account';
import { RecurringAmountType, RecurringCadence, RecurringSeriesSource, RecurringSeriesStatus, RecurringSeriesType } from '@service/recurring/recurring-types';

const DAY_MS = 86_400_000;
/** UTC midnight `days` from today, so the route's own "today" contains the occurrence. */
const inDays = (days: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * DAY_MS);
};

async function addSeries(em: EntityManager, input: { account?: Account; displayName: string; tenantKey: Tenant }) {
  const series = em.create(RecurringSeries, {
    accountKey: input.account,
    amountType: RecurringAmountType.fixed,
    cadence: RecurringCadence.monthly,
    cadenceConfidence: 100,
    confidenceScore: 100,
    detectionVersion: 1,
    displayName: input.displayName,
    expectedAmount: 100,
    nextExpectedAt: inDays(5),
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

describe('GET /v1/account/forecast', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/account', accountRoutes);

  it('returns daily projected balances and a low point for the next 30 days', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await addSeries(em, { account: household.account, displayName: 'Rent', tenantKey: household.tenant });

    const response = await http.as(household.appuser).get('/v1/account/forecast?days=30');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ days: 30, from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(response.body.accounts).toHaveLength(1);
    expect(response.body.accounts[0].points).toHaveLength(30);
    expect(response.body.accounts[0].lowPoint).toMatchObject({ balance: 900 });
    expect(response.body.total).toMatchObject({ currency: 'EUR', openingBalance: 1000 });
    expect(response.body.totals).toHaveLength(1);
  });

  it('filters to the requested accounts', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const second = await addAccount(em, household, { balance: 250, name: 'Second account' });

    const response = await http.as(household.appuser).get(`/v1/account/forecast?days=30&accountKeys=${second.accountKey}`);

    expect(response.status).toBe(200);
    expect(response.body.accounts.map((series: { accountKey: number }) => series.accountKey)).toEqual([second.accountKey]);
    expect(response.body.total).toMatchObject({ openingBalance: 250 });
  });

  it('rejects a window outside 30..90 days and a malformed account key', async () => {
    const em = db.em();
    const household = await seedHousehold(em);

    expect((await http.as(household.appuser).get('/v1/account/forecast?days=29')).status).toBe(400);
    expect((await http.as(household.appuser).get('/v1/account/forecast?days=91')).status).toBe(400);
    expect((await http.as(household.appuser).get('/v1/account/forecast?days=30&accountKeys=nope')).status).toBe(400);
  });
});
