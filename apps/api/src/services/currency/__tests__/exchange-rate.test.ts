import { describe, expect, it } from 'vitest';

import { currencyFor } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FxStatus } from '@entity/Transaction';

import { convertWithStatus, resolveExchangeRate } from '../exchange-rate';

/*
 * One resolver picks every conversion rate. It answers with a stored rate or with nothing, never
 * with an implied 1 for two different currencies.
 */
describe('resolving an exchange rate', () => {
  const db = useTestDatabase();
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

  async function eurUsd(rates: [string, number][]) {
    const em = db.em();
    const eur = await currencyFor(em, 'EUR');
    const usd = await currencyFor(em, 'USD');
    const jpy = await currencyFor(em, 'JPY');
    for (const [date, rate] of rates) em.create(ExchangeRate, { date: day(date), fromCurrency: usd, rate, toCurrency: eur }, { partial: true });
    await em.flush();
    return { em, eur, jpy, usd };
  }

  it('takes the latest rate on or before the date', async () => {
    const { em, eur, usd } = await eurUsd([['2026-03-02', 0.91], ['2026-03-05', 0.92], ['2026-03-09', 0.95]]);

    expect(await resolveExchangeRate(em, usd, eur, day('2026-03-06'))).toEqual({ rate: 0.92, rateDate: day('2026-03-05'), source: 'ecb', status: FxStatus.EXACT });
  });

  it('marks a rate older than the staleness window provisional', async () => {
    const { em, eur, usd } = await eurUsd([['2026-03-02', 0.91]]);

    expect(await resolveExchangeRate(em, usd, eur, day('2026-03-20'))).toMatchObject({ rate: 0.91, status: FxStatus.PROVISIONAL });
    expect(await resolveExchangeRate(em, usd, eur, day('2026-03-20'), { staleAfterDays: 30 })).toMatchObject({ status: FxStatus.EXACT });
  });

  it('finds nothing when no rate is stored on or before the date', async () => {
    const { em, eur, jpy, usd } = await eurUsd([['2026-03-09', 0.95]]);

    expect(await resolveExchangeRate(em, usd, eur, day('2026-03-01'))).toBeNull();
    expect(await resolveExchangeRate(em, jpy, eur, day('2026-03-10'))).toBeNull();
  });

  it('needs no rate within one currency', async () => {
    const { em, eur } = await eurUsd([]);

    expect(await resolveExchangeRate(em, eur, eur, day('2026-03-01'))).toMatchObject({ rate: 1, source: 'same-currency', status: FxStatus.EXACT });
  });

  it('stores no converted amount when no rate exists, rather than the foreign amount', async () => {
    const { em, eur, jpy, usd } = await eurUsd([['2026-03-05', 0.92]]);

    expect(await convertWithStatus(em, 10_000, jpy, eur, day('2026-03-06'))).toEqual({ amount: null, fxStatus: FxStatus.MISSING, rate: null });
    expect(await convertWithStatus(em, 19.99, usd, eur, day('2026-03-06'))).toEqual({ amount: 18.3908, fxStatus: FxStatus.EXACT, rate: 0.92 });
    expect(await convertWithStatus(em, 5, eur, eur, day('2026-03-06'))).toEqual({ amount: 5, fxStatus: FxStatus.EXACT, rate: null });
  });
});
