import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { currencyFor, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Account } from '@entity/Account';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FxStatus } from '@entity/Transaction';
import accountRoutes from '@route/account';
import netWorthRoutes from '@route/net-worth';

/*
 * An offline account in a currency with no exchange rate keeps its own balance and stores none in
 * the owner's currency. Net worth reports it as unconverted rather than counting it as zero or at
 * face value.
 */
describe('an offline account in a currency with no exchange rate', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const accounts = tenantHttp('/v1/account', accountRoutes);
  const netWorth = tenantHttp('/v1/net-worth', netWorthRoutes);

  async function aHousehold(rate?: number) {
    const em = db.em();
    const household = await seedHousehold(em);
    household.account.appuserCurrencyBalance = 1000;
    const jpy = await currencyFor(em, 'JPY');
    if (rate !== undefined) em.create(ExchangeRate, { date: new Date(Date.now() - 86_400_000), fromCurrency: jpy, rate, toCurrency: household.currency }, { partial: true });
    await em.flush();
    return { household, jpy };
  }

  const stored = async (name: string) => db.em().findOneOrFail(Account, { accountName: name }, { filters: false });

  it('stores no converted balance and marks it missing', async () => {
    const { household, jpy } = await aHousehold();

    const response = await accounts.as(household.appuser).post('/v1/account/offline').send({ currencyId: jpy.currencyKey, currentBalance: 10_000, name: 'Yen savings' });

    expect(response.status).toBe(201);
    expect(await stored('Yen savings')).toMatchObject({ appuserCurrencyBalance: null, balance: 10_000, fxStatus: FxStatus.MISSING });
  });

  it('is reported by net worth as unconverted, not counted as zero or at face value', async () => {
    const { household, jpy } = await aHousehold();
    await accounts.as(household.appuser).post('/v1/account/offline').send({ currencyId: jpy.currencyKey, currentBalance: 10_000, name: 'Yen savings' });

    const response = await netWorth.as(household.appuser).get('/v1/net-worth');

    expect(response.body).toMatchObject({ assets: { accounts: 1000 }, unsupportedCurrencies: { accounts: 1 } });
    expect(response.body.rows.map((row: { name: string }) => row.name)).not.toContain('Yen savings');
  });

  it('converts at the stored rate and marks it exact', async () => {
    const { household, jpy } = await aHousehold(0.006);

    await accounts.as(household.appuser).post('/v1/account/offline').send({ currencyId: jpy.currencyKey, currentBalance: 10_000, name: 'Yen savings' });

    expect(await stored('Yen savings')).toMatchObject({ appuserCurrencyBalance: 60, fxStatus: FxStatus.EXACT });
  });
});
